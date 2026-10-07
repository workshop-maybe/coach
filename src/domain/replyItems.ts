// Reply items (see docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md, KTD1, KTD2): a reply
// is an ordered list of text, image, video, file and link items. These helpers are shared by the
// folder format, the operations that save a reply and the views that show one, so every layer
// agrees on what a reply holds, when it has anything in it (R4), and how its text is stored.

import { isBareName, isLocalImageName } from "./images";
import type { ReplyItem, TextItem } from "./types";
import { isLocalVideoName } from "./videos";

/** A record that carries a reply: its joined text, and its items when it is not exactly one text item. */
export interface ReplyRecord {
  handBack: string;
  items?: ReplyItem[];
}

/** A reply's items. A record with none is one text item holding its hand-back, as every reply saved before items was (R12). */
export function replyItems(r: ReplyRecord): ReplyItem[] {
  return r.items ?? [{ kind: "text", text: r.handBack }];
}

function isText(item: ReplyItem): item is TextItem {
  return item.kind === "text";
}

/** Whether the reply is exactly one text item, the shape that writes no `items` key. */
export function isOneText(items: readonly ReplyItem[]): items is readonly [TextItem] {
  return items.length === 1 && isText(items[0]);
}

/** The reply's text items, joined by a blank line. The hand-back a record keeps beside its items. */
export function textOf(items: readonly ReplyItem[]): string {
  return items
    .filter(isText)
    .map((t) => t.text)
    .join("\n\n");
}

/** Whether a reply can be recorded or held (R4): any item that is not text, or text with something in it. */
export function hasContent(items: readonly ReplyItem[]): boolean {
  return items.some((item) => !isText(item) || item.text.trim() !== "");
}

/**
 * A reply as it is saved (KTD7 Saving): whitespace-only text items dropped, the rest kept verbatim
 * and in order. Exactly one text item is a bare hand-back with no items, so it saves byte for
 * byte as a reply did before items. Null when nothing is left (R4).
 */
export function normalizeReply(items: readonly ReplyItem[]): ReplyRecord | null {
  const kept = items.filter((item) => !isText(item) || item.text.trim() !== "");
  if (kept.length === 0) return null;
  if (isOneText(kept)) return { handBack: kept[0].text };
  return { handBack: textOf(kept), items: [...kept] };
}

// ---------------------------------------------------------------------------
// Text slots: a reply's text items fill the `## Handback` body in order, separated by a break
// line holding a token that occurs in no text item (KTD1).

const BREAK_LINE = /^<!-- item ([0-9a-f]+) -->$/;

/** Whether `line` is a break line of the shape `chooseBreak` writes, so a hand-edited one can't inject a pattern. */
export function isBreakLine(line: string): boolean {
  return BREAK_LINE.test(line);
}

/** Twelve random lowercase hex digits. */
function randomHex(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A break line whose token occurs in none of `texts`, drawing again until one does not. */
export function chooseBreak(texts: readonly string[], random: () => string = randomHex): string {
  for (;;) {
    const token = random();
    if (/^[0-9a-f]+$/.test(token) && !texts.some((t) => t.includes(token))) return `<!-- item ${token} -->`;
  }
}

/** The body the text slots fill: each slot, with the break line on its own line between two. */
export function joinSlots(texts: readonly string[], breakLine: string): string {
  return texts.join(`\n${breakLine}\n`);
}

/**
 * The text slots in a body, split at each whole line that is `breakLine`. Lines end only at "\n"
 * (folder.ts KTD14), and a "\r" before it stays on the line, so a CRLF file's break line, with
 * the "\r\n" before it, reads too.
 */
export function splitSlots(body: string, breakLine: string): string[] {
  const slots: string[] = [];
  let from = 0;
  for (let start = 0; ; ) {
    const newline = body.indexOf("\n", start);
    const end = newline === -1 ? body.length : newline;
    const line = body.slice(start, end);
    const crlf = line === `${breakLine}\r`;
    if (line === breakLine || crlf) {
      let slot = body.slice(from, start);
      if (slot.endsWith("\n")) slot = slot.slice(0, -1);
      if (crlf && slot.endsWith("\r")) slot = slot.slice(0, -1);
      slots.push(slot);
      from = newline === -1 ? body.length : newline + 1;
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  slots.push(body.slice(from));
  return slots;
}

/**
 * Whether `ref` is where an item of `kind` may live (KTD2): an image or video by bare name beside
 * the result, as pasted ones are, and any other file by bare `file-` name in its `files/` folder.
 * Only such a ref is ever read, so a hand edit can't point an item outside the result's folder.
 */
export function isItemRef(kind: "image" | "video" | "file", ref: string): boolean {
  if (kind === "image") return isLocalImageName(ref);
  if (kind === "video") return isLocalVideoName(ref);
  const name = ref.startsWith("files/") ? ref.slice("files/".length) : "";
  return name.startsWith("file-") && isBareName(name);
}

// ---------------------------------------------------------------------------
// Names, previews and keys

/** An added file's display name: the last segment of its original path, on any platform (R14). */
export function displayNameOf(path: string): string {
  const parts = path.split(/[/\\]/).filter((p) => p !== "");
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** What an item is called: a file's display name, a link's URL, and nothing for text. */
export function itemName(item: ReplyItem): string {
  switch (item.kind) {
    case "text":
      return "";
    case "link":
      return item.url;
    default:
      return item.name;
  }
}

/** A line to preview a reply by: its first text item with something in it, then its first other item's name. */
export function previewText(items: readonly ReplyItem[]): string {
  const text = items.find((item) => isText(item) && item.text.trim() !== "");
  if (text) return (text as TextItem).text;
  const other = items.find((item) => !isText(item));
  return other ? itemName(other) : "";
}

/**
 * A stable identity for what a reply holds. A one-text reply is keyed by its text, as replies
 * were before items; any other by every item's fields in order.
 */
export function replyKey(items: readonly ReplyItem[]): string {
  if (isOneText(items)) return items[0].text;
  return JSON.stringify(
    items.map((item) => {
      switch (item.kind) {
        case "text":
          return ["text", item.text];
        case "link":
          return ["link", item.url];
        default:
          return [item.kind, item.name, item.ref];
      }
    }),
  );
}
