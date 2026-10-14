mod context;
mod files;
mod jev;
mod media;
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
    /// Paths dropped on the window, approved for `add_files` (KTD5). Written only by the
    /// window event handler in `run`, never by a listener on the event bus.
    drops: Mutex<files::DropApprovals>,
    /// The remembered data folder that could not be used at launch, if any.
    missing_data_folder: Option<String>,
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

/// The data folder, a remembered one that went missing, or none (KTD4 of the first-run
/// intro plan): only none plays the intro.
#[tauri::command]
fn get_data_folder(state: State<'_, AppState>) -> Result<files::DataFolderStatus, String> {
    let roots = state.roots.lock().map_err(|e| e.to_string())?;
    Ok(files::data_folder_status(&roots, state.missing_data_folder.as_deref()))
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

/// Where `add_files` gets its files (KTD5), and which files it takes (reply artifacts KTD3).
/// Every shape names what it accepts; only `any` keeps a file that is not a picture or video.
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum AddFrom {
    /// Rust shows a picker filtered to the key that asked.
    Pick { item: PickItem, accept: files::Accept },
    /// Paths the page got from the drop event, each checked against the approvals.
    Drop { paths: Vec<String>, accept: files::Accept },
    /// The files the page saw on a paste, matched against the clipboard's file list.
    Paste { files: Vec<PastedFile>, accept: files::Accept },
}

/// The key a pick came from. It sets the picker's filter only; the content still decides
/// what each picked file becomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum PickItem {
    Image,
    Video,
    File,
}

#[derive(serde::Deserialize)]
struct PastedFile {
    name: String,
    size: u64,
}

/// Runs file work on a blocking thread, so a slow volume never ties up the async workers.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .unwrap_or_else(|_| Err("The copy stopped before it finished.".into()))
}

/// The paths of the files on the clipboard, as Finder puts them there on a copy.
#[cfg(desktop)]
fn clipboard_files() -> Vec<PathBuf> {
    arboard::Clipboard::new().and_then(|mut c| c.get().file_list()).unwrap_or_default()
}

#[cfg(not(desktop))]
fn clipboard_files() -> Vec<PathBuf> {
    Vec::new()
}

/// The pick filters. GTK matches extensions by case, so both cases are listed.
const VIDEO_PICK_EXTENSIONS: [&str; 8] = ["mp4", "m4v", "mov", "webm", "MP4", "M4V", "MOV", "WEBM"];
const IMAGE_PICK_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "PNG", "JPG", "JPEG"];

