//! Проекты на диске. Каждый проект — папка внутри `<данные>\projects\`:
//!
//! ```text
//! my-game\
//!   project.json   { name, createdAt, cover? }
//!   README.md      документация
//!   board.json     { todo, inProgress, done }
//! ```
//!
//! Имя папки — это id проекта. Оно задаётся при создании и дальше не меняется,
//! переименование меняет только `name` в project.json.

use crate::{data_dir, write_atomic, CmdResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const PROJECTS_DIR: &str = "projects";
const META_FILE: &str = "project.json";
pub(crate) const BOARD_FILE: &str = "board.json";
const MAX_NAME_CHARS: usize = 200;
const MAX_SLUG_CHARS: usize = 40;

/// Содержимое project.json.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMeta {
    name: String,
    #[serde(default)]
    created_at: u64,
    /// Имя файла обложки внутри папки проекта.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cover: Option<String>,
}

/// Проект для интерфейса.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    id: String,
    name: String,
    created_at: u64,
    /// Полный путь к обложке, если она есть и файл на месте.
    cover_path: Option<String>,
    /// Полный путь к папке проекта: относительно неё открываются картинки из markdown.
    dir: String,
}

pub fn projects_root(data: &Path) -> PathBuf {
    data.join(PROJECTS_DIR)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn validate_name(name: &str) -> CmdResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Название проекта не может быть пустым".into());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("Название длиннее {MAX_NAME_CHARS} символов"));
    }
    Ok(name.to_string())
}

/// Папка проекта по id. id приходит из интерфейса, поэтому не пускаем его за пределы `projects\`.
pub(crate) fn project_dir(app: &AppHandle, id: &str) -> CmdResult<PathBuf> {
    if id.is_empty() || id == "." || id == ".." || id.contains(['/', '\\', ':']) {
        return Err(format!("Некорректный id проекта: {id}"));
    }
    let dir = projects_root(&data_dir(app)?).join(id);
    if !dir.is_dir() {
        return Err(format!("Проект не найден: {id}"));
    }
    Ok(dir)
}

