//! App settings persisted as JSON in the app config dir.

use serde::{Deserialize, Serialize};
use std::path::Path;

pub const FILE_NAME: &str = "settings.json";

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub data_folder: Option<String>,
    /// This machine's id, created once. It lives here, outside the synced data
    /// folder, so two machines sharing a folder keep distinct ids.
    #[serde(default)]
    pub machine_id: Option<String>,
}

/// Loads settings. A missing or unreadable file gives the defaults.
pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Saves settings atomically, creating the config dir if needed.
pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Cannot save settings: {e}"))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let temp = crate::files::write_temp(path, &json)?;
    crate::files::commit_temp(&temp, path)
}

/// The machine id from `settings`, creating and saving one when there is none.
/// A file that exists but can't be parsed is never overwritten, so a bad read
/// can't drop the remembered data folder; the new id then lasts this session.
pub fn ensure_machine_id(path: &Path, settings: &mut Settings, new_id: impl FnOnce() -> String) -> String {
    if let Some(id) = &settings.machine_id {
        return id.clone();
    }
    let id = new_id();
    settings.machine_id = Some(id.clone());
    let safe_to_write = match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str::<Settings>(&s).is_ok(),
        Err(e) => e.kind() == std::io::ErrorKind::NotFound,
    };
    if safe_to_write {
        let _ = save(path, settings);
    }
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_machine_id_is_created_once_and_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        save(&path, &Settings { data_folder: Some("/data".into()), machine_id: None }).unwrap();

        let mut first = load(&path);
        let id = ensure_machine_id(&path, &mut first, || "aaaa".into());
        assert_eq!(id, "aaaa");

        let mut again = load(&path);
        assert_eq!(ensure_machine_id(&path, &mut again, || "bbbb".into()), "aaaa");
        assert_eq!(again.data_folder.as_deref(), Some("/data"));
    }

    #[test]
    fn a_missing_file_gets_an_id_saved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join(FILE_NAME);
        let mut s = load(&path);
        assert_eq!(ensure_machine_id(&path, &mut s, || "cccc".into()), "cccc");
        assert_eq!(load(&path).machine_id.as_deref(), Some("cccc"));
    }

    #[test]
    fn an_unparseable_file_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, "{ not json").unwrap();
        let mut s = load(&path);
        assert_eq!(ensure_machine_id(&path, &mut s, || "dddd".into()), "dddd");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json");
    }
}