/// The picker's filter for a key, as its name and extensions. File shows every file.
fn pick_filter(item: PickItem) -> Option<(&'static str, &'static [&'static str])> {
    match item {
        PickItem::Image => Some(("Images", &IMAGE_PICK_EXTENSIONS)),
        PickItem::Video => Some(("Videos", &VIDEO_PICK_EXTENSIONS)),
        PickItem::File => None,
    }
}

/// Adds files to `dir` in the data root by pick, drop or paste (KTD5), copied by Rust
/// from each file's path so no bytes cross IPC. Returns one result per file, in order.
/// A dropped or pasted path is checked against the approvals or the clipboard before
/// anything reads it.
#[tauri::command]
async fn add_files(
    app: AppHandle,
    state: State<'_, AppState>,
    dir: String,
    from: AddFrom,
) -> Result<Vec<files::AddedFile>, String> {
    let root = state.root("data")?;
    let (candidates, accept) = match from {
        AddFrom::Pick { item, accept } => {
            let mut dialog = app.dialog().file();
            if let Some((name, extensions)) = pick_filter(item) {
                dialog = dialog.add_filter(name, extensions);
            }
            let Some(picked) = dialog.blocking_pick_files() else {
                return Ok(Vec::new());
            };
            (files::picked(picked.into_iter().filter_map(|fp| fp.into_path().ok()).collect()), accept)
        }
        AddFrom::Drop { paths, accept } => {
            let mut approvals = state.drops.lock().map_err(|e| e.to_string())?;
            (files::take_dropped(&mut approvals, &paths, std::time::Instant::now()), accept)
        }
        AddFrom::Paste { files: expected, accept } => {
            let expected: Vec<(String, u64)> = expected.into_iter().map(|f| (f.name, f.size)).collect();
            (blocking(move || Ok(files::match_pasted(&clipboard_files(), &expected))).await?, accept)
        }
    };
    blocking(move || Ok(files::add_files_in(&root, &dir, candidates, accept))).await
}

/// Copies a video from the data root into a folder of the data or export root under its
/// content-addressed name (KTD7). Returns the target's root-relative path.
#[tauri::command]
async fn copy_video(
    state: State<'_, AppState>,
    from: String,
    to_root: String,
    to_dir: String,
) -> Result<String, String> {
    let data = state.root("data")?;
    let target = state.root(&to_root)?;
    blocking(move || files::copy_video_in(&data, &from, &target, &to_dir)).await
}

/// Copies a reply's video or file item from the data root into a folder of the data or
/// export root, for the carry (reply artifacts KTD2). Returns the target's root-relative path.
#[tauri::command]
async fn copy_item(state: State<'_, AppState>, from: String, to_root: String, to_dir: String) -> Result<String, String> {
    let data = state.root("data")?;
    let target = state.root(&to_root)?;
    blocking(move || files::copy_item_in(&data, &from, &target, &to_dir)).await
}

/// Reads a reply's Markdown or plain-text item file, capped at 1 MiB (reply artifacts KTD4).
/// `read_text` stays uncapped, since every result loads through it.
#[tauri::command]
async fn read_item_text(state: State<'_, AppState>, path: String) -> Result<Option<String>, String> {
    let root = state.root("data")?;
    blocking(move || files::read_item_text_in(&root, &path)).await
}

/// Opens a reply's item file in its default app when its type is on the allowlist in
/// `files`, and otherwise shows it in its folder (reply artifacts KTD4). The page sends a
/// data-root path, never an absolute one, so no opener scope is granted to the page.
#[tauri::command]
async fn open_item(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = state.root("data")?;
    let target = blocking(move || files::open_target_in(&root, &path)).await?;
    let opened = match target {
        files::OpenTarget::Open(path) => app.opener().open_path(path.to_string_lossy(), None::<&str>),
        files::OpenTarget::Reveal(path) => app.opener().reveal_item_in_dir(path),
    };
    opened.map_err(|_| files::CANNOT_OPEN.to_string())
}

/// Turns a scheme reply into a response. A reply that cannot be built is an empty 500.
fn media_response(reply: media::Reply) -> tauri::http::Response<Vec<u8>> {
    let mut builder = tauri::http::Response::builder().status(reply.status);
    for (name, value) in &reply.headers {
        builder = builder.header(*name, value.as_str());
    }
    builder.body(reply.body).unwrap_or_else(|_| {
        let mut empty = tauri::http::Response::new(Vec::new());
        *empty.status_mut() = tauri::http::StatusCode::INTERNAL_SERVER_ERROR;
        empty
    })
}

/// Answers a `media` request on a blocking thread (KTD3). The data root is looked up per
/// request, so a new data folder takes effect at once. On macOS the response is handed
/// back on the main thread, which closes wry#1822's race with WebKit stopping the task.
fn serve_media(app: AppHandle, request: tauri::http::Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
    let text = |name: tauri::http::header::HeaderName| {
        request.headers().get(name).map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
    };
    let range = text(tauri::http::header::RANGE);
    let origin = text(tauri::http::header::ORIGIN);
    let method = request.method().as_str().to_string();
    let path = request.uri().path().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let root = app.try_state::<AppState>().and_then(|s| s.root("data").ok());
        let reply = media::respond(
            root.as_deref(),
            &media::Request { method: &method, path: &path, range: range.as_deref(), origin: origin.as_deref() },
        );
        let response = media_response(reply);
        #[cfg(target_os = "macos")]
        {
            let _ = app.run_on_main_thread(move || responder.respond(response));
        }
        #[cfg(not(target_os = "macos"))]
        responder.respond(response);
    });
}

#[tauri::command]
async fn read_data_uri(state: State<'_, AppState>, root: String, path: String) -> Result<Option<String>, String> {
    files::read_data_uri_in(&state.root(&root)?, &path)
}

