import { describe, expect, it } from "vitest";
import { badgeName, FALLBACK_NAME, LINE_MAX, normalizeLine } from "./badgeName";

describe("badgeName", () => {
  it("AE10. names the badge from the line's opening words", () => {
    expect(badgeName("It finds the bug and names the line that causes it")).toBe("It finds the bug and names");
  });

  it("AE10. falls back when the line has no letters or digits", () => {
    expect(badgeName("!!!")).toBe(FALLBACK_NAME);
    expect(badgeName("   ")).toBe(FALLBACK_NAME);
    expect(badgeName("")).toBe(FALLBACK_NAME);
  });

  it("trims trailing punctuation and keeps a short line whole", () => {
    expect(badgeName("Tests pass.")).toBe("Tests pass");
    expect(badgeName("Cites every source, ...")).toBe("Cites every source");
    expect(badgeName("Ships v2")).toBe("Ships v2");
  });

  it("reads the line flattened", () => {
    expect(badgeName("It finds\nthe bug\t\tfast")).toBe("It finds the bug fast");
  });
});

describe("normalizeLine", () => {
  it("flattens a multi-line paste to one line", () => {
    expect(normalizeLine("  first line\r\n\nsecond\tline  ")).toBe("first line second line");
  });

  it("caps the line at 200 characters", () => {
    const long = "word ".repeat(100);
    const line = normalizeLine(long);
    expect(line.length).toBeLessThanOrEqual(LINE_MAX);
    expect(line.endsWith(" ")).toBe(false);
    expect(normalizeLine("x".repeat(300))).toHaveLength(LINE_MAX);
  });
});
