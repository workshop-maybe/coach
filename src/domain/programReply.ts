// The program in a reply (KTD5 of docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md,
// R5, R17, R18): a reply to a program badge is saved as it was pasted, and the program is found
// again in its text each time it opens, never stored. A program is data. This module only ever
// hands reply text to `JSON.parse`, and returns what it parsed for Quinelings' bounded
// interpreter to read; nothing here evaluates it.
//
// The order follows KTD5. Fenced code blocks are read as written first, since that is where an
// agent puts a program. When none holds one, the whole text is read as its reader sees it
// (`readerText` undoes the reply box's Markdown escapes) and scanned for balanced JSON objects,
// outermost first. Candidates are any object whose own `format` is `qdl-intent`, at any depth,
// and two that differ only in key order are the same program. When there is none, a fenced
// block or a brace that names `"qdl-intent"` and does not parse makes the reply unreadable,
// with the parser's message.
//
// The scan is bounded: text over PROGRAM_TEXT_CAP is not read, the brace matcher is one pass
// with no regex, and the parse attempts on spans that fail share a budget, so a long hostile
// line stays linear (docs/solutions/performance-issues/
// secret-filter-regexes-rescan-long-lines-quadratically.md). Lines split on `\n` only, so a
// U+2028 inside a string literal stays in its string (docs/solutions/runtime-errors/
// unicode-line-separators-end-multiline-regex-lines.md).

import { scanLines } from "./markdownLines";
import { readerText } from "./readerText";
import { textOf } from "./replyItems";
import type { ReplyItem } from "./types";

/** A parsed program: a JSON object whose own `format` is `qdl-intent`. */
export type QdlIntent = Record<string, unknown> & { format: "qdl-intent" };

/** What a reply holds: one program, none, more than one, or a program that does not parse. */
export type ProgramFind =
  | { kind: "program"; intent: QdlIntent }
  | { kind: "none" }
  | { kind: "several"; count: number }
  | { kind: "unreadable"; message: string };

/** The longest reply text read for a program, in UTF-16 code units. A program is a few kilobytes. */
export const PROGRAM_TEXT_CAP = 2_000_000;

const FORMAT = "qdl-intent";
const TOKEN = `"${FORMAT}"`;
/** Characters of failed parse attempts the unfenced scan may spend, past which it stops trying. */
const FAILED_PARSE_BUDGET = 4 * PROGRAM_TEXT_CAP;

/** The program in a take's reply: its text items joined, as `textOf` stores them. */
export function findProgramInItems(items: readonly ReplyItem[]): ProgramFind {
  return findProgram(textOf(items));
}

/** The program in a reply's text (KTD5). Only `JSON.parse` reads the text. */
export function findProgram(text: string): ProgramFind {
  if (text.length > PROGRAM_TEXT_CAP) {
    return text.includes(TOKEN) ? { kind: "unreadable", message: "The reply is too long to read a program from." } : { kind: "none" };
  }
  const failures: string[] = [];

  const fenced = fromFences(text, failures);
  if (fenced.length > 0) return settle(fenced);

  const reader = readerText(text);
  const unclosed: string[] = [];
  let found = fromSpans(reader, failures, unclosed);
  // A reply saved without the box's escapes reads wrongly through readerText (`\"` loses its
  // backslash), so the text as stored gets the same scan when the reader's view holds nothing.
  if (found.length === 0 && reader !== text) found = fromSpans(text, failures, unclosed);
  if (found.length > 0) return settle(found);

  const message = failures[0] ?? unclosed[0];
  return message === undefined ? { kind: "none" } : { kind: "unreadable", message };
}

// ---------------------------------------------------------------------------

/** One program, or how many distinct ones, by canonical form. */
function settle(candidates: QdlIntent[]): ProgramFind {
  const distinct = new Map<string, QdlIntent>();
  for (const c of candidates) {
    const key = canonical(c);
    if (!distinct.has(key)) distinct.set(key, c);
  }
  if (distinct.size === 1) return { kind: "program", intent: distinct.values().next().value as QdlIntent };
  return { kind: "several", count: distinct.size };
}

