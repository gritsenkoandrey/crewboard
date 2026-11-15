//! Project Kanban board: the `board.json` file in the project folder.
//! Task order in each array determines the order within its column.
//! Store project labels here too, so deleting a label and removing it from tasks takes one write.

use crate::projects::{project_dir, BOARD_FILE};
use crate::{write_atomic, CmdResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use tauri::AppHandle;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;

struct DeletedTask {
    token: String,
    dir: PathBuf,
    task: Task,
    column: usize,
    position: usize,
}

#[derive(Default)]
pub struct DeletedTaskState(Mutex<Option<DeletedTask>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedTaskReceipt {
    token: String,
    number: Option<u64>,
    board: Board,
}

/// Must match TASK_TITLE_MAX in src/components/Board.tsx.
const MAX_TITLE_CHARS: usize = 2000;
/// Guard against accidentally pasting huge text; leave ample room for normal descriptions.
const MAX_DESCRIPTION_CHARS: usize = 200_000;
/// Must match LABEL_NAME_MAX in src/labels.ts.
const MAX_LABEL_CHARS: usize = 40;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    id: String,
    title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    number: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    updated_at: Option<u64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    archived: bool,
    /// Detailed Markdown description. Omit when empty and accept older boards without this field.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    description: String,
    /// Project label IDs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    labels: Vec<String>,
    /// Extension fields (assignment, sessions, reports) survive edits from older views.
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

/// Project label. Its color is a UI palette key (`red`, `blue`, etc.), not an arbitrary hex value.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Label {
    id: String,
    name: String,
    color: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    #[serde(default)]
    task_prefix: String,
    #[serde(default)]
    next_task_number: u64,
    #[serde(default)]
    todo: Vec<Task>,
    #[serde(default)]
    in_progress: Vec<Task>,
    #[serde(default)]
    done: Vec<Task>,
    #[serde(default)]
    labels: Vec<Label>,
}

/// Defaults are applied only on board creation, never when loading existing boards.
pub(crate) fn new_board() -> Board {
    let labels = [("improve", "Improve", "blue"), ("bug", "Bug", "red"),
        ("agent", "Agent", "purple"), ("feature", "Feature", "green")]
        .into_iter().map(|(id, name, color)| Label {
            id: id.into(), name: name.into(), color: color.into(),
        }).collect();
    Board { labels, ..Board::default() }
}

impl Board {
    fn tasks(&self) -> impl Iterator<Item = &Task> {
        self.todo.iter().chain(&self.in_progress).chain(&self.done)
    }

    fn tasks_mut(&mut self) -> impl Iterator<Item = &mut Task> {
        self.todo.iter_mut().chain(&mut self.in_progress).chain(&mut self.done)
    }
}

/// Validates the board before saving and removes references to nonexistent labels from tasks.
pub(crate) fn validate(mut board: Board) -> CmdResult<Board> {
    let mut label_ids = HashSet::new();
    for label in &board.labels {
        let name = label.name.trim();
        if name.is_empty() {
            return Err("Label name cannot be empty".into());
        }
        if name.chars().count() > MAX_LABEL_CHARS {
            return Err(format!("Label name exceeds {MAX_LABEL_CHARS} characters"));
        }
        if !label_ids.insert(label.id.clone()) {
            return Err(format!("Duplicate label ID: {}", label.id));
        }
    }

    let mut task_ids = HashSet::new();
    for task in board.tasks() {
        if task.title.trim().is_empty() {
            return Err("Task title cannot be empty".into());
        }
        if task.title.chars().count() > MAX_TITLE_CHARS {
            return Err(format!("Task title exceeds {MAX_TITLE_CHARS} characters"));
        }
        if task.description.chars().count() > MAX_DESCRIPTION_CHARS {
            return Err(format!("Task description exceeds {MAX_DESCRIPTION_CHARS} characters"));
        }
        if task.extra.get("acceptanceCriteria").and_then(serde_json::Value::as_str).is_some_and(|v| v.chars().count() > MAX_DESCRIPTION_CHARS) {
            return Err("Acceptance criteria exceed 200000 characters".into());
        }
        if !task_ids.insert(task.id.clone()) {
            return Err(format!("Duplicate task ID: {}", task.id));
        }
    }

    // Silently remove dangling label references and duplicates; these are not user errors.
    for task in board.tasks_mut() {
        let mut seen = HashSet::new();
        task.labels.retain(|id| label_ids.contains(id) && seen.insert(id.clone()));
    }
    Ok(board)
}

/// Assign missing numbers once, preserving the high-water mark after deletions.
pub(crate) fn initialize_metadata(board: &mut Board, name: &str) {
    if board.task_prefix.is_empty() {
        let words: Vec<&str> = name.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
        board.task_prefix = if words.len() > 1 {
            words.iter().filter_map(|w| w.chars().next()).take(5).collect::<String>().to_uppercase()
        } else {
            words.first().unwrap_or(&"TT").chars().take(3).collect::<String>().to_uppercase()
        };
    }
    let mut next = board.next_task_number.max(board.tasks().filter_map(|t| t.number).max().unwrap_or(0) + 1).max(1);
    let mut used = HashSet::new();
    for task in board.tasks_mut() {
        if task.number.is_none_or(|n| n == 0 || !used.insert(n)) {
            task.number = Some(next);
            used.insert(next);
            next += 1;
        }
    }
    board.next_task_number = next;
}

pub(crate) fn load(dir: &Path) -> CmdResult<Board> {
    let path = dir.join(BOARD_FILE);
    let mut board: Board = match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("Board file is corrupt: {e}"))?,
        Err(e) if e.kind() == ErrorKind::NotFound => new_board(),
        Err(e) => return Err(format!("Failed to read the board: {e}")),
    };
    let original = serde_json::to_string(&board).map_err(|e| e.to_string())?;
    let meta: serde_json::Value = fs::read_to_string(dir.join("project.json")).ok()
        .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    initialize_metadata(&mut board, meta["name"].as_str().unwrap_or("Project"));
    if serde_json::to_string(&board).map_err(|e| e.to_string())? != original { store(dir, &board)?; }
    Ok(board)
}
pub(crate) fn store(dir: &Path, board: &Board) -> CmdResult<()> {
    let text = serde_json::to_string_pretty(board).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(BOARD_FILE), &(text + "\n"))
}
#[tauri::command]
pub fn get_board(app: AppHandle, id: String) -> CmdResult<Board> {
    let dir = project_dir(&app, &id)?;
    let _lock = crate::storage::lock(&dir, "board.lock")?;
    load(&dir)
}
#[tauri::command]
pub fn save_board(app: AppHandle, id: String, board: Board, base: Board) -> CmdResult<Board> {
    let dir = project_dir(&app, &id)?;
    let _lock = crate::storage::lock(&dir, "board.lock")?;
    let remote = load(&dir)?;
    let merged = crate::board_merge::merge(&base, &board, &remote)?;
    store(&dir, &merged)?;
    Ok(merged)
}

