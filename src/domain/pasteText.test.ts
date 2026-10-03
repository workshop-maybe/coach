import { describe, expect, it } from "vitest";
import { findJoinCandidates, fixPastedText, looksTerminalCopied, wrapWidth } from "./pasteText";

/** Greedy word wrap at `width` columns, the way a terminal lays out a long line. */
function wrapAt(text: string, width: number, indent = ""): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

const PROSE =
  "The badge page kept showing the stale flag after a result was saved, because the flag was read once when the page opened and never again. " +
  "Reading it on every render fixes it, and a test now saves a result and checks the flag clears without a reload.";

const MORE =
  "Two smaller things turned up on the way. The compare view assumed both picks still existed, and the reply list forgot its scroll position after a save.";

/** The text with every space, tab, line break, non-breaking space and harness marker taken out. */
function ink(text: string): string {
  return text.replace(/[\s\u00a0⏺⎿]/g, "");
}

describe("fixPastedText", () => {
  it("normalizes CRLF and lone CR line endings and non-breaking spaces", () => {
    expect(fixPastedText("one\r\ntwo\u00a0words\rthree").text).toBe("one\ntwo words\nthree");
  });

  it("trims trailing spaces on a terminal-looking paste, hard breaks included", () => {
    const { text, terminal } = fixPastedText("⏺ Done.   \n  Next line  \n  Last\t");
    expect(terminal).toBe(true);
    expect(text).toBe("Done.\nNext line\nLast");
  });

  it("keeps a Markdown hard break in a paste that does not look terminal-copied, and trims the rest", () => {
    const { text, terminal } = fixPastedText("**Note:** first  \nsecond   \n\nthird \t\nfourth  ");
    expect(terminal).toBe(false);
    expect(text).toBe("**Note:** first  \nsecond\n\nthird\nfourth");
  });

  it("trims trailing spaces that end a block, since no hard break can fall there", () => {
    const { text } = fixPastedText("## Title  \nnext  \n- one  \n- two  \n  more  \nlast  ");
    expect(text).toBe("## Title\nnext\n- one\n- two  \n  more  \nlast");
  });

  it("collapses runs of blank lines to one, whitespace-only lines included", () => {
    expect(fixPastedText("a\n\n\n\nb\n  \n\t\n\nc").text).toBe("a\n\nb\n\nc");
  });

  it("leaves fenced code alone: blank runs, trailing spaces and non-breaking spaces inside survive", () => {
    const reply = "Run:\n\n\n\n```python\ndef a():  \n    pass\n\n\ndef b():\n    return '\u00a0'\n```\n\n\nDone.";
    expect(fixPastedText(reply).text).toBe("Run:\n\n```python\ndef a():  \n    pass\n\n\ndef b():\n    return '\u00a0'\n```\n\nDone.");
  });

  it("drops the harness markers and the shared two-space gutter from a terminal copy", () => {
    const copied = [
      "⏺ I fixed the parser. The stale flag on the",
      "  badge page now clears.",
      "",
      "⏺ Update(src/parser.ts)",
      "  ⎿  Updated src/parser.ts with 2 additions",
      "     and 1 removal",
    ].join("\n");
    const { text, terminal } = fixPastedText(copied);
    expect(terminal).toBe(true);
    // A marker becomes a space, so its line keeps its column and the gutter comes off evenly.
    expect(text).toBe(
      [
        "I fixed the parser. The stale flag on the",
        "badge page now clears.",
        "",
        "Update(src/parser.ts)",
        "   Updated src/parser.ts with 2 additions",
        "   and 1 removal",
      ].join("\n"),
    );
  });

  it("takes the shared gutter off fenced lines too, keeping the code's own indentation", () => {
    const copied = "  Run the tests:\n\n  ```sh\n  npm test\n    -- --watch\n  ```";
    expect(fixPastedText(copied).text).toBe("Run the tests:\n\n```sh\nnpm test\n  -- --watch\n```");
  });

  it("keeps the indentation of indented code in a paste that does not look terminal-copied", () => {
    const reply = "Steps:\n\n    npm install\n    npm test\n\nDone.";
    expect(fixPastedText(reply)).toEqual({ text: reply, terminal: false });
  });

  it("does not treat a marker inside fenced code as harness chrome", () => {
    const doc = "Claude Code prints:\n\n```\n⏺ Bash(ls)\n  ⎿  README.md\n```";
    expect(fixPastedText(doc)).toEqual({ text: doc, terminal: false });
  });

  it("leaves ordinary Markdown as it is", () => {
    const reply = "## Findings\n\n- off-by-one in `loop`\n- **missing** test\n\n> Keep it small.";
    expect(fixPastedText(reply)).toEqual({ text: reply, terminal: false });
  });

  it("returns an empty paste as it is", () => {
    expect(fixPastedText("")).toEqual({ text: "", terminal: false });
  });

  it.each([
    ["Markdown", "## Plan\r\n\r\n\r\n- read it  \n- ship\u00a0it\n\n\n\n```\nx  \n\n\ny\n```"],
    ["a terminal copy", `⏺ ${wrapAt(PROSE, 72, "  ").slice(2)}\n\n\n  ⎿  done   \n\n⏺ ${wrapAt(MORE, 72, "  ").slice(2)}`],
    ["a wrapped paste", `${wrapAt(PROSE, 60)}\n\n${wrapAt(MORE, 60)}`],
  ])("changes only whitespace and markers in %s", (_, raw) => {
    expect(ink(fixPastedText(raw).text)).toBe(ink(raw));
  });
});

