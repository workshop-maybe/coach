/// <reference types="node" />
// The Jev deep dive's checks (docs/plans/2026-10-04-1503-docs-jev-deep-dive-plan.md, KTD1,
// KTD2, KTD6). The content check (content.test.ts) reads only a page's MDX, so it cannot see
// what the deep dive's components read from disk at build time. This file checks that:
//
// - every <Source> a page cites resolves to exactly one declaration, stays short, and shows
//   nothing the guide forbids;
//
// Each problem is one line naming the page and what is wrong.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { filesUnder } from "../../src/test/files";
import { MAX_EXCERPT_LINES, excerpt, excerptFromText, forbiddenIn, repoRoot } from "../src/deep-dive/excerpt";

const ROOT = join(__dirname, "..", "..");
const GUIDE = join(ROOT, "site", "src", "content", "guide");

/** The guide's pages, as the content check reads them. */
function guidePages(): { id: string; text: string }[] {
  return filesUnder(GUIDE)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => ({ id: relative(GUIDE, f).replace(/\.mdx?$/, "").split("\\").join("/"), text: readFileSync(f, "utf8") }));
}

/** One attribute's value from a component tag's attribute text. */
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];

/** Every <Source> a page cites, as file, symbol and optional end symbol. */
export function sourcesIn(text: string): { file?: string; symbol?: string; to?: string }[] {
  return [...text.matchAll(/<Source\b([^>]*?)\/?>/g)].map(([, attrs]) => ({ file: attr(attrs, "file"), symbol: attr(attrs, "symbol"), to: attr(attrs, "to") }));
}

