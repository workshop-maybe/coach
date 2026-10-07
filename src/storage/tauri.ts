// Storage over the confined Rust file commands (KTD1, KTD2).

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { ContextReading } from "../domain/types";
import { currentPlatform, type Platform } from "../domain/videos";
import type { AddAccept, AddFrom, AddedFile, RootKind, Storage, VideoUrl } from "./storage";

export class TauriStorage implements Storage {
  /** The platform is read once, when the app builds its storage. */
  constructor(private readonly platform: Platform = currentPlatform()) {}

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

  addFiles(dir: string, from: AddFrom, accept: AddAccept = "media"): Promise<AddedFile[]> {
    // Every shape names what it accepts, and a pick names its key (reply artifacts KTD3).
    const wire = from.kind === "pick" ? { kind: "pick", item: from.item ?? "video", accept } : { ...from, accept };
    return invoke<AddedFile[]>("add_files", { dir, from: wire });
  }

  copyVideo(from: string, toRoot: RootKind, toDir: string): Promise<string> {
    return invoke<string>("copy_video", { from, toRoot, toDir });
  }

  copyItem(from: string, toRoot: RootKind, toDir: string): Promise<string> {
    return invoke<string>("copy_item", { from, toRoot, toDir });
  }

  readItemText(path: string): Promise<string | null> {
    return invoke<string | null>("read_item_text", { path });
  }

  openItem(path: string): Promise<void> {
    return invoke<void>("open_item", { path });
  }

  videoUrl(path: string): Promise<VideoUrl | null> {
    return this.mediaUrl(path);
  }

  /** The scheme serves a PDF item as it serves a video, so a PDF's URL is made the same way. */
  fileUrl(path: string): Promise<VideoUrl | null> {
    return this.mediaUrl(path);
  }

  private async mediaUrl(path: string): Promise<VideoUrl | null> {
    const url = convertFileSrc(path, "media");
    // WebKitGTK will not hand a custom-scheme URL to GStreamer, so Linux plays a blob (KTD4).
    // With no URL to fall back on, any failure there shows the placeholder.
    if (this.platform === "linux") {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const objectUrl = URL.createObjectURL(await response.blob());
        return { url: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
      } catch {
        return null;
      }
    }
    // Only a 404 means missing, so a reply's video with preload="none" shows the placeholder
    // at once. Anything else plays or fails in the <video>, so a fetch problem never blanks
    // every video.
    try {
      if ((await fetch(url, { method: "HEAD" })).status === 404) return null;
    } catch {
      // Fail open.
    }
    return { url, release: () => {} };
  }

  readContext(repo: string, harness: string): Promise<ContextReading> {
    return invoke<ContextReading>("read_context", { repo, harness });
  }
}
