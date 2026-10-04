// A box's images (KTD6, KTD7 of docs/plans/2026-10-04-0033-feat-paste-images-into-rich-boxes-plan.md).
// An image lives beside the file its box saves to, and the box's Markdown names it bare.
//
// Reads go through src/ui/imageSource.ts, and so do the box's videos: a bare video name gets
// a counted URL from the storage port's data root, never from the network (KTD2, KTD4 of the
// video plan). A paste is written the moment it lands (KTD6), so the editor can show it
// through the same read; `busy` counts writes in flight, so a deck can hold its forward
// action until they land (R11). When the folder changes under a mounted box (a reply whose
// agent or badge changed), the images it saved this visit that its text still names are
// copied into the new folder (R10). Content addressing keeps their names.
//
// An add (U7 of the video plan) asks Rust to copy picked, dropped or pasted files into the
// same folder, so no bytes pass through the page. It counts in `busy` like a paste (R7), and
// every file it refused goes on one notice that names them (R5). Its files join the same
// record a carry reads, and a carry moves a video with `copyVideo`, inside Rust (KTD7, R13).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IMAGE_TOO_LARGE, ONLY_PNG_OR_JPEG, PASTED_IMAGE_MAX_BYTES, dataUriToBytes, folderOf, isLocalImageName, localRefNames } from "../domain/images";
import { isLocalVideoName } from "../domain/videos";
import type { AddedFile } from "../storage/storage";
import { forgetImage, imageSource } from "./imageSource";
import type { RichImageSource } from "./richImage";
import type { RichImages } from "./RichText";
import { fileName } from "./shared";
import { describeError, useFolder } from "./useFolderState";

/** With no folder yet: no images, and no videos (they show as placeholders). */
const NOTHING: RichImageSource = { load: () => Promise.resolve(null) };

/** A refusal with no reason, which Rust never sends, still reads as a sentence. */
const NOT_ADDED = "It could not be added.";

/** Whether a ref is one a carry may move: a bare-name picture or video. */
const isLocalFileName = (src: string) => isLocalImageName(src) || isLocalVideoName(src);

/** "a", "a and b", "a, b and c". */
function listNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One notice for every file one add refused (R5): each reason once, after the names of the
 * files it refused, in the order the files came. "clip.mkv and notes.txt: Only MP4, …".
 */
export function refusalNotice(refused: Pick<AddedFile, "name" | "error">[]): string {
  const byReason = new Map<string, string[]>();
  for (const { name, error } of refused) {
    const reason = error ?? NOT_ADDED;
    byReason.set(reason, [...(byReason.get(reason) ?? []), name]);
  }
  return [...byReason].map(([reason, names]) => `${listNames(names)}: ${reason}`).join(" ");
}

/**
 * The images of a box whose file is in `dir` (null: no folder yet, so nothing saves), and
 * whether a write is in flight. `text` is the box's Markdown, which decides what a change of
 * folder carries along.
 */
export function useRichImages(dir: string | null, text = ""): { images: RichImages; busy: boolean } {
  const { storage, setNotice } = useFolder();
  const [inFlight, setInFlight] = useState(0);
  // What this box saved this visit: bare name to root-relative path.
  const saved = useRef(new Map<string, string>());
  const latestText = useRef(text);
  latestText.current = text;

  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setInFlight((n) => n + 1);
    try {
      return await work();
    } finally {
      setInFlight((n) => n - 1);
    }
  }, []);

  const images = useMemo<RichImages>(() => {
    const { load, video } = dir === null ? NOTHING : imageSource(storage, dir);
    return {
      load,
      video,
      async save(file) {
        const refuse = (message: string): never => {
          setNotice(message);
          throw new Error(message);
        };
        if (dir === null) refuse("This box has no folder yet.");
        if (file.type !== "image/png" && file.type !== "image/jpeg") refuse(ONLY_PNG_OR_JPEG);
        if (file.size > PASTED_IMAGE_MAX_BYTES) refuse(IMAGE_TOO_LARGE);
        return track(async () => {
          try {
            const path = await storage.saveImage("data", dir!, new Uint8Array(await file.arrayBuffer()));
            // A file read as missing before this paste is there now.
            forgetImage(storage, path);
            const name = fileName(path);
            saved.current.set(name, path);
            return name;
          } catch (e) {
            setNotice(describeError(e));
            throw e;
          }
        });
      },
      // With no folder there is nowhere to copy to, so the box shows no Video key.
      ...(dir !== null && {
        add(from) {
          return track(async () => {
            let files: AddedFile[];
            try {
              files = await storage.addFiles(dir, from);
            } catch (e) {
              setNotice(describeError(e));
              throw e;
            }
            const names: string[] = [];
            for (const { path } of files) {
              if (path === null) continue;
              // A picture read as missing before this add is there now.
              forgetImage(storage, path);
              const name = fileName(path);
              saved.current.set(name, path);
              names.push(name);
            }
            const refused = files.filter((f) => f.path === null);
            if (refused.length > 0) setNotice(refusalNotice(refused));
            return names;
          });
        },
      }),
    };
  }, [storage, dir, setNotice, track]);

  // A new folder takes the images and videos this box saved that its text still names (R10,
  // R13). A video is copied inside Rust; a picture is read and written again.
  const carriedTo = useRef(dir);
  useEffect(() => {
    if (dir === null || carriedTo.current === dir) return;
    carriedTo.current = dir;
    const names = new Set(localRefNames(latestText.current, isLocalFileName));
    const moving = [...saved.current].filter(([name, path]) => names.has(name) && folderOf(path) !== dir);
    if (moving.length === 0) return;
    void track(async () => {
      for (const [name, from] of moving) {
        try {
          if (isLocalVideoName(name)) {
            saved.current.set(name, await storage.copyVideo(from, "data", dir));
            continue;
          }
          const uri = await storage.readDataUri("data", from);
          if (uri === null) continue;
          const path = await storage.saveImage("data", dir, dataUriToBytes(uri));
          forgetImage(storage, path);
          saved.current.set(name, path);
        } catch (e) {
          setNotice(describeError(e));
        }
      }
    });
  }, [dir, storage, setNotice, track]);

  return { images, busy: inFlight > 0 };
}