/** Everything wrong with the excerpts one page cites. */
export function sourceProblems(page: { id: string; text: string }, root: string): string[] {
  const out: string[] = [];
  for (const { file, symbol, to } of sourcesIn(page.text)) {
    if (!file || !symbol) {
      out.push(`${page.id}: a <Source> needs both file and symbol`);
      continue;
    }
    const name = to ? `${symbol} to ${to}` : symbol;
    try {
      const found = excerpt(file, symbol, to, root);
      const lines = found.end - found.start + 1;
      if (lines > MAX_EXCERPT_LINES) out.push(`${page.id}: ${file} ${name} is ${lines} lines, over ${MAX_EXCERPT_LINES}; cite a smaller symbol`);
      for (const problem of forbiddenIn(found.text)) out.push(`${page.id}: ${file} ${name} ${problem}`);
    } catch (e) {
      out.push(`${page.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

describe("excerpts", () => {
  it("finds the repo root from site/ and from the root", () => {
    expect(repoRoot(join(ROOT, "site"))).toBe(ROOT);
    expect(repoRoot(ROOT)).toBe(ROOT);
  });

  it("reads a TypeScript function with its doc comment", () => {
    const found = excerpt("src/domain/calls.ts", "callOf", undefined, ROOT);
    expect(found.text.split("\n")[0]).toBe("/** How a probability reads under a pair. */");
    expect(found.text).toContain("export function callOf(probability: number, pair: CutOffs): Call {");
    expect(found.text.trimEnd().endsWith("}")).toBe(true);
  });

  it("reads a function nested in a component, dedented", () => {
    const found = excerpt("src/ui/TestDeck.tsx", "askJev", undefined, ROOT);
    expect(found.text.startsWith("/** Asks Jev about this reply once")).toBe(true);
    expect(found.text).toContain("async function askJev() {");
    expect(found.text.split("\n").at(-1)).toBe("}");
  });

  it("reads an exported const, and a range from one symbol to another", () => {
    expect(excerpt("src/domain/calls.ts", "DEFAULT_CUT_OFFS", undefined, ROOT).text).toContain("export const DEFAULT_CUT_OFFS: CutOffs");
    const range = excerpt("src/domain/calls.ts", "CUT_OFF_STEP", "MIN_READINGS_PER_VERDICT", ROOT);
    expect(range.text).toContain("export const CUT_OFF_STEP = 5;");
    expect(range.text.trimEnd().endsWith("export const MIN_READINGS_PER_VERDICT = 2;")).toBe(true);
  });

  it("reads a Rust method inside an impl, with its comments, and a one-line const", () => {
    const found = excerpt("src-tauri/src/jev.rs", "prepare", undefined, ROOT);
    expect(found.text.split("\n")[0].startsWith("/// ")).toBe(true);
    expect(found.text).toContain("pub fn prepare(&self, file: &SettingsFile, request: Value) -> Result<Prepared, JevError> {");
    expect(found.text.split("\n").at(-1)).toBe("}");
    const model = excerpt("src-tauri/src/jev.rs", "MODEL", undefined, ROOT);
    expect(model.text).toBe('pub const MODEL: &str = "jev-1.13.0";');
  });

  it("reads a Rust command with its attribute", () => {
    const found = excerpt("src-tauri/src/lib.rs", "jev_ask", undefined, ROOT);
    expect(found.text).toContain("#[tauri::command]");
    expect(found.text).toContain("jev::send(prepared).await");
  });

  it("never reads a Rust symbol from the tests below #[cfg(test)]", () => {
    const text = "fn kept() {\n    1\n}\n\n#[cfg(test)]\nmod tests {\n    fn kept() {}\n    fn only_in_tests() {}\n}\n";
    expect(excerptFromText("x.rs", text, "kept").text).toBe("fn kept() {\n    1\n}");
    expect(() => excerptFromText("x.rs", text, "only_in_tests")).toThrow("only_in_tests is declared 0 times above its tests");
  });

  it("fails a missing symbol and a name declared twice", () => {
    expect(() => excerpt("src/domain/calls.ts", "noSuchThing", undefined, ROOT)).toThrow("noSuchThing is declared 0 times");
    expect(() => excerptFromText("x.ts", "function a() {}\nnamespace n { function a() {} }\n", "a")).toThrow("a is declared 2 times");
    expect(() => excerpt("src/domain/nothing.ts", "a", undefined, ROOT)).toThrow("src/domain/nothing.ts does not exist.");
  });

  it("flags what a page must never show", () => {
    expect(forbiddenIn("the Machine room")).toEqual(['says "Machine"']);
    expect(forbiddenIn("open /Users/someone/x and ~/notes")).toEqual(["names a home folder (/Users/)", "names a home folder (~/)"]);
    expect(forbiddenIn('const KEY = "ts-live-0123456789abcdef";')).toEqual(["holds a TypeSafe key's prefix (ts-live- or ts-test-)"]);
    expect(forbiddenIn("token Ab3dEf6hIj9kLm2nOp5qR")).toEqual(["holds a key-shaped run (Ab3dEf…)"]);
    // The app's own secret filter, quoted, is no secret.
    const filter = excerpt("src/domain/jevExamples.ts", "TOKEN", undefined, ROOT).text;
    expect(forbiddenIn(filter)).toEqual([]);
  });

  it("fails a page whose excerpt is too long or missing, naming the page", () => {
    const page = { id: "jev/fixture", text: '<Source file="src/domain/calls.ts" symbol="fitCutOffs" to="distanceFromDefault" />\n<Source file="src/domain/calls.ts" symbol="gone" />\n<Source symbol="x" />' };
    const problems = sourceProblems(page, ROOT);
    expect(problems[0]).toMatch(/^jev\/fixture: src\/domain\/calls.ts fitCutOffs to distanceFromDefault is \d+ lines, over 60; cite a smaller symbol$/);
    expect(problems[1]).toBe("jev/fixture: src/domain/calls.ts: gone is declared 0 times; an excerpt needs exactly one.");
    expect(problems[2]).toBe("jev/fixture: a <Source> needs both file and symbol");
  });
});

describe("the deep dive's pages", () => {
  const pages = guidePages();

  it("cite only excerpts that resolve, stay short and show nothing forbidden", () => {
    expect(pages.flatMap((p) => sourceProblems(p, ROOT))).toEqual([]);
  });
});
