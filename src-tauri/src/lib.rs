mod board;
mod docs;
mod projects;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Файл настроек приложения в %APPDATA%\com.local.tasktrack\.
const CONFIG_FILE: &str = "config.json";

/// Настройки приложения. Хранятся отдельно от данных: при переустановке Windows
/// теряются только они, а папку с проектами достаточно выбрать заново.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    data_dir: Option<PathBuf>,
}

/// Состояние папки данных для интерфейса.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirInfo {
    /// Путь из настроек, если папка уже выбиралась.
    path: Option<String>,
    /// Папка выбрана, но сейчас недоступна (удалена, отключён диск).
    missing: bool,
}

pub(crate) type CmdResult<T> = Result<T, String>;

fn config_path(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Не удалось найти папку настроек: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

fn read_config(app: &AppHandle) -> CmdResult<Config> {
    let path = config_path(app)?;
    match fs::read_to_string(&path) {
        // Повреждённый файл настроек не должен ломать запуск: просто попросим выбрать папку заново.
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(format!("Не удалось прочитать настройки: {e}")),
    }
}

/// Пишет файл через временный, чтобы сбой посреди записи не оставил его обрезанным.
pub(crate) fn write_atomic(path: &Path, contents: &str) -> CmdResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| format!("Не удалось записать {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Не удалось сохранить {}: {e}", path.display()))
}

fn write_config(app: &AppHandle, config: &Config) -> CmdResult<()> {
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    write_atomic(&config_path(app)?, &text)
}

/// Текущая папка данных. Ошибка, если она не выбрана или недоступна.
pub(crate) fn data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    match read_config(app)?.data_dir {
        Some(dir) if dir.is_dir() => Ok(dir),
        Some(dir) => Err(format!("Папка с данными недоступна: {}", dir.display())),
        None => Err("Папка с данными не выбрана".into()),
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

/// Запоминает папку данных и готовит в ней структуру. Существующие данные не трогает,
/// поэтому после переустановки можно указать старую папку и всё подхватится.
#[tauri::command]
fn set_data_dir(app: AppHandle, path: String) -> CmdResult<DataDirInfo> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("Папка не найдена: {path}"));
    }
    let projects = projects::projects_root(&dir);
    fs::create_dir_all(&projects).map_err(|e| format!("Не удалось создать {}: {e}", projects.display()))?;
    write_config(&app, &Config { data_dir: Some(dir) })?;
    Ok(DataDirInfo { path: Some(path), missing: false })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Второй запуск приложения просто разворачивает уже открытое окно,
        // чтобы два экземпляра не писали в одни и те же файлы.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        // Ссылки из документации открываются в системном браузере, а не внутри окна.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_data_dir,
            set_data_dir,
            projects::list_projects,
            projects::create_project,
            projects::rename_project,
            projects::delete_project,
            board::get_board,
            board::save_board,
            docs::get_readme,
            docs::save_readme,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
