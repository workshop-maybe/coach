//! Confined file I/O over the folders the user picked: text files, plus
//! JPEG/PNG images (badge art, pasted images) written in and read back as data URIs.
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

/// Lexical normalization of a root-relative path: drops `.`, applies `..`, and
/// refuses an absolute path or one that climbs above the root. Reads no disk.
fn normalize_rel(rel: &str) -> Result<Vec<&std::ffi::OsStr>, String> {
    use std::path::Component;

    let rel_path = Path::new(rel);
    if rel_path.is_absolute() || rel_path.has_root() {
        return Err(format!("Path \"{rel}\" must be relative to the folder."));
    }
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
    Ok(parts)
}

/// Resolves `rel` inside the canonical `root`, or explains why it cannot.
///
/// Rejects absolute paths, `..` that climbs above the root, and symlinks
/// (including dangling ones) that lead outside the root. The returned path
/// has every existing component resolved, so later I/O cannot be redirected
/// by a symlink that was checked here.
pub fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let parts = normalize_rel(rel)?;

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

/// Moves one file to another path inside the root, creating the destination's
/// folders. Refuses a missing source, anything that is not a plain file, and an
/// existing destination, so a move never overwrites.
pub fn move_in(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let source = resolve_in_root(root, from)?;
    let target = resolve_in_root(root, to)?;
    // Resolving follows a link to its target, so check the path as named for a link first.
    if std::fs::symlink_metadata(root.join(from)).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(format!("\"{from}\" is not a file."));
    }
    match std::fs::symlink_metadata(&source) {
        Ok(m) if m.is_file() => {}
        Ok(_) => return Err(format!("\"{from}\" is not a file.")),
        Err(_) => return Err(format!("Cannot move \"{from}\": it does not exist.")),
    }
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err(format!("Cannot move to \"{to}\": something is already there."));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create folders for \"{to}\": {e}"))?;
    }
    std::fs::rename(&source, &target).map_err(|e| format!("Cannot move \"{from}\": {e}"))
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

/// Largest pasted image accepted, in bytes (10 MiB, inclusive). It is also the
/// largest image the app writes, so it caps every image read.
pub const MAX_PASTED_IMAGE_BYTES: usize = 10 * 1024 * 1024;

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG_MAGIC: [u8; 3] = [0xFF, 0xD8, 0xFF];

/// What an image is for, which sets its size cap and how a refusal reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageLimit {
    /// Plate art: 3 MiB.
    BadgeArt,
    /// A pasted image, or one the app copies or reads: 10 MiB.
    Pasted,
}

impl ImageLimit {
    pub const fn max_bytes(self) -> usize {
        match self {
            ImageLimit::BadgeArt => MAX_IMAGE_BYTES,
            ImageLimit::Pasted => MAX_PASTED_IMAGE_BYTES,
        }
    }

    fn too_large(self, len: usize) -> String {
        match self {
            ImageLimit::BadgeArt => {
                format!("That image is {len} bytes. Badge art must be 3 MiB ({MAX_IMAGE_BYTES} bytes) or smaller.")
            }
            ImageLimit::Pasted => "That image is larger than 10 MB.".into(),
        }
    }
}

/// Checks that `bytes` is a JPEG or PNG within `limit`, by magic bytes rather
/// than by file name. Returns the extension to store it under.
pub fn validate_image(bytes: &[u8], limit: ImageLimit) -> Result<&'static str, String> {
    let ext = if bytes.starts_with(&JPEG_MAGIC) {
        "jpg"
    } else if bytes.starts_with(&PNG_SIGNATURE) {
        "png"
    } else {
        return Err("That file is not a JPEG or PNG image.".into());
    };
    if bytes.len() > limit.max_bytes() {
        return Err(limit.too_large(bytes.len()));
    }
    Ok(ext)
}

