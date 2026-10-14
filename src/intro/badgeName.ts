// The newcomer's line and the badge name drawn from it (KTD7, R19). The line is flattened
// to one line and capped before it becomes a learning target or a name, so a pasted
// paragraph can't make either run on.

/** The longest line kept, in characters. */
export const LINE_MAX = 200;

/** The most words the name takes from the line. */
const NAME_WORDS = 6;

/** The name when the line has no letters or digits. */
export const FALLBACK_NAME = "My first badge";

/** Every run of whitespace, line breaks too, as one space. */
export function flattenWhitespace(s: string): string {
  return s.replace(/\s+/g, " ");
}

/** The line on one line: every run of whitespace, line breaks too, as one space, trimmed and capped. */
export function normalizeLine(raw: string): string {
  return flattenWhitespace(raw).trim().slice(0, LINE_MAX).trim();
}

/** The badge's name: up to six words of the line, trailing punctuation trimmed. */
export function badgeName(line: string): string {
  const words = normalizeLine(line).split(" ").slice(0, NAME_WORDS).join(" ");
  const name = words.replace(/[^\p{L}\p{N}]+$/u, "");
  return /[\p{L}\p{N}]/u.test(name) ? name : FALLBACK_NAME;
}
