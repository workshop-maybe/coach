//! App settings persisted as JSON in the app config dir.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const FILE_NAME: &str = "settings.json";

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub data_folder: Option<String>,
    /// This machine's id, created once. It lives here, outside the synced data
    /// folder, so two machines sharing a folder keep distinct ids.
    #[serde(default)]
    pub machine_id: Option<String>,
    /// Jev Mode's switch and what is known about its key, never the key itself.
    #[serde(default)]
    pub jev: JevSettings,
}

/// Jev Mode as status reads it, without touching the keychain (KTD3).
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JevSettings {
    #[serde(default)]
    pub on: bool,
    /// Where the key is kept. None means there is no key.
    #[serde(default)]
    pub storage: Option<KeyStorage>,
    /// The key's last four characters, for keys of 12 or more.
    #[serde(default)]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyStorage {
    /// The OS keychain, so it survives a relaunch.
    Keychain,
    /// Memory only, for this run (Linux without a Secret Service).
    Session,
}

/// Why `SettingsFile::update` wrote nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateError {
    /// The file exists but can't be read or parsed, so it is left as it is.
    Unreadable,
    Save(String),
}

impl From<UpdateError> for String {
    fn from(e: UpdateError) -> String {
        match e {
            UpdateError::Unreadable => "Settings can't be read, so they weren't changed".to_string(),
            UpdateError::Save(e) => e,
        }
    }
}

/// The settings file and the lock every writer holds (KTD3).
pub struct SettingsFile {
    pub path: PathBuf,
    lock: Mutex<()>,
}

impl SettingsFile {
    pub fn new(path: PathBuf) -> Self {
        SettingsFile { path, lock: Mutex::new(()) }
    }

    pub fn load(&self) -> Settings {
        load(&self.path)
    }

    /// Reads the file, applies `change` and saves, all under the lock. A file that
    /// can't be parsed is never written, so one writer can't drop another's fields.
    /// When `change` fails, nothing is saved.
    pub fn update<T, E: From<UpdateError>>(
        &self,
        change: impl FnOnce(&mut Settings) -> Result<T, E>,
    ) -> Result<T, E> {
        let _guard = self.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut settings = read_for_update(&self.path)?;
        let out = change(&mut settings)?;
        save(&self.path, &settings).map_err(UpdateError::Save)?;
        Ok(out)
    }

    /// Remembers the approved data folder.
    pub fn remember_data_folder(&self, folder: &str) -> Result<(), String> {
        self.update(|s| {
            s.data_folder = Some(folder.to_string());
            Ok::<_, UpdateError>(())
        })
        .map_err(String::from)
    }
}

/// The saved settings, when it is safe to write over them: the file parses, or
/// there is no file yet.
fn read_for_update(path: &Path) -> Result<Settings, UpdateError> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|_| UpdateError::Unreadable),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(_) => Err(UpdateError::Unreadable),
    }
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
    if read_for_update(path).is_ok() {
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
        save(&path, &Settings { data_folder: Some("/data".into()), ..Settings::default() }).unwrap();

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

    #[test]
    fn a_file_written_before_jev_mode_loads_with_it_off_and_no_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, r#"{ "data_folder": "/data", "machine_id": "aaaa" }"#).unwrap();
        let s = load(&path);
        assert_eq!(s.data_folder.as_deref(), Some("/data"));
        assert_eq!(s.machine_id.as_deref(), Some("aaaa"));
        assert_eq!(s.jev, JevSettings { on: false, storage: None, hint: None });
    }

    #[test]
    fn an_update_keeps_the_fields_it_does_not_change() {
        let dir = tempfile::tempdir().unwrap();
        let file = SettingsFile::new(dir.path().join(FILE_NAME));
        let before = Settings {
            data_folder: Some("/old".into()),
            machine_id: Some("aaaa".into()),
            jev: JevSettings { on: true, storage: Some(KeyStorage::Keychain), hint: Some("wxyz".into()) },
        };
        save(&file.path, &before).unwrap();

        file.remember_data_folder("/new").unwrap();

        assert_eq!(load(&file.path), Settings { data_folder: Some("/new".into()), ..before });
    }

    #[test]
    fn an_update_never_writes_over_an_unparseable_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = SettingsFile::new(dir.path().join(FILE_NAME));
        std::fs::write(&file.path, "{ not json").unwrap();

        let mut called = false;
        let out = file.update(|s| {
            called = true;
            s.jev.on = true;
            Ok::<_, UpdateError>(())
        });
        assert_eq!(out, Err(UpdateError::Unreadable));
        assert!(!called, "the change never runs");
        assert!(file.remember_data_folder("/data").is_err());
        assert_eq!(std::fs::read_to_string(&file.path).unwrap(), "{ not json");
    }

    #[test]
    fn an_update_whose_change_fails_saves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let file = SettingsFile::new(dir.path().join(FILE_NAME));
        file.remember_data_folder("/data").unwrap();
        let written = std::fs::read_to_string(&file.path).unwrap();

        let out = file.update(|s| {
            s.data_folder = None;
            Err::<(), _>(UpdateError::Save("refused".into()))
        });
        assert!(out.is_err());
        assert_eq!(std::fs::read_to_string(&file.path).unwrap(), written);
    }

    #[test]
    fn an_update_with_no_file_starts_from_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let file = SettingsFile::new(dir.path().join("nested").join(FILE_NAME));
        file.update(|s| {
            s.jev.on = true;
            Ok::<_, UpdateError>(())
        })
        .unwrap();
        assert_eq!(load(&file.path).jev.on, true);
        assert_eq!(load(&file.path).data_folder, None);
    }
}
