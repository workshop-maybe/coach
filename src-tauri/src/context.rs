//! The context a test started with: which machine, and a fingerprint of the
//! memory and instruction files the agent's harness loads for its repo.
//!
//! These reads go outside the folders the user picked, so only a short digest
//! ever leaves this module. File contents never reach the UI or the data
//! folder. Plain Rust with no Tauri types, so it is unit-tested without a
//! runtime; the command in `lib.rs` is a thin wrapper.

use std::path::{Path, PathBuf};

/// Recorded when memory could not be read, so no false change is reported.
pub const NOT_READ: &str = "not-read";

/// A source bigger than this is not read.
pub const MAX_SOURCE_BYTES: u64 = 1024 * 1024;

/// The harness whose memory layout this module knows.
const CLAUDE_CODE: &str = "claude-code";

/// A 12-hex digest of the harness's memory and instruction files for `repo`,
/// or `NOT_READ`.
///
/// Only Claude Code is read. Its sources are `~/.claude/CLAUDE.md`, the
/// repo's `CLAUDE.md` and `CLAUDE.local.md`, and the `*.md` files in the
/// project's `memory/` folder. Session transcripts are left out because they
/// change every session. A missing source counts as absent, so adding or
/// removing a file changes the digest. Anything that exists but cannot be
/// read safely makes the whole fingerprint `NOT_READ`.
pub fn memory_fingerprint(home: &Path, repo: &str, harness: &str) -> String {
    if harness != CLAUDE_CODE {
        return NOT_READ.to_string();
    }
    let Some(repo) = resolve_repo(home, repo) else {
        return NOT_READ.to_string();
    };
    match source_hashes(home, &repo) {
        Some(entries) => digest(&entries),
        None => NOT_READ.to_string(),
    }
}

/// The Claude Code project folder name for a repo path.
pub fn project_dir_name(repo: &Path) -> String {
    repo.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// A new random-enough machine id: 16 hex characters.
pub fn new_machine_id() -> String {
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let seed = format!(
        "{nanos}:{}:{}:{:p}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed),
        &COUNTER
    );
    hex(&Sha256::digest(seed.as_bytes())[..8])
}

/// Trims the repo string, expands a leading `~`, and canonicalizes it.
/// None when it is empty or not an existing folder.
fn resolve_repo(home: &Path, repo: &str) -> Option<PathBuf> {
    let repo = repo.trim();
    let path = if repo.is_empty() {
        return None;
    } else if repo == "~" {
        home.to_path_buf()
    } else if let Some(rest) = repo.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(repo)
    };
    if !path.is_dir() {
        return None;
    }
    path.canonicalize().ok()
}

