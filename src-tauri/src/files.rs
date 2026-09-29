//! Confined file I/O over the folders the user picked: text files, plus
//! JPEG/PNG badge art copied in and read back as data URIs.
//!
//! Everything here is plain Rust with no Tauri types, so the confinement rules
//! are unit-tested without a runtime. The Tauri commands in `lib.rs` are thin
//! wrappers over these functions.

use std::path::{Path, PathBuf};

/// Marker in the names of temp files that `write_text_in` creates.
/// `list_files_in` skips any file whose name contains it.
pub const TEMP_MARKER: &str = ".andamio-tmp";

/// Which approved root a command targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootKind {
    Data,
    Export,
}

impl RootKind {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "data" => Ok(RootKind::Data),
            "export" => Ok(RootKind::Export),
            other => Err(format!("Unknown root \"{other}\". Expected \"data\" or \"export\".")),
        }
    }
}

/// The roots the user approved. Each is stored canonicalized.
#[derive(Debug, Default)]
pub struct Roots {
    data: Option<PathBuf>,
    export: Option<PathBuf>,
}

impl Roots {
    /// Approves `folder` as the root of `kind`, replacing any earlier one.
    /// Returns the canonical path that is stored.
    pub fn set(&mut self, kind: RootKind, folder: &Path) -> Result<PathBuf, String> {
        let canon = folder
            .canonicalize()
            .map_err(|e| format!("Cannot use folder {}: {e}", folder.display()))?;
        if !canon.is_dir() {
            return Err(format!("{} is not a folder.", canon.display()));
        }
        match kind {
            RootKind::Data => self.data = Some(canon.clone()),
            RootKind::Export => self.export = Some(canon.clone()),
        }
        Ok(canon)
    }

    pub fn get(&self, kind: RootKind) -> Result<&Path, String> {
        match kind {
            RootKind::Data => self
                .data
                .as_deref()
                .ok_or_else(|| "No data folder is set. Choose a data folder first.".to_string()),
            RootKind::Export => self
                .export
                .as_deref()
                .ok_or_else(|| "No export folder is set. Choose an export folder first.".to_string()),
        }
    }
}

/// Registers the remembered data folder from settings, if it still exists.
/// Returns the canonical root when one was registered.
pub fn register_remembered(roots: &mut Roots, remembered: Option<&str>) -> Option<PathBuf> {
    let folder = remembered?;
    roots.set(RootKind::Data, Path::new(folder)).ok()
}

/// Resolves `rel` inside the canonical `root`, or explains why it cannot.
///
/// Rejects absolute paths, `..` that climbs above the root, and symlinks
/// (including dangling ones) that lead outside the root. The returned path
/// has every existing component resolved, so later I/O cannot be redirected
/// by a symlink that was checked here.
pub fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    use std::path::Component;

    let rel_path = Path::new(rel);
    if rel_path.is_absolute() || rel_path.has_root() {
        return Err(format!("Path \"{rel}\" must be relative to the folder."));
    }

    // Lexical normalization: drop `.`, apply `..`, refuse to climb above the root.
    let mut parts: Vec<&std::ffi::OsStr> = Vec::new();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(p) => parts.push(p),
            Component::CurDir => {}
            Component::ParentDir => {
                if parts.pop().is_none() {
                    return Err(format!("Path \"{rel}\" leaves the folder."));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Path \"{rel}\" must be relative to the folder."));
            }
        }
    }

    // Find the nearest existing ancestor and resolve it through symlinks.
    let mut existing = parts.len();
    let resolved_base = loop {
        let candidate = parts[..existing].iter().fold(root.to_path_buf(), |p, c| p.join(c));
        if std::fs::symlink_metadata(&candidate).is_ok() {
            // It exists (possibly as a symlink). A dangling link fails here.
            break candidate
                .canonicalize()
                .map_err(|_| format!("Path \"{rel}\" goes through a broken link."))?;
        }
        if existing == 0 {
            return Err(format!("The folder {} no longer exists.", root.display()));
        }
        existing -= 1;
    };

    if !resolved_base.starts_with(root) {
        return Err(format!("Path \"{rel}\" leaves the folder."));
    }
    Ok(parts[existing..].iter().fold(resolved_base, |p, c| p.join(c)))
}

