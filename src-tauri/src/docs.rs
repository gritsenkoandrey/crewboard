//! Named Markdown documents. Titles and tab order live in documents.json;
//! file names remain stable when tabs are renamed.
use crate::projects::project_dir;
use crate::{write_atomic, CmdResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const INDEX: &str = "documents.json";
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Document {
    id: String,
    name: String,
    file: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "externalPath")]
    external_path: Option<String>,
}
#[derive(Serialize)]
pub struct DocumentContent { text: String, dir: String, revision: String }
#[derive(Serialize)]
pub struct DocumentRevision { id: String, revision: Option<String>, error: Option<String> }
fn revision(bytes: &[u8]) -> String {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hash); format!("{:x}", hash.finish())
}
fn external_file(path: &str) -> CmdResult<PathBuf> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("md")) {
        return Err("Выберите Markdown-файл с расширением .md".into());
    }
    Ok(path)
}
fn document_path(dir: &Path, doc: &Document) -> CmdResult<PathBuf> {
    match &doc.external_path {
        Some(source) => {
            let path = external_file(source)?;
            if path.exists() { fs::canonicalize(path).map_err(|e| e.to_string()) } else { Ok(path) }
        },
        None => file_path(dir, &doc.file),
    }
}

fn valid_name(name: &str) -> CmdResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("Название документа должно содержать от 1 до 100 символов".into());
    }
    Ok(name.into())
}
fn file_path(dir: &Path, file: &str) -> CmdResult<PathBuf> {
    if file.is_empty() || file.contains(['/', '\\', ':']) || file.starts_with('.')
        || !file.to_lowercase().ends_with(".md") || file.chars().any(|c| c.is_control()) {
        return Err("Некорректное имя файла документа".into());
    }
    let path = dir.join(file);
    if path.exists() {
        let real = fs::canonicalize(&path).map_err(|e| e.to_string())?;
        let parent = fs::canonicalize(dir).map_err(|e| e.to_string())?;
        if real.parent() != Some(parent.as_path()) || !real.is_file() {
            return Err("Файл документа находится вне проекта".into());
        }
    }
    Ok(path)
}
fn write_index(dir: &Path, docs: &[Document]) -> CmdResult<()> {
    write_atomic(&dir.join(INDEX), &serde_json::to_string_pretty(docs).map_err(|e| e.to_string())?)
}
fn read_index(dir: &Path) -> CmdResult<Vec<Document>> {
    let docs: Vec<Document> = match fs::read_to_string(dir.join(INDEX)) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("Повреждён список документов: {e}"))?,
        Err(e) if e.kind() == ErrorKind::NotFound => {
            // Migrate legacy README and any Markdown files already present, without touching their content.
            let mut docs = Vec::new();
            for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let file = entry.file_name().to_string_lossy().into_owned();
                if entry.file_type().map_err(|e| e.to_string())?.is_file() && file.to_lowercase().ends_with(".md") {
                    file_path(dir, &file)?;
                    let overview = file.eq_ignore_ascii_case("README.md");
                    docs.push(Document { id: file.clone(), name: if overview { "Обзор проекта".into() } else { file[..file.len()-3].into() }, file, external_path: None });
                }
            }
            docs.sort_by(|a,b| (!a.file.eq_ignore_ascii_case("README.md")).cmp(&(!b.file.eq_ignore_ascii_case("README.md"))).then_with(|| a.name.cmp(&b.name)));
            write_index(dir, &docs)?;
            docs
        }
        Err(e) => return Err(format!("Не удалось прочитать список документов: {e}")),
    };
    let mut ids = HashSet::new();
    let mut files = HashSet::new();
    for doc in &docs {
        document_path(dir, doc)?;
        valid_name(&doc.name)?;
        if doc.id.is_empty() || !ids.insert(doc.id.clone()) || !files.insert(doc.external_path.as_ref().unwrap_or(&doc.file).to_lowercase()) {
            return Err("В списке документов повторяются идентификаторы или файлы".into());
        }
    }
    Ok(docs)
}
fn find<'a>(docs: &'a [Document], document_id: &str) -> CmdResult<&'a Document> {
    docs.iter().find(|d| d.id == document_id).ok_or_else(|| "Документ не найден".into())
}
fn check_duplicate(docs: &[Document], name: &str, except: Option<&str>) -> CmdResult<()> {
    if docs.iter().any(|d| Some(d.id.as_str()) != except && d.name.to_lowercase() == name.to_lowercase()) {
        return Err("Документ с таким названием уже есть".into());
    }
    Ok(())
}
fn create_in(dir: &Path, name: &str) -> CmdResult<Vec<Document>> {
    let name = valid_name(name)?;
    let mut docs = read_index(dir)?;
    check_duplicate(&docs, &name, None)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let id = format!("doc-{stamp}");
    let file = format!("{id}.md");
    let path = file_path(dir, &file)?;
    let mut handle = OpenOptions::new().create_new(true).write(true).open(&path).map_err(|e| e.to_string())?;
    handle.write_all(b"").map_err(|e| e.to_string())?;
    drop(handle);
    docs.push(Document { id, name, file, external_path: None });
    if let Err(e) = write_index(dir, &docs) { let _ = fs::remove_file(&path); return Err(e); }
    Ok(docs)
}
fn reorder_in(dir: &Path, ids: Vec<String>) -> CmdResult<Vec<Document>> {
    let docs = read_index(dir)?;
    let unique: HashSet<_> = ids.iter().collect();
    if ids.len() != docs.len() || unique.len() != docs.len() { return Err("Некорректный порядок документов".into()); }
    let ordered = ids.iter().map(|id| find(&docs, id).cloned()).collect::<CmdResult<Vec<_>>>()?;
    write_index(dir, &ordered)?;
    Ok(ordered)
}

