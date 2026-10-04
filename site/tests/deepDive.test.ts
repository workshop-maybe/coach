/// <reference types="node" />
// The Jev deep dive's checks (docs/plans/2026-10-04-1503-docs-jev-deep-dive-plan.md, KTD1,
// KTD2, KTD6). The content check (content.test.ts) reads only a page's MDX, so it cannot see
// what the deep dive's components read from disk at build time. This file checks that:
//
// - every <Source> a page cites resolves to exactly one declaration, stays short, and shows
//   nothing the guide forbids;
// - every example the generator builds (site/src/deep-dive/examples.ts) matches its
//   committed file, every file is shown by a page, and every <Example> names a file;
// - the case studies' examples say what the pages say they do.
//
// After an intended change, `npm run site:examples` rewrites the example files. Each problem
// is one line naming the page or file and what is wrong.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { filesUnder } from "../../src/test/files";
import { MAX_EXCERPT_LINES, excerpt, excerptFromText, forbiddenIn, repoRoot } from "../src/deep-dive/excerpt";
import { buildExamples } from "../src/deep-dive/examples";

const ROOT = join(__dirname, "..", "..");
const GUIDE = join(ROOT, "site", "src", "content", "guide");
const EXAMPLES = join(ROOT, "site", "src", "deep-dive", "examples");

/** The guide's pages, as the content check reads them. */
function guidePages(): { id: string; text: string }[] {
  return filesUnder(GUIDE)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => ({ id: relative(GUIDE, f).replace(/\.mdx?$/, "").split("\\").join("/"), text: readFileSync(f, "utf8") }));
}

/** One attribute's value from a component tag's attribute text. */
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];

/** A page's MDX with its comments taken out, so a component named in one is not a use. */
const withoutComments = (text: string) => text.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/** Every <Source> a page cites, as file, symbol and optional end symbol. */
export function sourcesIn(text: string): { file?: string; symbol?: string; to?: string }[] {
  return [...withoutComments(text).matchAll(/<Source\b([^>]*?)\/?>/g)].map(([, attrs]) => ({ file: attr(attrs, "file"), symbol: attr(attrs, "symbol"), to: attr(attrs, "to") }));
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

/** Every example file a page shows. */
export function examplesIn(text: string): string[] {
  return [...withoutComments(text).matchAll(/<Example\b([^>]*?)\/?>/g)].map(([, attrs]) => attr(attrs, "file") ?? "");
}

describe("the deep dive's pages", () => {
  const pages = guidePages();

  it("cite only excerpts that resolve, stay short and show nothing forbidden", () => {
    expect(pages.flatMap((p) => sourceProblems(p, ROOT))).toEqual([]);
  });

  it("show only examples that exist, and every example is shown", async () => {
    const built = Object.keys(await buildExamples());
    const shown = new Set(pages.flatMap((p) => examplesIn(p.text)));
    const problems = [
      ...pages.flatMap((p) => examplesIn(p.text).filter((f) => !built.includes(f)).map((f) => `${p.id}: <Example file="${f}"> is no example the generator builds`)),
      ...built.filter((f) => !shown.has(f)).map((f) => `example ${f}: no page shows it`),
      ...filesUnder(EXAMPLES)
        .map((f) => relative(EXAMPLES, f).split("\\").join("/"))
        .filter((f) => !built.includes(f))
        .map((f) => `site/src/deep-dive/examples/${f}: the generator builds no such example; delete it`),
    ];
    expect(problems).toEqual([]);
  });
});

/** A whole-number const as a source file declares it: `const NAME = 12;`, `const NAME: usize = 256 * 1024;`, `Duration::from_secs(20)`. */
function constIn(file: string, name: string): number {
  const text = readFileSync(join(ROOT, file), "utf8");
  const m = new RegExp(`\\bconst ${name}\\b[^=]*=\\s*([^;]+);`).exec(text);
  if (!m) throw new Error(`${file} declares no const ${name}`);
  const value = m[1].replace(/Duration::from_secs\((\d+)\)/, "$1").replace(/_/g, "");
  if (!/^[\d\s*+]+$/.test(value)) throw new Error(`${file}'s ${name} is not a whole number: ${m[1]}`);
  return value.split("*").reduce((product, n) => product * Number(n.trim()), 1);
}

/** Small numbers as the pages spell them. */
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n: number) => WORDS[n] ?? String(n);

/**
 * Each number a deep-dive page states in prose, as the phrase the page must contain, built
 * from the code constant or the generated example it comes from (KTD6). A changed constant
 * changes the phrase, and the page that still says the old number fails here.
 */
