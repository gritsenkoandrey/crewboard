//! Канбан-доска проекта: файл `board.json` в папке проекта.
//! Порядок задач в массиве — это их порядок в колонке.
//! Метки проекта хранятся здесь же: так удаление метки и снятие её с задач — одна запись.

use crate::projects::{project_dir, BOARD_FILE};
use crate::{write_atomic, CmdResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use tauri::AppHandle;
use std::path::Path;

/// Должно совпадать с TASK_TITLE_MAX в src/components/Board.tsx.
const MAX_TITLE_CHARS: usize = 2000;
/// Защита от случайной вставки огромного текста; обычному описанию хватит с запасом.
const MAX_DESCRIPTION_CHARS: usize = 200_000;
/// Должно совпадать с LABEL_NAME_MAX в src/labels.ts.
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
    /// Подробное описание в markdown. Пустое не пишем в файл, старые доски без поля читаются как есть.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    description: String,
    /// id меток проекта.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    labels: Vec<String>,
    /// Extension fields (assignment, sessions, reports) survive edits from older views.
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

/// Метка проекта. Цвет — ключ из палитры интерфейса (`red`, `blue`…), а не произвольный hex.
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

/// Проверяет доску перед записью и убирает с задач ссылки на несуществующие метки.
pub(crate) fn validate(mut board: Board) -> CmdResult<Board> {
    let mut label_ids = HashSet::new();
    for label in &board.labels {
        let name = label.name.trim();
        if name.is_empty() {
            return Err("Название метки не может быть пустым".into());
        }
        if name.chars().count() > MAX_LABEL_CHARS {
            return Err(format!("Название метки длиннее {MAX_LABEL_CHARS} символов"));
        }
        if !label_ids.insert(label.id.clone()) {
            return Err(format!("Повторяющийся id метки: {}", label.id));
        }
    }

    let mut task_ids = HashSet::new();
    for task in board.tasks() {
        if task.title.trim().is_empty() {
            return Err("Название задачи не может быть пустым".into());
        }
        if task.title.chars().count() > MAX_TITLE_CHARS {
            return Err(format!("Название задачи длиннее {MAX_TITLE_CHARS} символов"));
        }
        if task.description.chars().count() > MAX_DESCRIPTION_CHARS {
            return Err(format!("Описание задачи длиннее {MAX_DESCRIPTION_CHARS} символов"));
        }
        if task.extra.get("acceptanceCriteria").and_then(serde_json::Value::as_str).is_some_and(|v| v.chars().count() > MAX_DESCRIPTION_CHARS) {
            return Err("Условия готовности длиннее 200000 символов".into());
        }
        if !task_ids.insert(task.id.clone()) {
            return Err(format!("Повторяющийся id задачи: {}", task.id));
        }
    }

    // Висячие ссылки на удалённые метки и повторы молча убираем: это не ошибка пользователя.
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
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("Файл доски повреждён: {e}"))?,
        Err(e) if e.kind() == ErrorKind::NotFound => new_board(),
        Err(e) => return Err(format!("Не удалось прочитать доску: {e}")),
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
        assert!(!text.contains("labels"), "пустой список меток задачи не пишем: {text}");
    }
}