/// Reads a UTF-8 text file. `None` when it does not exist.
pub fn read_text_in(root: &Path, rel: &str) -> Result<Option<String>, String> {
    let path = resolve_in_root(root, rel)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read \"{rel}\": {e}")),
    }
}

/// First half of an atomic write: writes `contents` to a temp file next to
/// `target` and returns its path. The target is not touched.
pub fn write_temp(target: &Path, contents: impl AsRef<[u8]>) -> Result<PathBuf, String> {
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    let dir = target.parent().ok_or("Cannot write to the folder itself.")?;
    let name = target
        .file_name()
        .ok_or("Cannot write to the folder itself.")?
        .to_string_lossy();
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let temp = dir.join(format!(".{name}{TEMP_MARKER}-{}-{nanos}", std::process::id()));

    let result = (|| {
        let mut f = std::fs::File::create(&temp)?;
        f.write_all(contents.as_ref())?;
        f.sync_all()
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Cannot write {}: {e}", target.display()));
    }
    Ok(temp)
}

/// Second half of an atomic write: renames the temp file over the target.
pub fn commit_temp(temp: &Path, target: &Path) -> Result<(), String> {
    std::fs::rename(temp, target).map_err(|e| {
        let _ = std::fs::remove_file(temp);
        format!("Cannot write {}: {e}", target.display())
    })
}

/// Writes a text file atomically, creating parent folders as needed.
pub fn write_text_in(root: &Path, rel: &str, contents: &str) -> Result<(), String> {
    write_bytes_in(root, rel, contents.as_bytes())
}

/// Writes a file atomically, creating parent folders as needed.
fn write_bytes_in(root: &Path, rel: &str, contents: &[u8]) -> Result<(), String> {
    let target = resolve_in_root(root, rel)?;
    if target == root {
        return Err("Cannot write to the folder itself.".into());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create folders for \"{rel}\": {e}"))?;
    }
    let temp = write_temp(&target, contents)?;
    commit_temp(&temp, &target)
}

/// Lists files under `dir`, recursively, as root-relative paths with forward
/// slashes, sorted. Missing `dir` gives an empty list. Symlinks and temp
/// files are skipped.
pub fn list_files_in(root: &Path, dir: &str) -> Result<Vec<String>, String> {
    let start = resolve_in_root(root, dir)?;
    let meta = match std::fs::metadata(&start) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Cannot list \"{dir}\": {e}")),
    };
    if !meta.is_dir() {
        return Err(format!("\"{dir}\" is not a folder."));
    }

    let mut out = Vec::new();
    let mut stack = vec![start];
    while let Some(current) = stack.pop() {
        let entries =
            std::fs::read_dir(&current).map_err(|e| format!("Cannot list \"{dir}\": {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Cannot list \"{dir}\": {e}"))?;
            let file_type = entry.file_type().map_err(|e| format!("Cannot list \"{dir}\": {e}"))?;
            let path = entry.path();
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() {
                if entry.file_name().to_string_lossy().contains(TEMP_MARKER) {
                    continue;
                }
                if let Ok(rel) = path.strip_prefix(root) {
                    let parts: Vec<String> =
                        rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
                    out.push(parts.join("/"));
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Largest plate-art image accepted, in bytes (3 MiB, inclusive).
pub const MAX_IMAGE_BYTES: usize = 3 * 1024 * 1024;

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG_MAGIC: [u8; 3] = [0xFF, 0xD8, 0xFF];

/// Checks that `bytes` is a JPEG or PNG no larger than 3 MiB, by magic bytes
/// rather than by file name. Returns the extension to store it under.
pub fn validate_image(bytes: &[u8]) -> Result<&'static str, String> {
    let ext = if bytes.starts_with(&JPEG_MAGIC) {
        "jpg"
    } else if bytes.starts_with(&PNG_SIGNATURE) {
        "png"
    } else {
        return Err("That file is not a JPEG or PNG image.".into());
    };
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "That image is {} bytes. Badge art must be 3 MiB ({MAX_IMAGE_BYTES} bytes) or smaller.",
            bytes.len()
        ));
    }
    Ok(ext)
}