async function facts(): Promise<{ page: string; says: string }[]> {
  const examples = await buildExamples();
  const parse = (file: string) => JSON.parse(examples[file]);
  const calls = await import("../../src/domain/calls");
  const request = await import("../../src/domain/jevRequest");
  const lineBreaks = await import("../../src/domain/lineBreaks");
  const rs = "src-tauri/src/jev.rs";
  const paste = "src/domain/pasteText.ts";
  const fit = parse("second-opinion/fit.json");
  const reading = parse("second-opinion/reading.json");
  const percentOf = (id: string) => reading.rows.find((r: { id: string }) => r.id === id).percent;
  const ranking = parse("second-opinion/ranking.json") as { sent: boolean; note: string | null }[];
  const detection = parse("cleanup/detection.json");
  const { low, high } = calls.DEFAULT_CUT_OFFS;
  const pct = (p: number) => `${p}`;
  const say = (page: string, ...says: string[]) => says.map((s) => ({ page, says: s }));
  return [
    ...say(
      "jev/how-jev-works",
      `\`${request.JEV_MODEL}\``,
      `gives up after ${constIn(rs, "TIMEOUT")} seconds`,
      `no answer within ${constIn(rs, "TIMEOUT")} seconds`,
      `at most ${constIn(rs, "MAX_KEY_CHARS")} characters`,
      `shorter than ${constIn(rs, "HINT_MIN_CHARS")} characters`,
      `at ${request.JEV_LIMITS.maxQuestions} questions`,
      `${request.JEV_LIMITS.whole / 1000}k tokens for the state and every question`,
      `${request.JEV_LIMITS.stateAndLongest / 1000}k tokens for the state plus the longest`,
      `larger than ${constIn(rs, "MAX_RESPONSE_BYTES") / 1024} KiB`,
      "`io.andamio.desktop`",
      "`typesafe-api-key`",
    ),
    ...say(
      "jev/second-opinion",
      `up to ${request.MAX_EXAMPLES_PER_SIDE} examples on each side`,
      `first ${request.MAX_OPENING_CHARS} characters`,
      `capped at ${request.MAX_REASON_CHARS} characters`,
      `starts with ${low} and ${high}`,
      `at least ${calls.MIN_JUDGED_READINGS} such results, with at least ${calls.MIN_READINGS_PER_VERDICT} Met and ${calls.MIN_READINGS_PER_VERDICT} Not met`,
      `a ${calls.CUT_OFF_STEP}-point grid`,
      `from ${calls.LOW_CUT_OFF_RANGE.min} to ${calls.LOW_CUT_OFF_RANGE.max}`,
      `from ${calls.HIGH_CUT_OFF_RANGE.min} to ${calls.HIGH_CUT_OFF_RANGE.max}`,
      `less ${calls.WRONG_CALL_COST} for each wrong call`,
      `at most ${calls.MAX_CANT_CALL_PERCENT}% of the readings`,
      `once there are ${calls.MIN_JUDGED_READINGS} such results`,
      `offers ${parse("second-opinion/forced-drops.json").offered} examples`,
      `has ${word(fit.judged)} readings from one model`,
      `they score ${fit.default_pair.score}`,
      `moves the pair to ${fit.fitted_pair.pair.low} and ${fit.fitted_pair.pair.high}`,
      `rises to ${fit.fitted_pair.score}`,
    ),
    ...say(
      "jev/second-opinion-case-study",
      `holds ${word(fit.judged)} judged results`,
      `${word(ranking.filter((r) => r.note).length)} of them carry notes`,
      `saying ${word(ranking.filter((r) => r.sent).length)} earlier replies go with it`,
      `That is ${word(ranking.filter((r) => r.sent).length)} results`,
      `fit its cut-offs to ${fit.fitted_pair.pair.low} and ${fit.fitted_pair.pair.high}`,
      `${fit.track_record.matches} matches out of ${fit.track_record.calls} calls, and ${fit.track_record.cantCalls} it couldn't call`,
      `at ${pct(percentOf("p2"))}%, would read`,
      `at ${pct(percentOf("overall"))}%, reads`,
      `at ${pct(percentOf("t2"))}%, reads`,
    ),
    ...say(
      "jev/paste-cleanup",
      `At least ${constIn(paste, "GUTTER_LINES")} non-blank lines`,
      `a margin of at least ${constIn(paste, "GUTTER")} spaces`,
      `at least ${constIn(paste, "WRAPPED_LINES")} lines of ${constIn(paste, "LONG_LINE")} characters or more`,
      `within ${constIn(paste, "WRAP_SLACK")} characters of one width`,
      `at ${lineBreaks.JOIN_AFTER_OPEN} or above`,
      `at ${lineBreaks.JOIN_AFTER_STOP} or above`,
      `at most ${request.JEV_LIMITS.maxQuestions} questions`,
      `up to ${lineBreaks.LINE_BREAK_RETRIES} times`,
      `or ${lineBreaks.BACKOFF_MS / 1000} second, then ${(2 * lineBreaks.BACKOFF_MS) / 1000}, then ${(4 * lineBreaks.BACKOFF_MS) / 1000}`,
      `longer than ${lineBreaks.MAX_WAIT_MS / 1000} seconds`,
    ),
    ...say(
      "jev/paste-cleanup-case-study",
      `That width, ${detection.wrap_width} characters`,
      `would not have fit in ${detection.wrap_width} characters`,
      `${word(detection.candidates.length)[0].toUpperCase()}${word(detection.candidates.length).slice(1)} breaks could be wraps`,
      `joins at ${lineBreaks.JOIN_AFTER_OPEN} or above`,
    ),
  ];
}

