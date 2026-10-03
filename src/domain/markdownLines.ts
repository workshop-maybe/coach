// A fence-aware line scanner for Markdown-ish text: rubrics (KTD8) and pasted replies
// (KTD15, KTD17). It only finds fenced code, so callers can leave code alone when they
// read list items, trim whitespace, collapse blank lines or look for line breaks to join.
//
// Fences follow CommonMark except on indent: any leading whitespace opens or closes one.
// A terminal paste carries a gutter and a rubric item nests its fence two to four spaces
// in, and CommonMark's three-space cap would miss both. An unclosed fence runs to the end.
// To skip fenced code, skip every line that is `fence || inFence`.

export interface ScannedLine {
  /** The line, without its LF or CRLF ending. */
  text: string;
  /** Columns of leading whitespace. A tab advances to the next multiple of four. */
  indent: number;
  /** An opening or closing fence: three or more backticks or tildes. */
  fence: boolean;
  /** Between an opening fence and its closing fence, the fences themselves excluded. */
  inFence: boolean;
}

/** Every line of the text, in order, marked for fenced code. An empty text is one empty line. */
export function scanLines(text: string): ScannedLine[] {
  const out: ScannedLine[] = [];
  /** The open fence's mark and run length, or null outside a fence. */
  let open: { mark: string; length: number } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const indent = indentOf(line);
    if (open) {
      const close = CLOSING.exec(line);
      const closes = close !== null && close[1][0] === open.mark && close[1].length >= open.length;
      out.push({ text: line, indent, fence: closes, inFence: !closes });
      if (closes) open = null;
      continue;
    }
    const m = OPENING.exec(line);
    // A backtick run whose info string holds a backtick is an inline code span, not a fence.
    const opens = m !== null && !(m[1][0] === "`" && m[2].includes("`"));
    if (opens) open = { mark: m[1][0], length: m[1].length };
    out.push({ text: line, indent, fence: opens, inFence: false });
  }
  return out;
}

// ---------------------------------------------------------------------------

/** A run of three or more of one fence mark, then the info string. */
const OPENING = /^[ \t]*(`{3,}|~{3,})(.*)$/;
/** A run of three or more of one fence mark and nothing after it but whitespace. */
const CLOSING = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

function indentOf(line: string): number {
  let columns = 0;
  for (const ch of line) {
    if (ch === " ") columns += 1;
    else if (ch === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}