/// A slug must be one safe path segment. Hand-made folders can have any name, so
/// this refuses only what could leave the segment: separators, `.`, `..`, a leading
/// dot, and control characters.
fn check_slug(what: &str, slug: &str) -> Result<(), String> {
    let unsafe_segment = slug.is_empty()
        || slug.starts_with('.')
        || slug.contains(['/', '\\', ':'])
        || slug.chars().any(char::is_control);
    if unsafe_segment {
        return Err(format!("The {what} name \"{slug}\" cannot be used in a file path."));
    }
    Ok(())
}

/// The content-addressed, folder-relative destination for plate art:
/// `collections/<slug>/badge/art-<8 hex>.<ext>` for a collection, or
/// `collections/<slug>/badge/<credential>-<8 hex>.<ext>` for an override.
/// The hex is the first 4 bytes of the image's SHA-256.
pub fn art_dest_name(collection_slug: &str, credential_slug: Option<&str>, bytes: &[u8]) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    check_slug("collection", collection_slug)?;
    if let Some(cred) = credential_slug {
        check_slug("credential", cred)?;
    }
    let ext = validate_image(bytes)?;
    let hash: String = Sha256::digest(bytes)[..4].iter().map(|b| format!("{b:02x}")).collect();
    let stem = credential_slug.unwrap_or("art");
    Ok(format!("collections/{collection_slug}/badge/{stem}-{hash}.{ext}"))
}

/// Writes `bytes` to `rel` inside `root` atomically, creating parent folders.
/// Takes only the root path, never `Roots`, so it cannot approve anything.
pub fn copy_bytes_into_root(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    write_bytes_in(root, rel, bytes)
}