describe("the deep dive's numbers", async () => {
  const pages = new Map(guidePages().map((p) => [p.id, p.text.replace(/\s+/g, " ")]));
  const all = await facts();

  it("are the numbers in the code and the examples (each page says each phrase)", () => {
    expect(all.filter((f) => !pages.get(f.page)?.toLowerCase().includes(f.says.toLowerCase())).map((f) => `${f.page} does not say "${f.says}"`)).toEqual([]);
  });

  it("read the Rust constants they quote", () => {
    expect(constIn("src-tauri/src/jev.rs", "MAX_RESPONSE_BYTES")).toBe(256 * 1024);
    expect(constIn("src-tauri/src/jev.rs", "TIMEOUT")).toBe(20);
    expect(() => constIn("src-tauri/src/jev.rs", "NO_SUCH")).toThrow("declares no const NO_SUCH");
  });
});

describe("the deep dive's examples", async () => {
  const examples = await buildExamples();
  const parse = (file: string) => JSON.parse(examples[file]);

  it.each(Object.keys(examples))("%s matches its committed file (npm run site:examples rewrites it)", async (file) => {
    await expect(examples[file]).toMatchFileSnapshot(join(EXAMPLES, file));
  });

  it("show nothing the guide forbids", () => {
    const problems = Object.entries(examples).flatMap(([file, text]) => forbiddenIn(text).map((p) => `${file} ${p}`));
    expect(problems).toEqual([]);
  });

  it("quote four earlier results in the second opinion, the two with notes first, with a reason only where one may ride", () => {
    const ranking = parse("second-opinion/ranking.json") as { rank: number; ranks_as: string; sent: boolean; note: string | null }[];
    expect(ranking.filter((r) => r.sent)).toHaveLength(4);
    expect(ranking.slice(0, 2).map((r) => r.ranks_as)).toEqual(["overrule with a reason", "overrule with a reason"]);
    const request = parse("second-opinion/request.json");
    const overall = request.questions.overall.criteria;
    expect(overall.true.examples[0].user_reason).toBeTruthy();
    expect(overall.false.examples[0].user_reason).toBeTruthy();
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) {
      for (const ex of request.questions[id].criteria.true.examples ?? []) expect(ex.user_reason, id).toBeUndefined();
    }
    expect(request.questions.t1.criteria.true).toBeTypeOf("string");
  });

  it("read the case study's reading with the fitted pair, and save it seen after the verdict with the missed point and the reason", () => {
    const reading = parse("second-opinion/reading.json");
    expect(reading.pair).toEqual({ low: 40, high: 75 });
    const saved = examples["second-opinion/saved-result.md"];
    const front = parseYaml(/^---\n([\s\S]*?)\n---/.exec(saved)![1]);
    expect(front.result).toBe("not_met");
    expect(front.jev).toMatchObject({ seen: "after", verdict_when_seen: "not_met", verdict_changed: false, examples_sent: 4, model: "jev-1.13.0" });
    expect(front.missed_points).toHaveLength(1);
    expect(front.context).toBeUndefined();
    expect(front.handoff).toBeUndefined();
    expect(saved).toContain("## Note\n\nLets key 2 stand");
  });

  it("drop examples from the end of each side until the request fits", () => {
    const drops = parse("second-opinion/forced-drops.json") as { examples: { question: string; side: string; rank: number; kept: boolean }[]; kept: number; offered: number };
    expect(drops.kept).toBeGreaterThan(0);
    expect(drops.kept).toBeLessThan(drops.offered);
    const sides = new Map<string, { kept: number[]; dropped: number[] }>();
    for (const e of drops.examples) {
      const s = sides.get(`${e.question}:${e.side}`) ?? { kept: [], dropped: [] };
      (e.kept ? s.kept : s.dropped).push(e.rank);
      sides.set(`${e.question}:${e.side}`, s);
    }
    for (const [side, { kept, dropped }] of sides) if (kept.length && dropped.length) expect(Math.min(...dropped), side).toBeGreaterThan(Math.max(...kept));
  });

  it("join only whitespace in the cleanup, leaving every word in its order", () => {
    const words = (text: string) => text.split(/\s+/).filter(Boolean);
    expect(words(examples["cleanup/joined.txt"])).toEqual(words(examples["cleanup/fixed.txt"]));
    expect(examples["cleanup/joined.txt"]).not.toEqual(examples["cleanup/fixed.txt"]);
  });

  it("split a long paste into batches that each fit and together ask about every candidate once", () => {
    const two = parse("cleanup/two-batches.json");
    expect(two.batches).toHaveLength(2);
    expect(two.batches.reduce((n: number, b: { questions: number }) => n + b.questions, 0)).toBe(two.candidates);
    for (const b of two.batches) {
      expect(b.questions).toBeLessThanOrEqual(two.limits.questions);
      expect(b.state_tokens + b.question_tokens).toBeLessThanOrEqual(two.limits.state_plus_all);
    }
  });
});