/// The first 4 bytes of the SHA-256 of `bytes`, as 8 lowercase hex digits.
fn hash8(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)[..4].iter().map(|b| format!("{b:02x}")).collect()
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
    check_slug("collection", collection_slug)?;
    if let Some(cred) = credential_slug {
        check_slug("credential", cred)?;
    }
    let ext = validate_image(bytes, ImageLimit::BadgeArt)?;
    let stem = credential_slug.unwrap_or("art");
    Ok(format!("collections/{collection_slug}/badge/{stem}-{}.{ext}", hash8(bytes)))
}

/// Writes `bytes` to `rel` inside `root` atomically, creating parent folders.
/// Takes only the root path, never `Roots`, so it cannot approve anything.
pub fn copy_bytes_into_root(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    write_bytes_in(root, rel, bytes)
}

/// Saves a pasted or exported image in `dir` under its content-addressed name,
/// `image-<8 hex>.<ext>`, and returns its root-relative path with forward
/// slashes. An empty `dir` or `.` means the root itself. The same bytes saved
/// again write nothing and return the same path. Anything else already at that
/// name is refused: a different file, a link, a folder, or a path that cannot
/// be checked.
pub fn save_image_in(root: &Path, dir: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = validate_image(bytes, ImageLimit::Pasted)?;
    let name = format!("image-{}.{ext}", hash8(bytes));
    // `dir` is never trimmed, so "/" stays absolute and is refused.
    let joined = if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") };
    let parts = normalize_rel(&joined)?;
    let rel = parts.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>().join("/");
    let target = resolve_in_root(root, &rel)?;

    // Resolving follows a link at the name to its target, so check the name as given.
    let named = parts.iter().fold(root.to_path_buf(), |p, c| p.join(c));
    match std::fs::symlink_metadata(&named) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            write_bytes_in(root, &rel, bytes)?;
            Ok(rel)
        }
        Err(e) => Err(format!("Cannot save the image as \"{rel}\": {e}")),
        Ok(m) if m.file_type().is_symlink() || !m.is_file() => {
            Err(format!("Something other than a plain file is already named {name}."))
        }
        Ok(m) => {
            let same = m.len() == bytes.len() as u64
                && std::fs::read(&target).map_err(|e| format!("Cannot read \"{rel}\": {e}"))? == bytes;
            if same {
                Ok(rel)
            } else {
                Err(format!("A different file is already named {name}."))
            }
        }
    }
}

/// Decodes a percent-encoded folder header once, as strict UTF-8. Refuses one
/// that does not decode or that holds a control character, NUL included.
pub fn decode_dir_header(raw: &str) -> Result<String, String> {
    let dir = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| "The folder name is not valid UTF-8.".to_string())?;
    if dir.chars().any(char::is_control) {
        return Err("The folder name holds a control character.".into());
    }
    Ok(dir.into_owned())
}

