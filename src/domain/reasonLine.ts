// The reason line a test's verdict can carry when it goes against Jev's call (growing
// context R7, KTD14). It is saved as the result's note, which the file keeps under its own
// `## Note` heading, so whatever was pasted into the one-line field must stay one line and
// never read as a heading of its own.

import { LINE_BREAK, MAX_REASON_CHARS } from "./jevRequest";

/** Every line break Rust refuses in a reason, a CRLF read as one, found throughout the text. */
const EVERY_LINE_BREAK = new RegExp(LINE_BREAK.source, "g");
/** Leading heading marks and whitespace, in any mix. */
const LEADING_MARKS = /^[#\s]+/;

/**
 * The line as the result's note keeps it: every line break turned into a space, leading
 * `#` marks and whitespace dropped until none are left, trimmed, then capped at 200 code
 * points, the same cap an example's reason has. Empty when nothing is left.
 */
export function reasonLine(text: string): string {
  const line = text.replace(EVERY_LINE_BREAK, " ").replace(LEADING_MARKS, "").trim();
  return Array.from(line).slice(0, MAX_REASON_CHARS).join("").trimEnd();
}
