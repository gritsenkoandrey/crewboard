//! Документация проекта: файл `README.md` в папке проекта.

use crate::projects::{project_dir, README_FILE};
use crate::{write_atomic, CmdResult};
use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readme {
    text: String,
    /// Папка проекта: относительно неё открываются картинки из markdown.
    dir: String,
}

#[tauri::command]
pub fn get_readme(app: AppHandle, id: String) -> CmdResult<Readme> {
    let dir = project_dir(&app, &id)?;
    let text = match fs::read_to_string(dir.join(README_FILE)) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("Не удалось прочитать README.md: {e}")),
    };
    Ok(Readme { text, dir: dir.to_string_lossy().into_owned() })
}

#[tauri::command]
pub fn save_readme(app: AppHandle, id: String, text: String) -> CmdResult<()> {
    let path = project_dir(&app, &id)?.join(README_FILE);
    write_atomic(&path, &text)
}