/// Reads a JPEG or PNG inside `root` as a base64 data URI. `None` when it
/// does not exist. Anything that is not a valid image is an error. Every image
/// is read up to the largest the app writes, badge art included.
pub fn read_data_uri_in(root: &Path, rel: &str) -> Result<Option<String>, String> {
    use base64::Engine;

    let path = resolve_in_root(root, rel)?;
    // Refuse an oversized file before reading it all (validate_image checks again).
    match std::fs::metadata(&path) {
        Ok(m) if m.len() > MAX_PASTED_IMAGE_BYTES as u64 => {
            return Err(format!("\"{rel}\": the image is larger than 10 MB"));
        }
        _ => {}
    }
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot read \"{rel}\": {e}")),
    };
    let mime = match validate_image(&bytes, ImageLimit::Pasted).map_err(|e| format!("\"{rel}\": {e}"))? {
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
    fn move_puts_a_file_at_its_new_path_and_creates_its_folders() {
        let (_d, root) = root();
        write_text_in(&root, "agents/a.json", "{}").unwrap();
        move_in(&root, "agents/a.json", "trash/20260930T000000Z/agents/a.json").unwrap();
        assert!(!root.join("agents/a.json").exists());
        assert_eq!(fs::read_to_string(root.join("trash/20260930T000000Z/agents/a.json")).unwrap(), "{}");
    }

    #[test]
    fn move_refuses_to_overwrite_leave_the_folder_or_move_a_missing_file() {
        let (_d, root) = root();
        write_text_in(&root, "a.md", "a").unwrap();
        write_text_in(&root, "b.md", "b").unwrap();
        assert!(move_in(&root, "a.md", "b.md").is_err());
        assert_eq!(fs::read_to_string(root.join("b.md")).unwrap(), "b");
        assert!(move_in(&root, "a.md", "../out.md").is_err());
        assert!(move_in(&root, "missing.md", "c.md").is_err());
        assert!(move_in(&root, "", "c").is_err());
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "a");
    }

    #[cfg(unix)]
    #[test]
    fn move_refuses_a_link_and_leaves_its_target_in_place() {
        let (_d, root) = root();
        write_text_in(&root, "collections/c/collection.json", "{}").unwrap();
        std::os::unix::fs::symlink(root.join("collections/c/collection.json"), root.join("agents.json")).unwrap();
        assert!(move_in(&root, "agents.json", "trash/x/agents.json").is_err());
        assert!(root.join("collections/c/collection.json").exists());
        assert!(!root.join("trash").exists());
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
            ..Default::default()
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
        assert_eq!(validate_image(&jpeg(100), ImageLimit::BadgeArt).unwrap(), "jpg");
        assert_eq!(validate_image(&png(100), ImageLimit::BadgeArt).unwrap(), "png");
    }

    #[test]
    fn validate_image_rejects_a_renamed_text_file_and_empty_input() {
        let err = validate_image(b"just some text, saved as art.png", ImageLimit::BadgeArt).unwrap_err();
        assert!(err.contains("JPEG or PNG"), "got: {err}");
        assert!(validate_image(b"", ImageLimit::BadgeArt).is_err());
        // A truncated PNG signature is not a PNG.
        assert!(validate_image(&PNG_SIG[..4], ImageLimit::BadgeArt).is_err());
    }

    #[test]
    fn validate_image_badge_art_limit_is_three_mib_inclusive() {
        assert_eq!(validate_image(&png(MAX_IMAGE_BYTES), ImageLimit::BadgeArt).unwrap(), "png");
        let err = validate_image(&png(MAX_IMAGE_BYTES + 1), ImageLimit::BadgeArt).unwrap_err();
        assert!(err.contains("3 MiB"), "got: {err}");
        assert!(validate_image(&jpeg(MAX_IMAGE_BYTES + 1), ImageLimit::BadgeArt).is_err());
    }

    #[test]
    fn badge_art_keeps_its_three_mib_cap_and_its_own_wording() {
        let len = MAX_IMAGE_BYTES + 1;
        let err = validate_image(&png(len), ImageLimit::BadgeArt).unwrap_err();
        assert_eq!(
            err,
            format!("That image is {len} bytes. Badge art must be 3 MiB ({MAX_IMAGE_BYTES} bytes) or smaller.")
        );
        assert_eq!(art_dest_name("c", None, &png(len)).unwrap_err(), err);
        // A pasted image that size is fine, and a pasted refusal never says "Badge art".
        assert_eq!(validate_image(&png(len), ImageLimit::Pasted).unwrap(), "png");
        let err = validate_image(&png(MAX_PASTED_IMAGE_BYTES + 1), ImageLimit::Pasted).unwrap_err();
        assert_eq!(err, "That image is larger than 10 MB.");
        assert_eq!(
            validate_image(b"text", ImageLimit::Pasted).unwrap_err(),
            "That file is not a JPEG or PNG image."
        );
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
        // Hand-placed badge art over its own 3 MiB cap now loads (KTD4).
        fs::write(root.join("five.png"), png(5 * 1024 * 1024)).unwrap();
        let uri = read_data_uri_in(&root, "five.png").unwrap().unwrap();
        assert!(uri.starts_with("data:image/png;base64,"), "got: {}", &uri[..40]);
        fs::write(root.join("ok.png"), png(MAX_PASTED_IMAGE_BYTES)).unwrap();
        assert!(read_data_uri_in(&root, "ok.png").unwrap().is_some());

        // A sparse PNG one byte over 10 MiB.
        let big = root.join("big.png");
        fs::write(&big, PNG_SIG).unwrap();
        fs::File::options()
            .write(true)
            .open(&big)
            .unwrap()
            .set_len(MAX_PASTED_IMAGE_BYTES as u64 + 1)
            .unwrap();
        #[cfg(unix)]
        {
            // Unreadable, so only a refusal made from its size alone can name the size.
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&big, fs::Permissions::from_mode(0o000)).unwrap();
        }
        let err = read_data_uri_in(&root, "big.png").unwrap_err();
        assert_eq!(err, "\"big.png\": the image is larger than 10 MB");
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

    // --- Pasted and exported images (save_image) ---

    const DIR: &str = "collections/c/credentials";

    /// Computed here, not with the module's helper, so names are checked independently.
    fn hash8(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(bytes)[..4].iter().map(|b| format!("{b:02x}")).collect()
    }

    /// A data root inside an outer temp folder, to check nothing lands beside it.
    fn nested_root() -> (TempDir, PathBuf) {
        let outer = tempfile::tempdir().unwrap();
        let inner = outer.path().join("root");
        fs::create_dir(&inner).unwrap();
        let root = Roots::default().set(RootKind::Data, &inner).unwrap();
        (outer, root)
    }

    fn outer_holds_only_the_root(outer: &TempDir) {
        let names: Vec<_> = fs::read_dir(outer.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("root")]);
    }

    #[test]
    fn save_image_names_png_and_jpeg_by_their_sha256_prefix() {
        let (_d, root) = root();
        let p = png(300);
        let j = jpeg(300);
        let prel = save_image_in(&root, DIR, &p).unwrap();
        let jrel = save_image_in(&root, DIR, &j).unwrap();
        assert_eq!(prel, format!("{DIR}/image-{}.png", hash8(&p)));
        assert_eq!(jrel, format!("{DIR}/image-{}.jpg", hash8(&j)));
        assert_eq!(fs::read(root.join(&prel)).unwrap(), p);
        assert_eq!(fs::read(root.join(&jrel)).unwrap(), j);
        // No temp files are left behind.
        let mut expect = vec![prel, jrel];
        expect.sort();
        assert_eq!(list_files_in(&root, "").unwrap(), expect);
    }

    #[test]
    fn save_image_twice_returns_the_same_path_and_does_not_rewrite() {
        let (_d, root) = root();
        let bytes = png(500);
        let first = save_image_in(&root, DIR, &bytes).unwrap();
        let before = fs::symlink_metadata(root.join(&first)).unwrap();
        let second = save_image_in(&root, DIR, &bytes).unwrap();
        assert_eq!(second, first);
        let after = fs::symlink_metadata(root.join(&first)).unwrap();
        assert_eq!(after.modified().unwrap(), before.modified().unwrap());
        #[cfg(unix)]
        {
            // A write renames a new file over the old one, so a rewrite changes the inode.
            use std::os::unix::fs::MetadataExt;
            assert_eq!(after.ino(), before.ino());
        }
        assert_eq!(list_files_in(&root, "").unwrap(), vec![first]);
    }

    #[test]
    fn save_image_refuses_a_different_file_at_its_name_and_leaves_it() {
        let (_d, root) = root();
        let bytes = png(64);
        let name = format!("image-{}.png", hash8(&bytes));
        let at_name = root.join(DIR).join(&name);
        fs::create_dir_all(root.join(DIR)).unwrap();

        // Same length, different bytes: only the byte comparison can tell them apart.
        let mut same_len = bytes.clone();
        *same_len.last_mut().unwrap() = 1;
        fs::write(&at_name, &same_len).unwrap();
        let err = save_image_in(&root, DIR, &bytes).unwrap_err();
        assert_eq!(err, format!("A different file is already named {name}."));
        assert_eq!(fs::read(&at_name).unwrap(), same_len);

        // A different length.
        fs::write(&at_name, b"short").unwrap();
        let err = save_image_in(&root, DIR, &bytes).unwrap_err();
        assert_eq!(err, format!("A different file is already named {name}."));
        assert_eq!(fs::read(&at_name).unwrap(), b"short");
        assert_eq!(list_files_in(&root, "").unwrap(), vec![format!("{DIR}/{name}")]);
    }

    #[test]
    fn save_image_refuses_non_images_and_takes_up_to_ten_mib() {
        let (_d, root) = root();
        let not_image = "That file is not a JPEG or PNG image.";
        assert_eq!(save_image_in(&root, DIR, b"just some text, saved as shot.png").unwrap_err(), not_image);
        assert_eq!(save_image_in(&root, DIR, b"").unwrap_err(), not_image);
        let too_big = "That image is larger than 10 MB.";
        assert_eq!(save_image_in(&root, DIR, &png(MAX_PASTED_IMAGE_BYTES + 1)).unwrap_err(), too_big);
        assert_eq!(save_image_in(&root, DIR, &jpeg(MAX_PASTED_IMAGE_BYTES + 1)).unwrap_err(), too_big);
        // A refused image creates no folder.
        assert!(!root.join("collections").exists());

        assert_eq!(MAX_PASTED_IMAGE_BYTES, 10 * 1024 * 1024);
        let rel = save_image_in(&root, DIR, &png(MAX_PASTED_IMAGE_BYTES)).unwrap();
        assert_eq!(fs::metadata(root.join(rel)).unwrap().len(), MAX_PASTED_IMAGE_BYTES as u64);
    }

    #[test]
    fn save_image_refuses_folders_that_leave_the_root() {
        let (outer, root) = nested_root();
        let bytes = png(10);
        for dir in ["..", "../out", "a/../..", "collections/../../out", "/"] {
            assert!(save_image_in(&root, dir, &bytes).is_err(), "dir {dir:?}");
        }
        let abs = outer.path().join("abs");
        assert!(save_image_in(&root, abs.to_str().unwrap(), &bytes).is_err());
        let abs_inside = root.join("inside");
        assert!(save_image_in(&root, abs_inside.to_str().unwrap(), &bytes).is_err());
        outer_holds_only_the_root(&outer);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn save_image_refuses_a_folder_reached_through_a_link_that_leaves_the_root() {
        use std::os::unix::fs::symlink;
        let (_d, root) = root();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), root.join("link")).unwrap();
        let bytes = png(10);
        assert!(save_image_in(&root, "link", &bytes).is_err());
        assert!(save_image_in(&root, "link/deeper", &bytes).is_err());
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn save_image_through_a_link_inside_the_root_returns_the_path_as_named() {
        use std::os::unix::fs::symlink;
        let (_d, root) = root();
        fs::create_dir(root.join("real")).unwrap();
        symlink(root.join("real"), root.join("alias")).unwrap();
        let bytes = png(10);
        let name = format!("image-{}.png", hash8(&bytes));
        assert_eq!(save_image_in(&root, "alias", &bytes).unwrap(), format!("alias/{name}"));
        assert_eq!(fs::read(root.join("real").join(&name)).unwrap(), bytes);
    }

    #[test]
    fn save_image_creates_its_folder_and_saves_at_the_root_for_an_empty_folder() {
        let (_d, root) = root();
        let bytes = png(10);
        let name = format!("image-{}.png", hash8(&bytes));
        assert!(!root.join("new").exists());
        assert_eq!(save_image_in(&root, "new/deeper", &bytes).unwrap(), format!("new/deeper/{name}"));
        assert_eq!(fs::read(root.join("new/deeper").join(&name)).unwrap(), bytes);

        assert_eq!(save_image_in(&root, "", &bytes).unwrap(), name);
        assert_eq!(fs::read(root.join(&name)).unwrap(), bytes);
        assert_eq!(save_image_in(&root, ".", &bytes).unwrap(), name);

        // The returned path is normalized, with forward slashes.
        assert_eq!(save_image_in(&root, "a/../b/./c", &bytes).unwrap(), format!("b/c/{name}"));
        assert_eq!(save_image_in(&root, "d/", &bytes).unwrap(), format!("d/{name}"));
        assert!(!root.join("a").exists());
    }

    #[cfg(unix)]
    #[test]
    fn save_image_refuses_a_link_at_its_name_and_leaves_the_link_target() {
        use std::os::unix::fs::symlink;
        let (_d, root) = root();
        let bytes = png(64);
        let name = format!("image-{}.png", hash8(&bytes));
        write_text_in(&root, &format!("{DIR}/foo.md"), "foo").unwrap();
        let foo = root.join(DIR).join("foo.md");
        let link = root.join(DIR).join(&name);
        symlink(&foo, &link).unwrap();
        assert!(save_image_in(&root, DIR, &bytes).is_err());
        assert_eq!(fs::read_to_string(&foo).unwrap(), "foo");
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());

        // A link to a file holding the very same bytes is refused too.
        let other = "collections/c/other";
        copy_bytes_into_root(&root, &format!("{other}/same.png"), &bytes).unwrap();
        symlink("same.png", root.join(other).join(&name)).unwrap();
        assert!(save_image_in(&root, other, &bytes).is_err());
        assert!(fs::symlink_metadata(root.join(other).join(&name)).unwrap().file_type().is_symlink());
    }

    #[test]
    fn save_image_refuses_a_folder_at_its_name_or_a_file_in_its_path() {
        let (_d, root) = root();
        let bytes = png(64);
        let name = format!("image-{}.png", hash8(&bytes));
        fs::create_dir_all(root.join(DIR).join(&name)).unwrap();
        assert!(save_image_in(&root, DIR, &bytes).is_err());
        assert!(root.join(DIR).join(&name).is_dir());
        assert_eq!(fs::read_dir(root.join(DIR).join(&name)).unwrap().count(), 0);

        write_text_in(&root, "notes.md", "n").unwrap();
        assert!(save_image_in(&root, "notes.md", &bytes).is_err());
        assert_eq!(fs::read_to_string(root.join("notes.md")).unwrap(), "n");
    }

    #[test]
    fn decode_dir_header_decodes_percent_encoding_once() {
        assert_eq!(
            decode_dir_header("collections%2Fmy%20c%2Fcredentials").unwrap(),
            "collections/my c/credentials"
        );
        assert_eq!(decode_dir_header("collections/R%C3%A9vision%20%E6%97%A5%E6%9C%AC").unwrap(), "collections/Révision 日本");
        assert_eq!(decode_dir_header("plain/folder").unwrap(), "plain/folder");
        assert_eq!(decode_dir_header("").unwrap(), "");
        // Once: an encoded percent sign stays a percent sign.
        assert_eq!(decode_dir_header("%2541").unwrap(), "%41");
    }

    #[test]
    fn decode_dir_header_refuses_control_characters_and_invalid_utf8() {
        for raw in ["%00", "a%00b", "%0A", "%0D", "%09", "a\tb", "%7F", "%C2%85", "%FF", "%C3", "%C3%28", "a%E6%97"] {
            assert!(decode_dir_header(raw).is_err(), "{raw:?}");
        }
    }

    #[test]
    fn a_decoded_folder_that_climbs_out_is_refused_by_the_save() {
        let (outer, root) = nested_root();
        let dir = decode_dir_header("a%2F..%2F..").unwrap();
        assert_eq!(dir, "a/../..");
        assert!(save_image_in(&root, &dir, &png(10)).is_err());
        outer_holds_only_the_root(&outer);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    }
}