/// Reads a JPEG or PNG inside `root` as a base64 data URI. `None` when it
/// does not exist. Anything that is not a valid image is an error.
pub fn read_data_uri_in(root: &Path, rel: &str) -> Result<Option<String>, String> {
    use base64::Engine;

    let path = resolve_in_root(root, rel)?;
    // Refuse an oversized file before reading it all (validate_image checks again).
    match std::fs::metadata(&path) {
        Ok(m) if m.len() > MAX_IMAGE_BYTES as u64 => {
            return Err(format!("\"{rel}\": the image is larger than 3 MiB"));
        }
        _ => {}
    }
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot read \"{rel}\": {e}")),
    };
    let mime = match validate_image(&bytes).map_err(|e| format!("\"{rel}\": {e}"))? {
        "jpg" => "image/jpeg",
        _ => "image/png",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// A temp root, canonicalized the way `Roots::set` stores it.
    fn root() -> (TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let mut roots = Roots::default();
        let canon = roots.set(RootKind::Data, dir.path()).unwrap();
        (dir, canon)
    }

    #[test]
    fn write_then_read_round_trips() {
        let (_d, root) = root();
        write_text_in(&root, "credentials/a.md", "# A\n").unwrap();
        assert_eq!(fs::read_to_string(root.join("credentials/a.md")).unwrap(), "# A\n");
        assert_eq!(read_text_in(&root, "credentials/a.md").unwrap().as_deref(), Some("# A\n"));
    }

    #[test]
    fn read_missing_file_is_none() {
        let (_d, root) = root();
        assert_eq!(read_text_in(&root, "nope/missing.md").unwrap(), None);
    }

    #[test]
    fn parent_dir_escape_is_rejected_and_writes_nothing() {
        let outer = tempfile::tempdir().unwrap();
        let inner = outer.path().join("root");
        fs::create_dir(&inner).unwrap();
        let mut roots = Roots::default();
        let root = roots.set(RootKind::Data, &inner).unwrap();

        assert!(resolve_in_root(&root, "../escaped.md").is_err());
        assert!(resolve_in_root(&root, "a/../../escaped.md").is_err());
        assert!(write_text_in(&root, "../escaped.md", "x").is_err());
        assert!(write_text_in(&root, "sub/../../escaped.md", "x").is_err());
        assert!(!outer.path().join("escaped.md").exists());
        assert!(read_text_in(&root, "../escaped.md").is_err());
        assert!(list_files_in(&root, "..").is_err());
    }

    #[test]
    fn parent_dir_that_stays_inside_is_allowed() {
        let (_d, root) = root();
        write_text_in(&root, "a/../b.md", "b").unwrap();
        assert_eq!(fs::read_to_string(root.join("b.md")).unwrap(), "b");
    }

    #[test]
    fn absolute_path_is_rejected() {
        let (_d, root) = root();
        let abs = root.join("a.md");
        let abs = abs.to_str().unwrap();
        assert!(resolve_in_root(&root, abs).is_err());
        assert!(write_text_in(&root, abs, "x").is_err());
        assert!(!root.join("a.md").exists());
        assert!(read_text_in(&root, "/etc/hosts").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escaping_root_is_rejected_for_read_and_write() {
        use std::os::unix::fs::symlink;
        let (_d, root) = root();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "secret").unwrap();

        // A symlinked directory pointing outside.
        symlink(outside.path(), root.join("link")).unwrap();
        assert!(read_text_in(&root, "link/secret.txt").is_err());
        assert!(write_text_in(&root, "link/new.txt", "x").is_err());
        assert!(!outside.path().join("new.txt").exists());

        // A symlinked file pointing outside.
        symlink(outside.path().join("secret.txt"), root.join("file-link.txt")).unwrap();
        assert!(read_text_in(&root, "file-link.txt").is_err());
        assert!(write_text_in(&root, "file-link.txt", "overwritten").is_err());
        assert_eq!(fs::read_to_string(outside.path().join("secret.txt")).unwrap(), "secret");

        // A dangling symlink whose target is outside and does not exist yet.
        symlink(outside.path().join("later.txt"), root.join("dangling.txt")).unwrap();
        assert!(write_text_in(&root, "dangling.txt", "x").is_err());
        assert!(!outside.path().join("later.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_staying_inside_root_is_allowed() {
        use std::os::unix::fs::symlink;
        let (_d, root) = root();
        fs::create_dir(root.join("real")).unwrap();
        symlink(root.join("real"), root.join("alias")).unwrap();
        write_text_in(&root, "alias/a.md", "a").unwrap();
        assert_eq!(fs::read_to_string(root.join("real/a.md")).unwrap(), "a");
    }

    #[test]
    fn interrupted_write_leaves_original_intact() {
        let (_d, root) = root();
        write_text_in(&root, "a.md", "original").unwrap();
        let target = resolve_in_root(&root, "a.md").unwrap();

        // First half of a write: the temp file exists, the target is untouched.
        let temp = write_temp(&target, "updated").unwrap();
        assert_eq!(temp.parent(), target.parent());
        assert!(temp.file_name().unwrap().to_str().unwrap().contains(TEMP_MARKER));
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        assert_eq!(read_text_in(&root, "a.md").unwrap().as_deref(), Some("original"));
        // Listing does not show the half-written temp file.
        assert_eq!(list_files_in(&root, "").unwrap(), vec!["a.md".to_string()]);

        commit_temp(&temp, &target).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "updated");
        assert!(!temp.exists());
    }

    #[test]
    fn listing_is_recursive_relative_and_forward_slashed() {
        let (_d, root) = root();
        write_text_in(&root, "credentials/a.md", "a").unwrap();
        write_text_in(&root, "credentials/deep/b.md", "b").unwrap();
        write_text_in(&root, "profiles/p.json", "{}").unwrap();

        assert_eq!(
            list_files_in(&root, "").unwrap(),
            vec!["credentials/a.md", "credentials/deep/b.md", "profiles/p.json"]
        );
        assert_eq!(
            list_files_in(&root, "credentials").unwrap(),
            vec!["credentials/a.md", "credentials/deep/b.md"]
        );
        assert_eq!(list_files_in(&root, "missing").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn roots_report_clear_error_before_a_folder_is_set() {
        let roots = Roots::default();
        let err = roots.get(RootKind::Data).unwrap_err();
        assert!(err.contains("No data folder"), "got: {err}");
        let err = roots.get(RootKind::Export).unwrap_err();
        assert!(err.contains("No export folder"), "got: {err}");
    }

    #[test]
    fn root_kind_parses_known_names_only() {
        assert_eq!(RootKind::parse("data").unwrap(), RootKind::Data);
        assert_eq!(RootKind::parse("export").unwrap(), RootKind::Export);
        assert!(RootKind::parse("home").is_err());
    }

    #[test]
    fn export_root_is_replaced_by_a_new_pick() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut roots = Roots::default();
        roots.set(RootKind::Export, a.path()).unwrap();
        let second = roots.set(RootKind::Export, b.path()).unwrap();
        assert_eq!(roots.get(RootKind::Export).unwrap(), second.as_path());
        assert_eq!(second, b.path().canonicalize().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn root_under_symlinked_temp_dir_accepts_inside_paths() {
        use std::os::unix::fs::symlink;
        // Reproduce macOS /var -> /private/var on any unix: pick the root
        // through a symlinked path and confirm paths inside still resolve.
        let base = tempfile::tempdir().unwrap();
        let real = base.path().join("real");
        fs::create_dir(&real).unwrap();
        let via_link = base.path().join("via-link");
        symlink(&real, &via_link).unwrap();

        let mut roots = Roots::default();
        let root = roots.set(RootKind::Data, &via_link).unwrap();
        assert_eq!(root, real.canonicalize().unwrap());
        write_text_in(&root, "credentials/a.md", "a").unwrap();
        assert_eq!(read_text_in(&root, "credentials/a.md").unwrap().as_deref(), Some("a"));
        assert_eq!(list_files_in(&root, "").unwrap(), vec!["credentials/a.md"]);

        // The real macOS temp dir (/var/folders/...) is itself behind a symlink.
        let tmp = tempfile::tempdir().unwrap();
        let root = roots.set(RootKind::Data, tmp.path()).unwrap();
        write_text_in(&root, "x.md", "x").unwrap();
        assert_eq!(read_text_in(&root, "x.md").unwrap().as_deref(), Some("x"));
    }

    #[test]
    fn remembered_folder_registers_on_a_fresh_state() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("hello.md"), "hi").unwrap();

        // Settings persisted in an earlier run.
        let settings_dir = tempfile::tempdir().unwrap();
        let settings_path = settings_dir.path().join("settings.json");
        let saved = crate::settings::Settings {
            data_folder: Some(dir.path().to_string_lossy().into_owned()),
        };
        crate::settings::save(&settings_path, &saved).unwrap();

        // A fresh app state after restart.
        let loaded = crate::settings::load(&settings_path);
        let mut roots = Roots::default();
        let registered = register_remembered(&mut roots, loaded.data_folder.as_deref());
        assert_eq!(registered, Some(dir.path().canonicalize().unwrap()));
        let root = roots.get(RootKind::Data).unwrap();
        assert_eq!(read_text_in(root, "hello.md").unwrap().as_deref(), Some("hi"));
    }

    #[test]
    fn remembered_folder_that_vanished_is_not_registered() {
        let mut roots = Roots::default();
        assert_eq!(register_remembered(&mut roots, Some("/definitely/not/here/andamio")), None);
        assert_eq!(register_remembered(&mut roots, None), None);
        assert!(roots.get(RootKind::Data).is_err());
    }

    #[test]
    fn settings_load_tolerates_missing_and_corrupt_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert_eq!(crate::settings::load(&path).data_folder, None);
        fs::write(&path, "not json").unwrap();
        assert_eq!(crate::settings::load(&path).data_folder, None);
    }

    // --- Plate art (U3) ---

    const PNG_SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    fn png(len: usize) -> Vec<u8> {
        let mut v = PNG_SIG.to_vec();
        v.resize(len.max(PNG_SIG.len()), 0);
        v
    }

    fn jpeg(len: usize) -> Vec<u8> {
        let mut v = vec![0xFF, 0xD8, 0xFF, 0xE0];
        v.resize(len.max(4), 0);
        v
    }

    #[test]
    fn validate_image_accepts_jpeg_and_png_by_magic_bytes() {
        assert_eq!(validate_image(&jpeg(100)).unwrap(), "jpg");
        assert_eq!(validate_image(&png(100)).unwrap(), "png");
    }

    #[test]
    fn validate_image_rejects_a_renamed_text_file_and_empty_input() {
        let err = validate_image(b"just some text, saved as art.png").unwrap_err();
        assert!(err.contains("JPEG or PNG"), "got: {err}");
        assert!(validate_image(b"").is_err());
        // A truncated PNG signature is not a PNG.
        assert!(validate_image(&PNG_SIG[..4]).is_err());
    }

    #[test]
    fn validate_image_size_limit_is_one_mib_inclusive() {
        assert_eq!(validate_image(&png(MAX_IMAGE_BYTES)).unwrap(), "png");
        let err = validate_image(&png(MAX_IMAGE_BYTES + 1)).unwrap_err();
        assert!(err.contains("3 MiB"), "got: {err}");
        assert!(validate_image(&jpeg(MAX_IMAGE_BYTES + 1)).is_err());
    }

    #[test]
    fn art_dest_name_is_content_addressed() {
        let bytes = png(64);
        let a = art_dest_name("my-collection", None, &bytes).unwrap();
        assert!(a.starts_with("collections/my-collection/badge/art-"), "got: {a}");
        assert!(a.ends_with(".png"));
        let hash = &a["collections/my-collection/badge/art-".len()..a.len() - ".png".len()];
        assert_eq!(hash.len(), 8);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        // Same bytes, same name. Different bytes, different name.
        assert_eq!(art_dest_name("my-collection", None, &bytes).unwrap(), a);
        assert_ne!(art_dest_name("my-collection", None, &png(65)).unwrap(), a);

        let o = art_dest_name("my-collection", Some("rust-basics"), &jpeg(64)).unwrap();
        assert!(o.starts_with("collections/my-collection/badge/rust-basics-"), "got: {o}");
        assert!(o.ends_with(".jpg"));
        assert_eq!(o.len(), "collections/my-collection/badge/rust-basics-".len() + 8 + ".jpg".len());
    }

    #[test]
    fn art_dest_name_known_sha256_prefix() {
        // The name carries the first 4 bytes of the image's SHA-256.
        use sha2::{Digest, Sha256};
        let bytes = png(10);
        let expect: String = Sha256::digest(&bytes)[..4].iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            art_dest_name("c", None, &bytes).unwrap(),
            format!("collections/c/badge/art-{expect}.png")
        );
    }

    #[test]
    fn art_dest_name_rejects_unsafe_slugs_and_non_images() {
        let bytes = png(10);
        for bad in ["", ".", "..", "../x", "a/b", "/abs", ".hidden", "a\\b", "c:d", "a\nb"] {
            assert!(art_dest_name(bad, None, &bytes).is_err(), "collection {bad:?}");
            assert!(art_dest_name("ok", Some(bad), &bytes).is_err(), "credential {bad:?}");
        }
        // Hand-made folders can have any safe name.
        for good in ["My_Collection", "A b", "a.b", "Révision"] {
            assert!(art_dest_name(good, None, &bytes).is_ok(), "collection {good:?}");
            assert!(art_dest_name("ok", Some(good), &bytes).is_ok(), "credential {good:?}");
        }
        assert!(art_dest_name("ok", None, b"text").is_err());
    }

    #[test]
    fn copy_bytes_into_root_writes_jpeg_and_png_atomically() {
        let (_d, root) = root();
        let j = jpeg(300);
        let p = png(300);
        let jrel = art_dest_name("c", None, &j).unwrap();
        let prel = art_dest_name("c", Some("cred"), &p).unwrap();
        copy_bytes_into_root(&root, &jrel, &j).unwrap();
        copy_bytes_into_root(&root, &prel, &p).unwrap();
        assert_eq!(fs::read(root.join(&jrel)).unwrap(), j);
        assert_eq!(fs::read(root.join(&prel)).unwrap(), p);
        // No temp files are left behind.
        assert_eq!(list_files_in(&root, "").unwrap(), {
            let mut v = vec![jrel.clone(), prel.clone()];
            v.sort();
            v
        });
    }

    #[test]
    fn copy_bytes_into_root_keeps_non_utf8_bytes_intact() {
        let (_d, root) = root();
        let mut bytes = png(0);
        bytes.extend([0xFF, 0xFE, 0x00, 0x80, 0xC3]);
        copy_bytes_into_root(&root, "collections/c/badge/x.png", &bytes).unwrap();
        assert_eq!(fs::read(root.join("collections/c/badge/x.png")).unwrap(), bytes);
    }

    #[test]
    fn copy_bytes_into_root_rejects_parent_and_absolute_destinations() {
        let outer = tempfile::tempdir().unwrap();
        let inner = outer.path().join("root");
        fs::create_dir(&inner).unwrap();
        let mut roots = Roots::default();
        let root = roots.set(RootKind::Data, &inner).unwrap();
        let bytes = png(10);

        assert!(copy_bytes_into_root(&root, "../escaped.png", &bytes).is_err());
        assert!(copy_bytes_into_root(&root, "collections/../../escaped.png", &bytes).is_err());
        assert!(!outer.path().join("escaped.png").exists());

        let abs = outer.path().join("abs.png");
        assert!(copy_bytes_into_root(&root, abs.to_str().unwrap(), &bytes).is_err());
        assert!(!abs.exists());
        assert!(copy_bytes_into_root(&root, "", &bytes).is_err());
    }

    #[test]
    fn copy_bytes_into_root_never_touches_approved_roots() {
        // The picked source lives outside every approved root. Copying its
        // bytes in must not approve it: the function takes no `Roots` at all,
        // and the roots are unchanged afterwards.
        let data = tempfile::tempdir().unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let source = source_dir.path().join("picked.png");
        fs::write(&source, png(50)).unwrap();

        let mut roots = Roots::default();
        let root = roots.set(RootKind::Data, data.path()).unwrap();

        let bytes = fs::read(&source).unwrap();
        let rel = art_dest_name("c", None, &bytes).unwrap();
        copy_bytes_into_root(&root, &rel, &bytes).unwrap();

        assert_eq!(roots.get(RootKind::Data).unwrap(), root.as_path());
        assert!(roots.get(RootKind::Export).is_err());
        let source_canon = source_dir.path().canonicalize().unwrap();
        assert!(!root.starts_with(&source_canon));
        // Reading back through the source folder is still refused.
        assert!(read_data_uri_in(&root, source.to_str().unwrap()).is_err());
    }

    #[test]
    fn read_data_uri_in_returns_mime_prefix_by_magic_bytes() {
        use base64::Engine;
        let (_d, root) = root();
        let j = jpeg(20);
        let p = png(20);
        // Extensions deliberately lie: the MIME comes from the bytes.
        copy_bytes_into_root(&root, "a.png", &j).unwrap();
        copy_bytes_into_root(&root, "b.jpg", &p).unwrap();

        let a = read_data_uri_in(&root, "a.png").unwrap().unwrap();
        assert!(a.starts_with("data:image/jpeg;base64,"), "got: {a}");
        let b = read_data_uri_in(&root, "b.jpg").unwrap().unwrap();
        assert!(b.starts_with("data:image/png;base64,"), "got: {b}");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&b["data:image/png;base64,".len()..])
            .unwrap();
        assert_eq!(decoded, p);
    }

    #[test]
    fn read_data_uri_in_refuses_an_oversized_file_before_reading_it() {
        let (_d, root) = root();
        fs::write(root.join("big.png"), png(MAX_IMAGE_BYTES + 1)).unwrap();
        let err = read_data_uri_in(&root, "big.png").unwrap_err();
        assert!(err.contains("larger than 3 MiB"), "got: {err}");
        fs::write(root.join("ok.png"), png(MAX_IMAGE_BYTES)).unwrap();
        assert!(read_data_uri_in(&root, "ok.png").unwrap().is_some());
    }

    #[test]
    fn read_data_uri_in_missing_is_none_and_non_image_is_rejected() {
        let (_d, root) = root();
        assert_eq!(read_data_uri_in(&root, "nope.png").unwrap(), None);
        write_text_in(&root, "notes.png", "not an image").unwrap();
        assert!(read_data_uri_in(&root, "notes.png").is_err());
    }

    #[test]
    fn read_data_uri_in_rejects_paths_outside_the_root() {
        let outer = tempfile::tempdir().unwrap();
        let inner = outer.path().join("root");
        fs::create_dir(&inner).unwrap();
        fs::write(outer.path().join("outside.png"), png(20)).unwrap();
        let mut roots = Roots::default();
        let root = roots.set(RootKind::Data, &inner).unwrap();

        assert!(read_data_uri_in(&root, "../outside.png").is_err());
        let abs = outer.path().join("outside.png");
        assert!(read_data_uri_in(&root, abs.to_str().unwrap()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn read_data_uri_in_rejects_symlink_out_of_root() {
        use std::os::unix::fs::symlink;
        let (_d, root) = root();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("o.png"), png(20)).unwrap();
        symlink(outside.path().join("o.png"), root.join("link.png")).unwrap();
        assert!(read_data_uri_in(&root, "link.png").is_err());
    }
}
