//! Cross-process locks shared by the GUI and agent CLI. OS releases locks on process exit.
use crate::CmdResult;
use std::fs::{File, OpenOptions};
use std::path::Path;
pub(crate) fn lock(dir: &Path, name: &str) -> CmdResult<File> {
    let file = OpenOptions::new().read(true).write(true).create(true).truncate(false)
        .open(dir.join(name)).map_err(|e| format!("Не удалось открыть блокировку: {e}"))?;
    file.lock().map_err(|e| format!("Не удалось заблокировать данные: {e}"))?;
    Ok(file)
}
