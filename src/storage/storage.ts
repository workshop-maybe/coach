// The storage port the domain layer writes through (KTD2). Paths are relative to a root
// and always use forward slashes. The Tauri implementation calls the confined Rust
// commands (KTD1). The memory implementation backs the tests.

export type RootKind = "data" | "export";

export interface Storage {
  /** Returns the file's text, or null when it does not exist. */
  readText(root: RootKind, path: string): Promise<string | null>;
  /** Writes atomically, creating parent directories. */
  writeText(root: RootKind, path: string, contents: string): Promise<void>;
  /** Lists every file under `dir` (recursively), as root-relative paths. Missing dir lists nothing. */
  listFiles(root: RootKind, dir: string): Promise<string[]>;
  /** Returns a JPEG or PNG inside the root as a base64 data URI, or null when it does not exist. */
  readDataUri(root: RootKind, path: string): Promise<string | null>;
  /**
   * Opens an image picker and copies the chosen JPEG or PNG (1 MiB max) into the data folder
   * under a content-addressed name (KTD4). Returns the folder-relative path, or null on cancel.
   * With a credential slug the file is named for that credential's override.
   */
  importBadgeArt(collectionSlug: string, credentialSlug: string | null): Promise<string | null>;
}

/** Thrown when a save finds the file changed since it was opened (KTD6). */
export class ChangedOnDiskError extends Error {
  constructor(public readonly path: string) {
    super(`Changed on disk: ${path}`);
    this.name = "ChangedOnDiskError";
  }
}