fn rename_in(dir: &Path, document_id: &str, name: &str) -> CmdResult<Vec<Document>> {
    let name = valid_name(name)?;
    let mut docs = read_index(dir)?;
    check_duplicate(&docs, &name, Some(document_id))?;
    find(&docs, document_id)?;
    docs.iter_mut().find(|d| d.id == document_id).unwrap().name = name;
    write_index(dir, &docs)?;
    Ok(docs)
}
/// Unique sibling temp file avoids overwriting an unrelated .tmp file beside the original.
fn guarded_write(path: &Path, text: &str, base_text: &str) -> CmdResult<()> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let temp = path.with_file_name(format!(".{}.tasktrack-{stamp}.tmp", path.file_name().unwrap().to_string_lossy()));
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e| e.to_string())?;
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        let current = fs::read_to_string(path).map_err(|e| e.to_string())?;
        if current != base_text && current != text { return Err("Документ изменён другим редактором. Ваши правки остались в редакторе.".into()); }
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if temp.exists() { let _ = fs::remove_file(&temp); }
    result
}
fn save_in(dir: &Path, document_id: &str, text: &str, base_text: &str) -> CmdResult<()> {
    let docs = read_index(dir)?;
    let path = document_path(dir, find(&docs, document_id)?)?;
    let current = fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать документ: {e}"))?;
    if current != base_text && current != text {
        return Err("Документ изменён другим редактором. Ваши правки остались в редакторе.".into());
    }
    guarded_write(&path, text, base_text)
}
fn delete_in(dir: &Path, document_id: &str, recycle: impl FnOnce(&Path) -> CmdResult<()>) -> CmdResult<Vec<Document>> {
    let docs = read_index(dir)?;
    let doc = find(&docs, document_id)?;
    if doc.external_path.is_some() { return Err("Подключённый файл можно только отключить от проекта".into()); }
    let path = file_path(dir, &doc.file)?;
    let remaining: Vec<Document> = docs.iter().filter(|d| d.id != document_id).cloned().collect();
    write_index(dir, &remaining)?;
    if let Err(e) = recycle(&path) {
        write_index(dir, &docs)?;
        return Err(format!("Не удалось переместить документ в корзину: {e}"));
    }
    Ok(remaining)
}

