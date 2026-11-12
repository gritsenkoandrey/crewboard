mod storage;
mod board_merge;
mod agents;
pub mod agent_cli;
mod board;
mod docs;
mod projects;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Application settings file in %APPDATA%\com.local.tasktrack\.
const CONFIG_FILE: &str = "config.json";

/// Application settings are stored separately from data: after reinstalling Windows,
/// only settings are lost; selecting the existing project folder restores access to the data.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    data_dir: Option<PathBuf>,
}

/// Data folder state for the UI.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirInfo {
    /// Path from settings, if a folder was previously selected.
    path: Option<String>,
    /// A folder was selected but is unavailable (deleted or on a disconnected drive).
    missing: bool,
}

pub(crate) type CmdResult<T> = Result<T, String>;

fn config_path(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to locate the settings folder: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

fn read_config(app: &AppHandle) -> CmdResult<Config> {
    let path = config_path(app)?;
    match fs::read_to_string(&path) {
        // A corrupt settings file must not prevent startup; ask the user to select a folder again.
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(format!("Failed to read settings: {e}")),
    }
}

/// Writes through a temporary file so an interrupted write cannot leave a truncated file.
pub(crate) fn write_atomic(path: &Path, contents: &str) -> CmdResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create folder {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Failed to save {}: {e}", path.display()))
}

fn write_config(app: &AppHandle, config: &Config) -> CmdResult<()> {
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    write_atomic(&config_path(app)?, &text)
}

/// Current data folder. Returns an error if it is not selected or is unavailable.
pub(crate) fn data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    match read_config(app)?.data_dir {
        Some(dir) if dir.is_dir() => Ok(dir),
        Some(dir) => Err(format!("Data folder is unavailable: {}", dir.display())),
        None => Err("Data folder is not selected".into()),
    }
}

#[tauri::command]
fn get_data_dir(app: AppHandle) -> CmdResult<DataDirInfo> {
    let config = read_config(&app)?;
    Ok(match config.data_dir {
        Some(dir) => DataDirInfo {
            missing: !dir.is_dir(),
            path: Some(dir.to_string_lossy().into_owned()),
        },
        None => DataDirInfo { path: None, missing: false },
    })
}

/// Stores the data folder and prepares its structure without modifying existing data,
/// so selecting the old folder after reinstalling restores access to all data.
#[tauri::command]
fn set_data_dir(app: AppHandle, path: String) -> CmdResult<DataDirInfo> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("Folder not found: {path}"));
    }
    let projects = projects::projects_root(&dir);
    fs::create_dir_all(&projects).map_err(|e| format!("Failed to create {}: {e}", projects.display()))?;
    write_config(&app, &Config { data_dir: Some(dir) })?;
    Ok(DataDirInfo { path: Some(path), missing: false })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second application launch brings the existing window to the foreground,
        // preventing two instances from writing to the same files.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        // Open documentation links in the system browser rather than inside the window.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            agents::get_participants,
            agents::create_participant,
            agents::get_source_dir,
            agents::set_source_dir,
            agents::release_task,
            get_data_dir,
            set_data_dir,
            projects::list_projects,
            projects::create_project,
            projects::rename_project,
            projects::delete_project,
            projects::set_cover,
            projects::remove_cover,
            board::get_board,
            board::save_board,
            docs::link_document,
            docs::unlink_document,
            docs::document_revisions,
            docs::list_documents,
            docs::create_document,
            docs::rename_document,
            docs::reorder_documents,
            docs::get_document,
            docs::save_document,
            docs::delete_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
