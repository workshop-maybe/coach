// In-memory Storage for tests. One Map of path -> text per root, plus separate Maps per
// root of path -> data URI for images and path -> bytes for videos.

import { IMAGE_TOO_LARGE, NOT_AN_IMAGE, PASTED_IMAGE_MAX_BYTES, bytesToBase64, imageExtension } from "../domain/images";
import type { ContextReading } from "../domain/types";
import { ONLY_VIDEOS_AND_IMAGES, VIDEO_MAX_BYTES, VIDEO_TOO_LARGE, alreadyNamed, isLocalVideoName } from "../domain/videos";
import type { AddFrom, AddedFile, RootKind, Storage, VideoUrl } from "./storage";

/** What `readContext` returns when nothing is queued. */
const TEST_CONTEXT: ContextReading = { machineId: "test-machine", machine: "Test Mac", memory: "000000000000" };

/**
 * One file the next `addFiles` considers, standing in for what Rust found at a picked,
 * dropped or pasted path: its bytes, which go through the real sorting rules, or a refusal
 * Rust made before touching them (an unapproved drop, an unmatched paste).
 */
export type QueuedFile = { name: string; bytes: Uint8Array } | { name: string; error: string };

export class MemoryStorage implements Storage {
  private readonly roots: Record<RootKind, Map<string, string>> = {
    data: new Map(),
    export: new Map(),
  };

  private readonly images: Record<RootKind, Map<string, string>> = {
    data: new Map(),
    export: new Map(),
  };

  private readonly videos: Record<RootKind, Map<string, Uint8Array>> = {
    data: new Map(),
    export: new Map(),
  };

  /** Picks that `importBadgeArt` will return, in order. null models a cancelled picker. */
  private readonly artQueue: (string | null)[] = [];

  /** Readings that `readContext` will return, in order. An Error models a failed read. */
  private readonly contextQueue: (ContextReading | Error)[] = [];

  /** What each `addFiles` call finds, in order. An Error models a failed command. */
  private readonly addQueue: (QueuedFile[] | Error)[] = [];

  /** Every write, in order, for asserting what the domain layer touched. */
  readonly writes: { root: RootKind; path: string }[] = [];

  /** Every `addFiles` call, in order, for asserting what the page asked for. */
  readonly adds: { dir: string; from: AddFrom }[] = [];

  /** One entry per URL `videoUrl` handed out, with how many times it was released. */
  readonly videoUrls: { path: string; releases: number }[] = [];

  constructor(seed: Record<string, string> = {}, root: RootKind = "data") {
    this.seed(seed, root);
  }

  async readText(root: RootKind, path: string): Promise<string | null> {
    return this.roots[root].get(path) ?? null;
  }

  async writeText(root: RootKind, path: string, contents: string): Promise<void> {
    this.roots[root].set(path, contents);
    this.writes.push({ root, path });
  }

  async listFiles(root: RootKind, dir: string): Promise<string[]> {
    const prefix = dir === "" || dir.endsWith("/") ? dir : `${dir}/`;
    const paths = new Set([...this.roots[root].keys(), ...this.images[root].keys(), ...this.videos[root].keys()]);
    return [...paths].filter((p) => p.startsWith(prefix)).sort();
  }

  /** Mirrors the Rust command: a missing source or an existing target is an error. */
  async moveFile(root: RootKind, from: string, to: string): Promise<void> {
    const maps: Map<string, unknown>[] = [this.roots[root], this.images[root], this.videos[root]];
    const map = maps.find((m) => m.has(from));
    if (map === undefined) throw new Error(`Cannot move "${from}": it does not exist.`);
    if (maps.some((m) => m.has(to))) throw new Error(`Cannot move to "${to}": something is already there.`);
    map.set(to, map.get(from));
    map.delete(from);
    this.writes.push({ root, path: to });
  }

  async readDataUri(root: RootKind, path: string): Promise<string | null> {
    const uri = this.images[root].get(path);
    if (uri !== undefined) return uri;
    if (this.roots[root].has(path) || this.videos[root].has(path)) throw new Error(`"${path}": That file is not a JPEG or PNG image.`);
    return null;
  }

  /** Mirrors the Rust command: takes the next queued pick and stores it at a content-addressed path. */
  async importBadgeArt(collectionSlug: string, credentialSlug: string | null): Promise<string | null> {
    checkSlug("collection", collectionSlug);
    if (credentialSlug !== null) checkSlug("credential", credentialSlug);
    const uri = this.artQueue.shift() ?? null;
    if (uri === null) return null;
    const ext = uri.startsWith("data:image/jpeg;") ? "jpg" : uri.startsWith("data:image/png;") ? "png" : null;
    if (ext === null) throw new Error("That file is not a JPEG or PNG image.");
    const path = `collections/${collectionSlug}/badge/${credentialSlug ?? "art"}-${hash8(uri)}.${ext}`;
    this.images.data.set(path, uri);
    this.writes.push({ root: "data", path });
    return path;
  }

