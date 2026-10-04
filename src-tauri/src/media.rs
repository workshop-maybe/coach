//! The `media` URI scheme (KTD3): plays videos from the data folder, confined to it,
//! with Range support. `respond` is plain Rust with no Tauri types; `lib.rs` registers
//! the scheme and turns a `Reply` into a response.

use std::path::Path;

/// The most bytes one ranged response carries (4 MiB).
pub const MAX_RANGE_BYTES: u64 = 4 * 1024 * 1024;

/// A response, as status, headers and body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

/// The parts of a request the scheme reads.
#[derive(Debug, Clone, Copy)]
pub struct Request<'a> {
    pub method: &'a str,
    /// The URL's path, still percent-encoded, with its leading `/`.
    pub path: &'a str,
    pub range: Option<&'a str>,
    pub origin: Option<&'a str>,
}

/// Answers one request against the data root, if one is set.
pub fn respond(root: Option<&Path>, request: &Request<'_>) -> Reply {
    answer(root, request, cfg!(debug_assertions))
}

/// The app's own page origins, plus the dev server's in a debug build.
fn allowed_origin(origin: &str, debug: bool) -> bool {
    matches!(origin, "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost")
        || (debug && origin == "http://localhost:1420")
}

fn content_type(ext: &str) -> &'static str {
    match ext {
        "m4v" => "video/x-m4v",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => "video/mp4",
    }
}

/// A video found under the root, open and checked.
struct Found {
    file: std::fs::File,
    len: u64,
    ext: &'static str,
}

/// Finds the video a request path names, or None for anything refused, missing or
/// outside the root, so every such case gets the same answer.
fn find_video(root: Option<&Path>, raw: &str) -> Option<Found> {
    use crate::files::{
        family_agrees, is_local_video_name, normalize_rel, open_regular, read_head, resolve_in_root, sniff_video,
        video_ext_of_name,
    };
    let root = root?;
    let raw = raw.split(['?', '#']).next().unwrap_or_default();
    let raw = raw.strip_prefix('/').unwrap_or(raw);
    let decoded = percent_encoding::percent_decode_str(raw).decode_utf8().ok()?;
    if decoded.chars().any(char::is_control) {
        return None;
    }
    let parts = normalize_rel(&decoded).ok()?;
    let name = parts.last()?.to_str()?;
    if !is_local_video_name(name) {
        return None;
    }
    let ext = video_ext_of_name(name)?;
    let rel = crate::files::rel_string(&parts);
    let path = resolve_in_root(root, &rel).ok()?;
    let (mut file, len) = open_regular(&path).ok()??;
    let head = read_head(&mut file).ok()?;
    if !sniff_video(&head).is_some_and(|family| family_agrees(family, ext)) {
        return None;
    }
    Some(Found { file, len, ext })
}

/// Digits only, so a sign or a space never parses.
fn parse_u64(s: &str) -> Option<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// The first range of a `Range` header against `len` bytes, as inclusive (start, end)
/// capped at `MAX_RANGE_BYTES`. None when it is malformed or cannot be satisfied.
fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let (unit, set) = header.trim().split_once('=')?;
    if !unit.trim().eq_ignore_ascii_case("bytes") {
        return None;
    }
    let first = set.split(',').map(str::trim).find(|s| !s.is_empty())?;
    let (a, b) = first.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    let last = len.checked_sub(1)?;
    let (start, end) = if a.is_empty() {
        let n = parse_u64(b)?;
        if n == 0 {
            return None;
        }
        (len.saturating_sub(n), last)
    } else {
        let start = parse_u64(a)?;
        let end = if b.is_empty() { last } else { parse_u64(b)? };
        if start > end || start > last {
            return None;
        }
        (start, end.min(last))
    };
    Some((start, end.min(start.saturating_add(MAX_RANGE_BYTES - 1))))
}