/// Имя папки из названия: буквы и цифры (в том числе кириллица), остальное — дефисы.
fn slugify(name: &str) -> String {
    let mut slug = String::new();
    for ch in name.to_lowercase().chars() {
        if ch.is_alphanumeric() {
            slug.push(ch);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug: String = slug.trim_matches('-').chars().take(MAX_SLUG_CHARS).collect();
    let slug = slug.trim_end_matches('-').to_string();
    // Зарезервированные имена Windows нельзя использовать как имя папки.
    const RESERVED: &[&str] = &["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "lpt1", "lpt2", "lpt3"];
    if slug.is_empty() || RESERVED.contains(&slug.as_str()) {
        format!("project-{slug}").trim_end_matches('-').to_string()
    } else {
        slug
    }
}

/// Свободное имя папки: `slug`, `slug-2`, `slug-3`…
fn unique_dir(root: &Path, slug: &str) -> PathBuf {
    let mut dir = root.join(slug);
    let mut n = 2;
    while dir.exists() {
        dir = root.join(format!("{slug}-{n}"));
        n += 1;
    }
    dir
}

fn read_meta(dir: &Path) -> Option<ProjectMeta> {
    let text = fs::read_to_string(dir.join(META_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_meta(dir: &Path, meta: &ProjectMeta) -> CmdResult<()> {
    let text = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(META_FILE), &text)
}

fn to_project(dir: &Path, meta: ProjectMeta) -> Project {
    let id = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let cover_path = meta
        .cover
        .as_deref()
        .map(|file| dir.join(file))
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned());
    Project {
        id,
        name: meta.name,
        created_at: meta.created_at,
        cover_path,
        dir: dir.to_string_lossy().into_owned(),
    }
}

/// Читает проект. Папку без project.json (или с повреждённым) всё равно показываем,
/// взяв название из имени папки, — чтобы данные не «пропадали» из списка.
fn load_project(dir: &Path) -> Project {
    let meta = read_meta(dir).unwrap_or_else(|| ProjectMeta {
        name: dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        created_at: 0,
        cover: None,
    });
    to_project(dir, meta)
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> CmdResult<Vec<Project>> {
    let root = projects_root(&data_dir(&app)?);
    fs::create_dir_all(&root).map_err(|e| format!("Не удалось создать {}: {e}", root.display()))?;
    let entries = fs::read_dir(&root).map_err(|e| format!("Не удалось прочитать {}: {e}", root.display()))?;
    let mut projects: Vec<Project> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| load_project(&entry.path()))
        .collect();
    // Новые сверху, при равенстве — по алфавиту.
    projects.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(projects)
}

#[tauri::command]
pub fn create_project(app: AppHandle, name: String) -> CmdResult<Project> {
    let name = validate_name(&name)?;
    let root = projects_root(&data_dir(&app)?);
    fs::create_dir_all(&root).map_err(|e| format!("Не удалось создать {}: {e}", root.display()))?;
    let dir = unique_dir(&root, &slugify(&name));
    fs::create_dir(&dir).map_err(|e| format!("Не удалось создать папку проекта: {e}"))?;

    let meta = ProjectMeta { name: name.clone(), created_at: now_ms(), cover: None };
    write_meta(&dir, &meta)?;
    let board_text = serde_json::to_string_pretty(&crate::board::new_board()).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(BOARD_FILE), &(board_text + "\n"))?;
    Ok(to_project(&dir, meta))
}

#[tauri::command]
pub fn rename_project(app: AppHandle, id: String, name: String) -> CmdResult<Project> {
    let name = validate_name(&name)?;
    let dir = project_dir(&app, &id)?;
    let mut meta = read_meta(&dir).unwrap_or(ProjectMeta { name: String::new(), created_at: now_ms(), cover: None });
    meta.name = name;
    write_meta(&dir, &meta)?;
    Ok(to_project(&dir, meta))
}

/// Форматы, которые умеет показывать WebView2.
const COVER_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];
const MAX_COVER_BYTES: u64 = 30 * 1024 * 1024;

/// Удаляет файл старой обложки, если он лежит внутри папки проекта.
fn remove_cover_file(dir: &Path, meta: &ProjectMeta) {
    if let Some(file) = &meta.cover {
        // Имя из project.json могли поправить руками: не даём выйти за пределы папки проекта.
        if !file.contains(['/', '\\']) && file != ".." {
            let _ = fs::remove_file(dir.join(file));
        }
    }
}

/// Копирует картинку в папку проекта и делает её обложкой. Имя файла каждый раз новое
/// (`cover-<время>.png`), чтобы WebView не показывал старую картинку из кеша.
#[tauri::command]
pub fn set_cover(app: AppHandle, id: String, source: String) -> CmdResult<Project> {
    let dir = project_dir(&app, &id)?;
    let source = PathBuf::from(source);
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| COVER_EXTENSIONS.contains(&e.as_str()))
        .ok_or_else(|| format!("Поддерживаются картинки: {}", COVER_EXTENSIONS.join(", ")))?;
    let size = fs::metadata(&source).map_err(|e| format!("Не удалось открыть файл: {e}"))?.len();
    if size > MAX_COVER_BYTES {
        return Err(format!("Картинка больше {} МБ", MAX_COVER_BYTES / 1024 / 1024));
    }

    let file_name = format!("cover-{}.{ext}", now_ms());
    fs::copy(&source, dir.join(&file_name)).map_err(|e| format!("Не удалось скопировать картинку: {e}"))?;

    let mut meta = read_meta(&dir).unwrap_or_else(|| ProjectMeta {
        name: id.clone(),
        created_at: now_ms(),
        cover: None,
    });
    remove_cover_file(&dir, &meta);
    meta.cover = Some(file_name);
    write_meta(&dir, &meta)?;
    Ok(to_project(&dir, meta))
}

#[tauri::command]
pub fn remove_cover(app: AppHandle, id: String) -> CmdResult<Project> {
    let dir = project_dir(&app, &id)?;
    let Some(mut meta) = read_meta(&dir) else {
        return Ok(load_project(&dir));
    };
    remove_cover_file(&dir, &meta);
    meta.cover = None;
    write_meta(&dir, &meta)?;
    Ok(to_project(&dir, meta))
}

/// Удаляет проект в корзину Windows, чтобы случайное удаление можно было отменить.
#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> CmdResult<()> {
    let dir = project_dir(&app, &id)?;
    trash::delete(&dir).map_err(|e| format!("Не удалось переместить проект в корзину: {e}"))
}

#[cfg(test)]
mod tests {
    use super::slugify;

    #[test]
    fn slugify_keeps_letters_and_digits() {
        assert_eq!(slugify("Моя игра 2"), "моя-игра-2");
        assert_eq!(slugify("  Hello, World!  "), "hello-world");
    }

    #[test]
    fn slugify_handles_empty_and_reserved() {
        assert_eq!(slugify("!!!"), "project");
        assert_eq!(slugify("CON"), "project-con");
    }
}
