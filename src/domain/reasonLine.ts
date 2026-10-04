// The reason line a test's verdict can carry when it goes against Jev's call (growing
// context R7, KTD14). It is saved as the result's note, which the file keeps under its own
// `## Note` heading, so whatever was pasted into the one-line field must stay one line and
// never read as a heading of its own.

import { MAX_REASON_CHARS } from "./jevExamples";

/** Every Unicode line break, a CRLF read as one: the set Rust refuses in a reason. */
const LINE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/g;
/** Leading heading marks and whitespace, in any mix. */
const LEADING_MARKS = /^[#\s]+/;

/**
 * The line as the result's note keeps it: every line break turned into a space, leading
 * `#` marks and whitespace dropped until none are left, trimmed, then capped at 200 code
 * points, the same cap an example's reason has. Empty when nothing is left.
 */
export function reasonLine(text: string): string {
  const line = text.replace(LINE_BREAK, " ").replace(LEADING_MARKS, "").trim();
  return Array.from(line).slice(0, MAX_REASON_CHARS).join("").trimEnd();
}
