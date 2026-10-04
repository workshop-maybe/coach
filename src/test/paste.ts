// Fires a paste the way a person's paste arrives: a paste event whose clipboard data holds
// the flavors given, keyed by MIME type ("text/plain", "text/html", ...). ProseMirror's own
// `view.pasteText` passes no clipboard data, so it never reaches a `handlePaste` that reads
// the clipboard, and jsdom has no DataTransfer. Works on a rich box and on a textarea alike.

import { fireEvent } from "@testing-library/react";

/** Pastes into `target`. Returns false when a handler took the paste (prevented its default). */
export function firePaste(target: Element, flavors: Record<string, string>): boolean {
  const clipboardData = {
    types: Object.keys(flavors),
    getData: (type: string) => flavors[type] ?? "",
  };
  return fireEvent.paste(target, { clipboardData });
}
