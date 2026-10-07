// A reply's item files (see docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md, KTD2 to
// KTD4). A file item that is not a picture or a video is copied by Rust into a `files/`
// subfolder of its result's folder as `file-<8 hex>[.<ext>]`, read back capped, and opened
// only through Rust. The page holds names and data-root paths, never bytes or absolute paths.

/** The subfolder of a result's folder that holds its file items (KTD2). */
export const FILES_DIR = "files";

/** The largest file item, in bytes (KTD3). Rust holds the same cap, the same as a video's. */
export const FILE_MAX_BYTES = 100 * 1024 * 1024;

/** The largest item file `readItemText` reads, in bytes (KTD4). Rust holds the same cap. */
export const ITEM_TEXT_MAX_BYTES = 1024 * 1024;

// Refusals from `add_files`, `read_item_text`, `open_item` and `copy_item`, word for word as
// Rust sends them. A Rust test checks each one appears here.

export const FILE_TOO_LARGE = "That file is larger than 100 MB.";
export const ITEM_TEXT_TOO_LARGE = "That file is larger than 1 MB, so it can't be shown here.";
export const NOT_TEXT = "That file is not UTF-8 text.";
/** An absolute path, any `..`, or a path that leads out of the data folder. */
export const NOT_IN_FOLDER = "That file is not in the data folder.";
export const ITEM_MISSING = "That file is no longer in the data folder.";
export const NOT_AN_ITEM = "Only a reply's videos and files can be copied.";
export const CANNOT_OPEN = "That file can't be opened.";

const FILE_ITEM_NAME = /^file-[0-9a-f]{8}(\.[a-z0-9]{1,16})?$/;

/** Whether a name is a stored file item's: `file-`, 8 lowercase hex, and an optional short lowercase extension. */
export function isFileItemName(name: string): boolean {
  return FILE_ITEM_NAME.test(name);
}

/**
 * The extension a file item is stored under: the original name's, lowercased, when it is 1 to
 * 16 ASCII letters and digits, else none. A name that starts with its only dot has none.
 */
export function itemExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1);
  return /^[A-Za-z0-9]{1,16}$/.test(ext) ? ext.toLowerCase() : null;
}

/** Whether a data-root path is a file item: a file item name directly inside a `files/` folder. */
export function isFileItemPath(path: string): boolean {
  const parts = path.split("/");
  return parts.length >= 2 && parts[parts.length - 2] === FILES_DIR && isFileItemName(parts[parts.length - 1]);
}
