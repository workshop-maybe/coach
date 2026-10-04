import { describe, expect, it } from "vitest";
import { readerLine, readerText } from "./readerText";

describe("readerLine", () => {
  it("drops the backslash the reply box puts before punctuation, and keeps the punctuation", () => {
    expect(readerLine(String.raw`See \[the docs\], a\[1\] and snake\_case\_name.`)).toBe("See [the docs], a[1] and snake_case_name.");
    expect(readerLine(String.raw`2\*3\*4, \~tilde\~, \`tick\` and \# and \!`)).toBe("2*3*4, ~tilde~, `tick` and # and !");
    expect(readerLine(String.raw`An escaped backslash \\ stays one, and \\\[ reads \[`)).toBe(String.raw`An escaped backslash \ stays one, and \[ reads [`);
  });

  it("reads the three entities the box writes, in one pass", () => {
    expect(readerLine("A &lt; b &gt; c &amp; d")).toBe("A < b > c & d");
    expect(readerLine("&amp;lt; is how you write &lt;")).toBe("&lt; is how you write <");
    expect(readerLine("&quot; and &copy; and & alone stay")).toBe("&quot; and &copy; and & alone stay");
  });

  it("keeps a code span as written, and a backtick run with no match as literal backticks", () => {
    expect(readerLine(String.raw`Run \`a\_b\`? No: run ${"`"}a\_b &lt;${"`"} and \[y\]`)).toBe(String.raw`Run ` + "`a_b`? No: run `a\\_b &lt;` and [y]");
    expect(readerLine("``a`b\\_c`` then \\_")).toBe("``a`b\\_c`` then _");
    expect(readerLine("one ` alone and \\_ after")).toBe("one ` alone and _ after");
  });

  it("leaves a backslash before anything but punctuation, and drops one that ends the line", () => {
    expect(readerLine(String.raw`C:\path\to\file`)).toBe(String.raw`C:\path\to\file`);
    expect(readerLine("a hard break\\")).toBe("a hard break");
  });

  it("reads a very long line in one pass, however its backticks are laid out", () => {
    const growing = Array.from({ length: 440 }, (_, n) => "`".repeat(n + 1)).join("x");
    const lines = [growing, "\\".repeat(100_000), "`\\_".repeat(30_000), "&amp;".repeat(30_000)];
    for (const line of lines) {
      const start = performance.now();
      readerLine(line);
      expect(performance.now() - start, line.slice(0, 12)).toBeLessThan(1000);
    }
  });
});

describe("readerText", () => {
  it("reads every line but fenced code, which keeps its backslashes and entities", () => {
    const md = ["Before \\[x\\]", "```", "\\[x\\] &lt; a\\_b", "```", "After &amp; \\_"].join("\n");
    expect(readerText(md)).toBe(["Before [x]", "```", "\\[x\\] &lt; a\\_b", "```", "After & _"].join("\n"));
  });

  it("leaves text with nothing escaped exactly as it was", () => {
    const plain = "1. Holds. 100 has 20 multiples of 5.\n2. Does not hold.\n\n- A bullet\n  - nested";
    expect(readerText(plain)).toBe(plain);
  });
});
