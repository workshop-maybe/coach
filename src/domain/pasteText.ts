// What a paste into the reply box goes through before it becomes structure (KTD14–KTD17).
// The fixes change only whitespace and terminal chrome, never a word: line endings and
// non-breaking spaces are normalized, trailing whitespace trimmed and blank runs collapsed,
// and a paste that looks terminal-copied also loses its harness markers and shared gutter.
// Fenced code is left alone, but for a terminal's gutter, which every line carries. The
// join candidates are the line breaks a terminal may have put in mid-sentence; Jev
// decides each one, so this only rules out breaks that can't be.

import { scanLines, type ScannedLine } from "./markdownLines";

/** The characters a coding harness puts at the start of a message or tool result. */
export const HARNESS_MARKERS = ["⏺", "⎿"] as const;

export interface FixedPaste {
  /** The paste after the meaning-safe fixes. */
  text: string;
  /** Whether the paste, as it came, looked terminal-copied (KTD16). */
  terminal: boolean;
}

/** A line break that may be a terminal's wrap: indices into `scanLines(text)`, `second` always `first + 1`. */
export interface JoinCandidate {
  first: number;
  second: number;
}

/** Applies the meaning-safe fixes to a pasted text (KTD15). */
export function fixPastedText(text: string): FixedPaste {
  const normalized = text.replace(/\r\n?/g, "\n");
  const terminal = looksTerminalCopied(normalized);
  // A marker becomes a space, so its line keeps its column and the gutter comes off evenly.
  // Scanned again afterwards, since a line the marker started can turn out to be a fence.
  const lines = terminal ? scanLines(stripGutter(scanLines(normalized).map(dropMarker)).join("\n")) : scanLines(normalized);
  const out: string[] = [];
  let blank = false;
  lines.forEach((line, i) => {
    if (isCode(line)) {
      out.push(line.text);
      blank = false;
      return;
    }
    // A hard break needs the next line to carry on the same paragraph.
    const next = lines[i + 1];
    const hardBreak =
      !terminal && / {2,}$/.test(line.text) && !isBlank(line) && !HEADING.test(line.text) && next !== undefined && !isBlank(next) && !STARTS_BLOCK.test(next.text);
    const fixed = line.text.replace(/\u00a0/g, " ").trimEnd() + (hardBreak ? "  " : "");
    if (!fixed && blank) return;
    blank = !fixed;
    out.push(fixed);
  });
  return { text: out.join("\n"), terminal };
}

/**
 * Whether a paste looks terminal-copied (KTD16): it carries a harness marker at the start
 * of a line outside fenced code, every non-blank line shares a left gutter of at least two
 * spaces, or it has a wrap signature.
 */
export function looksTerminalCopied(text: string): boolean {
  const lines = scanLines(text.replace(/\r\n?/g, "\n"));
  if (lines.some((l) => !isCode(l) && markerAt(l.text) >= 0)) return true;
  const filled = lines.filter((l) => !isBlank(l));
  if (filled.length >= GUTTER_LINES && gutterOf(filled.map((l) => l.text)) >= GUTTER) return true;
  return wrapWidth(text) !== null;
}

/**
 * The width a paste was wrapped at, when it has a wrap signature: at least three long lines
 * outside fenced code end within a few columns of one width, and they are most of its long
 * lines. Widths are counted in characters, trailing whitespace excluded. Null without one.
 */
export function wrapWidth(text: string): number | null {
  const long = scanLines(text.replace(/\r\n?/g, "\n"))
    .filter((l) => !isCode(l))
    .map((l) => columns(l.text.trimEnd()))
    .filter((n) => n >= LONG_LINE);
  let best = 0;
  let width = 0;
  for (const top of new Set(long)) {
    const near = long.filter((n) => n <= top && n > top - WRAP_SLACK).length;
    if (near > best || (near === best && top > width)) {
      best = near;
      width = top;
    }
  }
  return best >= WRAPPED_LINES && best * 2 > long.length ? width : null;
}

/**
 * The line breaks that may be a terminal's wrap (KTD17): adjacent non-blank lines outside
 * fenced code where the second starts no list, heading, quote or fence marker and sits at
 * the first line's text column. With a wrap width, only breaks where the first line, a space
 * and the second line's first word would not have fit.
 */
export function findJoinCandidates(text: string): JoinCandidate[] {
  const lines = scanLines(text);
  const width = wrapWidth(text);
  const out: JoinCandidate[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const [a, b] = [lines[i], lines[i + 1]];
    if (isCode(a) || isCode(b) || isBlank(a) || isBlank(b)) continue;
    if (STARTS_BLOCK.test(b.text) || b.indent !== textColumn(a)) continue;
    const word = b.text.trim().split(/\s+/)[0];
    if (width !== null && columns(a.text.trimEnd()) + 1 + columns(word) <= width) continue;
    out.push({ first: i, second: i + 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------

/** The shortest gutter that counts, and the fewest non-blank lines that must share it. */
const GUTTER = 2;
const GUTTER_LINES = 2;
/** A wrap signature: lines this long or longer, ending within this many columns of one width, at least this many. */
const LONG_LINE = 40;
const WRAP_SLACK = 8;
const WRAPPED_LINES = 3;

/** A list item, heading, quote or fence marker at the start of a line. */
const STARTS_BLOCK = /^[ \t]*(?:[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|>|`{3}|~{3})/;
const HEADING = /^[ \t]*#{1,6}(?:[ \t]|$)/;
/** The marker that puts a line's text further right than its indent: list item, heading or quote. */
const LEAD = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)]|#{1,6})[ \t]+|>[ \t]?)/;

function isCode(line: ScannedLine): boolean {
  return line.fence || line.inFence;
}

function isBlank(line: ScannedLine): boolean {
  return line.text.trim() === "";
}

/** Characters, not UTF-16 units, so a marker or an accented letter counts once. */
function columns(text: string): number {
  return [...text].length;
}

/** The column a line's text starts at, after its indent and any list, heading or quote marker. */
function textColumn(line: ScannedLine): number {
  const lead = LEAD.exec(line.text);
  return lead ? line.indent + lead[0].trimStart().length : line.indent;
}

/** Where a harness marker starts the line's text, or -1. */
function markerAt(text: string): number {
  const at = text.length - text.trimStart().length;
  return (HARNESS_MARKERS as readonly string[]).includes(text[at]) ? at : -1;
}

function dropMarker(line: ScannedLine): string {
  const at = isCode(line) ? -1 : markerAt(line.text);
  return at < 0 ? line.text : `${line.text.slice(0, at)} ${line.text.slice(at + 1)}`;
}

/** The leading spaces every non-blank line has. */
function gutterOf(texts: string[]): number {
  const filled = texts.filter((t) => t.trim() !== "");
  return filled.length ? Math.min(...filled.map((t) => t.length - t.replace(/^ +/, "").length)) : 0;
}

function stripGutter(texts: string[]): string[] {
  const gutter = gutterOf(texts);
  return texts.map((t) => t.slice(Math.min(gutter, t.length - t.replace(/^ +/, "").length)));
}
