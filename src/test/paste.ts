// Fires a paste the way a person's paste arrives: a paste event whose clipboard data holds
// the flavors given, keyed by MIME type ("text/plain", "text/html", ...), and any files, as a
// copied screenshot or a Finder copy brings them: pictures, videos (`videoFile`) or both, each
// carried in `files` and in `items`. ProseMirror's own `view.pasteText` passes
// no clipboard data, so it never reaches a `handlePaste` that reads the clipboard, and jsdom
// has no DataTransfer. Works on a rich box and on a textarea alike.

import { fireEvent } from "@testing-library/react";

/** Pastes into `target`. Returns false when a handler took the paste (prevented its default). */
export function firePaste(target: Element, flavors: Record<string, string>, files: File[] = []): boolean {
  const clipboardData = {
    types: [...Object.keys(flavors), ...(files.length ? ["Files"] : [])],
    getData: (type: string) => flavors[type] ?? "",
    files,
    items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
  };
  return fireEvent.paste(target, { clipboardData });
}

/**
 * A small video `File`, as a Finder copy of a clip arrives: the start of a QuickTime file.
 * Pass `type` "" for a file the clipboard gives no type.
 */
export function videoFile(name = "clip.mov", type = "video/quicktime"): File {
  const bytes = new Uint8Array([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0, 0x71, 0x74, 0x20, 0x20]);
  return new File([bytes], name, { type });
}

/** A small PNG `File`, as a clipboard screenshot arrives. */
export function pngFile(name = "image.png", type = "image/png"): File {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  return new File([bytes], name, { type });
}