/// Reads `count` bytes from `start`.
fn read_span(file: &mut std::fs::File, start: u64, count: u64) -> std::io::Result<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let size = usize::try_from(count).map_err(|_| std::io::ErrorKind::InvalidInput)?;
    let mut body = vec![0u8; size];
    file.seek(SeekFrom::Start(start))?;
    file.read_exact(&mut body)?;
    Ok(body)
}

fn answer(root: Option<&Path>, request: &Request<'_>, debug: bool) -> Reply {
    let mut headers: Vec<(&'static str, String)> = vec![("Accept-Ranges", "bytes".into()), ("Vary", "Origin".into())];
    if let Some(origin) = request.origin.filter(|o| allowed_origin(o, debug)) {
        headers.push(("Access-Control-Allow-Origin", origin.to_string()));
    }
    let empty = |status: u16, mut headers: Vec<(&'static str, String)>| {
        headers.push(("Content-Length", "0".into()));
        Reply { status, headers, body: Vec::new() }
    };

    let head_only = match request.method {
        "GET" => false,
        "HEAD" => true,
        _ => {
            headers.push(("Allow", "GET, HEAD".into()));
            return empty(405, headers);
        }
    };
    let Some(mut found) = find_video(root, request.path) else {
        return empty(404, headers);
    };
    headers.push(("Content-Type", content_type(found.ext).into()));
    let len = found.len;

    let (status, start, count) = match request.range {
        None if len > crate::files::MAX_VIDEO_BYTES => return empty(413, headers),
        None => (200, 0, len),
        Some(range) => match parse_range(range, len) {
            None => {
                headers.push(("Content-Range", format!("bytes */{len}")));
                return empty(416, headers);
            }
            Some((start, end)) => {
                let Some(count) = end.checked_sub(start).and_then(|n| n.checked_add(1)) else {
                    return empty(500, headers);
                };
                headers.push(("Content-Range", format!("bytes {start}-{end}/{len}")));
                (206, start, count)
            }
        },
    };
    headers.push(("Content-Length", count.to_string()));
    if head_only {
        return Reply { status, headers, body: Vec::new() };
    }
    match read_span(&mut found.file, start, count) {
        Ok(body) => Reply { status, headers, body },
        Err(_) => {
            headers.retain(|(name, _)| !matches!(*name, "Content-Length" | "Content-Range" | "Content-Type"));
            empty(500, headers)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::{MAX_VIDEO_BYTES, RootKind, Roots};
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn root() -> (TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let canon = Roots::default().set(RootKind::Data, dir.path()).unwrap();
        (dir, canon)
    }

    /// A data root inside an outer folder, so a file can sit just outside it.
    fn nested_root() -> (TempDir, PathBuf) {
        let outer = tempfile::tempdir().unwrap();
        let inner = outer.path().join("root");
        fs::create_dir(&inner).unwrap();
        let root = Roots::default().set(RootKind::Data, &inner).unwrap();
        (outer, root)
    }

    /// An `ftyp` video of `len` bytes whose other bytes count up, so a range is checkable.
    fn mp4(len: usize) -> Vec<u8> {
        let mut v: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
        if len >= 8 {
            v[4..8].copy_from_slice(b"ftyp");
        }
        v
    }

    fn webm(len: usize) -> Vec<u8> {
        let mut v = vec![0x1A, 0x45, 0xDF, 0xA3, 0x87, 0x42, 0x82, 0x84, b'w', b'e', b'b', b'm'];
        v.resize(len.max(v.len()), 0);
        v
    }

    fn put(root: &Path, rel: &str, bytes: &[u8]) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, bytes).unwrap();
    }

    fn req<'a>(method: &'a str, path: &'a str, range: Option<&'a str>) -> Request<'a> {
        Request { method, path, range, origin: None }
    }

    fn get(root: &Path, path: &str, range: Option<&str>) -> Reply {
        answer(Some(root), &req("GET", path, range), true)
    }

    fn header<'a>(reply: &'a Reply, name: &str) -> Option<&'a str> {
        reply.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    const V: &str = "/video-1a2b3c4d.mp4";

    fn ten(root: &Path) -> Vec<u8> {
        let v = mp4(10);
        put(root, "video-1a2b3c4d.mp4", &v);
        v
    }

    fn assert_416(reply: &Reply, len: u64) {
        assert_eq!(reply.status, 416, "{reply:?}");
        assert_eq!(header(reply, "Content-Range"), Some(format!("bytes */{len}").as_str()));
        assert!(reply.body.is_empty());
    }

    #[test]
    fn a_closed_range_returns_206_with_its_bytes() {
        let (_d, root) = root();
        let v = ten(&root);
        let r = get(&root, V, Some("bytes=0-1"));
        assert_eq!(r.status, 206);
        assert_eq!(header(&r, "Content-Range"), Some("bytes 0-1/10"));
        assert_eq!(header(&r, "Content-Length"), Some("2"));
        assert_eq!(r.body, v[0..2]);
    }

    #[test]
    fn open_suffix_and_overlong_ranges_are_clamped_to_the_file() {
        let (_d, root) = root();
        let v = ten(&root);
        let r = get(&root, V, Some("bytes=4-"));
        assert_eq!((r.status, r.body.as_slice()), (206, &v[4..]));
        assert_eq!(header(&r, "Content-Range"), Some("bytes 4-9/10"));
        let r = get(&root, V, Some("bytes=-3"));
        assert_eq!((r.status, r.body.as_slice()), (206, &v[7..]));
        assert_eq!(header(&r, "Content-Range"), Some("bytes 7-9/10"));
        let r = get(&root, V, Some("bytes=8-100"));
        assert_eq!((r.status, r.body.as_slice()), (206, &v[8..]));
        assert_eq!(header(&r, "Content-Range"), Some("bytes 8-9/10"));
        let r = get(&root, V, Some("bytes=-20"));
        assert_eq!((r.status, r.body.as_slice()), (206, &v[..]));
        assert_eq!(header(&r, "Content-Range"), Some("bytes 0-9/10"));
    }

    #[test]
    fn an_open_range_on_a_large_file_returns_at_most_4_mib() {
        let (_d, root) = root();
        let total = MAX_RANGE_BYTES as usize + 100;
        let v = mp4(total);
        put(&root, "video-1a2b3c4d.mp4", &v);
        let r = get(&root, V, Some("bytes=0-"));
        assert_eq!(r.status, 206);
        assert_eq!(r.body.len() as u64, MAX_RANGE_BYTES);
        assert_eq!(r.body, v[..MAX_RANGE_BYTES as usize]);
        assert_eq!(header(&r, "Content-Range"), Some(format!("bytes 0-4194303/{total}").as_str()));
        assert_eq!(header(&r, "Content-Length"), Some("4194304"));
        let r = get(&root, V, Some("bytes=100-"));
        assert_eq!(header(&r, "Content-Range"), Some(format!("bytes 100-4194403/{total}").as_str()));
        assert_eq!(r.body, v[100..100 + MAX_RANGE_BYTES as usize]);
    }

    #[test]
    fn unsatisfiable_or_malformed_ranges_return_416() {
        let (_d, root) = root();
        ten(&root);
        for range in ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=abc", "items=0-1", "bytes=", "bytes=-", "bytes=+1-2", "", "bytes=1"] {
            assert_416(&get(&root, V, Some(range)), 10);
        }
    }

    #[test]
    fn huge_numbers_and_odd_spacing_never_panic() {
        let (_d, root) = root();
        let v = ten(&root);
        let r = get(&root, V, Some("bytes=0-18446744073709551615"));
        assert_eq!((r.status, r.body.as_slice()), (206, &v[..]));
        assert_416(&get(&root, V, Some("bytes=18446744073709551615-")), 10);
        assert_416(&get(&root, V, Some("bytes=-99999999999999999999999")), 10);
        assert_416(&get(&root, V, Some("bytes=99999999999999999999999-1")), 10);
        for range in ["bytes= 0 - 1 ", "bytes=0-1,", "bytes=,0-1", " bytes = 0-1", "bytes=0\t-1", "bytes=0-1,,,"] {
            let r = get(&root, V, Some(range));
            assert!(r.status == 206 || r.status == 416, "{range:?}: {}", r.status);
        }
        assert_eq!(get(&root, V, Some("bytes=0-1,")).body, v[0..2]);
    }

    #[test]
    fn only_the_first_of_several_ranges_is_served() {
        let (_d, root) = root();
        let v = ten(&root);
        let r = get(&root, V, Some("bytes=0-1,4-5"));
        assert_eq!(r.status, 206);
        assert_eq!(r.body, v[0..2]);
        assert_eq!(header(&r, "Content-Range"), Some("bytes 0-1/10"));
    }

    #[test]
    fn no_range_returns_a_small_file_whole_and_refuses_one_over_100_mib() {
        let (_d, root) = root();
        let v = ten(&root);
        let r = get(&root, V, None);
        assert_eq!((r.status, r.body.as_slice()), (200, &v[..]));
        assert_eq!(header(&r, "Content-Length"), Some("10"));
        assert_eq!(header(&r, "Content-Range"), None);

        // Sparse, one byte over: refused from its size without reading it.
        put(&root, "big.mp4", &mp4(16));
        fs::File::options().write(true).open(root.join("big.mp4")).unwrap().set_len(MAX_VIDEO_BYTES + 1).unwrap();
        let r = get(&root, "/big.mp4", None);
        assert_eq!(r.status, 413);
        assert!(r.body.is_empty());
        // A range of it is still served.
        assert_eq!(get(&root, "/big.mp4", Some("bytes=0-1")).status, 206);
    }

    #[test]
    fn head_returns_the_headers_alone_and_other_methods_get_405() {
        let (_d, root) = root();
        ten(&root);
        let r = answer(Some(&root), &req("HEAD", V, None), true);
        assert_eq!(r.status, 200);
        assert_eq!(header(&r, "Content-Length"), Some("10"));
        assert_eq!(header(&r, "Content-Type"), Some("video/mp4"));
        assert!(r.body.is_empty());
        let r = answer(Some(&root), &req("HEAD", V, Some("bytes=0-1")), true);
        assert_eq!(r.status, 206);
        assert_eq!(header(&r, "Content-Length"), Some("2"));
        assert_eq!(header(&r, "Content-Range"), Some("bytes 0-1/10"));
        assert!(r.body.is_empty());
        // HEAD on a missing file is the same 404 a GET gets.
        let missing = "/video-00000000.mp4";
        assert_eq!(
            answer(Some(&root), &req("HEAD", missing, None), true),
            answer(Some(&root), &req("GET", missing, None), true)
        );
        for method in ["POST", "PUT", "DELETE", "OPTIONS", "get"] {
            let r = answer(Some(&root), &req(method, V, None), true);
            assert_eq!(r.status, 405, "{method}");
            assert!(r.body.is_empty());
        }
    }

    #[test]
    fn content_types_follow_the_extension_and_every_response_accepts_ranges() {
        let (_d, root) = root();
        put(&root, "a.mp4", &mp4(20));
        put(&root, "a.m4v", &mp4(20));
        put(&root, "a.mov", &mp4(20));
        put(&root, "a.webm", &webm(20));
        for (path, ty) in [("/a.mp4", "video/mp4"), ("/a.m4v", "video/x-m4v"), ("/a.mov", "video/quicktime"), ("/a.webm", "video/webm")] {
            let r = get(&root, path, None);
            assert_eq!(r.status, 200, "{path}");
            assert_eq!(header(&r, "Content-Type"), Some(ty), "{path}");
        }
        put(&root, "big.mp4", &mp4(16));
        fs::File::options().write(true).open(root.join("big.mp4")).unwrap().set_len(MAX_VIDEO_BYTES + 1).unwrap();
        let replies = [
            get(&root, "/a.mp4", None),
            get(&root, "/a.mp4", Some("bytes=0-1")),
            get(&root, "/a.mp4", Some("bytes=99-")),
            get(&root, "/big.mp4", None),
            get(&root, "/missing.mp4", None),
            answer(Some(&root), &req("POST", "/a.mp4", None), true),
            answer(None, &req("GET", "/a.mp4", None), true),
        ];
        for r in &replies {
            assert_eq!(header(r, "Accept-Ranges"), Some("bytes"), "{r:?}");
        }
        assert_eq!(replies.iter().map(|r| r.status).collect::<Vec<_>>(), vec![200, 206, 416, 413, 404, 405, 404]);
    }

    #[test]
    fn only_the_apps_own_origins_are_echoed() {
        let (_d, root) = root();
        ten(&root);
        let with_origin = |origin: Option<&str>, debug: bool| {
            answer(Some(&root), &Request { method: "GET", path: V, range: None, origin }, debug)
        };
        for origin in ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"] {
            let r = with_origin(Some(origin), false);
            assert_eq!(header(&r, "Access-Control-Allow-Origin"), Some(origin));
            assert_eq!(header(&r, "Vary"), Some("Origin"));
        }
        for origin in [Some("https://evil.example"), Some("null"), Some("tauri://localhost.evil"), None] {
            let r = with_origin(origin, true);
            assert_eq!(header(&r, "Access-Control-Allow-Origin"), None, "{origin:?}");
            assert_eq!(header(&r, "Vary"), Some("Origin"));
        }
        // The dev server's origin only in a debug build.
        let dev = Some("http://localhost:1420");
        assert_eq!(header(&with_origin(dev, true), "Access-Control-Allow-Origin"), dev);
        assert_eq!(header(&with_origin(dev, false), "Access-Control-Allow-Origin"), None);
        let r = respond(Some(&root), &Request { method: "GET", path: V, range: None, origin: dev });
        assert_eq!(header(&r, "Access-Control-Allow-Origin").is_some(), cfg!(debug_assertions));
        // A 404 carries the same CORS answer, so the page can read it.
        let r = with_origin(Some("tauri://localhost"), false);
        assert_eq!(r.status, 200);
        let r = answer(Some(&root), &Request { method: "GET", path: "/nope.mp4", range: None, origin: Some("tauri://localhost") }, false);
        assert_eq!(r.status, 404);
        assert_eq!(header(&r, "Access-Control-Allow-Origin"), Some("tauri://localhost"));
    }

    #[test]
    fn anything_refused_missing_or_outside_the_root_is_404() {
        let (outer, root) = nested_root();
        fs::write(outer.path().join("video-1a2b3c4d.mp4"), mp4(20)).unwrap();
        put(&root, "collections/c/credentials/foo.md", b"# Foo\n");
        put(&root, "image-1a2b3c4d.png", &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]);
        put(&root, "notes.mp4", b"just some text, saved as a video");
        put(&root, "kept.mp4", &mp4(20));
        let abs = outer.path().join("video-1a2b3c4d.mp4");
        let abs_encoded = format!("/{}", abs.to_str().unwrap().replace('/', "%2F"));
        let mut paths = vec![
            "/../video-1a2b3c4d.mp4".to_string(),
            "/a/../../video-1a2b3c4d.mp4".to_string(),
            "/..%2Fvideo-1a2b3c4d.mp4".to_string(),
            "/%2e%2e%2fvideo-1a2b3c4d.mp4".to_string(),
            "/%2E%2E/video-1a2b3c4d.mp4".to_string(),
            format!("/{}", abs.to_str().unwrap()),
            abs_encoded,
            "/collections%2Fc%2Fcredentials%2Ffoo.md".to_string(),
            "/image-1a2b3c4d.png".to_string(),
            "/notes.mp4".to_string(),
            "/missing.mp4".to_string(),
            "/%00".to_string(),
            "/kept%00.mp4".to_string(),
            "/kept.mp4%00".to_string(),
            "/%0Akept.mp4".to_string(),
            "/%c0%ae%c0%ae/video-1a2b3c4d.mp4".to_string(),
            "/%ff.mp4".to_string(),
            "/kept.mp4%3Fa".to_string(),
            "/".to_string(),
            String::new(),
        ];
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink(&abs, root.join("out.mp4")).unwrap();
            symlink(outer.path(), root.join("outdir")).unwrap();
            symlink(root.join("collections/c/credentials/foo.md"), root.join("video-0badc0de.mp4")).unwrap();
            let fifo = root.join("video-f1f0f1f0.mp4");
            assert!(std::process::Command::new("mkfifo").arg(&fifo).status().unwrap().success());
            paths.extend(["/out.mp4", "/outdir/video-1a2b3c4d.mp4", "/video-0badc0de.mp4", "/video-f1f0f1f0.mp4"].map(String::from));
        }
        for path in &paths {
            assert_eq!(get(&root, path, None).status, 404, "{path:?}");
            assert_eq!(get(&root, path, Some("bytes=0-1")).status, 404, "{path:?}");
        }
        // With no data folder set, even a real file is 404.
        assert_eq!(answer(None, &req("GET", "/kept.mp4", None), true).status, 404);
        assert_eq!(get(&root, "/kept.mp4", None).status, 200);
    }

    #[test]
    fn missing_refused_and_outside_get_byte_identical_404s() {
        let (outer, root) = nested_root();
        fs::write(outer.path().join("video-1a2b3c4d.mp4"), mp4(20)).unwrap();
        put(&root, "notes.mp4", b"just some text, saved as a video");
        let missing = get(&root, "/video-00000000.mp4", None);
        let refused = get(&root, "/notes.mp4", None);
        let outside = get(&root, "/..%2Fvideo-1a2b3c4d.mp4", None);
        let not_video = get(&root, "/notes.md", None);
        assert_eq!(missing.status, 404);
        assert_eq!(missing, refused);
        assert_eq!(missing, outside);
        assert_eq!(missing, not_video);
        assert!(missing.body.is_empty());
        assert_eq!(header(&missing, "Content-Type"), None);
        // The same with a Range header: no 416 before the checks pass.
        assert_eq!(get(&root, "/notes.mp4", Some("bytes=99-")), missing);
    }

    #[test]
    fn a_double_encoded_climb_stays_a_literal_name() {
        let (outer, root) = nested_root();
        fs::write(outer.path().join("video-1a2b3c4d.mp4"), mp4(20)).unwrap();
        assert_eq!(get(&root, "/%252e%252e%252fvideo-1a2b3c4d.mp4", None).status, 404);
        // A file really named that way is what it reaches.
        let literal = mp4(12);
        put(&root, "%2e%2e%2fvideo-1a2b3c4d.mp4", &literal);
        let r = get(&root, "/%252e%252e%252fvideo-1a2b3c4d.mp4", None);
        assert_eq!((r.status, r.body), (200, literal));
    }

    #[test]
    fn a_query_or_fragment_is_ignored() {
        let (_d, root) = root();
        let v = ten(&root);
        assert_eq!(get(&root, "/video-1a2b3c4d.mp4?t=1", None).body, v);
        assert_eq!(get(&root, "/video-1a2b3c4d.mp4#t=1", None).body, v);
    }

    #[test]
    fn an_encoded_path_with_spaces_and_unicode_resolves() {
        let (_d, root) = root();
        let v = mp4(30);
        put(&root, "my clips/Révision 日本/video-1a2b3c4d.mp4", &v);
        let r = get(&root, "/my%20clips%2FR%C3%A9vision%20%E6%97%A5%E6%9C%AC%2Fvideo-1a2b3c4d.mp4", None);
        assert_eq!((r.status, r.body.as_slice()), (200, &v[..]));
        // Slashes left unencoded work too.
        let r = get(&root, "/my%20clips/R%C3%A9vision%20%E6%97%A5%E6%9C%AC/video-1a2b3c4d.mp4", None);
        assert_eq!(r.status, 200);
    }
}
