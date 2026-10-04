// A box's images (KTD6, KTD7 of docs/plans/2026-10-04-0033-feat-paste-images-into-rich-boxes-plan.md).
// An image lives beside the file its box saves to, and the box's Markdown names it bare.
//
// Reads go through src/ui/imageSource.ts. A paste is written the moment it lands (KTD6), so
// the editor can show it through the same read; `busy` counts writes in flight, so a deck
// can hold its forward action until they land (R11). When the folder changes under a mounted
// box (a reply whose agent or badge changed), the images it saved this visit that its text
// still names are copied into the new folder (R10). Content addressing keeps their names.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IMAGE_TOO_LARGE, ONLY_PNG_OR_JPEG, PASTED_IMAGE_MAX_BYTES, dataUriToBytes, folderOf, localImageNames } from "../domain/images";
import { forgetImage, imageSource } from "./imageSource";
import type { RichImages } from "./RichText";
import { fileName } from "./shared";
import { describeError, useFolder } from "./useFolderState";

const NOTHING = { load: () => Promise.resolve(null) };

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
    const { load } = dir === null ? NOTHING : imageSource(storage, dir);
    return {
      load,
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
    };
  }, [storage, dir, setNotice, track]);

  // A new folder takes the images this box saved that its text still names (R10).
  const carriedTo = useRef(dir);
  useEffect(() => {
    if (dir === null || carriedTo.current === dir) return;
    carriedTo.current = dir;
    const names = new Set(localImageNames(latestText.current));
    const moving = [...saved.current].filter(([name, path]) => names.has(name) && folderOf(path) !== dir);
    if (moving.length === 0) return;
    void track(async () => {
      for (const [name, from] of moving) {
        try {
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