describe("looksTerminalCopied", () => {
  it("fires on a harness marker at the start of a line", () => {
    expect(looksTerminalCopied("⏺ Done.")).toBe(true);
    expect(looksTerminalCopied("Bash(ls)\n  ⎿  README.md")).toBe(true);
  });

  it("fires on a left gutter of two or more spaces shared by every non-blank line", () => {
    expect(looksTerminalCopied("  first line\n\n  second line\n    deeper")).toBe(true);
    expect(looksTerminalCopied(" first line\n second line")).toBe(false);
    expect(looksTerminalCopied("  first line\nsecond line")).toBe(false);
  });

  it("does not take a single indented line for a gutter", () => {
    expect(looksTerminalCopied("    return x;")).toBe(false);
  });

  it("fires on a wrap signature: most long lines end within a few columns of one width", () => {
    expect(looksTerminalCopied(`${wrapAt(PROSE, 60)}\n\n${wrapAt(MORE, 60)}`)).toBe(true);
  });

  it("does not fire on ordinary Markdown", () => {
    expect(looksTerminalCopied("## Plan\n\n- read the diff\n- write the test\n\nThen **ship** it.")).toBe(false);
    expect(looksTerminalCopied(`${PROSE}\n\n${MORE}\n\nShort closing line.`)).toBe(false);
    expect(looksTerminalCopied("Run it:\n\n```ts\n  const a = 1;\n  console.log(a);\n```")).toBe(false);
  });
});

describe("wrapWidth", () => {
  it("finds the width a paste was wrapped at", () => {
    const width = wrapWidth(`${wrapAt(PROSE, 60)}\n\n${wrapAt(MORE, 60)}`);
    expect(width).not.toBeNull();
    expect(width).toBeLessThanOrEqual(60);
    expect(width).toBeGreaterThan(52);
  });

  it("finds none in text whose long lines end anywhere", () => {
    expect(wrapWidth(`${PROSE}\n\n${MORE}`)).toBeNull();
    expect(wrapWidth("one\ntwo\nthree")).toBeNull();
  });

  it("ignores lines inside fenced code", () => {
    const code = Array.from({ length: 6 }, (_, i) => `const value${i} = compute(${"x".repeat(40)});`).join("\n");
    expect(wrapWidth(`Code:\n\n\`\`\`ts\n${code}\n\`\`\``)).toBeNull();
  });
});

describe("findJoinCandidates", () => {
  it("pairs a list item's line with a next line at the item's text column, and never the next item (AE6)", () => {
    const text = "- the stale flag on the\n  badge page\n- the next item";
    expect(findJoinCandidates(text)).toEqual([{ first: 0, second: 1 }]);
  });

  it("measures an ordered item's text column after its marker", () => {
    expect(findJoinCandidates("10. the first part of\n    the item\n11. next")).toEqual([{ first: 0, second: 1 }]);
  });

  it("pairs adjacent prose lines at the same indent", () => {
    expect(findJoinCandidates("I fixed the parser. The stale flag on the\nbadge page now clears.")).toEqual([{ first: 0, second: 1 }]);
  });

  it("never pairs lines across a blank line", () => {
    expect(findJoinCandidates("one paragraph\n\nanother paragraph")).toEqual([]);
  });

  it("never pairs a line indented deeper than the previous line's text column", () => {
    expect(findJoinCandidates("Run this\n    npm test\n- item\n    nested code")).toEqual([]);
  });

  it("never pairs a line that starts a list, heading, quote or fence", () => {
    const text = "Plan\n- read it\nThen\n1. first\nNext\n## Heading\nQuote\n> said\nCode\n```\nx\ny\n```";
    expect(findJoinCandidates(text)).toEqual([]);
  });

  it("never pairs lines inside fenced code", () => {
    expect(findJoinCandidates("```\nconst a =\n  1;\nlet b\nlet c\n```")).toEqual([]);
  });

  it("with a wrap width, pairs a line filled to the width and not a short one", () => {
    const wrapped = wrapAt(PROSE, 60);
    const text = `Steps\ndo this first\n\n${wrapped}`;
    const width = wrapWidth(text);
    expect(width).not.toBeNull();
    const pairs = findJoinCandidates(text);
    // "Steps" plus "do" fits well within the width, so that break is no wrap.
    expect(pairs).not.toContainEqual({ first: 0, second: 1 });
    // Every break inside the wrapped paragraph is one.
    const wrappedLines = wrapped.split("\n").length;
    for (let i = 3; i < 3 + wrappedLines - 1; i++) expect(pairs).toContainEqual({ first: i, second: i + 1 });
  });

  it("finds none in a list of similar-length items, wrap signature or not", () => {
    const list = Array.from({ length: 6 }, (_, i) => `- item ${i}: ${"word ".repeat(10).trim()} end`).join("\n");
    expect(findJoinCandidates(list)).toEqual([]);
  });

  it("finds none in a terminal copy whose messages are one line each", () => {
    const { text } = fixPastedText("⏺ Done.\n\n⏺ Saved the result.\n\n  ⎿  Wrote 3 lines");
    expect(findJoinCandidates(text)).toEqual([]);
  });

  it("finds the candidates that remain in a terminal copy after the fixes", () => {
    const { text } = fixPastedText("⏺ I fixed the parser. The stale flag on the\n  badge page now clears.");
    expect(text).toBe("I fixed the parser. The stale flag on the\nbadge page now clears.");
    expect(findJoinCandidates(text)).toEqual([{ first: 0, second: 1 }]);
  });
});
