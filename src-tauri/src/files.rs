//! Confined text-file I/O over the folders the user picked.
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
pub fn write_temp(target: &Path, contents: &str) -> Result<PathBuf, String> {
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
        f.write_all(contents.as_bytes())?;
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
}
