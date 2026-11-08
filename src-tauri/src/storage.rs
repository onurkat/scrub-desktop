use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("SCRUB_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    app.path().app_data_dir().map_err(|_| "storageError".into())
}
pub fn read(path: &Path, fallback: Value) -> Result<Value, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "storageError".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(fallback),
        Err(_) => Err("storageError".into()),
    }
}
pub fn atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("storageError")?;
    fs::create_dir_all(parent).map_err(|_| "storageError")?;
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "storageError")?
        .as_nanos();
    let temp = parent.join(format!(".write-{}-{suffix}.tmp", std::process::id()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| "storageError")?;
        let bytes = serde_json::to_vec(value).map_err(|_| "storageError")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "storageError")?;
        fs::rename(&temp, path).map_err(|_| "storageError")?;
        Ok(())
    })();
    if temp.exists() {
        fs::remove_file(&temp).map_err(|_| "storageError")?;
    }
    result.map_err(str::to_string)
}
pub fn empty_store() -> Value {
    json!({"version":1,"current":null,"recent":[]})
}
pub fn mappings(dir: &Path) -> Result<Value, String> {
    let value = read(&dir.join("mappings.json"), empty_store())?;
    if value["version"] != 1 || !value["recent"].is_array() {
        return Err("storageError".into());
    }
    Ok(value)
}
// Preserve conversations added by the CLI while a desktop review was open.
pub fn merge_mappings(disk: &Value, incoming: &Value) -> Result<Value, String> {
    let mut rows = incoming["recent"].as_array().ok_or("mappingError")?.clone();
    for row in disk["recent"].as_array().ok_or("mappingError")? {
        if !rows.iter().any(|existing| existing["id"] == row["id"]) {
            rows.push(row.clone());
        }
    }
    rows.sort_by(|a, b| b["time"].as_str().cmp(&a["time"].as_str()));
    // Keep the explicitly selected conversation even when it is older.
    if let Some(index) = rows.iter().position(|r| r["id"] == incoming["current"]) {
        let current = rows.remove(index);
        rows.insert(0, current);
    }
    rows.truncate(10);
    Ok(json!({"version":1,"current":incoming["current"],"recent":rows}))
}
pub struct Lock(PathBuf);
impl Lock {
    pub fn acquire(dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(dir).map_err(|_| "storageError")?;
        let path = dir.join("mappings.lock");
        for _ in 0..30 {
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    thread::sleep(Duration::from_millis(50))
                }
                Err(_) => return Err("storageError".into()),
            }
        }
        Err("storeBusy".into())
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        if fs::remove_dir(&self.0).is_err() {
            eprintln!("Scrub: mapping lock cleanup failed");
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_cli_conversations_survive_desktop_save() {
        let disk = json!({"version":1,"current":"cli","recent":[{"id":"cli","time":"2026-11-08T10:00:00Z"}]});
        let desktop = json!({"version":1,"current":"desktop","recent":[{"id":"desktop","time":"2026-11-08T09:00:00Z"}]});
        let merged = merge_mappings(&disk, &desktop).unwrap();
        assert_eq!(merged["current"], "desktop");
        assert_eq!(merged["recent"].as_array().unwrap().len(), 2);
        assert_eq!(merge_mappings(&merged, &desktop).unwrap(), merged);
    }
    #[test]
    fn private_atomic_roundtrip() {
        let dir = std::env::temp_dir().join(format!("scrub-storage-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        atomic(&p, &json!({"keep":false})).unwrap();
        assert_eq!(read(&p, Value::Null).unwrap()["keep"], false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&p).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
