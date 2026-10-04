import { describe, expect, it } from "vitest";
import { fitsJev } from "./jevBudget";
import { JEV_LIMITS } from "./jevRequest";
import { findPreset, presetCredential } from "./presets";
import {
  isVague,
  OVERALL_CRITERIA,
  OVERALL_ID,
  OVERALL_QUESTION,
  POINT_CRITERIA,
  POINT_QUESTION,
  POINT_QUESTION_WITHOUT_NOTES,
  pointId,
  readingParts,
  rubricParts,
  secondOpinionRequest,
  VAGUE_BAND,
} from "./secondOpinion";
import type { JevReading } from "./types";

const points = (rubric: string) => rubricParts(rubric).points;
const ask = (rubric: string, reply = "Done.") => secondOpinionRequest({ task: "Write the README.", rubric, reply });

describe("rubricParts: points", () => {
  it("covers AE4: three bullets and a closing line make three points and one note", () => {
    const rubric = "- Names the file\n- Shows the command\n- Quotes the output\n\nMet when every point holds.";
    expect(rubricParts(rubric)).toEqual({
      points: ["Names the file", "Shows the command", "Quotes the output"],
      notes: "Met when every point holds.",
    });
  });

  it("ends the list at an unindented line even with no blank line before it", () => {
    // CommonMark would read the line as a lazy continuation of the last item.
    expect(rubricParts("- One\n- Two\n- Three\nMet when every point holds.")).toEqual({
      points: ["One", "Two", "Three"],
      notes: "Met when every point holds.",
    });
  });

  it("takes ordered, plus and star items as points", () => {
    expect(points("1. First\n2) Second\n+ Third\n* Fourth\n10. Tenth")).toEqual(["First", "Second", "Third", "Fourth", "Tenth"]);
  });

  it("folds a nested item into its parent's text, marker and all", () => {
    expect(points("- The install covers:\n  - the Rust toolchain\n  * a prebuilt binary\n- The versions are named")).toEqual([
      "The install covers: - the Rust toolchain * a prebuilt binary",
      "The versions are named",
    ]);
    expect(points("1. Parent\n   1. child\n2. Next")).toEqual(["Parent 1. child", "Next"]);
  });

  it("joins a continuation line to its item", () => {
    expect(points("- The relay listens only\n  locally.\n- Next")).toEqual(["The relay listens only locally.", "Next"]);
  });

  it("joins an indented paragraph after a blank line to its item", () => {
    expect(points("- First\n\n  More about the first.\n- Second")).toEqual(["First More about the first.", "Second"]);
  });

  it("drops task-box prefixes, nested ones included", () => {
    expect(points("- [ ] Open\n- [x] Done\n- [X] Also done\n  - [ ] a child")).toEqual(["Open", "Done", "Also done - a child"]);
  });

  it("finds no points in a list inside a code fence, and no notes either", () => {
    expect(rubricParts("```\n- a\n- b\n```")).toEqual({ points: [], notes: "" });
    expect(rubricParts("Read this:\n~~~md\n- a\n~~~\n- real")).toEqual({ points: ["real"], notes: "Read this:" });
  });

  it("finds no points in a list inside an unclosed fence", () => {
    expect(rubricParts("- before\n```\n- a\n- b")).toEqual({ points: ["before"], notes: "" });
  });

  it("ends an item at a top-level fence and keeps it open across a fence nested under it", () => {
    expect(rubricParts("- a\n```\ncode\n```\nafter")).toEqual({ points: ["a"], notes: "after" });
    expect(points("- a\n  ```\n  code\n  ```\n  more")).toEqual(["a more"]);
  });

  it("finds no points in a rubric with no list, and keeps its lines as notes", () => {
    expect(rubricParts("Met when the reply names the file.\nIt must compile.")).toEqual({
      points: [],
      notes: "Met when the reply names the file.\nIt must compile.",
    });
  });

  it("reads an empty rubric as no points and no notes", () => {
    expect(rubricParts("")).toEqual({ points: [], notes: "" });
  });

  it("drops empty items and thematic breaks", () => {
    expect(rubricParts("- \n- real\n-\n\n* * *\n---\n\nAfter.")).toEqual({ points: ["real"], notes: "After." });
  });

  it("does not take a dash or number without a space after it as an item", () => {
    expect(rubricParts("-not an item\n1.5 litres\n+1 from me")).toEqual({
      points: [],
      notes: "-not an item\n1.5 litres\n+1 from me",
    });
  });

  it("takes a list that starts indented, and a later item at a smaller indent, as points", () => {
    expect(points("  - a\n  - b\n- c")).toEqual(["a", "b", "c"]);
  });

  it("trims note lines and skips blank ones, before and after the list", () => {
    expect(rubricParts("  Intro\n\n- a\n\n   \nOutro  \r\nEnd").notes).toBe("Intro\nOutro\nEnd");
  });
});