fn content_in(dir: &Path, document_id: &str) -> CmdResult<DocumentContent> {
    let docs = read_index(dir)?;
    let path = document_path(dir, find(&docs, document_id)?)?;
    let text = fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать документ: {e}"))?;
    let revision = revision(text.as_bytes());
    Ok(DocumentContent { text, dir: path.parent().unwrap_or(dir).to_string_lossy().into_owned(), revision })
}
fn revisions_in(dir: &Path) -> CmdResult<Vec<DocumentRevision>> {
    Ok(read_index(dir)?.into_iter().map(|doc| {
        match document_path(dir, &doc).and_then(|path| fs::read(path).map_err(|e| e.to_string())) {
            Ok(bytes) => DocumentRevision { id: doc.id, revision: Some(revision(&bytes)), error: None },
            Err(e) => DocumentRevision { id: doc.id, revision: None, error: Some(format!("Файл недоступен: {e}")) },
        }
    }).collect())
}

#[tauri::command]
pub fn list_documents(app: AppHandle, id: String) -> CmdResult<Vec<Document>> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    read_index(&project_dir(&app, &id)?)
}
#[tauri::command]
pub fn create_document(app: AppHandle, id: String, name: String) -> CmdResult<Vec<Document>> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    create_in(&project_dir(&app, &id)?, &name)
}
#[tauri::command]
pub fn rename_document(app: AppHandle, id: String, document_id: String, name: String) -> CmdResult<Vec<Document>> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    rename_in(&project_dir(&app, &id)?, &document_id, &name)
}
#[tauri::command]
pub fn reorder_documents(app: AppHandle, id: String, document_ids: Vec<String>) -> CmdResult<Vec<Document>> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    reorder_in(&project_dir(&app, &id)?, document_ids)
}
#[tauri::command]
pub fn get_document(app: AppHandle, id: String, document_id: String) -> CmdResult<DocumentContent> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    content_in(&project_dir(&app, &id)?, &document_id)
}
#[tauri::command]
pub fn save_document(app: AppHandle, id: String, document_id: String, text: String, base_text: String) -> CmdResult<String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    save_in(&project_dir(&app, &id)?, &document_id, &text, &base_text)?;
    Ok(revision(text.as_bytes()))
}
#[tauri::command]
pub fn delete_document(app: AppHandle, id: String, document_id: String) -> CmdResult<Vec<Document>> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    delete_in(&project_dir(&app, &id)?, &document_id, |path| trash::delete(path).map_err(|e| e.to_string()))
}

