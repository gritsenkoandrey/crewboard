//! Cross-process locks shared by the GUI and agent CLI. OS releases locks on process exit.
use crate::CmdResult;
use std::fs::{File, OpenOptions};
use std::path::Path;
pub(crate) fn lock(dir: &Path, name: &str) -> CmdResult<File> {
    let file = OpenOptions::new().read(true).write(true).create(true).truncate(false)
        .open(dir.join(name)).map_err(|e| format!("Failed to open the lock file: {e}"))?;
    file.lock().map_err(|e| format!("Failed to lock the data: {e}"))?;
    Ok(file)
}
