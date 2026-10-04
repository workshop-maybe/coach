// The web side mirrors the native side's example limits by hand (growing context KTD2), so
// these tests read src-tauri/src/jev.rs and fail when the two drift apart: a cap raised on
// one side alone would let the web view build asks that Rust then refuses.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JEV_MODEL, LINE_BREAK, MAX_EXAMPLES_PER_SIDE, MAX_OPENING_CHARS, MAX_REASON_CHARS } from "./jevRequest";

const RUST = readFileSync(join(__dirname, "..", "..", "src-tauri", "src", "jev.rs"), "utf8");

/** The value of a `const NAME: usize = N;` in jev.rs. */
function rustUsize(name: string): number {
  const m = new RegExp(`const ${name}: usize = (\\d+);`).exec(RUST);
  if (!m) throw new Error(`jev.rs has no usize constant ${name}`);
  return Number(m[1]);
}

describe("the web side's copy of the native example limits", () => {
  it("matches each cap in src-tauri/src/jev.rs", () => {
    expect(MAX_EXAMPLES_PER_SIDE).toBe(rustUsize("MAX_EXAMPLES_PER_SIDE"));
    expect(MAX_OPENING_CHARS).toBe(rustUsize("MAX_OPENING_CHARS"));
    expect(MAX_REASON_CHARS).toBe(rustUsize("MAX_REASON_CHARS"));
  });

  it("pins the same model as the native side", () => {
    expect(RUST).toContain(`pub const MODEL: &str = "${JEV_MODEL}";`);
  });

  it("finds exactly the line breaks the native side refuses in a reason", () => {
    const refused = /fn is_line_break\(c: char\) -> bool \{\s*matches!\(c, ([^)]*)\)/.exec(RUST);
    expect(refused).not.toBeNull();
    const chars = [...refused![1].matchAll(/'([^']+)'/g)].map(([, c]) => (c.startsWith("\\u{") ? String.fromCodePoint(parseInt(c.slice(3, -1), 16)) : c === "\\n" ? "\n" : c === "\\r" ? "\r" : c));
    expect(chars).toHaveLength(7);
    for (const c of chars) expect(LINE_BREAK.test(`a${c}b`), JSON.stringify(c)).toBe(true);
    expect(LINE_BREAK.test("a\tb")).toBe(false);
  });
});