fn link_in(dir: &Path, source: &str, replace_id: Option<&str>) -> CmdResult<Vec<Document>> {
    let path = external_file(source)?;
    let canonical = fs::canonicalize(&path).map_err(|e| format!("Файл недоступен: {e}"))?;
    fs::read_to_string(&canonical).map_err(|e| format!("Не удалось прочитать Markdown: {e}"))?;
    let mut docs = read_index(dir)?;
    for doc in &docs {
        if Some(doc.id.as_str()) != replace_id && fs::canonicalize(document_path(dir, doc)?).ok().as_ref() == Some(&canonical) {
            return Err("Этот файл уже подключён к проекту".into());
        }
    }
    if let Some(id) = replace_id {
        find(&docs, id)?;
        let doc = docs.iter_mut().find(|d| d.id == id).unwrap();
        if doc.external_path.is_none() { return Err("Это внутренний документ проекта".into()); }
        doc.external_path = Some(path.to_string_lossy().into_owned());
        doc.file = path.file_name().unwrap().to_string_lossy().into_owned();
    } else {
        let stem = path.file_stem().unwrap().to_string_lossy();
        let base: String = stem.chars().take(90).collect();
        let mut name = base.clone(); let mut n = 2;
        while check_duplicate(&docs, &name, None).is_err() { name = format!("{base} ({n})"); n += 1; }
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
        docs.push(Document { id: format!("linked-{stamp}"), name, file: path.file_name().unwrap().to_string_lossy().into_owned(), external_path: Some(path.to_string_lossy().into_owned()) });
    }
    write_index(dir, &docs)?; Ok(docs)
}
fn unlink_in(dir: &Path, document_id: &str) -> CmdResult<Vec<Document>> {
    let docs = read_index(dir)?;
    if find(&docs, document_id)?.external_path.is_none() { return Err("Это внутренний документ проекта".into()); }
    let remaining: Vec<Document> = docs.into_iter().filter(|d| d.id != document_id).collect();
    write_index(dir, &remaining)?; Ok(remaining)
}
#[tauri::command]
pub fn link_document(app: AppHandle, id: String, source: String, document_id: Option<String>) -> CmdResult<Vec<Document>> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    link_in(&project_dir(&app, &id)?, &source, document_id.as_deref())
}
#[tauri::command]
pub fn unlink_document(app: AppHandle, id: String, document_id: String) -> CmdResult<Vec<Document>> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    unlink_in(&project_dir(&app, &id)?, &document_id)
}
#[tauri::command]
pub fn document_revisions(app: AppHandle, id: String) -> CmdResult<Vec<DocumentRevision>> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    revisions_in(&project_dir(&app, &id)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("task-track-docs-test-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
            fs::create_dir(&dir).unwrap(); Self(dir)
        }
    }
    impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test]
    fn linked_file_is_edited_in_place_and_unlink_never_recycles_original() {
        let project = Temp::new(); let external = Temp::new();
        let source = external.0.join("Marketing.md");
        fs::write(&source, "# Marketing").unwrap();
        let docs = link_in(&project.0, source.to_str().unwrap(), None).unwrap();
        let doc = &docs[0];
        assert!(doc.external_path.is_some());
        assert_eq!(doc.name, "Marketing");
        let loaded = content_in(&project.0, &doc.id).unwrap();
        assert_eq!(loaded.text, "# Marketing");
        assert_eq!(fs::canonicalize(loaded.dir).unwrap(), fs::canonicalize(&external.0).unwrap());
        save_in(&project.0, &doc.id, "Changed from Task Track", "# Marketing").unwrap();
        assert_eq!(fs::read_to_string(&source).unwrap(), "Changed from Task Track");
        rename_in(&project.0, &doc.id, "Campaign").unwrap();
        assert!(source.exists());
        assert!(link_in(&project.0, source.to_str().unwrap(), None).is_err());
        assert!(delete_in(&project.0, &doc.id, |_| panic!("must not recycle an external file")).is_err());
        assert!(unlink_in(&project.0, &doc.id).unwrap().is_empty());
        assert_eq!(fs::read_to_string(source).unwrap(), "Changed from Task Track");
        assert!(save_in(&project.0, &doc.id, "Late save", "Changed from Task Track").is_err());
    }
    #[test]
    fn external_replacement_missing_file_and_reconnection_are_detected() {
        let project = Temp::new(); let external = Temp::new();
        let source = external.0.join("Notes.md");
        fs::write(&source, "one").unwrap();
        let docs = link_in(&project.0, source.to_str().unwrap(), None).unwrap();
        let doc = &docs[0];
        let first = revisions_in(&project.0).unwrap()[0].revision.clone();
        // Atomic replacement, same text length, must still be detected by content hash.
        let replacement = external.0.join("replacement");
        fs::write(&replacement, "two").unwrap();
        fs::rename(&replacement, &source).unwrap();
        assert_ne!(revisions_in(&project.0).unwrap()[0].revision, first);
        assert_eq!(content_in(&project.0, &doc.id).unwrap().text, "two");
        assert!(save_in(&project.0, &doc.id, "local", "one").is_err());
        let moved = external.0.join("Moved.md");
        fs::rename(&source, &moved).unwrap();
        assert!(revisions_in(&project.0).unwrap()[0].error.is_some());
        assert!(content_in(&project.0, &doc.id).is_err());
        assert_eq!(read_index(&project.0).unwrap().len(), 1);
        let linked = link_in(&project.0, moved.to_str().unwrap(), Some(&doc.id)).unwrap();
        assert_eq!(linked[0].id, doc.id);
        assert_eq!(content_in(&project.0, &doc.id).unwrap().text, "two");
    }
    #[test]
    fn linking_checks_type_and_saving_preserves_unrelated_temp_file() {
        let project = Temp::new(); let external = Temp::new();
        let bad = external.0.join("bad.txt"); fs::write(&bad, "text").unwrap();
        assert!(link_in(&project.0, bad.to_str().unwrap(), None).is_err());
        assert!(link_in(&project.0, "relative.md", None).is_err());
        let source = external.0.join("Plan.md"); fs::write(&source, "old").unwrap();
        fs::write(source.with_extension("tmp"), "unrelated").unwrap();
        let docs = link_in(&project.0, source.to_str().unwrap(), None).unwrap();
        save_in(&project.0, &docs[0].id, "new", "old").unwrap();
        assert_eq!(fs::read_to_string(source.with_extension("tmp")).unwrap(), "unrelated");
        assert_eq!(fs::read_dir(&external.0).unwrap().count(), 3);
    }
    #[test]
    fn new_projects_have_no_default_document_and_legacy_readme_is_preserved() {
        let temp = Temp::new();
        assert!(read_index(&temp.0).unwrap().is_empty());
        let legacy = Temp::new();
        fs::write(legacy.0.join("README.md"), "# Existing\n![image](screens/test.png)").unwrap();
        let docs = read_index(&legacy.0).unwrap();
        assert_eq!(docs[0].name, "Обзор проекта");
        assert_eq!(docs[0].file, "README.md");
        assert_eq!(fs::read_to_string(legacy.0.join("README.md")).unwrap(), "# Existing\n![image](screens/test.png)");
        assert_eq!(read_index(&legacy.0).unwrap(), docs);
    }
    #[test]
    fn creation_rename_and_reorder_preserve_files_and_content() {
        let temp = Temp::new();
        let docs = create_in(&temp.0, "Маркетинг").unwrap();
        let first = docs[0].clone();
        save_in(&temp.0, &first.id, "Campaign plan", "").unwrap();
        let docs = rename_in(&temp.0, &first.id, "Продвижение").unwrap();
        assert_eq!(docs[0].file, first.file);
        assert_eq!(docs[0].id, first.id);
        assert_eq!(fs::read_to_string(temp.0.join(&first.file)).unwrap(), "Campaign plan");
        let docs = create_in(&temp.0, "Идеи").unwrap();
        let ids = vec![docs[1].id.clone(), docs[0].id.clone()];
        let ordered = reorder_in(&temp.0, ids).unwrap();
        assert_eq!(ordered[0].name, "Идеи");
        assert_eq!(read_index(&temp.0).unwrap(), ordered);
        assert!(reorder_in(&temp.0, vec![first.id.clone(), first.id]).is_err());
    }
    #[test]
    fn names_and_paths_are_checked() {
        let temp = Temp::new();
        assert!(create_in(&temp.0, "  ").is_err());
        assert!(create_in(&temp.0, &"a".repeat(101)).is_err());
        create_in(&temp.0, "Marketing").unwrap();
        assert!(create_in(&temp.0, "marketing").is_err());
        for file in ["../secret.md", r"D:\secret.md", "folder/file.md", "file.txt", ".hidden.md"] {
            assert!(file_path(&temp.0, file).is_err());
        }
        assert!(save_in(&temp.0, "missing", "data", "").is_err());
    }
    #[test]
    fn external_edits_are_not_overwritten() {
        let temp = Temp::new();
        let docs = create_in(&temp.0, "Notes").unwrap();
        save_in(&temp.0, &docs[0].id, "First", "").unwrap();
        fs::write(temp.0.join(&docs[0].file), "External").unwrap();
        assert!(save_in(&temp.0, &docs[0].id, "Local", "First").is_err());
        assert_eq!(fs::read_to_string(temp.0.join(&docs[0].file)).unwrap(), "External");
        save_in(&temp.0, &docs[0].id, "Merged", "External").unwrap();
    }
    #[test]
    fn failed_recycling_keeps_index_and_successful_deletion_prevents_late_save() {
        let temp = Temp::new();
        let docs = create_in(&temp.0, "Notes").unwrap();
        assert!(delete_in(&temp.0, &docs[0].id, |_| Err("Unavailable".into())).is_err());
        assert_eq!(read_index(&temp.0).unwrap(), docs);
        let recycled = temp.0.join("recycled-file");
        let remaining = delete_in(&temp.0, &docs[0].id, |path| fs::rename(path, &recycled).map_err(|e| e.to_string())).unwrap();
        assert!(remaining.is_empty());
        assert!(recycled.exists());
        assert!(read_index(&temp.0).unwrap().is_empty());
        assert!(save_in(&temp.0, &docs[0].id, "Late save", "").is_err());
        assert!(!temp.0.join(&docs[0].file).exists());
    }
}
