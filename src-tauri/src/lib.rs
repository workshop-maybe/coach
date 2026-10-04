mod context;
mod files;
mod jev;
mod settings;

use std::path::PathBuf;
use std::sync::Mutex;

use files::{RootKind, Roots};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Approved roots plus where settings live, and this machine's identity.
struct AppState {
    roots: Mutex<Roots>,
    /// Every settings write goes through its guarded update (KTD3).
    settings: settings::SettingsFile,
    /// Jev Mode's key store and the key held for this session, if any.
    jev: jev::Jev,
    machine_id: String,
    /// Looked up on the first copy, not at launch, since it spawns a process.
    machine_name: std::sync::OnceLock<String>,
    home: Option<PathBuf>,
}

/// The context a test starts with. Only the memory digest leaves `context`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextReport {
    machine_id: String,
    machine: String,
    memory: String,
}

/// The name people know this machine by: the macOS Computer Name, else the
/// hostname, else "This computer".
fn machine_display_name() -> String {
    let run = |cmd: &str, args: &[&str]| {
        std::process::Command::new(cmd)
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    };
    let computer_name = if cfg!(target_os = "macos") { run("scutil", &["--get", "ComputerName"]) } else { None };
    computer_name
        .or_else(|| run("hostname", &[]))
        .unwrap_or_else(|| "This computer".to_string())
}

impl AppState {
    fn root(&self, kind: &str) -> Result<PathBuf, String> {
        let kind = RootKind::parse(kind)?;
        let roots = self.roots.lock().map_err(|e| e.to_string())?;
        roots.get(kind).map(|p| p.to_path_buf())
    }
}

/// Shows a folder picker. Must run off the main thread (async command).
fn pick_folder(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    match app.dialog().file().blocking_pick_folder() {
        None => Ok(None),
        Some(fp) => fp.into_path().map(Some).map_err(|e| e.to_string()),
    }
}

/// Shows a folder picker and approves the choice as the given root.
fn pick_and_approve(app: &AppHandle, state: &AppState, kind: RootKind) -> Result<Option<String>, String> {
    let Some(folder) = pick_folder(app)? else {
        return Ok(None);
    };
    let canon = state.roots.lock().map_err(|e| e.to_string())?.set(kind, &folder)?;
    Ok(Some(canon.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn pick_data_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let Some(path) = pick_and_approve(&app, &state, RootKind::Data)? else {
        return Ok(None);
    };
    state.settings.remember_data_folder(&path)?;
    Ok(Some(path))
}

#[tauri::command]
fn get_data_folder(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let roots = state.roots.lock().map_err(|e| e.to_string())?;
    Ok(roots
        .get(RootKind::Data)
        .ok()
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn pick_export_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    pick_and_approve(&app, &state, RootKind::Export)
}

// The file commands are async so their disk I/O runs off the main thread.

#[tauri::command]
async fn read_text(state: State<'_, AppState>, root: String, path: String) -> Result<Option<String>, String> {
    files::read_text_in(&state.root(&root)?, &path)
}

#[tauri::command]
async fn write_text(
    state: State<'_, AppState>,
    root: String,
    path: String,
    contents: String,
) -> Result<(), String> {
    files::write_text_in(&state.root(&root)?, &path, &contents)
}

#[tauri::command]
async fn list_files(state: State<'_, AppState>, root: String, dir: String) -> Result<Vec<String>, String> {
    files::list_files_in(&state.root(&root)?, &dir)
}

#[tauri::command]
async fn move_file(state: State<'_, AppState>, root: String, from: String, to: String) -> Result<(), String> {
    files::move_in(&state.root(&root)?, &from, &to)
}

/// Reads at most one byte past the image limit, so an oversized pick is
/// refused by `validate_image` without loading the whole file.
fn read_picked_image(path: &std::path::Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(files::MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    Ok(bytes)
}

/// Shows an image picker and copies the chosen JPEG or PNG into the data
/// folder under a content-addressed name. Returns the folder-relative path,
/// or None when the user cancels. The picked file is read once and never
/// becomes an approved root.
#[tauri::command]
async fn import_badge_art(
    app: AppHandle,
    state: State<'_, AppState>,
    collection_slug: String,
    credential_slug: Option<String>,
) -> Result<Option<String>, String> {
    let root = state.root("data")?;
    let picked = app
        .dialog()
        .file()
        .add_filter("Images", &["jpg", "jpeg", "png"])
        .blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let source = picked.into_path().map_err(|e| e.to_string())?;
    let bytes = read_picked_image(&source)?;
    let rel = files::art_dest_name(&collection_slug, credential_slug.as_deref(), &bytes)?;
    files::copy_bytes_into_root(&root, &rel, &bytes)?;
    Ok(Some(rel))
}

#[tauri::command]
async fn read_data_uri(state: State<'_, AppState>, root: String, path: String) -> Result<Option<String>, String> {
    files::read_data_uri_in(&state.root(&root)?, &path)
}

/// This machine and a fingerprint of the agent's memory for its repo (R1).
#[tauri::command]
async fn read_context(state: State<'_, AppState>, repo: String, harness: String) -> Result<ContextReport, String> {
    let memory = match &state.home {
        Some(home) => context::memory_fingerprint(home, &repo, &harness),
        None => context::NOT_READ.to_string(),
    };
    Ok(ContextReport {
        machine_id: state.machine_id.clone(),
        machine: state.machine_name.get_or_init(machine_display_name).clone(),
        memory,
    })
}

// Jev Mode (KTD1). Work that can reach the key store runs on a blocking thread,
// since a keychain prompt waits on the user. The contract is at the top of jev.rs.

async fn off_thread<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&AppState) -> Result<T, jev::JevError> + Send + 'static,
) -> Result<T, jev::JevError> {
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<AppState>()))
        .await
        .unwrap_or_else(|_| Err(jev::JevError::of(jev::Kind::Other)))
}

