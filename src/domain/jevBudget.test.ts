import { describe, expect, it } from "vitest";
import { fitSecondOpinion, fitsJev, fitsTokens, jevTokens } from "./jevBudget";
import {
  JEV_LIMITS,
  type HeadToHeadRequest,
  type JevExample,
  type JevExampleEntry,
  type JevExampleMap,
  type LineBreaksRequest,
  type SecondOpinionRequest,
} from "./jevRequest";
import { secondOpinionRequest, type SecondOpinionInput } from "./secondOpinion";

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

// The native side's budget test for a second opinion with examples uses this same request,
// written out the same way, so the two checks refuse it at the same reply length.
function withExamples(replyLength: number, examples = true): SecondOpinionRequest {
  return {
    kind: "secondOpinion",
    state: {
      task: "Write the README",
      rubric_points: ["Point 1"],
      rubric_notes: "",
      rubric: "- Point 1",
      learning_targets: ["Target 1"],
      reply: "y".repeat(replyLength),
    },
    questions: {
      p1: {
        type: "noul",
        instructions: { point: "Point 1", question: "q" },
        criteria: examples
          ? {
              true: { what: "w", examples: [{ reply_opening: "o".repeat(300) }, { reply_opening: "o".repeat(300) }] },
              false: { what: "w", examples: [{ reply_opening: "n".repeat(300), user_reason: "r".repeat(200) }] },
            }
          : { true: "w", false: "w" },
      },
      t1: { type: "noul", instructions: { target: "Target 1", question: "q" }, criteria: { true: "w", false: "w" } },
      overall: { type: "noul", instructions: "q" },
    },
  };
}

describe("fitsJev: a second opinion's examples", () => {
  it("counts example text, refusing at the same reply length as the native check", () => {
    // p1 is 1,325 characters of JSON, 332 tokens; the state is 137 characters plus the reply.
    expect(jevTokens(withExamples(0).questions.p1)).toBe(332);
    expect(fitsJev(withExamples(126_535))).toBe(true);
    expect(fitsJev(withExamples(126_536))).toBe(false);
    expect(fitsJev(withExamples(126_536, false))).toBe(true);
  });
});

// The native side's budget test for a head-to-head uses this same request
// (`pair_for_budget` in src-tauri/src/jev.rs), so the two checks refuse it at the same
// reply length.
function pairForBudget(replyLength: number): HeadToHeadRequest {
  const question = { type: "noul" as const, instructions: { point: "Point 1", question: "q" }, criteria: { true: "w", false: "w" } };
  return {
    kind: "headToHead",
    state: {
      task: "Write the README",
      rubric_points: ["Point 1"],
      rubric_notes: "",
      rubric: "- Point 1",
      learning_targets: ["Target 1"],
      reply_1: "y".repeat(replyLength),
      reply_2: "z".repeat(replyLength),
    },
    questions: { a1: question, b1: question },
  };
}

describe("fitsJev: a head-to-head's two replies", () => {
  it("counts both replies in the state, refusing at the same reply length as the native check", () => {
    // Each question is 101 characters of JSON, 26 tokens; the state is 152 characters plus
    // both replies. Each reply alone is about half the 32k, so only the two together pass it.
    expect(jevTokens(pairForBudget(0).questions.a1)).toBe(26);
    expect(jevTokens(pairForBudget(0).state)).toBe(38);
    expect(fitsJev(pairForBudget(63_872))).toBe(true);
    expect(fitsJev(pairForBudget(63_873))).toBe(false);
  });
});