/** The intents in fenced code blocks, read as written. A block that names the format and fails to parse adds its message. */
function fromFences(text: string, failures: string[]): QdlIntent[] {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of scanLines(text)) {
    if (line.inFence) (current ??= []).push(line.text);
    else if (line.fence) {
      // An opening fence starts a block and a closing one ends it; an empty block has no lines to keep.
      if (current) blocks.push(current.join("\n"));
      current = current ? null : [];
    }
  }
  if (current) blocks.push(current.join("\n"));

  const found: QdlIntent[] = [];
  for (const block of blocks) {
    const parsed = tryParse(block);
    if (parsed.ok) found.push(...intentsIn(parsed.value));
    else if (block.includes(TOKEN)) failures.push(parsed.message);
  }
  return found;
}

/**
 * The intents in balanced `{...}` spans of the text, outermost first. Only spans that contain
 * the quoted format are parsed, and a span inside one that parsed is not read again. A span
 * that fails adds its message and its inner spans get their turn, within the failure budget.
 * The quoted format after a brace that never closes adds the parser's message for the text
 * from that brace on to `unclosed`.
 */
function fromSpans(text: string, failures: string[], unclosed: string[]): QdlIntent[] {
  const tokens = tokenPositions(text);
  if (tokens.length === 0) return [];
  const { spans: all, firstUnclosed } = balancedSpans(text);
  if (firstUnclosed >= 0 && tokens[tokens.length - 1] > firstUnclosed) {
    const parsed = tryParse(text.slice(firstUnclosed));
    if (!parsed.ok) unclosed.push(parsed.message);
  }
  const spans = all.filter(([start, end]) => containsToken(tokens, start, end));
  spans.sort((a, b) => a[0] - b[0]);

  const found: QdlIntent[] = [];
  let takenUntil = -1;
  let budget = FAILED_PARSE_BUDGET;
  for (const [start, end] of spans) {
    if (start < takenUntil) continue;
    const length = end - start + 1;
    if (length > budget) break;
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed.ok) {
      const intents = intentsIn(parsed.value);
      if (intents.length > 0) {
        found.push(...intents);
        takenUntil = end + 1;
      }
    } else {
      budget -= length;
      failures.push(parsed.message);
    }
  }
  return found;
}

/**
 * Every balanced `{...}` span as [start, end] indices, in one pass. Quotes only count inside a
 * brace, so prose apostrophes and quotes outside JSON cannot shift it, and a string ends at a
 * line feed, which JSON strings cannot hold, so an unclosed quote in prose loses one line at
 * most. A `}` with no open brace is prose; a `{` never closed opens no span, and the first
 * such brace is returned as `firstUnclosed` (-1 when every brace closes).
 */
function balancedSpans(text: string): { spans: Array<[number, number]>; firstUnclosed: number } {
  const spans: Array<[number, number]> = [];
  const open: number[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 0x5c /* \ */) i++;
      else if (ch === 0x22 /* " */ || ch === 0x0a /* \n */) inString = false;
    } else if (ch === 0x7b /* { */) open.push(i);
    else if (ch === 0x7d /* } */) {
      const start = open.pop();
      if (start !== undefined) spans.push([start, i]);
    } else if (ch === 0x22 && open.length > 0) inString = true;
  }
  return { spans, firstUnclosed: open.length > 0 ? open[0] : -1 };
}

/** Where the quoted format starts in the text, in order. */
function tokenPositions(text: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(TOKEN); i >= 0; i = text.indexOf(TOKEN, i + TOKEN.length)) out.push(i);
  return out;
}

/** Whether a quoted format lies wholly within [start, end], by binary search over its positions. */
function containsToken(tokens: readonly number[], start: number, end: number): boolean {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid] < start) lo = mid + 1;
    else hi = mid;
  }
  return lo < tokens.length && tokens[lo] + TOKEN.length - 1 <= end;
}

/** The intents in a parsed value, outermost first: an intent is taken whole, and its own contents are not searched. */
function intentsIn(root: unknown): QdlIntent[] {
  const out: QdlIntent[] = [];
  const queue: unknown[] = [root];
  for (let i = 0; i < queue.length; i++) {
    const value = queue[i];
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, "format") && record.format === FORMAT) out.push(record as QdlIntent);
    else for (const key of Object.keys(record)) queue.push(record[key]);
  }
  return out;
}

/** A JSON value written with object keys sorted, so key order does not make two programs differ. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
