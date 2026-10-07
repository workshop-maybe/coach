// The reply as Jev reads it (U6 of docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md,
// KTD8, R13, R14, R15). A reply is a list of items, and Jev's request holds one `reply`
// string (`reply_1` and `reply_2` in a head-to-head), since the native contract denies any
// other field. That string is built here, from the items in order:
//
// - a text item as a reader sees it (`readerText`), its picture and video Markdown removed,
//   and a whitespace-only one skipped;
// - a Markdown or plain-text file under a `File: <name>` line, its text as written, with
//   lines that look like secrets dropped as an example's are;
// - every other item, and a file that can't be read, as one line naming its kind and its file
//   name or URL, so a point Jev can't judge from text reads as neither met nor missed (KTD9).
//
// File texts are read ahead (src/ui/useItemTexts.ts) and handed in by ref, so this stays
// synchronous. A text still loading projects as a file Jev cannot see, and callers wait
// (`pendingTexts`) before they ask. The budget measures the whole string (R15). Nothing here
// cuts a line: a secret is looked for along a long line in bounded windows, so the patterns
// stay linear, and any lone surrogate in what goes is replaced, since Tauri's IPC refuses one.
//
// Only file texts pass the secret filter. Text items go as the user pasted and read them, as
// the reply being judged always has: the filter would drop lines that are evidence, such as a
// full commit hash. An earlier reply quoted as an example is still filtered whole, by its
// excerpt (`excerptOf`).

import { keptLines, withoutImages } from "./jevExamples";
import { assessmentDir } from "./folder";
import { fileFormat } from "./files";
import { LINE_BREAK } from "./jevRequest";
import { scanLines } from "./markdownLines";
import { readerLine } from "./readerText";
import { isItemRef } from "./replyItems";
import type { ReplyItem, Slug } from "./types";

/** A file's text as read: the text, null when it can't be read (missing, over 1 MiB, not UTF-8), undefined while it loads. */
export type FileText = string | null | undefined;

/** File texts by data-root path, as src/ui/useItemTexts.ts reads them ahead. */
export type FileTexts = (path: string) => FileText;

/** A reply's file texts by ref, relative to the reply's folder. */
export type RefTexts = (ref: string) => FileText;

/** No file texts: every file reads as one Jev cannot see. */
export const NO_TEXTS: FileTexts = () => null;

/** Whether a file item's stored ref is a Markdown or plain-text file Jev reads (R13). Decided on the ref by `fileFormat`, as the stack decides. */
export function isTextFileRef(ref: string): boolean {
  if (!isItemRef("file", ref)) return false;
  const format = fileFormat(ref);
  return format === "markdown" || format === "plain";
}

/** The refs of a reply's text files, in order, each once. */
export function textFileRefs(items: readonly ReplyItem[]): string[] {
  const refs = items.flatMap((item) => (item.kind === "file" && isTextFileRef(item.ref) ? [item.ref] : []));
  return [...new Set(refs)];
}

/** The refs of a reply's text files still loading. Empty when Jev can be asked about it. */
export function pendingTexts(items: readonly ReplyItem[], texts: RefTexts): string[] {
  return textFileRefs(items).filter((ref) => texts(ref) === undefined);
}

/** A record's file texts by ref: its items live in its result folder, held or recorded (KTD2). */
export function textsIn(texts: FileTexts, record: { profileSlug: Slug; collectionSlug: Slug; credentialSlug: Slug }): RefTexts {
  const dir = assessmentDir(record.profileSlug, record.collectionSlug, record.credentialSlug);
  return (ref) => texts(`${dir}/${ref}`);
}

/** The reply string Jev reads (KTD8): each item's part, in order, separated by a blank line. */
export function jevReply(items: readonly ReplyItem[], texts: RefTexts): string {
  const parts: string[] = [];
  for (const item of items) {
    const part = partOf(item, texts);
    if (part !== "") parts.push(part);
  }
  return wellFormed(parts.join("\n\n"));
}

function partOf(item: ReplyItem, texts: RefTexts): string {
  switch (item.kind) {
    case "text":
      return textPart(item.text);
    case "image":
      return `A picture Jev cannot see: ${oneLine(item.name)}`;
    case "video":
      return `A video Jev cannot see: ${oneLine(item.name)}`;
    case "link":
      return `A link Jev cannot open: ${oneLine(item.url)}`;
    case "file": {
      const text = isTextFileRef(item.ref) ? texts(item.ref) : null;
      if (typeof text !== "string") return `A file Jev cannot see: ${oneLine(item.name)}`;
      return filePart(item.name, text);
    }
  }
}

/** The last few `File:` parts built, by name and text, so a reply being typed doesn't clean unchanged files again. */
const fileParts = new Map<string, string>();
const MAX_FILE_PARTS = 8;

/** A readable file's part: a `File:` line naming it, then its kept lines (`keptLines`), if any. */
function filePart(name: string, text: string): string {
  // The name's length first, so no name and text pair can make another pair's key.
  const key = `${name.length}:${name}\u0000${text}`;
  const cached = fileParts.get(key);
  if (cached !== undefined) {
    fileParts.delete(key);
    fileParts.set(key, cached);
    return cached;
  }
  const body = keptLines(text).map(unforged).join("\n").trimEnd();
  const part = body === "" ? `File: ${oneLine(name)}` : `File: ${oneLine(name)}\n${body}`;
  fileParts.set(key, part);
  if (fileParts.size > MAX_FILE_PARTS) fileParts.delete(fileParts.keys().next().value as string);
  return part;
}

/**
 * A text item as a reader sees it, without its pictures and videos: outside fenced code, each
 * picture or video's Markdown and any image data URI go, a line left blank by that goes, and
 * a reference definition to image data goes. Then each line reads as `readerText` reads it.
 * Fenced code stays as written. Empty for an item with nothing else in it.
 */
function textPart(markdown: string): string {
  const lines: string[] = [];
  for (const line of scanLines(markdown)) {
    if (line.fence || line.inFence) {
      lines.push(unforged(line.text));
      continue;
    }
    const full = withoutImages(line.text);
    if (full === null) continue;
    lines.push(unforged(readerLine(full)));
  }
  const text = lines.join("\n");
  return text.trim() === "" ? "" : text;
}

// The lines only the app writes: a part naming an item Jev cannot see or open, and a file's heading.
const MARKER = /^\s*(?:A (?:picture|video|file) Jev cannot see:|A link Jev cannot open:|File:)/;

/**
 * A line from the agent's own text or file that reads like a line only the app writes is
 * marked as quoted, so a reply can't name an unseen item that isn't there and turn a missed
 * point into a can't-call (the criteria's unread clause).
 */
function unforged(line: string): string {
  return MARKER.test(line) ? `Quoted: ${line}` : line;
}

/** A name or URL on one line: any line break read as a space, so a name can never start a line of its own. */
function oneLine(s: string): string {
  return s.split(LINE_BREAK).join(" ");
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The text with every lone surrogate replaced by U+FFFD, the same length, so nothing past it moves. */
function wellFormed(s: string): string {
  return s.replace(LONE_SURROGATE, "�");
}
