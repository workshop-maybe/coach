// Storage over the confined Rust file commands (KTD1, KTD2).

import { invoke } from "@tauri-apps/api/core";
import type { ContextReading } from "../domain/types";
import type { RootKind, Storage } from "./storage";

export class TauriStorage implements Storage {
  readText(root: RootKind, path: string): Promise<string | null> {
    return invoke<string | null>("read_text", { root, path });
  }

  writeText(root: RootKind, path: string, contents: string): Promise<void> {
    return invoke<void>("write_text", { root, path, contents });
  }

  listFiles(root: RootKind, dir: string): Promise<string[]> {
    return invoke<string[]>("list_files", { root, dir });
  }

  moveFile(root: RootKind, from: string, to: string): Promise<void> {
    return invoke<void>("move_file", { root, from, to });
  }

  readDataUri(root: RootKind, path: string): Promise<string | null> {
    return invoke<string | null>("read_data_uri", { root, path });
  }

  importBadgeArt(collectionSlug: string, credentialSlug: string | null): Promise<string | null> {
    return invoke<string | null>("import_badge_art", { collectionSlug, credentialSlug });
  }

  saveImage(root: RootKind, dir: string, bytes: Uint8Array): Promise<string> {
    // The bytes go as the raw body; the folder is percent-encoded, since a header is ASCII.
    return invoke<string>("save_image", bytes, { headers: { "x-root": root, "x-dir": encodeURIComponent(dir) } });
  }

  readContext(repo: string, harness: string): Promise<ContextReading> {
    return invoke<ContextReading>("read_context", { repo, harness });
  }
}