fn delete_with_undo(dir: &Path, expected: &Task, state: &DeletedTaskState) -> CmdResult<DeletedTaskReceipt> {
    let mut undo = state.0.lock().map_err(|_| "Task undo state is unavailable")?;
    let _lock = crate::storage::lock(dir, "board.lock")?;
    let mut board = load(dir)?;
    let (column, position) = [&board.todo, &board.in_progress, &board.done].into_iter().enumerate()
        .find_map(|(column, tasks)| tasks.iter().position(|task| task.id == expected.id).map(|position| (column, position)))
        .ok_or("Task not found")?;
    let tasks = match column { 0 => &mut board.todo, 1 => &mut board.in_progress, _ => &mut board.done };
    let current = &tasks[position];
    if current.extra.get("claim").is_some_and(serde_json::Value::is_object) {
        return Err("Release the task before deleting it".into());
    }
    if current != expected { return Err("The task changed before deletion. Reload it and try again.".into()); }
    let task = tasks.remove(position);
    let token = crate::agents::unique();
    store(dir, &board)?;
    let number = task.number;
    *undo = Some(DeletedTask { token: token.clone(), dir: dir.into(), task, column, position });
    Ok(DeletedTaskReceipt { token, number, board })
}

fn restore_with_undo(dir: &Path, token: &str, state: &DeletedTaskState) -> CmdResult<Board> {
    let mut undo = state.0.lock().map_err(|_| "Task undo state is unavailable")?;
    let saved = undo.as_ref().filter(|saved| saved.token == token && saved.dir == dir)
        .ok_or("This task deletion can no longer be undone")?;
    let _lock = crate::storage::lock(dir, "board.lock")?;
    let mut board = load(dir)?;
    if board.tasks().any(|task| task.id == saved.task.id || saved.task.number.is_some() && task.number == saved.task.number) {
        return Err("A task with this ID or number already exists. Nothing was overwritten.".into());
    }
    let lists = [&mut board.todo, &mut board.in_progress, &mut board.done];
    let tasks = lists.into_iter().nth(saved.column).ok_or("Invalid original task status")?;
    tasks.insert(saved.position.min(tasks.len()), saved.task.clone());
    if let Some(number) = saved.task.number { board.next_task_number = board.next_task_number.max(number.saturating_add(1)); }
    let board = validate(board)?;
    store(dir, &board)?;
    *undo = None;
    Ok(board)
}

