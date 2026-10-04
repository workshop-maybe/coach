// Reading the images beside a box's file (KTD7 of the paste-images plan). Reads go through a
// cache per storage and path, missing files included, which the folder provider clears on
// every reload as it does badge art: a mounted image keeps showing, and the next one to
// mount reads fresh.

import { assessmentDir } from "../domain/folder";
import type { Assessment } from "../domain/types";
import type { Storage } from "../storage/storage";
import type { RichImageSource } from "./richImage";

const cache = new WeakMap<Storage, Map<string, Promise<string | null>>>();
const sources = new WeakMap<Storage, Map<string, RichImageSource>>();

/** Drops every cached image, so the next read sees the folder as it is now. */
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

/** The images beside a recorded result's file. */
export function resultImages(storage: Storage, a: Pick<Assessment, "profileSlug" | "collectionSlug" | "credentialSlug">): RichImageSource {
  return imageSource(storage, assessmentDir(a.profileSlug, a.collectionSlug, a.credentialSlug));
}

/** The images beside a file in `dir`. One object per storage and folder, so it never changes identity. */
export function imageSource(storage: Storage, dir: string): RichImageSource {
  let byDir = sources.get(storage);
  if (!byDir) sources.set(storage, (byDir = new Map()));
  let source = byDir.get(dir);
  if (!source) {
    source = { load: (name) => readImage(storage, dir === "" ? name : `${dir}/${name}`) };
    byDir.set(dir, source);
  }
  return source;
}