describe("secondOpinionRequest", () => {
  it("covers AE4: three point questions plus an overall question", () => {
    const req = ask("- One\n- Two\n- Three\n\nMet when every point holds.");
    expect(req.kind).toBe("secondOpinion");
    expect(Object.keys(req.questions)).toEqual(["p1", "p2", "p3", "overall"]);
  });

  it("names the task, the rubric points, the rubric notes, the full rubric and the reply, and nothing else", () => {
    const rubric = "Intro line.\n\n- One\n- Two\n\nMet when both hold.";
    const req = secondOpinionRequest({ task: "Write the README.", rubric, reply: "I wrote README.md." });
    expect(req.state).toEqual({
      task: "Write the README.",
      rubric_points: ["One", "Two"],
      rubric_notes: "Intro line.\nMet when both hold.",
      rubric,
      reply: "I wrote README.md.",
    });
    expect(Object.keys(req)).toEqual(["kind", "state", "questions"]);
  });

  it("asks each point with its text, the notes and KTD7's literal question", () => {
    const req = ask("- One\n- Two\n\nA rewrite in other words passes.");
    expect(req.questions.p2).toEqual({
      type: "noul",
      instructions: {
        point: "Two",
        rubric_notes: "A rewrite in other words passes.",
        question: "Does `reply` satisfy `point`, read with `rubric_notes`, given `task`?",
      },
      criteria: POINT_CRITERIA,
    });
    expect(POINT_QUESTION).toBe("Does `reply` satisfy `point`, read with `rubric_notes`, given `task`?");
  });

  it("leaves the notes out of a point question when the rubric has none", () => {
    const req = ask("- One");
    expect(req.questions.p1.instructions).toEqual({ point: "One", question: POINT_QUESTION_WITHOUT_NOTES });
    expect(POINT_QUESTION_WITHOUT_NOTES).toBe("Does `reply` satisfy `point`, given `task`?");
    expect(req.state.rubric_notes).toBe("");
  });

  it("gives every question type noul, and every point question KTD7's evidence criteria", () => {
    expect(POINT_CRITERIA).toEqual({
      true: "the reply gives specific, checkable evidence that this point is met: it names the files, commands or output, or shows the content",
      false: "the reply only asserts the point is met in general terms, or does not address it",
    });
    const req = ask("1. One\n2. Two\n3. Three");
    for (const q of Object.values(req.questions)) expect(q.type).toBe("noul");
    for (const id of ["p1", "p2", "p3"]) expect(req.questions[id].criteria).toEqual(POINT_CRITERIA);
  });

  it("asks the overall question over the whole rubric, with evidence criteria for the whole", () => {
    const req = ask("- One");
    expect(req.questions[OVERALL_ID]).toEqual({ type: "noul", instructions: OVERALL_QUESTION, criteria: OVERALL_CRITERIA });
    expect(OVERALL_QUESTION).toBe("Does `reply` satisfy all of `rubric`, given `task`?");
    expect(OVERALL_CRITERIA.true).toMatch(/specific, checkable evidence/);
    expect(OVERALL_CRITERIA.false).toMatch(/only asserts/);
  });

  it("asks only the overall question of a rubric with no list", () => {
    const req = ask("Met when the reply names the file.");
    expect(Object.keys(req.questions)).toEqual(["overall"]);
    expect(req.state.rubric_points).toEqual([]);
  });

  it("numbers questions after empty items are dropped, so the ids match the points", () => {
    const req = ask("- \n- One\n-\n- Two");
    expect(req.state.rubric_points).toEqual(["One", "Two"]);
    expect(Object.keys(req.questions)).toEqual(["p1", "p2", "overall"]);
    expect(pointId(0)).toBe("p1");
    expect(pointId(9)).toBe("p10");
  });

  it("passes the task, rubric and reply through verbatim", () => {
    const req = secondOpinionRequest({ task: "  Task\n", rubric: "- One  \n", reply: "\n Reply \n" });
    expect(req.state).toMatchObject({ task: "  Task\n", rubric: "- One  \n", reply: "\n Reply \n" });
  });

  it("carries both of the SLT-rewrite preset's qualifying lines in every point question", () => {
    const preset = findPreset("tighten-a-learning-target");
    if (!preset) throw new Error("the SLT-rewrite preset is missing");
    const credential = presetCredential(preset, "presets");
    const req = secondOpinionRequest({ task: credential.task, rubric: credential.rubric, reply: "My rewrites." });

    expect(req.state.rubric_points).toHaveLength(5);
    for (const p of req.state.rubric_points) expect(p).toMatch(/^"I can /);
    expect(Object.keys(req.questions)).toEqual(["p1", "p2", "p3", "p4", "p5", "overall"]);
    for (let i = 0; i < 5; i++) {
      const instructions = req.questions[pointId(i)].instructions;
      if (typeof instructions === "string") throw new Error("a point question takes the structured instructions");
      expect(instructions.question).toBe(POINT_QUESTION);
      expect(instructions.rubric_notes).toContain("A rewrite in other words passes when it makes the same cut.");
      expect(instructions.rubric_notes).toContain("Met when all five make the cut and each reason says where the removed detail belongs.");
    }
  });
});

describe("the budget of a second opinion", () => {
  it("fits a short reply", () => {
    expect(fitsJev(ask("- One\n- Two", "I wrote README.md."))).toBe(true);
  });

  it("reports a reply that pushes the estimate over budget as too long", () => {
    expect(fitsJev(ask("- One\n- Two", "x".repeat(4 * JEV_LIMITS.stateAndLongest)))).toBe(false);
  });
});

describe("readingParts", () => {
  const rubricPoints = Array.from({ length: 11 }, (_, i) => `Point ${i + 1}`);

  it("puts each point's probability beside its text, in rubric order, with the overall reading", () => {
    // Keys arrive in any order; "p10" sorts before "p2" as text.
    const answers = Object.fromEntries([["overall", 0.6], ...rubricPoints.map((_, i) => [pointId(i), i / 10])].reverse());
    const parts = readingParts(rubricPoints, { answers });
    expect(parts?.overall).toBe(0.6);
    expect(parts?.points.map((p) => p.text)).toEqual(rubricPoints);
    expect(parts?.points.map((p) => p.probability)).toEqual(rubricPoints.map((_, i) => i / 10));
  });

  it("reads a rubric with no points as the overall reading alone", () => {
    expect(readingParts([], { answers: { overall: 0.9 } })).toEqual({ overall: 0.9, points: [] });
  });

  it("is null when an answer is missing", () => {
    expect(readingParts(["One"], { answers: { overall: 0.9 } })).toBeNull();
    expect(readingParts(["One"], { answers: { p1: 0.9 } })).toBeNull();
  });

  it("is null when an answer is not a probability", () => {
    for (const bad of [1.2, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readingParts(["One"], { answers: { p1: bad, overall: 0.5 } })).toBeNull();
      expect(readingParts(["One"], { answers: { p1: 0.5, overall: bad } })).toBeNull();
    }
    expect(readingParts(["One"], { answers: { p1: "0.5", overall: 0.5 } as unknown as Record<string, number> })).toBeNull();
  });

  it("accepts the ends of the range and ignores ids it did not ask", () => {
    expect(readingParts(["One"], { answers: { p1: 0, overall: 1, p2: 0.5 } })).toEqual({
      overall: 1,
      points: [{ text: "One", probability: 0 }],
    });
  });

  it("leaves the caller to add the rest of a reading", () => {
    const parts = readingParts(["One"], { answers: { p1: 0.9, overall: 0.8 } });
    if (!parts) throw new Error("expected a reading");
    const reading: JevReading = { ...parts, model: "jev-1.13.0", assignmentVersion: "abc123def456", askedAt: "2026-10-03T09:00:00.000Z", seen: "before" };
    expect(reading.points).toEqual([{ text: "One", probability: 0.9 }]);
  });
});

describe("isVague", () => {
  it("is true from 0.30 to 0.70 inclusive, and false outside", () => {
    expect(VAGUE_BAND).toEqual({ min: 0.3, max: 0.7 });
    for (const p of [0.3, 0.52, 0.7]) expect(isVague(p)).toBe(true);
    for (const p of [0.29, 0.71, 0, 1]) expect(isVague(p)).toBe(false);
  });
});