/// Jev Mode's state, from settings and memory only. Never reads the key store.
#[tauri::command]
async fn jev_status(state: State<'_, AppState>) -> Result<jev::JevStatus, jev::JevError> {
    Ok(state.jev.status(&state.settings))
}

#[tauri::command]
async fn jev_set_key(app: AppHandle, key: String) -> Result<jev::JevStatus, jev::JevError> {
    let key = zeroize::Zeroizing::new(key);
    off_thread(app, move |state| state.jev.set_key(&state.settings, &key)).await
}

#[tauri::command]
async fn jev_clear_key(app: AppHandle) -> Result<jev::JevStatus, jev::JevError> {
    off_thread(app, |state| state.jev.clear_key(&state.settings)).await
}

#[tauri::command]
async fn jev_set_on(app: AppHandle, on: bool) -> Result<jev::JevStatus, jev::JevError> {
    off_thread(app, move |state| state.jev.set_on(&state.settings, on)).await
}

/// The request arrives untyped so that the on check runs before its shape is read.
#[tauri::command]
async fn jev_ask(app: AppHandle, request: serde_json::Value) -> Result<jev::Answers, jev::JevError> {
    let prepared = off_thread(app, move |state| state.jev.prepare(&state.settings, request)).await?;
    jev::send(prepared).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());
    // The window reopens at its last size and position (R5), and nothing else (KTD2). On
    // macOS the plugin reads an undecorated window as never maximized, so restoring that
    // flag would misplace a screen-sized window. Full screen would open a new Space, and a
    // stale file must not bring back a title bar or hide the window. Registered on the
    // builder, not in setup, so it is in place before the window in tauri.conf.json opens.
    #[cfg(desktop)]
    let builder = {
        use tauri_plugin_window_state::StateFlags;
        builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
                .build(),
        )
    };
    builder
        .setup(|app| {
            let settings_path = app.path().app_config_dir()?.join(settings::FILE_NAME);
            let mut saved = settings::load(&settings_path);
            let machine_id = settings::ensure_machine_id(&settings_path, &mut saved, context::new_machine_id);
            let mut roots = Roots::default();
            files::register_remembered(&mut roots, saved.data_folder.as_deref());
            app.manage(AppState {
                roots: Mutex::new(roots),
                settings: settings::SettingsFile::new(settings_path),
                // Opening the store sets keyring-core's default (KTD2). It reads no key and
                // raises no prompt; on Linux it connects to the Secret Service over D-Bus.
                jev: jev::Jev::new(Box::new(jev::Keychain::open())),
                machine_id,
                machine_name: std::sync::OnceLock::new(),
                home: app.path().home_dir().ok(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_data_folder,
            get_data_folder,
            pick_export_folder,
            read_text,
            write_text,
            list_files,
            move_file,
            import_badge_art,
            read_data_uri,
            read_context,
            jev_status,
            jev_set_key,
            jev_clear_key,
            jev_set_on,
            jev_ask
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
