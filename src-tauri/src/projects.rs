//! Projects on disk. Each project is a folder under `<data>\projects\`:
//!
//! ```text
//! my-game\
//!   project.json   { name, createdAt, cover? }
//!   README.md      documentation
//!   board.json     { todo, inProgress, done }
//! ```
//!
//! The folder name is the project ID. It is set at creation and never changes;
//! renaming only updates `name` in project.json.

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

/// Contents of project.json.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMeta {
    name: String,
    #[serde(default)]
    created_at: u64,
    /// Cover image filename within the project folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cover: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_dir: Option<String>,
}

/// Project data for the UI.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    id: String,
    name: String,
    created_at: u64,
    /// Absolute cover image path, if configured and the file exists.
    cover_path: Option<String>,
    source_dir: Option<String>,
    /// Absolute project folder path used to resolve relative Markdown image paths.
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
        return Err("Project name cannot be empty".into());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("Name exceeds {MAX_NAME_CHARS} characters"));
    }
    Ok(name.to_string())
}

/// Resolve a project folder by ID. IDs come from the UI and must stay within `projects\`.
pub(crate) fn project_dir(app: &AppHandle, id: &str) -> CmdResult<PathBuf> {
    if id.is_empty() || id == "." || id == ".." || id.contains(['/', '\\', ':']) {
        return Err(format!("Invalid project ID: {id}"));
    }
    let dir = projects_root(&data_dir(app)?).join(id);
    if !dir.is_dir() {
        return Err(format!("Project not found: {id}"));
    }
    Ok(dir)
}

/// Derive a folder name from the title: keep letters and digits, including Cyrillic; replace the rest with hyphens.
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
    // Windows reserved names cannot be used as folder names.
    const RESERVED: &[&str] = &["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "lpt1", "lpt2", "lpt3"];
    if slug.is_empty() || RESERVED.contains(&slug.as_str()) {
        format!("project-{slug}").trim_end_matches('-').to_string()
    } else {
        slug
    }
}

/// Find an available folder name: `slug`, `slug-2`, `slug-3`, etc.
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
        source_dir: meta.source_dir,
        dir: dir.to_string_lossy().into_owned(),
    }
}

/// Read a project. Still show folders with a missing or corrupt project.json,
/// using the folder name as the title so data does not disappear from the list.
fn load_project(dir: &Path) -> Project {
    let meta = read_meta(dir).unwrap_or_else(|| ProjectMeta {
        name: dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        created_at: 0,
        cover: None, source_dir: None,
    });
    to_project(dir, meta)
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> CmdResult<Vec<Project>> {
    let root = projects_root(&data_dir(&app)?);
    fs::create_dir_all(&root).map_err(|e| format!("Failed to create {}: {e}", root.display()))?;
    let entries = fs::read_dir(&root).map_err(|e| format!("Failed to read {}: {e}", root.display()))?;
    let mut projects: Vec<Project> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| load_project(&entry.path()))
        .collect();
    // Sort newest first, breaking ties alphabetically.
    projects.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(projects)
}

#[tauri::command]
pub fn create_project(app: AppHandle, name: String) -> CmdResult<Project> {
    let name = validate_name(&name)?;
    let root = projects_root(&data_dir(&app)?);
    fs::create_dir_all(&root).map_err(|e| format!("Failed to create {}: {e}", root.display()))?;
    let dir = unique_dir(&root, &slugify(&name));
    fs::create_dir(&dir).map_err(|e| format!("Failed to create the project folder: {e}"))?;

    let meta = ProjectMeta { name: name.clone(), created_at: now_ms(), cover: None, source_dir: None };
    write_meta(&dir, &meta)?;
    let board_text = serde_json::to_string_pretty(&crate::board::new_board()).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(BOARD_FILE), &(board_text + "\n"))?;
    Ok(to_project(&dir, meta))
}

#[tauri::command]
pub fn rename_project(app: AppHandle, id: String, name: String) -> CmdResult<Project> {
    let name = validate_name(&name)?;
    let dir = project_dir(&app, &id)?;
    let _lock = crate::storage::lock(&dir, "project.lock")?;
    let mut meta = read_meta(&dir).unwrap_or(ProjectMeta { name: String::new(), created_at: now_ms(), cover: None, source_dir: None });
    meta.name = name;
    write_meta(&dir, &meta)?;
    Ok(to_project(&dir, meta))
}

/// Image formats supported by WebView2.
const COVER_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];
const MAX_COVER_BYTES: u64 = 30 * 1024 * 1024;

/// Deletes the previous cover image if it is inside the project folder.
fn remove_cover_file(dir: &Path, meta: &ProjectMeta) {
    if let Some(file) = &meta.cover {
        // project.json may have been edited manually; prevent paths from escaping the project folder.
        if !file.contains(['/', '\\']) && file != ".." {
            let _ = fs::remove_file(dir.join(file));
        }
    }
}