  /** Mirrors the Rust command: magic bytes, the 10 MiB cap, a content-addressed name, no overwrite. */
  async saveImage(root: RootKind, dir: string, bytes: Uint8Array): Promise<string> {
    const ext = imageExtension(bytes);
    if (ext === null) throw new Error(NOT_AN_IMAGE);
    if (bytes.length > PASTED_IMAGE_MAX_BYTES) throw new Error(IMAGE_TOO_LARGE);
    const uri = `data:image/${ext === "jpg" ? "jpeg" : "png"};base64,${bytesToBase64(bytes)}`;
    const name = `image-${hash8(uri)}.${ext}`;
    const path = pathIn(dir, name);
    const existing = this.images[root].get(path);
    if (existing === uri) return path;
    if (existing !== undefined || this.roots[root].has(path)) throw new Error(alreadyNamed(name));
    this.images[root].set(path, uri);
    this.writes.push({ root, path });
    return path;
  }

  /**
   * Mirrors the Rust command: takes the next queued batch (nothing queued is a cancelled
   * pick) and sorts each file by content into the data root's `dir`. A picture goes through
   * `saveImage`'s rules and a video through the family check, cap and naming; a refusal is
   * reported for its file and never stops the rest.
   */
  async addFiles(dir: string, from: AddFrom): Promise<AddedFile[]> {
    this.adds.push({ dir, from });
    const batch = this.addQueue.shift() ?? [];
    if (batch instanceof Error) throw batch;
    const results: AddedFile[] = [];
    for (const file of batch) {
      if ("error" in file) {
        results.push({ name: file.name, path: null, error: file.error });
        continue;
      }
      try {
        const path =
          imageExtension(file.bytes) !== null
            ? await this.saveImage("data", dir, file.bytes)
            : this.saveVideo("data", dir, file.bytes, extensionOf(file.name));
        results.push({ name: file.name, path, error: null });
      } catch (e) {
        results.push({ name: file.name, path: null, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return results;
  }

  /** Mirrors the Rust command: reads only the data root, and checks and names the copy as an add does. */
  async copyVideo(from: string, toRoot: RootKind, toDir: string): Promise<string> {
    const bytes = this.videos.data.get(from);
    if (bytes === undefined) throw new Error(`Cannot copy "${from}": it is not a video in the data folder.`);
    return this.saveVideo(toRoot, toDir, bytes, extensionOf(from));
  }

  /**
   * A `blob:memory/` URL for a data video the scheme would serve: a local video name whose
   * content agrees with its extension. Anything else is null, as the scheme answers 404.
   */
  async videoUrl(path: string): Promise<VideoUrl | null> {
    const bytes = this.videos.data.get(path);
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (bytes === undefined || !isLocalVideoName(name) || !videoFamilyAgrees(bytes, extensionOf(name))) return null;
    const handed = { path, releases: 0 };
    this.videoUrls.push(handed);
    return { url: `blob:memory/${path}`, release: () => void handed.releases++ };
  }

  /** The family check, the cap and the content-addressed name (KTD6); the same bytes are not written twice. */
  private saveVideo(root: RootKind, dir: string, bytes: Uint8Array, ext: string): string {
    if (!videoFamilyAgrees(bytes, ext)) throw new Error(ONLY_VIDEOS_AND_IMAGES);
    if (bytes.length > VIDEO_MAX_BYTES) throw new Error(VIDEO_TOO_LARGE);
    const name = `video-${hash8(bytes)}.${ext}`;
    const path = pathIn(dir, name);
    const existing = this.videos[root].get(path);
    if (existing !== undefined && sameBytes(existing, bytes)) return path;
    if (existing !== undefined || this.roots[root].has(path) || this.images[root].has(path)) throw new Error(alreadyNamed(name));
    this.videos[root].set(path, bytes);
    this.writes.push({ root, path });
    return path;
  }

  async readContext(_repo: string, _harness: string): Promise<ContextReading> {
    const next = this.contextQueue.shift() ?? TEST_CONTEXT;
    if (next instanceof Error) throw next;
    return next;
  }

  // Test helpers. These bypass `writes` so they model edits made outside the app.

  /** Puts files in place as if they already existed on disk. */
  seed(files: Record<string, string>, root: RootKind = "data"): void {
    for (const [path, text] of Object.entries(files)) this.roots[root].set(path, text);
  }

  /** Queues what the next `importBadgeArt` picks: a data URI, or null for a cancel. */
  queueArt(dataUri: string | null): void {
    this.artQueue.push(dataUri);
  }

  /** Queues what the next `readContext` returns: a reading, or an Error for a failed read. */
  queueContext(reading: ContextReading | Error): void {
    this.contextQueue.push(reading);
  }

  /**
   * Queues what the next `addFiles` finds, whatever its `from`: files, an empty list for a
   * cancelled pick, or an Error for a command that fails outright.
   */
  queueAdd(files: QueuedFile[] | Error): void {
    this.addQueue.push(files);
  }

  /** Puts a video in place as bytes, as if it already existed on disk. */
  seedVideo(path: string, bytes: Uint8Array, root: RootKind = "data"): void {
    this.videos[root].set(path, bytes);
  }

  /** Current bytes of a video, or undefined when absent. */
  video(path: string, root: RootKind = "data"): Uint8Array | undefined {
    return this.videos[root].get(path);
  }

  /** The path of each handed-out video URL not yet released, once per URL. */
  openVideoUrls(): string[] {
    return this.videoUrls.filter((u) => u.releases === 0).map((u) => u.path);
  }

  /** Puts an image in place as a data URI, as if it already existed on disk. */
  seedImage(path: string, dataUri: string, root: RootKind = "data"): void {
    this.images[root].set(path, dataUri);
  }

  /** Current data URI of an image, or undefined when absent. */
  image(path: string, root: RootKind = "data"): string | undefined {
    return this.images[root].get(path);
  }

  /** Current text of a file, or undefined when absent. */
  file(path: string, root: RootKind = "data"): string | undefined {
    return this.roots[root].get(path);
  }

  /** A snapshot of every file in a root. */
  files(root: RootKind = "data"): Record<string, string> {
    return Object.fromEntries(this.roots[root]);
  }

  /** Removes a file, as an outside deletion would. */
  remove(path: string, root: RootKind = "data"): void {
    this.roots[root].delete(path);
    this.images[root].delete(path);
    this.videos[root].delete(path);
  }
}

/** The lowercased extension of a file name, or "" when it has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Mirrors the Rust family check (KTD6). ISO-BMFF and QuickTime: `ftyp` at bytes 4-8 for any
 * of .mp4, .m4v and .mov, whatever the brand, and for .mov also a bare first atom. EBML: only
 * a `webm` DocType, only for .webm; matroska is refused even when named .webm.
 */
function videoFamilyAgrees(bytes: Uint8Array, ext: string): boolean {
  if (ext === "mp4" || ext === "m4v" || ext === "mov") {
    if (bytes.length < 8) return false;
    const atom = String.fromCharCode(...bytes.subarray(4, 8));
    return atom === "ftyp" || (ext === "mov" && ["moov", "mdat", "wide", "free", "skip", "pnot"].includes(atom));
  }
  return ext === "webm" && ebmlDocType(bytes) === "webm";
}

/** The DocType in an EBML header, or null when the bytes are not one or it is cut short. */
function ebmlDocType(bytes: Uint8Array): string | null {
  if (bytes.length < 4 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) return null;
  const header = readVint(bytes, 4, false);
  if (header === null) return null;
  let at = 4 + header.length;
  const end = at + header.value;
  while (at < end) {
    const id = readVint(bytes, at, true);
    if (id === null) return null;
    at += id.length;
    const size = readVint(bytes, at, false);
    if (size === null) return null;
    at += size.length;
    if (at + size.value > end || at + size.value > bytes.length) return null;
    if (id.value === 0x4282) return new TextDecoder().decode(bytes.subarray(at, at + size.value)).replace(/\0+$/, "");
    at += size.value;
  }
  return null;
}

/** An EBML variable-length integer at `at`: an element ID keeps its length marker, a size drops it. */
function readVint(bytes: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number } | null {
  if (at >= bytes.length || bytes[at] === 0) return null;
  let length = 1;
  while ((bytes[at] & (0x80 >> (length - 1))) === 0) length++;
  if (at + length > bytes.length) return null;
  let value = keepMarker ? bytes[at] : bytes[at] & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i];
  return { value, length };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function checkSlug(what: string, slug: string): void {
  // Mirrors the Rust check: one safe path segment, whatever its characters.
  const unsafe = slug === "" || slug.startsWith(".") || /[/\\:]/.test(slug) || /[\u0000-\u001f\u007f]/.test(slug);
  if (unsafe) throw new Error(`The ${what} name "${slug}" cannot be used in a file path.`);
}

/** `name` in folder `dir`, where "" or "." is the root, as the Rust side joins them. */
function pathIn(dir: string, name: string): string {
  return dir === "" || dir === "." ? name : `${dir}/${name}`;
}

/** 8 hex chars of FNV-1a over a text's char codes or a file's bytes. Stands in for the Rust side's SHA-256 prefix. */
function hash8(input: string | Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= typeof input === "string" ? input.charCodeAt(i) : input[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
