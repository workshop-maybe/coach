// The storage port the domain layer writes through (KTD2). Paths are relative to a root
// and always use forward slashes. The Tauri implementation calls the confined Rust
// commands (KTD1). The memory implementation backs the tests.

import type { ContextReading } from "../domain/types";

export type RootKind = "data" | "export";

/** What an added file became, by its content (reply artifacts KTD3). */
export type AddedKind = "image" | "video" | "file";

/**
 * Which files `addFiles` takes (reply artifacts KTD3): pictures and videos, as every rich box
 * adds, or any file, as a reply's items do, where anything else becomes a file item.
 */
export type AddAccept = "media" | "any";

/**
 * Where `addFiles` takes its files from (video plan KTD5): Rust's own picker, filtered to the
 * key that asked (Video when none is named), the paths a drop on the window gave the page, or
 * the Finder files a paste named by base name and size.
 */
export type AddFrom =
  | { kind: "pick"; item?: AddedKind }
  | { kind: "drop"; paths: string[] }
  | { kind: "paste"; files: { name: string; size: number }[] };

/**
 * One file `addFiles` considered: its root-relative path and the kind its content gave it, or
 * a refusal to show. `name` is the original file name, an item's display name.
 */
export interface AddedFile {
  name: string;
  path: string | null;
  kind: AddedKind | null;
  error: string | null;
}

/** A URL a `<video>` can play or a PDF viewer can fetch. The caller owns it and calls `release` once it lets go. */
export interface VideoUrl {
  url: string;
  release(): void;
}

export interface Storage {
  /** Returns the file's text, or null when it does not exist. */
  readText(root: RootKind, path: string): Promise<string | null>;
  /** Writes atomically, creating parent directories. */
  writeText(root: RootKind, path: string, contents: string): Promise<void>;
  /** Lists every file under `dir` (recursively), as root-relative paths. Missing dir lists nothing. */
  listFiles(root: RootKind, dir: string): Promise<string[]>;
  /** Moves one file to another path in the same root, creating folders. Never overwrites. */
  moveFile(root: RootKind, from: string, to: string): Promise<void>;
  /** Returns a JPEG or PNG inside the root as a base64 data URI, or null when it does not exist. */
  readDataUri(root: RootKind, path: string): Promise<string | null>;
  /**
   * Opens an image picker and copies the chosen JPEG or PNG (3 MiB max) into the data folder
   * under a content-addressed name (KTD4). Returns the folder-relative path, or null on cancel.
   * With a credential slug the file is named for that credential's override.
   */
  importBadgeArt(collectionSlug: string, credentialSlug: string | null): Promise<string | null>;
  /**
   * Saves a pasted JPEG or PNG (10 MiB max) into `dir` under a content-addressed name and
   * returns its root-relative path. The same bytes already there are not written again; a
   * different file at that name is an error, never overwritten.
   */
  saveImage(root: RootKind, dir: string, bytes: Uint8Array): Promise<string>;
  /**
   * Copies videos, and PNG or JPEG pictures, into `dir` in the data root, sorted by content,
   * with no bytes crossing to the page (video plan KTD5, KTD6). With `accept` "any" every other
   * file is copied too, into `dir/files/` (reply artifacts KTD3); the default, "media", refuses
   * it as every rich box does. One result per file, in order; a refusal for one never stops the
   * rest. A cancelled pick gives an empty list.
   */
  addFiles(dir: string, from: AddFrom, accept?: AddAccept): Promise<AddedFile[]>;
  /**
   * Copies a video from the data root into `toDir` in either root under its content-addressed
   * name and returns the target path (KTD7). The same bytes already there are not written again.
   */
  copyVideo(from: string, toRoot: RootKind, toDir: string): Promise<string>;
  /**
   * Copies a reply's video or file item from the data root into `toDir` in either root, for the
   * carry, and returns the target path. A file item lands in `toDir/files/` (reply artifacts KTD2).
   */
  copyItem(from: string, toRoot: RootKind, toDir: string): Promise<string>;
  /** A playable URL for a video in the data root, or null when it is missing or refused (KTD4). */
  videoUrl(path: string): Promise<VideoUrl | null>;
  /** A URL to fetch a PDF item in the data root from, or null when it is missing or refused (reply artifacts KTD4). */
  fileUrl(path: string): Promise<VideoUrl | null>;
  /**
   * An item file in the data root as UTF-8 text, or null when it does not exist. Refuses a file
   * over 1 MiB, which shows its name and opens instead (reply artifacts KTD4).
   */
  readItemText(path: string): Promise<string | null>;
  /**
   * Opens an item file in the data root in its default app when Rust's allowlist names its
   * type, and otherwise shows it in its folder (reply artifacts KTD4).
   */
  openItem(path: string): Promise<void>;
  /**
   * This machine plus a fingerprint of the harness's memory for the agent's repo (R1). File
   * contents never cross; only the digest does. Reads outside the chosen folders.
   */
  readContext(repo: string, harness: string): Promise<ContextReading>;
}

/** Thrown when a save finds the file changed since it was opened (KTD6). */
export class ChangedOnDiskError extends Error {
  constructor(public readonly path: string) {
    super(`Changed on disk: ${path}`);
    this.name = "ChangedOnDiskError";
  }
}
