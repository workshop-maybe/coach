import { describe, expect, it } from "vitest";
import { fitsJev, fitsTokens, jevTokens } from "./jevBudget";
import { JEV_LIMITS, type LineBreaksRequest } from "./jevRequest";

// The cases mirror the native side's budget test in src-tauri/src/jev.rs, so the two
// checks stay the same check (KTD19).

function lineBreaks(state: string, ids: string[], instructions = (id: string) => `Does line ${id} pick up mid-sentence?`): LineBreaksRequest {
  return {
    kind: "lineBreaks",
    state,
    questions: Object.fromEntries(ids.map((id) => [id, { type: "noul" as const, instructions: instructions(id) }])),
  };
}

const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `L${String(from + i).padStart(3, "0")}`);

describe("jevTokens", () => {
  it("is the compact JSON's length over four, rounded up", () => {
    expect(jevTokens("abc")).toBe(2); // "abc" with its quotes is 5 characters
    expect(jevTokens("ab")).toBe(1);
    expect(jevTokens({ a: 1 })).toBe(2);
    expect(jevTokens("a\nb")).toBe(2); // the newline counts as its two-character escape
  });

  it("counts UTF-16 units, so it is never looser than the native count of characters", () => {
    expect(jevTokens("😀😀")).toBe(2); // 4 units plus 2 quotes
  });
});

describe("fitsTokens", () => {
  it("holds the state plus the longest question to 32k", () => {
    expect(fitsTokens(31_000, [1_000, 5])).toBe(true);
    expect(fitsTokens(31_000, [1_001, 5])).toBe(false);
    expect(fitsTokens(32_001, [])).toBe(false);
    expect(fitsTokens(32_000, [])).toBe(true);
  });

  it("holds the state plus every question to 64k", () => {
    expect(fitsTokens(20_000, [11_000, 11_000, 11_000, 11_000])).toBe(true);
    expect(fitsTokens(20_000, [11_000, 11_000, 11_000, 11_000, 1])).toBe(false);
  });

  it("allows at most 256 questions", () => {
    expect(fitsTokens(0, Array<number>(JEV_LIMITS.maxQuestions).fill(1))).toBe(true);
    expect(fitsTokens(0, Array<number>(JEV_LIMITS.maxQuestions + 1).fill(1))).toBe(false);
  });
});

describe("fitsJev", () => {
  it("refuses more than 256 questions however short", () => {
    expect(fitsJev(lineBreaks("x", ids(2, 257)))).toBe(true);
    expect(fitsJev(lineBreaks("x", ids(2, 258)))).toBe(false);
  });

  it("refuses a state plus its longest question over 32k, to the token", () => {
    // The question is 34 characters of JSON, 9 tokens, so the state may have 31,991.
    const q = () => "q";
    expect(fitsJev(lineBreaks("y".repeat(4 * 31_991 - 2), ["L002"], q))).toBe(true);
    expect(fitsJev(lineBreaks("y".repeat(4 * 31_991 - 1), ["L002"], q))).toBe(false);
  });

  it("refuses questions that each fit beside the state but not all together", () => {
    const wide = (n: number) => lineBreaks("y".repeat(4 * 20_000), ids(2, n + 1), () => "z".repeat(4 * 11_000));
    expect(fitsJev(wide(5))).toBe(false);
    expect(fitsJev(wide(2))).toBe(true);
  });

  it("does not count question keys, since TypeSafe does not send them to the model", () => {
    const q = () => "q";
    const shortKey = lineBreaks("y".repeat(4 * 31_991 - 2), ["L2"], q);
    const longKey: LineBreaksRequest = { ...shortKey, questions: { ["L" + "9".repeat(200_000)]: shortKey.questions.L2 } };
    expect(fitsJev(longKey)).toBe(true);
  });
});
