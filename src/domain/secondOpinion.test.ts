import { describe, expect, it } from "vitest";
import { FAKE_ANSWER, FAKE_ON, FakeJev } from "../jev/fakeJev";
import { BUILT_INS } from "./builtins";
import { parseCredentialMd } from "./credential-md";
import { fitsJev } from "./jevBudget";
import { answeringModel, JEV_LIMITS, JEV_MODEL, type JevExample } from "./jevRequest";
import {
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
  TARGET_CRITERIA,
  TARGET_QUESTION,
  targetId,
  tappedPoints,
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

  it("keeps a point whose text repeats an earlier point's once, in its first place", () => {
    expect(rubricParts("1. Holds.\n2. Wrong.\n3. Holds.\n\nMet when all hold.")).toEqual({ points: ["Holds.", "Wrong."], notes: "Met when all hold." });
    expect(Object.keys(ask("- Holds.\n- Wrong.\n- Holds.").questions)).toEqual(["p1", "p2", "overall"]);
    expect(tappedPoints(points("- Holds.\n- Wrong.\n- Holds."), ["Holds."])).toEqual(["Holds."]);
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
  it("sends the reply as a reader sees it, without the reply box's escapes, fenced code as written", () => {
    const reply = "Key: \\[2, 1\\], a\\_b &amp; c\n```\n\\[x\\]\n```";
    expect(ask("- One", reply).state.reply).toBe("Key: [2, 1], a_b & c\n```\n\\[x\\]\n```");
  });

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
      learning_targets: [],
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

  it("carries both of the SLT-rewrite badge's qualifying lines in every point question", () => {
    const markdown = BUILT_INS.find((b) => b.slug === "course-authoring")?.credentials["tighten-a-learning-target"];
    if (markdown === undefined) throw new Error("the built-in SLT-rewrite badge is missing");
    const credential = parseCredentialMd(markdown, { slug: "tighten-a-learning-target", collectionSlug: "course-authoring" });
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

describe("secondOpinionRequest: learning targets", () => {
  const withTargets = (learningTargets: string[], rubric = "- One\n- Two\n- Three\n- Four") =>
    secondOpinionRequest({ task: "Write the README.", rubric, reply: "Done.", learningTargets });

  it("covers AE1: three targets and four points ask p1 to p4, t1 to t3 and overall", () => {
    const req = withTargets(["I can install it", "I can run it", "I can test it"]);
    expect(Object.keys(req.questions)).toEqual(["p1", "p2", "p3", "p4", "t1", "t2", "t3", "overall"]);
    expect(req.state.learning_targets).toEqual(["I can install it", "I can run it", "I can test it"]);
  });

  it("asks each target with its text, the directional question and string criteria", () => {
    const req = withTargets(["I can install it", "I can run it"]);
    expect(req.questions.t2).toEqual({
      type: "noul",
      instructions: { target: "I can run it", question: TARGET_QUESTION },
      criteria: TARGET_CRITERIA,
    });
    expect(TARGET_QUESTION).toBe("Does `reply` show the work `target` describes, given `task`?");
    expect(typeof TARGET_CRITERIA.true).toBe("string");
    expect(typeof TARGET_CRITERIA.false).toBe("string");
    expect(targetId(0)).toBe("t1");
    expect(targetId(9)).toBe("t10");
  });

  it("sends targets trimmed, without blanks or repeats, numbered after the drops (KTD12)", () => {
    const req = withTargets(["  I can install it ", "", "   ", "I can install it", "I can run it\n", "I can run it"]);
    expect(req.state.learning_targets).toEqual(["I can install it", "I can run it"]);
    expect(Object.keys(req.questions)).toEqual(["p1", "p2", "p3", "p4", "t1", "t2", "overall"]);
  });

  it("sends an empty list and no target questions when there are no targets", () => {
    expect(withTargets([]).state.learning_targets).toEqual([]);
    expect(Object.keys(withTargets([]).questions)).toEqual(["p1", "p2", "p3", "p4", "overall"]);
    expect(ask("- One").state.learning_targets).toEqual([]);
  });

  it("asks the targets of a rubric with no list beside the overall question", () => {
    expect(Object.keys(withTargets(["I can install it"], "Met when it installs.").questions)).toEqual(["t1", "overall"]);
  });
});

describe("secondOpinionRequest: examples", () => {
  const yes: JevExample = { reply_opening: "I added README.md with an install section." };
  const no: JevExample = { reply_opening: "Done, the README is updated.", user_reason: "names no file" };
  const two = (examples: Parameters<typeof secondOpinionRequest>[0]["examples"]) =>
    secondOpinionRequest({ task: "Write the README.", rubric: "- One\n- Two", reply: "Done.", learningTargets: ["I can install it"], examples });

  it("turns each side with examples into what and examples, and leaves a side with none as its string", () => {
    const req = two({ p1: { true: [yes], false: [no] }, p2: { true: [yes] } });
    expect(req.questions.p1.criteria).toEqual({
      true: { what: POINT_CRITERIA.true, examples: [yes] },
      false: { what: POINT_CRITERIA.false, examples: [no] },
    });
    expect(req.questions.p2.criteria).toEqual({ true: { what: POINT_CRITERIA.true, examples: [yes] }, false: POINT_CRITERIA.false });
  });

  it("keeps today's criteria on a question with no examples, so a badge with no history sends today's request plus targets", () => {
    const req = two({ p1: { true: [yes] } });
    expect(req.questions.p2.criteria).toBe(POINT_CRITERIA);
    expect(two({ p1: { true: [], false: [] } }).questions.p1.criteria).toBe(POINT_CRITERIA);
    expect(two(undefined)).toEqual(two({}));
    expect(two({}).questions.overall).toEqual({ type: "noul", instructions: OVERALL_QUESTION, criteria: OVERALL_CRITERIA });
  });

  it("puts examples on the overall question, a reason on either side", () => {
    const reasoned = { ...yes, user_reason: "shows the install command" };
    const req = two({ overall: { true: [reasoned, yes], false: [no] } });
    expect(req.questions.overall.criteria).toEqual({
      true: { what: OVERALL_CRITERIA.true, examples: [reasoned, yes] },
      false: { what: OVERALL_CRITERIA.false, examples: [no] },
    });
  });

  it("never puts examples on a target question, and makes no question for an id it did not ask", () => {
    const req = two({ t1: { true: [yes] }, p3: { true: [yes] }, L002: { false: [no] } });
    expect(req.questions.t1.criteria).toBe(TARGET_CRITERIA);
    expect(Object.keys(req.questions)).toEqual(["p1", "p2", "t1", "overall"]);
  });

  it("never puts examples in the state", () => {
    const req = two({ p1: { true: [yes] } });
    expect(Object.keys(req.state)).toEqual(["task", "rubric_points", "rubric_notes", "rubric", "learning_targets", "reply"]);
    expect(JSON.stringify(req.state)).not.toContain(yes.reply_opening);
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
    expect(readingParts([], { answers: { overall: 0.9 } })).toEqual({ overall: 0.9, points: [], targets: [] });
  });

  it("puts each target's probability beside its text, in order", () => {
    const parts = readingParts(["One"], { answers: { p1: 0.9, t1: 0.2, t2: 0.7, overall: 0.8 } }, ["I can install it", "I can run it"]);
    expect(parts).toEqual({
      overall: 0.8,
      points: [{ text: "One", probability: 0.9 }],
      targets: [
        { text: "I can install it", probability: 0.2 },
        { text: "I can run it", probability: 0.7 },
      ],
    });
  });

  it("is null when a target's answer is missing or is not a probability, as for a point (KTD12)", () => {
    expect(readingParts(["One"], { answers: { p1: 0.9, overall: 0.8 } }, ["I can install it"])).toBeNull();
    expect(readingParts(["One"], { answers: { p1: 0.9, t1: 1.5, overall: 0.8 } }, ["I can install it"])).toBeNull();
    expect(readingParts([], { answers: { t1: 0.4, overall: 0.8 } }, ["I can install it", "I can run it"])).toBeNull();
  });

  it("reads every id FakeJev answers for a request with targets, with the pinned model", async () => {
    const req = secondOpinionRequest({ task: "Write the README.", rubric: "- One\n- Two", reply: "Done.", learningTargets: ["I can install it"] });
    const answers = await new FakeJev(FAKE_ON).ask(req);
    expect(answeringModel(answers)).toBe(JEV_MODEL);
    expect(answers.model).toBe("jev-1.13.0");
    expect(readingParts(req.state.rubric_points, answers, req.state.learning_targets)).toEqual({
      overall: FAKE_ANSWER,
      points: [
        { text: "One", probability: FAKE_ANSWER },
        { text: "Two", probability: FAKE_ANSWER },
      ],
      targets: [{ text: "I can install it", probability: FAKE_ANSWER }],
    });
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
    expect(readingParts(["One"], { answers: { p1: 0, overall: 1, p2: 0.5, t1: 0.5 } })).toEqual({
      overall: 1,
      points: [{ text: "One", probability: 0 }],
      targets: [],
    });
  });

  it("leaves the caller to add the rest of a reading", () => {
    const parts = readingParts(["One"], { answers: { p1: 0.9, overall: 0.8 } });
    if (!parts) throw new Error("expected a reading");
    const reading: JevReading = { ...parts, model: "jev-1.13.0", assignmentVersion: "abc123def456", askedAt: "2026-10-03T09:00:00.000Z", seen: "before" };
    expect(reading.points).toEqual([{ text: "One", probability: 0.9 }]);
  });
});

describe("answeringModel", () => {
  it("is the model the answer names, or the pinned one when it names none (KTD3)", () => {
    expect(JEV_MODEL).toBe("jev-1.13.0");
    expect(answeringModel({ answers: {}, model: "jev-1.14.0" })).toBe("jev-1.14.0");
    expect(answeringModel({ answers: {} })).toBe(JEV_MODEL);
  });
});
