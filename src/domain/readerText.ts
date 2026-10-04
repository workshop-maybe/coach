// A reply as its reader sees it (fix plan KTD6): the reply box keeps Markdown, and its editor
// escapes characters a paste carries plainly, a backslash before `\`, backticks, `*`, `_`,
// `[`, `]` and `~`, and `&amp;`, `&lt;` and `&gt;` for `&`, `<` and `>`. Code marks and code
// blocks it leaves alone. Jev reads the reply, so a request sends it without those escapes,
// the way the rendered reply reads: Markdown structure (lists, emphasis, headings, code)
// stays, since it carries meaning a reader sees.
//
// The rule follows CommonMark's: a backslash before ASCII punctuation is dropped and the
// punctuation kept, which undoes the editor's escapes and any a reply wrote itself. Fenced
// code keeps its lines as written, and so does a code span, which is found within its line:
// a span that crosses lines is rare in a reply, and treating each line alone keeps the
// excerpt cleaner able to read its lines one at a time.

import { scanLines } from "./markdownLines";

/** CommonMark's ASCII punctuation: what a backslash can escape. */
const ESCAPABLE = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");

/** The three entities the reply box's editor writes for `&`, `<` and `>`. */
const ENTITIES: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">" };
const ENTITY = /&(?:amp|lt|gt);/y;

/**
 * One line as a reader sees it: a backslash before ASCII punctuation is dropped and the
 * punctuation kept, a backslash that ends the line (a hard line break) is dropped, and
 * `&amp;`, `&lt;` and `&gt;` read as the characters they stand for. One left-to-right pass,
 * so `\\[` reads `\[` and `&amp;lt;` reads `&lt;`. A code span, a run of backticks up to the
 * next run of the same length on the line, is kept as written; a run with no such match is
 * literal backticks. Linear in the line's length.
 */
export function readerLine(line: string): string {
  const runs = backtickRuns(line);
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      if (i + 1 === line.length) break;
      if (ESCAPABLE.has(line[i + 1])) {
        out += line[i + 1];
        i += 2;
        continue;
      }
    } else if (ch === "`") {
      let n = 1;
      while (line[i + n] === "`") n++;
      const close = runs.next(n, i + n);
      const end = close >= 0 ? close + n : i + n;
      out += line.slice(i, end);
      i = end;
      continue;
    } else if (ch === "&") {
      ENTITY.lastIndex = i;
      const m = ENTITY.exec(line);
      if (m) {
        out += ENTITIES[m[0]];
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** The text as a reader sees it: each line by `readerLine`, fenced code as written. */
export function readerText(markdown: string): string {
  return scanLines(markdown)
    .map((line) => (line.fence || line.inFence ? line.text : readerLine(line.text)))
    .join("\n");
}

/** A line's maximal backtick runs by length, to find a code span's closing run by binary search. */
function backtickRuns(line: string): { next(length: number, from: number): number } {
  const byLength = new Map<number, number[]>();
  for (let i = line.indexOf("`"); i >= 0; i = line.indexOf("`", i)) {
    let n = 1;
    while (line[i + n] === "`") n++;
    const starts = byLength.get(n);
    if (starts) starts.push(i);
    else byLength.set(n, [i]);
    i += n;
  }
  return {
    /** Where the first maximal run of exactly `length` backticks at or after `from` starts, or -1. */
    next(length, from) {
      const starts = byLength.get(length);
      if (!starts) return -1;
      let lo = 0;
      let hi = starts.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] < from) lo = mid + 1;
        else hi = mid;
      }
      return lo < starts.length ? starts[lo] : -1;
    },
  };
}
