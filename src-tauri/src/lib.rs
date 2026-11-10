use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Подпапка внутри папки данных, где лежат проекты.
const PROJECTS_DIR: &str = "projects";
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

type CmdResult<T> = Result<T, String>;

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
fn write_atomic(path: &Path, contents: &str) -> CmdResult<()> {
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
    let projects = dir.join(PROJECTS_DIR);
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
        .invoke_handler(tauri::generate_handler![get_data_dir, set_data_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
