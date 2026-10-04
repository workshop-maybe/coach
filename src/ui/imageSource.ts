// Reading the images and videos beside a box's file (KTD7 of the paste-images plan, KTD4 of
// the video plan). Image reads go through a cache per storage and path, missing files
// included, which the folder provider clears on every reload as it does badge art: a mounted
// image keeps showing, and the next one to mount reads fresh.
//
// Videos stay out of that cache, since clearing it must never pull a URL from under a playing
// video. Each path has at most one URL from storage, counted by the views holding it; the
// last view to let go releases it, so two references to one file make one URL, and no view
// revokes another's. A missing video is never remembered, so one added later shows. Like the
// image reads, a video URL comes only from the storage port's confined data root, never from
// the network (R9 of the video plan).

import { ASSESSMENTS_DIR, assessmentDir } from "../domain/folder";
import type { Assessment } from "../domain/types";
import type { Storage, VideoUrl } from "../storage/storage";
import type { RichImageSource, RichVideo } from "./richImage";

const cache = new WeakMap<Storage, Map<string, Promise<string | null>>>();
const sources = new WeakMap<Storage, Map<string, RichImageSource>>();

/** One path's video URL from storage, and how many handles to it are out. */
interface HeldVideo {
  url: Promise<VideoUrl | null>;
  holders: number;
}

const videos = new WeakMap<Storage, Map<string, HeldVideo>>();

/** Drops every cached image, so the next read sees the folder as it is now. Video URLs stay. */
export function clearImageCache(storage: Storage): void {
  cache.delete(storage);
}

/** Forgets one path, as when a paste has just written it. */
export function forgetImage(storage: Storage, path: string): void {
  cache.get(storage)?.delete(path);
}

/** An image in the data folder as a data URI, or null when it is missing or can't be read. */
function readImage(storage: Storage, path: string): Promise<string | null> {
  let byPath = cache.get(storage);
  if (!byPath) cache.set(storage, (byPath = new Map()));
  let uri = byPath.get(path);
  if (!uri) {
    uri = storage.readDataUri("data", path).catch(() => null);
    byPath.set(path, uri);
  }
  return uri;
}

/**
 * A handle on the URL for a video in the data folder, or null when it is missing or refused.
 * Each handle's release counts once, however often it is called.
 */
async function holdVideo(storage: Storage, path: string, preload: RichVideo["preload"]): Promise<RichVideo | null> {
  const byPath = videos.get(storage) ?? new Map<string, HeldVideo>();
  videos.set(storage, byPath);
  const entry = byPath.get(path) ?? { url: storage.videoUrl(path).catch(() => null), holders: 0 };
  byPath.set(path, entry);
  entry.holders++;
  // The last release waits a microtask: ProseMirror destroys a node view and builds its
  // replacement in one go, and the new view keeps the URL instead of fetching it again.
  const letGo = (url: VideoUrl | null) => {
    entry.holders--;
    if (entry.holders > 0) return;
    queueMicrotask(() => {
      if (entry.holders > 0 || byPath.get(path) !== entry) return;
      byPath.delete(path);
      url?.release();
    });
  };
  const url = await entry.url;
  if (url === null) {
    letGo(null);
    return null;
  }
  let released = false;
  return {
    url: url.url,
    preload,
    release: () => {
      if (released) return;
      released = true;
      letGo(url);
    },
  };
}

/** The images beside a recorded result's file. */
export function resultImages(storage: Storage, a: Pick<Assessment, "profileSlug" | "collectionSlug" | "credentialSlug">): RichImageSource {
  return imageSource(storage, assessmentDir(a.profileSlug, a.collectionSlug, a.credentialSlug));
}

/**
 * The images and videos beside a file in `dir`. One object per storage and folder, so it
 * never changes identity. A video in a reply's folder gets preload "none", so nothing decodes
 * a file an agent named until the person presses play; anywhere else it loads its first frame.
 */
export function imageSource(storage: Storage, dir: string): RichImageSource {
  let byDir = sources.get(storage);
  if (!byDir) sources.set(storage, (byDir = new Map()));
  let source = byDir.get(dir);
  if (!source) {
    const pathOf = (name: string) => (dir === "" ? name : `${dir}/${name}`);
    const preload = dir === ASSESSMENTS_DIR || dir.startsWith(`${ASSESSMENTS_DIR}/`) ? "none" : "metadata";
    source = {
      load: (name) => readImage(storage, pathOf(name)),
      video: (name) => holdVideo(storage, pathOf(name), preload),
    };
    byDir.set(dir, source);
  }
  return source;
}
