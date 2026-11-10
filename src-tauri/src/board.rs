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

/// Должно совпадать с TASK_TITLE_MAX в src/components/Board.tsx.
const MAX_TITLE_CHARS: usize = 2000;
/// Защита от случайной вставки огромного текста; обычному описанию хватит с запасом.
const MAX_DESCRIPTION_CHARS: usize = 200_000;
/// Должно совпадать с LABEL_NAME_MAX в src/labels.ts.
const MAX_LABEL_CHARS: usize = 40;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Task {
    id: String,
    title: String,
    /// Подробное описание в markdown. Пустое не пишем в файл, старые доски без поля читаются как есть.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    description: String,
    /// id меток проекта.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    labels: Vec<String>,
}

/// Метка проекта. Цвет — ключ из палитры интерфейса (`red`, `blue`…), а не произвольный hex.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Label {
    id: String,
    name: String,
    color: String,
}

#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    #[serde(default)]
    todo: Vec<Task>,
    #[serde(default)]
    in_progress: Vec<Task>,
    #[serde(default)]
    done: Vec<Task>,
    #[serde(default)]
    labels: Vec<Label>,
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
fn validate(mut board: Board) -> CmdResult<Board> {
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

#[tauri::command]
pub fn get_board(app: AppHandle, id: String) -> CmdResult<Board> {
    let path = project_dir(&app, &id)?.join(BOARD_FILE);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            // Повреждённый файл не перезаписываем пустой доской молча — показываем ошибку.
            .map_err(|e| format!("Файл доски повреждён ({}): {e}", path.display())),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(Board::default()),
        Err(e) => Err(format!("Не удалось прочитать доску: {e}")),
    }
}

#[tauri::command]
pub fn save_board(app: AppHandle, id: String, board: Board) -> CmdResult<()> {
    let board = validate(board)?;
    let path = project_dir(&app, &id)?.join(BOARD_FILE);
    let text = serde_json::to_string_pretty(&board).map_err(|e| e.to_string())?;
    write_atomic(&path, &(text + "\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board(json: &str) -> Board {
        serde_json::from_str(json).unwrap()
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