describe("fitSecondOpinion", () => {
  const input: SecondOpinionInput = { task: "Write the README.", rubric: "- One\n- Two", reply: "Done.", learningTargets: ["I can install it"] };
  const opening = (who: string): JevExample => ({ reply_opening: `${who}: ${"I wrote README.md and ran the install. ".repeat(7)}`.slice(0, 300) });
  const entry = (sourceId: string, rank: number, questionId: string, side: "true" | "false", item = opening(sourceId)): JevExampleEntry => ({
    questionId,
    side,
    rank,
    sourceId,
    item,
  });
  /** Who each side of a question quotes, by the name its opening starts with. */
  const examplesOf = (request: SecondOpinionRequest | undefined, id: string) => {
    const criteria = request?.questions[id].criteria;
    const side = (s: unknown) => (typeof s === "string" ? [] : (s as { examples: JevExample[] }).examples.map((e) => e.reply_opening.split(":")[0]));
    return { true: side(criteria?.true), false: side(criteria?.false) };
  };
  /** A reply just long enough that the state plus this question is Jev's 32k, to the token. */
  const replyFilling = (question: unknown, base: SecondOpinionInput = input) => {
    const overhead = JSON.stringify(secondOpinionRequest({ ...base, reply: "" }).state).length;
    return "y".repeat(4 * (JEV_LIMITS.stateAndLongest - jevTokens(question)) - overhead);
  };
  const p1With = (examples: JevExampleMap) => secondOpinionRequest({ ...input, examples }).questions.p1;

  it("sends every example when the request fits, and names the results quoted in rank order", () => {
    const entries = [entry("B", 1, "p1", "true"), entry("A", 0, "p1", "true"), entry("A", 0, "overall", "true"), entry("C", 2, "overall", "false")];
    const fitted = fitSecondOpinion(input, entries);
    expect(fitted?.request).toEqual(
      secondOpinionRequest({
        ...input,
        examples: { p1: { true: [opening("A"), opening("B")] }, overall: { true: [opening("A")], false: [opening("C")] } },
      }),
    );
    expect(fitted?.sources).toEqual(["A", "B", "C"]);
    expect(fitted?.withNotes).toBe(false);
  });

  it("sends today's request plus targets when there are no examples", () => {
    expect(fitSecondOpinion(input, [])).toEqual({ request: secondOpinionRequest(input), sources: [], withNotes: false });
  });

  it("says whether a note goes with the examples", () => {
    const noted = entry("C", 2, "overall", "false", { ...opening("C"), user_reason: "skips the rollback" });
    expect(fitSecondOpinion(input, [entry("A", 0, "p1", "true"), noted])?.withNotes).toBe(true);
  });

  it("covers AE7: drops the lowest-priority example first, from the side of its question holding more", () => {
    // A and B say point 1 holds, C says it doesn't. C ranks lowest, but the side holding
    // more gives up its lowest first, so B goes before C, and C before A.
    const entries = [entry("A", 0, "p1", "true"), entry("B", 1, "p1", "true"), entry("C", 2, "p1", "false")];
    const afterOne = p1With({ p1: { true: [opening("A")], false: [opening("C")] } });
    const afterTwo = p1With({ p1: { true: [opening("A")] } });

    const one = fitSecondOpinion({ ...input, reply: replyFilling(afterOne) }, entries);
    expect(examplesOf(one?.request, "p1")).toEqual({ true: ["A"], false: ["C"] });
    expect(one?.sources).toEqual(["A", "C"]);

    const two = fitSecondOpinion({ ...input, reply: replyFilling(afterTwo) }, entries);
    expect(examplesOf(two?.request, "p1")).toEqual({ true: ["A"], false: [] });
    expect(two?.sources).toEqual(["A"]);
  });

  it("covers AE7: never cuts the reply, and drops every example before a reply that fits alone goes too long", () => {
    const entries = [entry("A", 0, "p1", "true"), entry("B", 1, "p1", "false")];
    const longest = Object.values(secondOpinionRequest(input).questions).reduce((a, b) => (jevTokens(b) > jevTokens(a) ? b : a));
    const reply = replyFilling(longest);
    const bare = fitSecondOpinion({ ...input, reply }, entries);
    expect(bare?.request.state.reply).toBe(reply);
    expect(bare?.request).toEqual(secondOpinionRequest({ ...input, reply }));
    expect(bare?.sources).toEqual([]);
  });

  it("covers AE7: is null when the reply alone is too long, examples or not", () => {
    const reply = "x".repeat(4 * JEV_LIMITS.stateAndLongest);
    expect(fitSecondOpinion({ ...input, reply }, [entry("A", 0, "p1", "true")])).toBeNull();
    expect(fitSecondOpinion({ ...input, reply }, [])).toBeNull();
    expect(fitsJev(secondOpinionRequest({ ...input, reply }))).toBe(false);
  });

  it("measures the reply alone with the targets' questions in it", () => {
    const targets = Array.from({ length: JEV_LIMITS.maxQuestions }, (_, i) => `Target ${i + 1}`);
    expect(fitSecondOpinion({ ...input, learningTargets: targets }, [])).toBeNull();
  });

  it("breaks a tie in rank across questions by dropping from the earlier question first", () => {
    const base: SecondOpinionInput = { ...input, learningTargets: [] };
    const entries = [entry("A", 0, "overall", "true"), entry("A", 0, "p1", "true")];
    const keepsOverall = secondOpinionRequest({ ...base, examples: { overall: { true: [opening("A")] } } });
    const keepsP1 = secondOpinionRequest({ ...base, examples: { p1: { true: [opening("A")] } } });
    // With A on both, p1 is the longest question, so one drop is needed whichever goes.
    expect(jevTokens(keepsP1.questions.p1)).toBeGreaterThan(jevTokens(keepsOverall.questions.overall));
    const fitted = fitSecondOpinion({ ...base, reply: replyFilling(keepsOverall.questions.overall, base) }, entries);
    expect(examplesOf(fitted?.request, "p1")).toEqual({ true: [], false: [] });
    expect(examplesOf(fitted?.request, "overall")).toEqual({ true: ["A"], false: [] });
    expect(fitted?.sources).toEqual(["A"]);
  });

  it("keeps the two best-ranked examples on a side, and counts only what goes", () => {
    const entries = [entry("C", 2, "p1", "true"), entry("A", 0, "p1", "true"), entry("B", 1, "p1", "true")];
    const fitted = fitSecondOpinion(input, entries);
    expect(examplesOf(fitted?.request, "p1")).toEqual({ true: ["A", "B"], false: [] });
    expect(fitted?.sources).toEqual(["A", "B"]);
  });

  it("ignores examples for a target question or a question it did not ask", () => {
    const entries = [entry("A", 0, "t1", "true"), entry("B", 1, "p3", "false"), entry("C", 2, "L002", "true")];
    expect(fitSecondOpinion(input, entries)).toEqual({ request: secondOpinionRequest(input), sources: [], withNotes: false });
  });
});