/// (label, content hash) for every source, or None when one can't be read.
fn source_hashes(home: &Path, repo: &Path) -> Option<Vec<(String, String)>> {
    let mut entries = vec![
        ("global/CLAUDE.md".to_string(), hash_source(&home.join(".claude/CLAUDE.md"))?),
        ("repo/CLAUDE.md".to_string(), hash_source(&repo.join("CLAUDE.md"))?),
        ("repo/CLAUDE.local.md".to_string(), hash_source(&repo.join("CLAUDE.local.md"))?),
    ];
    let memory = home.join(".claude/projects").join(project_dir_name(repo)).join("memory");
    match std::fs::read_dir(&memory) {
        Ok(dir) => {
            for entry in dir {
                let name = entry.ok()?.file_name().to_string_lossy().into_owned();
                if name.ends_with(".md") {
                    entries.push((format!("memory/{name}"), hash_source(&memory.join(&name))?));
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return None,
    }
    entries.sort();
    Some(entries)
}

/// The hex SHA-256 of a regular file of at most `MAX_SOURCE_BYTES`,
/// "absent" when it doesn't exist, or None when it can't be read safely.
fn hash_source(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Some("absent".to_string()),
        Err(_) => return None,
    };
    if !meta.is_file() || meta.len() > MAX_SOURCE_BYTES {
        return None;
    }
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_SOURCE_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return None;
    }
    Some(hex(&Sha256::digest(&bytes)))
}

fn digest(entries: &[(String, String)]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for (label, hash) in entries {
        hasher.update(format!("{label}\t{hash}\n").as_bytes());
    }
    hex(&hasher.finalize())[..12].to_string()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// A temp home and a temp repo, both canonical.
    fn setup() -> (TempDir, PathBuf, TempDir, PathBuf) {
        let home = tempfile::tempdir().unwrap();
        let repo = tempfile::tempdir().unwrap();
        let h = home.path().canonicalize().unwrap();
        let r = repo.path().canonicalize().unwrap();
        (home, h, repo, r)
    }

    fn memory_dir(home: &Path, repo: &Path) -> PathBuf {
        let dir = home.join(".claude/projects").join(project_dir_name(repo)).join("memory");
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fp(home: &Path, repo: &Path) -> String {
        memory_fingerprint(home, &repo.to_string_lossy(), "claude-code")
    }

    #[test]
    fn same_files_give_the_same_digest() {
        let (_h, home, _r, repo) = setup();
        fs::write(repo.join("CLAUDE.md"), "Run tests first.").unwrap();
        let a = fp(&home, &repo);
        assert_eq!(a, fp(&home, &repo));
        assert_eq!(a.len(), 12);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn editing_the_repo_claude_md_changes_the_digest() {
        let (_h, home, _r, repo) = setup();
        fs::write(repo.join("CLAUDE.md"), "Run tests first.").unwrap();
        let before = fp(&home, &repo);
        fs::write(repo.join("CLAUDE.md"), "Run tests first.\nThen lint.").unwrap();
        assert_ne!(before, fp(&home, &repo));
    }

    #[test]
    fn global_and_local_instructions_count() {
        let (_h, home, _r, repo) = setup();
        let base = fp(&home, &repo);
        fs::create_dir_all(home.join(".claude")).unwrap();
        fs::write(home.join(".claude/CLAUDE.md"), "be brief").unwrap();
        let with_global = fp(&home, &repo);
        assert_ne!(base, with_global);
        fs::write(repo.join("CLAUDE.local.md"), "mine").unwrap();
        assert_ne!(with_global, fp(&home, &repo));
    }

    #[test]
    fn adding_and_removing_a_memory_file_changes_the_digest() {
        let (_h, home, _r, repo) = setup();
        let mem = memory_dir(&home, &repo);
        fs::write(mem.join("MEMORY.md"), "- one").unwrap();
        let one = fp(&home, &repo);
        fs::write(mem.join("topic.md"), "fact").unwrap();
        let two = fp(&home, &repo);
        assert_ne!(one, two);
        fs::remove_file(mem.join("topic.md")).unwrap();
        assert_eq!(one, fp(&home, &repo));
    }

    #[test]
    fn session_transcripts_are_ignored() {
        let (_h, home, _r, repo) = setup();
        let mem = memory_dir(&home, &repo);
        fs::write(mem.join("MEMORY.md"), "- one").unwrap();
        let before = fp(&home, &repo);
        let project = mem.parent().unwrap();
        fs::write(project.join("abc.jsonl"), "{}").unwrap();
        fs::create_dir_all(project.join("abc")).unwrap();
        fs::write(mem.join("notes.txt"), "not markdown").unwrap();
        assert_eq!(before, fp(&home, &repo));
    }

    #[test]
    fn project_dir_name_replaces_every_non_alphanumeric_character() {
        assert_eq!(
            project_dir_name(Path::new("/Users/me/projects/01-projects/my app.v2")),
            "-Users-me-projects-01-projects-my-app-v2"
        );
    }

    #[test]
    fn other_harnesses_are_not_read() {
        let (_h, home, _r, repo) = setup();
        assert_eq!(memory_fingerprint(&home, &repo.to_string_lossy(), "codex"), NOT_READ);
    }

    #[test]
    fn an_empty_or_missing_repo_is_not_read() {
        let (_h, home, _r, repo) = setup();
        assert_eq!(memory_fingerprint(&home, "", "claude-code"), NOT_READ);
        assert_eq!(memory_fingerprint(&home, "   ", "claude-code"), NOT_READ);
        let missing = repo.join("nope");
        assert_eq!(memory_fingerprint(&home, &missing.to_string_lossy(), "claude-code"), NOT_READ);
    }

    #[test]
    fn a_tilde_repo_resolves_under_home() {
        let (_h, home, _r, _repo) = setup();
        let repo = home.join("projects/app");
        fs::create_dir_all(&repo).unwrap();
        fs::write(repo.join("CLAUDE.md"), "hi").unwrap();
        let tilde = memory_fingerprint(&home, " ~/projects/app ", "claude-code");
        assert_ne!(tilde, NOT_READ);
        assert_eq!(tilde, fp(&home, &repo));
    }

    #[test]
    fn an_oversized_source_is_not_read() {
        let (_h, home, _r, repo) = setup();
        let big = vec![b'a'; MAX_SOURCE_BYTES as usize + 1];
        fs::write(repo.join("CLAUDE.md"), big).unwrap();
        assert_eq!(fp(&home, &repo), NOT_READ);
    }

    #[test]
    fn a_directory_named_like_a_source_is_not_read() {
        let (_h, home, _r, repo) = setup();
        fs::create_dir_all(repo.join("CLAUDE.md")).unwrap();
        assert_eq!(fp(&home, &repo), NOT_READ);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_source_is_not_read() {
        use std::os::unix::fs::PermissionsExt;
        let (_h, home, _r, repo) = setup();
        let path = repo.join("CLAUDE.md");
        fs::write(&path, "secret").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        let unreadable = fs::read(&path).is_err();
        let result = fp(&home, &repo);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        if unreadable {
            assert_eq!(result, NOT_READ);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_source_is_not_read() {
        let (_h, home, _r, repo) = setup();
        let path = repo.join("CLAUDE.md");
        let status = std::process::Command::new("mkfifo").arg(&path).status().unwrap();
        assert!(status.success());
        assert_eq!(fp(&home, &repo), NOT_READ);
    }

    #[test]
    fn the_digest_carries_no_file_content() {
        let (_h, home, _r, repo) = setup();
        fs::write(repo.join("CLAUDE.md"), "abcdef").unwrap();
        assert!(!fp(&home, &repo).contains("abcdef"));
    }

    #[test]
    fn machine_ids_are_16_hex_and_differ() {
        let a = new_machine_id();
        let b = new_machine_id();
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
