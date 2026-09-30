// In-memory Storage for tests. One Map of path -> text per root, plus a separate
// Map of path -> data URI per root for images.

import type { ContextReading } from "../domain/types";
import type { RootKind, Storage } from "./storage";

/** What `readContext` returns when nothing is queued. */
export const TEST_CONTEXT: ContextReading = { machineId: "test-machine", machine: "Test Mac", memory: "000000000000" };

export class MemoryStorage implements Storage {
  private readonly roots: Record<RootKind, Map<string, string>> = {
    data: new Map(),
    export: new Map(),
  };

  private readonly images: Record<RootKind, Map<string, string>> = {
    data: new Map(),
    export: new Map(),
  };

  /** Picks that `importBadgeArt` will return, in order. null models a cancelled picker. */
  private readonly artQueue: (string | null)[] = [];

  /** Readings that `readContext` will return, in order. An Error models a failed read. */
  private readonly contextQueue: (ContextReading | Error)[] = [];

  /** Every write, in order, for asserting what the domain layer touched. */
  readonly writes: { root: RootKind; path: string }[] = [];

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
    const paths = new Set([...this.roots[root].keys(), ...this.images[root].keys()]);
    return [...paths].filter((p) => p.startsWith(prefix)).sort();
  }

  /** Mirrors the Rust command: a missing source or an existing target is an error. */
  async moveFile(root: RootKind, from: string, to: string): Promise<void> {
    const texts = this.roots[root];
    const images = this.images[root];
    const map = texts.has(from) ? texts : images.has(from) ? images : null;
    if (map === null) throw new Error(`Cannot move "${from}": it does not exist.`);
    if (texts.has(to) || images.has(to)) throw new Error(`Cannot move to "${to}": something is already there.`);
    map.set(to, map.get(from)!);
    map.delete(from);
    this.writes.push({ root, path: to });
  }

  async readDataUri(root: RootKind, path: string): Promise<string | null> {
    const uri = this.images[root].get(path);
    if (uri !== undefined) return uri;
    if (this.roots[root].has(path)) throw new Error(`"${path}": That file is not a JPEG or PNG image.`);
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
  }
}

function checkSlug(what: string, slug: string): void {
  // Mirrors the Rust check: one safe path segment, whatever its characters.
  const unsafe = slug === "" || slug.startsWith(".") || /[/\\:]/.test(slug) || /[\u0000-\u001f\u007f]/.test(slug);
  if (unsafe) throw new Error(`The ${what} name "${slug}" cannot be used in a file path.`);
}

/** 8 hex chars of FNV-1a. Stands in for the Rust side's SHA-256 prefix. */
function hash8(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