/// Copy an image into the project folder and set it as the cover. Use a new filename each time
/// (`cover-<timestamp>.png`) so WebView cannot display a stale cached image.
#[tauri::command]
pub fn set_cover(app: AppHandle, id: String, source: String) -> CmdResult<Project> {
    let dir = project_dir(&app, &id)?;
    let _lock = crate::storage::lock(&dir, "project.lock")?;
    let source = PathBuf::from(source);
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| COVER_EXTENSIONS.contains(&e.as_str()))
        .ok_or_else(|| format!("Supported image formats: {}", COVER_EXTENSIONS.join(", ")))?;
    let size = fs::metadata(&source).map_err(|e| format!("Failed to open file: {e}"))?.len();
    if size > MAX_COVER_BYTES {
        return Err(format!("Image exceeds {} MB", MAX_COVER_BYTES / 1024 / 1024));
    }

    let file_name = format!("cover-{}.{ext}", now_ms());
    fs::copy(&source, dir.join(&file_name)).map_err(|e| format!("Failed to copy the image: {e}"))?;

    let mut meta = read_meta(&dir).unwrap_or_else(|| ProjectMeta {
        name: id.clone(),
        created_at: now_ms(),
        cover: None, source_dir: None,
    });
    remove_cover_file(&dir, &meta);
    meta.cover = Some(file_name);
    write_meta(&dir, &meta)?;
    Ok(to_project(&dir, meta))
}

#[tauri::command]
pub fn remove_cover(app: AppHandle, id: String) -> CmdResult<Project> {
    let dir = project_dir(&app, &id)?;
    let _lock = crate::storage::lock(&dir, "project.lock")?;
    let Some(mut meta) = read_meta(&dir) else {
        return Ok(load_project(&dir));
    };
    remove_cover_file(&dir, &meta);
    meta.cover = None;
    write_meta(&dir, &meta)?;
    Ok(to_project(&dir, meta))
}

/// Moves a project to the Windows Recycle Bin so accidental deletion can be undone.
#[tauri::command]
pub async fn delete_project(app: AppHandle, id: String) -> CmdResult<()> {
    let dir = project_dir(&app, &id)?;
    recycle_project(dir).await
}

async fn recycle_project(dir: PathBuf) -> CmdResult<()> {
    // Shell/COM operations must not run inside the WebView's synchronous IPC callback.
    tauri::async_runtime::spawn_blocking(move || {
        // Wait for in-flight project and board writes to finish, then release the locks:
        // Windows refuses to move a directory while any file inside it (the lock files too)
        // is still open, which surfaced as "access denied to the source (0x80270021)".
        drop(crate::storage::lock(&dir, "project.lock")?);
        drop(crate::storage::lock(&dir, "board.lock")?);
        trash::delete(&dir).map_err(|e| format!("Failed to move the project to the Recycle Bin: {e}"))
    }).await.map_err(|e| format!("Project recycling worker failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::slugify;

    #[cfg(windows)]
    #[test]
    fn recycles_project_on_configured_volume() {
        use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
        let parent = std::env::var_os("TASKTRACK_RECYCLE_TEST_ROOT").map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target"));
        let root = parent.join(format!(".task-track-recycle-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let dir = root.join("sample");
        fs::create_dir_all(&dir).unwrap();
        let files = ["project.json", "board.json", "board.lock", "documents.json", "doc-test.md"];
        for file in files { fs::write(dir.join(file), "Disposable test fixture").unwrap(); }
        let result = tauri::async_runtime::block_on(super::recycle_project(dir.clone()));
        let source_exists = dir.exists();
        if source_exists {
            for file in files { fs::remove_file(dir.join(file)).unwrap(); }
            let _ = fs::remove_file(dir.join("project.lock"));
            fs::remove_dir(&dir).unwrap();
        }
        fs::remove_dir(&root).unwrap();
        assert!(result.is_ok(), "{result:?}");
        assert!(!source_exists, "The project should be moved to the Recycle Bin");
    }

    #[cfg(windows)]
    #[test]
    fn recycling_failure_keeps_the_project_and_releases_its_lock() {
        use std::{fs, os::windows::fs::OpenOptionsExt, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target").join(format!(".task-track-recycle-locked-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let dir = root.join("sample");
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("project.json");
        fs::write(&source, "Disposable locked test fixture").unwrap();
        // Simulate an editor opening the source without FILE_SHARE_DELETE.
        let held_file = fs::OpenOptions::new().read(true).share_mode(1).open(&source).unwrap();
        let result = tauri::async_runtime::block_on(super::recycle_project(dir.clone()));
        drop(held_file);
        let preserved = fs::read_to_string(&source);
        // The shell may recycle unlocked children before reporting a locked source.
        let lock_released = fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(dir.join("project.lock")).unwrap().try_lock().is_ok();
        fs::remove_file(&source).unwrap();
        fs::remove_file(dir.join("project.lock")).unwrap();
        let _ = fs::remove_file(dir.join("board.lock"));
        fs::remove_dir(&dir).unwrap();
        fs::remove_dir(&root).unwrap();
        assert!(result.is_err(), "A locked project must not be forcibly deleted");
        assert_eq!(preserved.unwrap(), "Disposable locked test fixture");
        assert!(lock_released);
    }

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