#[tauri::command]
pub fn delete_task(app: AppHandle, id: String, task: Task, state: tauri::State<'_, DeletedTaskState>) -> CmdResult<DeletedTaskReceipt> {
    delete_with_undo(&project_dir(&app, &id)?, &task, &state)
}

#[tauri::command]
pub fn restore_deleted_task(app: AppHandle, id: String, token: String, state: tauri::State<'_, DeletedTaskState>) -> CmdResult<Board> {
    restore_with_undo(&project_dir(&app, &id)?, &token, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board(json: &str) -> Board {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn migration_preserves_numbers_and_counter_without_inventing_dates() {
        let mut b = board(r#"{"todo":[{"id":"a","title":"Old"}],"done":[{"id":"b","title":"Done","number":8}],"nextTaskNumber":12}"#);
        initialize_metadata(&mut b, "Task Track");
        assert_eq!(b.task_prefix, "TT");
        assert_eq!(b.todo[0].number, Some(12));
        assert_eq!(b.done[0].number, Some(8));
        assert_eq!(b.todo[0].updated_at, None);
        assert_eq!(b.next_task_number, 13);
        initialize_metadata(&mut b, "Renamed Project");
        assert_eq!(b.task_prefix, "TT");
        b.todo.clear();
        initialize_metadata(&mut b, "Renamed Project");
        assert_eq!(b.next_task_number, 13);
        let restored: Board = serde_json::from_str(&serde_json::to_string(&b).unwrap()).unwrap();
        assert_eq!(restored, b);
    }

    #[test]
    fn new_boards_have_editable_default_labels_but_old_boards_are_unchanged() {
        let fresh = new_board();
        let labels: Vec<(&str, &str)> = fresh.labels.iter().map(|l| (l.name.as_str(), l.color.as_str())).collect();
        assert_eq!(labels, vec![("Improve", "blue"), ("Bug", "red"), ("Agent", "purple"), ("Feature", "green")]);
        let mut old = board(r#"{"todo":[],"labels":[]}"#);
        initialize_metadata(&mut old, "Old Project");
        assert!(old.labels.is_empty());
        let mut edited = fresh;
        edited.labels.clear();
        initialize_metadata(&mut edited, "New Project");
        assert!(edited.labels.is_empty(), "deleted defaults must not reappear");
    }

    #[test]
    fn archived_task_survives_validation_and_roundtrip_with_status_and_content() {
        let mut b = board(r#"{"inProgress":[{"id":"a","title":"Archived","number":12,"archived":true,"updatedAt":1234,"description":"Keep me","labels":["bug"]}],"labels":[{"id":"bug","name":"Bug","color":"red"}]}"#);
        initialize_metadata(&mut b, "Task Track");
        let b = validate(b).unwrap();
        let restored: Board = serde_json::from_str(&serde_json::to_string(&b).unwrap()).unwrap();
        assert_eq!(restored, b);
        assert!(restored.in_progress[0].archived);
        assert_eq!(restored.in_progress[0].number, Some(12));
        assert_eq!(restored.in_progress[0].description, "Keep me");
        assert_eq!(restored.in_progress[0].labels, vec!["bug"]);
        assert_eq!(restored.in_progress[0].updated_at, Some(1234));
        assert!(restored.todo.is_empty());
        assert!(restored.done.is_empty());
    }

    #[test]
    fn old_board_without_labels_still_reads() {
        let b = board(r#"{ "todo": [{ "id": "a", "title": "Задача" }], "inProgress": [], "done": [] }"#);
        assert!(b.labels.is_empty());
        assert!(b.todo[0].labels.is_empty());
    }

    #[test]
    fn removes_dangling_and_duplicate_label_refs() {
        let b = board(
            r#"{
                "todo": [{ "id": "a", "title": "Задача", "labels": ["bug", "gone", "bug"] }],
                "labels": [{ "id": "bug", "name": "баг", "color": "red" }]
            }"#,
        );
        let b = validate(b).unwrap();
        assert_eq!(b.todo[0].labels, vec!["bug".to_string()]);
    }

    #[test]
    fn rejects_empty_label_name_and_duplicate_ids() {
        let empty = board(r#"{ "labels": [{ "id": "x", "name": "  ", "color": "red" }] }"#);
        assert!(validate(empty).is_err());
        let dup = board(
            r#"{ "labels": [
                { "id": "x", "name": "a", "color": "red" },
                { "id": "x", "name": "b", "color": "blue" }
            ] }"#,
        );
        assert!(validate(dup).is_err());
    }

    #[test]
    fn task_without_labels_is_written_without_field() {
        let b = board(r#"{ "todo": [{ "id": "a", "title": "Задача" }] }"#);
        let text = serde_json::to_string(&b.todo[0]).unwrap();
        assert!(!text.contains("labels"), "omit an empty task label list: {text}");
    }

    struct DeletionFixture(PathBuf);
    impl DeletionFixture {
        fn new() -> Self {
            let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target").join(format!(".task-delete-undo-test-{}", crate::agents::unique()));
            fs::create_dir_all(&dir).unwrap();
            let initial = board(r#"{"taskPrefix":"TT","nextTaskNumber":10,"todo":[{"id":"a","number":8,"title":"Delete me","description":"Keep text","acceptanceCriteria":"Keep criteria","labels":["bug"],"reports":[{"text":"Keep report"}]}],"inProgress":[{"id":"b","number":9,"title":"Other task"}],"done":[],"labels":[{"id":"bug","name":"Bug","color":"red"}]}"#);
            store(&dir, &initial).unwrap();
            Self(dir)
        }
    }
    impl Drop for DeletionFixture {
        fn drop(&mut self) {
            assert!(self.0.starts_with(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target")));
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test] fn deleted_task_undo_restores_identity_and_content_without_reverting_other_edits() {
        let fixture = DeletionFixture::new(); let state = DeletedTaskState::default();
        let expected = load(&fixture.0).unwrap().todo[0].clone();
        let deleted = delete_with_undo(&fixture.0, &expected, &state).unwrap();
        assert!(deleted.board.todo.is_empty()); assert_eq!(deleted.number, Some(8));
        let mut current = load(&fixture.0).unwrap(); current.in_progress[0].title = "Edited other task".into();
        current.next_task_number = 20; store(&fixture.0, &current).unwrap();
        let restored = restore_with_undo(&fixture.0, &deleted.token, &state).unwrap();
        assert_eq!(restored.todo[0], expected); assert_eq!(restored.in_progress[0].title, "Edited other task");
        assert_eq!(restored.next_task_number, 20);
        assert!(restore_with_undo(&fixture.0, &deleted.token, &state).is_err());
    }
    #[test] fn task_deletion_rejects_stale_content_and_active_sessions() {
        let fixture = DeletionFixture::new(); let state = DeletedTaskState::default();
        let expected = load(&fixture.0).unwrap().todo[0].clone();
        let mut newer = load(&fixture.0).unwrap(); newer.todo[0].title = "New title".into(); store(&fixture.0, &newer).unwrap();
        assert!(delete_with_undo(&fixture.0, &expected, &state).err().unwrap().contains("changed"));
        newer.todo[0].extra.insert("claim".into(), serde_json::json!({"sessionId":"new"})); store(&fixture.0, &newer).unwrap();
        assert!(delete_with_undo(&fixture.0, &newer.todo[0], &state).err().unwrap().contains("Release"));
        assert_eq!(load(&fixture.0).unwrap().todo.len(), 1);
    }
    #[test] fn deleted_task_undo_refuses_collisions_and_wrong_tokens_without_consuming_undo() {
        let fixture = DeletionFixture::new(); let state = DeletedTaskState::default();
        let expected = load(&fixture.0).unwrap().todo[0].clone();
        let deleted = delete_with_undo(&fixture.0, &expected, &state).unwrap();
        assert!(restore_with_undo(&fixture.0, "wrong-token", &state).is_err());
        let mut current = load(&fixture.0).unwrap(); let mut collision = expected.clone(); collision.id = "replacement".into();
        current.done.push(collision); store(&fixture.0, &current).unwrap();
        assert!(restore_with_undo(&fixture.0, &deleted.token, &state).unwrap_err().contains("already exists"));
        current.done.clear(); store(&fixture.0, &current).unwrap();
        assert_eq!(restore_with_undo(&fixture.0, &deleted.token, &state).unwrap().todo[0].id, "a");
    }
}
