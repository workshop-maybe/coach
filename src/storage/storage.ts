// The storage port the domain layer writes through (KTD2). Paths are relative to a root
// and always use forward slashes. The Tauri implementation calls the confined Rust
// commands (KTD1). The memory implementation backs the tests.

import type { ContextReading } from "../domain/types";

export type RootKind = "data" | "export";

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
