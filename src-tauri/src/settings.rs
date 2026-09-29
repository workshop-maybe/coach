//! App settings persisted as JSON in the app config dir.

use serde::{Deserialize, Serialize};
use std::path::Path;

pub const FILE_NAME: &str = "settings.json";

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub data_folder: Option<String>,
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