/// One request header as text. A missing header is an error, never a default.
fn header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .ok_or_else(|| format!("The request has no {name} header."))?
        .to_str()
        .map_err(|_| format!("The {name} header is not percent-encoded."))
}

/// Saves a pasted or exported image (KTD3). The body is the image's raw bytes,
/// `x-root` names the root ("data" or "export") and `x-dir` the folder inside
/// it, percent-encoded. Returns the saved file's root-relative path.
#[tauri::command]
async fn save_image(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The image must arrive as raw bytes.".into());
    };
    let root = state.root(header(&request, "x-root")?)?;
    let dir = files::decode_dir_header(header(&request, "x-dir")?)?;
    files::save_image_in(&root, &dir, bytes)
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
        // Videos play through this scheme, confined to the data folder (KTD3).
        .register_asynchronous_uri_scheme_protocol("media", |ctx, request, responder| {
            serve_media(ctx.app_handle().clone(), request, responder)
        })
        // A drop approves its paths here, synchronously, before the page hears of it (KTD5).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut drops) = state.drops.lock() {
                        drops.approve(paths, std::time::Instant::now());
                    }
                }
            }
        })
        .setup(|app| {
            let settings_path = app.path().app_config_dir()?.join(settings::FILE_NAME);
            let mut saved = settings::load(&settings_path);
            let machine_id = settings::ensure_machine_id(&settings_path, &mut saved, context::new_machine_id);
            let mut roots = Roots::default();
            let missing_data_folder = match files::register_remembered(&mut roots, saved.data_folder.as_deref()) {
                files::Remembered::Missing(path) => Some(path),
                files::Remembered::Registered(_) | files::Remembered::None => None,
            };
            app.manage(AppState {
                roots: Mutex::new(roots),
                settings: settings::SettingsFile::new(settings_path),
                // Opening the store sets keyring-core's default (KTD2). It reads no key and
                // raises no prompt; on Linux it connects to the Secret Service over D-Bus.
                jev: jev::Jev::new(Box::new(jev::Keychain::open())),
                machine_id,
                machine_name: std::sync::OnceLock::new(),
                home: app.path().home_dir().ok(),
                drops: Mutex::new(files::DropApprovals::default()),
                missing_data_folder,
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
            save_image,
            add_files,
            copy_video,
            copy_item,
            read_item_text,
            open_item,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// This file's source above its tests.
    fn app_source() -> &'static str {
        let src = include_str!("lib.rs");
        let end = ["\n#[cfg(test)]", "\n#[cfg(all(test"].iter().filter_map(|m| src.find(m)).min();
        &src[..end.unwrap()]
    }

    #[test]
    fn approvals_come_only_from_the_window_event() {
        let src = app_source();
        // One approve call, inside the window event handler, for a Drop only.
        assert_eq!(src.matches(".approve(").count(), 1);
        let handler = src.find(".on_window_event(").expect("a window event handler");
        let approve = src.find(".approve(").unwrap();
        assert!(handler < approve);
        let between = &src[handler..approve];
        assert!(between.contains("DragDropEvent::Drop"), "{between}");
        assert!(!between.contains("Enter"), "{between}");
        // Nothing listens on the event bus, where page script can emit `tauri://drag-drop` itself.
        assert!(!src.contains(".listen"));
        assert!(!src.contains(".once"));
        assert!(!src.contains("tauri://drag-drop"));
    }

    #[test]
    fn add_from_reads_the_three_shapes_of_the_contract() {
        use files::Accept;
        let pick: AddFrom =
            serde_json::from_value(serde_json::json!({ "kind": "pick", "item": "video", "accept": "media" })).unwrap();
        assert!(matches!(pick, AddFrom::Pick { item: PickItem::Video, accept: Accept::Media }));
        for (item, want) in [("image", PickItem::Image), ("file", PickItem::File)] {
            let pick: AddFrom =
                serde_json::from_value(serde_json::json!({ "kind": "pick", "item": item, "accept": "any" })).unwrap();
            assert!(matches!(pick, AddFrom::Pick { item, accept: Accept::Any } if item == want));
        }
        let drop: AddFrom = serde_json::from_value(
            serde_json::json!({ "kind": "drop", "paths": ["/d/a.mov", "/d/b.png"], "accept": "any" }),
        )
        .unwrap();
        assert!(matches!(drop, AddFrom::Drop { paths, accept: Accept::Any } if paths == ["/d/a.mov", "/d/b.png"]));
        let paste: AddFrom = serde_json::from_value(
            serde_json::json!({ "kind": "paste", "files": [{ "name": "a.mov", "size": 5 }], "accept": "media" }),
        )
        .unwrap();
        assert!(
            matches!(paste, AddFrom::Paste { files, accept: Accept::Media } if files.len() == 1 && files[0].name == "a.mov" && files[0].size == 5)
        );
        for bad in [
            serde_json::json!({ "kind": "Pick", "item": "video", "accept": "media" }),
            serde_json::json!({ "kind": "drop", "accept": "media" }),
            serde_json::json!({ "kind": "paste", "files": [{ "name": "a.mov", "size": -1 }], "accept": "media" }),
            serde_json::json!({ "kind": "path", "path": "/etc/hosts", "accept": "any" }),
            // Every shape names what it accepts, and a pick names its key.
            serde_json::json!({ "kind": "pick", "item": "video" }),
            serde_json::json!({ "kind": "pick", "accept": "media" }),
            serde_json::json!({ "kind": "drop", "paths": [] }),
            serde_json::json!({ "kind": "paste", "files": [] }),
            serde_json::json!({ "kind": "drop", "paths": [], "accept": "everything" }),
            serde_json::json!({ "kind": "drop", "paths": [], "accept": "Any" }),
            serde_json::json!({ "kind": "pick", "item": "folder", "accept": "any" }),
            serde_json::json!({ "kind": "pick", "item": "Video", "accept": "media" }),
        ] {
            assert!(serde_json::from_value::<AddFrom>(bad.clone()).is_err(), "{bad}");
        }
    }

    #[test]
    fn each_pick_key_filters_to_its_kind_in_both_cases_and_file_shows_everything() {
        let (name, exts) = pick_filter(PickItem::Image).unwrap();
        assert_eq!(name, "Images");
        for ext in ["png", "jpg", "jpeg", "PNG", "JPG", "JPEG"] {
            assert!(exts.contains(&ext), "{ext}");
        }
        assert_eq!(exts.len(), 6);
        let (name, exts) = pick_filter(PickItem::Video).unwrap();
        assert_eq!((name, exts), ("Videos", &VIDEO_PICK_EXTENSIONS[..]));
        assert!(pick_filter(PickItem::File).is_none());
    }

    #[test]
    fn only_open_item_opens_a_path_and_it_asks_files_what_to_do() {
        let src = app_source();
        assert_eq!(src.matches(".open_path(").count(), 1);
        assert_eq!(src.matches("open_target_in(").count(), 1);
        let command = src.find("async fn open_item(").expect("an open_item command");
        let open = src.find(".open_path(").unwrap();
        let decide = src.find("open_target_in(").unwrap();
        assert!(command < decide && decide < open, "the target is decided before anything opens");
        // The page never passes an absolute path or a program to open it with.
        assert!(src[command..open].contains("state.root(\"data\")"));
        assert!(src.contains(".open_path(path.to_string_lossy(), None::<&str>)"));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod clipboard_check {
    /// The paste stop condition (KTD5): a file copied in Finder reaches arboard as a path.
    /// Run by hand after `osascript -e 'set the clipboard to (POSIX file "<path>")'`, with
    /// that path in `CLIP_CHECK_PATH`. It reads the real clipboard, so it is ignored by default.
    #[test]
    #[ignore = "reads the real clipboard"]
    fn arboard_reads_a_copied_file_reference() {
        let expected = std::env::var("CLIP_CHECK_PATH").expect("set CLIP_CHECK_PATH");
        let list = arboard::Clipboard::new().unwrap().get().file_list().unwrap();
        println!("file_list: {list:?}");
        assert!(list.iter().any(|p| p == std::path::Path::new(&expected)), "{list:?}");
    }
}
