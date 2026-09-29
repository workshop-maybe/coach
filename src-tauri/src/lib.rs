mod files;
mod settings;

use std::path::PathBuf;
use std::sync::Mutex;

use files::{RootKind, Roots};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Approved roots plus where settings live.
struct AppState {
    roots: Mutex<Roots>,
    settings_path: PathBuf,
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
    let mut s = settings::load(&state.settings_path);
    s.data_folder = Some(path.clone());
    settings::save(&state.settings_path, &s)?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let settings_path = app.path().app_config_dir()?.join(settings::FILE_NAME);
            let saved = settings::load(&settings_path);
            let mut roots = Roots::default();
            files::register_remembered(&mut roots, saved.data_folder.as_deref());
            app.manage(AppState {
                roots: Mutex::new(roots),
                settings_path,
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
            import_badge_art,
            read_data_uri
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
