//! Канбан-доска проекта: файл `board.json` в папке проекта.
//! Порядок задач в массиве — это их порядок в колонке.

use crate::projects::{project_dir, BOARD_FILE};
use crate::{write_atomic, CmdResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use tauri::AppHandle;

const MAX_TITLE_CHARS: usize = 500;

#[derive(Serialize, Deserialize, Clone)]
pub struct Task {
    id: String,
    title: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    #[serde(default)]
    todo: Vec<Task>,
    #[serde(default)]
    in_progress: Vec<Task>,
    #[serde(default)]
    done: Vec<Task>,
}

impl Board {
    fn tasks(&self) -> impl Iterator<Item = &Task> {
        self.todo.iter().chain(&self.in_progress).chain(&self.done)
    }
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
    let mut seen = std::collections::HashSet::new();
    for task in board.tasks() {
        if task.title.trim().is_empty() {
            return Err("Название задачи не может быть пустым".into());
        }
        if task.title.chars().count() > MAX_TITLE_CHARS {
            return Err(format!("Название задачи длиннее {MAX_TITLE_CHARS} символов"));
        }
        if !seen.insert(task.id.as_str()) {
            return Err(format!("Повторяющийся id задачи: {}", task.id));
        }
    }
    let path = project_dir(&app, &id)?.join(BOARD_FILE);
    let text = serde_json::to_string_pretty(&board).map_err(|e| e.to_string())?;
    write_atomic(&path, &(text + "\n"))
}
