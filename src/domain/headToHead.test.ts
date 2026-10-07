import { describe, expect, it } from "vitest";
import { FAKE_ANSWER, FAKE_ON, FakeJev } from "../jev/fakeJev";
import { DEFAULT_CUT_OFFS } from "./calls";
import {
  betterReply,
  FIRST_OVER_CRITERIA,
  FIRST_OVER_QUESTION,
  FIRST_OVER_QUESTION_WITHOUT_NOTES,
  firstOverId,
  headToHeadPoints,
  headToHeadRequest,
  PAIR_UNREAD_CLAUSE,
  SECOND_OVER_CRITERIA,
  SECOND_OVER_QUESTION,
  SECOND_OVER_QUESTION_WITHOUT_NOTES,
  secondOverId,
} from "./headToHead";
import { fitsJev } from "./jevBudget";
import { jevReply } from "./jevReply";
import { POINT_CRITERIA, secondOpinionRequest } from "./secondOpinion";

const pair = (rubric: string, first = "I wrote README.md.", second = "Done, the README is updated.") =>
  headToHeadRequest({ task: "Write the README.", rubric, first, second });

/** The text with `reply_1` and `reply_2` swapped. */
const swapped = (text: string) => text.replace(/reply_[12]/g, (name) => (name === "reply_1" ? "reply_2" : "reply_1"));

describe("headToHeadRequest", () => {
  it("asks a1 to aN, then b1 to bN, one of each per rubric point", () => {
    const req = pair("- One\n- Two\n- Three\n\nMet when every point holds.");
    expect(req?.kind).toBe("headToHead");
    expect(Object.keys(req?.questions ?? {})).toEqual(["a1", "a2", "a3", "b1", "b2", "b3"]);
    expect(firstOverId(0)).toBe("a1");
    expect(firstOverId(9)).toBe("a10");
    expect(secondOverId(0)).toBe("b1");
    expect(secondOverId(9)).toBe("b10");
  });

  it("names the task, the rubric's parts, the learning targets and both replies in strip order, and nothing else", () => {
    const rubric = "Intro line.\n\n- One\n- Two\n\nMet when both hold.";
    const req = headToHeadRequest({
      task: "Write the README.",
      rubric,
      learningTargets: ["I can install it"],
      first: "I wrote README.md.",
      second: "Done.",
    });
    expect(req?.state).toEqual({
      task: "Write the README.",
      rubric_points: ["One", "Two"],
      rubric_notes: "Intro line.\nMet when both hold.",
      rubric,
      learning_targets: ["I can install it"],
      reply_1: "I wrote README.md.",
      reply_2: "Done.",
    });
    expect(Object.keys(req ?? {})).toEqual(["kind", "state", "questions"]);
  });

  it("asks whether each reply covers each point better than the other, with the point's text and the notes", () => {
    const req = pair("- One\n- Two\n\nA rewrite in other words passes.");
    expect(req?.questions.a2).toEqual({
      type: "noul",
      instructions: { point: "Two", rubric_notes: "A rewrite in other words passes.", question: FIRST_OVER_QUESTION },
      criteria: FIRST_OVER_CRITERIA,
    });
    expect(req?.questions.b2).toEqual({
      type: "noul",
      instructions: { point: "Two", rubric_notes: "A rewrite in other words passes.", question: SECOND_OVER_QUESTION },
      criteria: SECOND_OVER_CRITERIA,
    });
    expect(FIRST_OVER_QUESTION).toBe("Does `reply_1` cover `point` better than `reply_2`, read with `rubric_notes`, given `task`?");
    expect(SECOND_OVER_QUESTION).toBe("Does `reply_2` cover `point` better than `reply_1`, read with `rubric_notes`, given `task`?");
  });

  it("leaves the notes out of every question when the rubric has none", () => {
    const req = pair("- One");
    expect(req?.questions.a1.instructions).toEqual({ point: "One", question: FIRST_OVER_QUESTION_WITHOUT_NOTES });
    expect(req?.questions.b1.instructions).toEqual({ point: "One", question: SECOND_OVER_QUESTION_WITHOUT_NOTES });
    expect(FIRST_OVER_QUESTION_WITHOUT_NOTES).toBe("Does `reply_1` cover `point` better than `reply_2`, given `task`?");
    expect(SECOND_OVER_QUESTION_WITHOUT_NOTES).toBe("Does `reply_2` cover `point` better than `reply_1`, given `task`?");
    expect(req?.state.rubric_notes).toBe("");
  });

  it("words the criteria evidence first, as a second opinion's point criteria, so a reply that only claims a point never covers it better (KTD5)", () => {
    expect(FIRST_OVER_CRITERIA).toEqual({
      true: `\`reply_1\` gives more specific, checkable evidence that this point is met than \`reply_2\` does: it names more of the files, commands or output, or shows more of the content. ${PAIR_UNREAD_CLAUSE}`,
      false: `\`reply_2\` gives evidence as strong or stronger, or neither reply addresses this point. ${PAIR_UNREAD_CLAUSE}`,
    });
    expect(FIRST_OVER_CRITERIA.true).toContain("specific, checkable evidence that this point is met");
    expect(POINT_CRITERIA.true).toContain("specific, checkable evidence that this point is met");
    expect(typeof FIRST_OVER_CRITERIA.true).toBe("string");
    expect(typeof FIRST_OVER_CRITERIA.false).toBe("string");
  });

  it("asks the b questions as the a questions with the two replies swapped", () => {
    expect(SECOND_OVER_QUESTION).toBe(swapped(FIRST_OVER_QUESTION));
    expect(SECOND_OVER_QUESTION_WITHOUT_NOTES).toBe(swapped(FIRST_OVER_QUESTION_WITHOUT_NOTES));
    expect(SECOND_OVER_CRITERIA).toEqual({ true: swapped(FIRST_OVER_CRITERIA.true), false: swapped(FIRST_OVER_CRITERIA.false) });
  });

  it("gives every question type noul, structured instructions with no target, and plain string criteria", () => {
    const req = pair("1. One\n2. Two\n3. Three\n\nA rewrite in other words passes.");
    for (const q of Object.values(req?.questions ?? {})) {
      expect(q.type).toBe("noul");
      expect(Object.keys(q.instructions).sort()).toEqual(["point", "question", "rubric_notes"]);
      expect(typeof q.criteria?.true).toBe("string");
      expect(typeof q.criteria?.false).toBe("string");
    }
  });

  it("sends learning targets as a second opinion sends them: trimmed, without blanks or repeats", () => {
    const learningTargets = ["  I can install it ", "", "   ", "I can install it", "I can run it\n", "I can run it"];
    const input = { task: "Write the README.", rubric: "- One", learningTargets };
    const req = headToHeadRequest({ ...input, first: "A.", second: "B." });
    expect(req?.state.learning_targets).toEqual(["I can install it", "I can run it"]);
    expect(req?.state.learning_targets).toEqual(secondOpinionRequest({ ...input, reply: "A." }).state.learning_targets);
    expect(Object.keys(req?.questions ?? {})).toEqual(["a1", "b1"]);
    expect(pair("- One")?.state.learning_targets).toEqual([]);
  });

  it("passes the task, the rubric and both replies through uncleaned, spaces and blank lines and all", () => {
    const req = headToHeadRequest({ task: "  Task\n", rubric: "- One  \n", first: "\n First \n", second: "Second\n\n\n" });
    expect(req?.state).toMatchObject({ task: "  Task\n", rubric: "- One  \n", reply_1: "\n First \n", reply_2: "Second\n\n\n" });
  });

  it("puts each multi-item reply's projection in reply_1 and reply_2, and no other state field (reply-artifacts KTD8)", () => {
    const first = jevReply(
      [
        { kind: "text", text: "Key: \\[2, 1\\] &lt;ok&gt;" },
        { kind: "file", name: "notes.md", ref: "files/file-0000000a.md" },
      ],
      (ref) => (ref === "files/file-0000000a.md" ? "Flags parse." : null),
    );
    const second = jevReply(
      [
        { kind: "text", text: "Ran `a\\_b` and snake\\_case" },
        { kind: "link", url: "https://example.com/run/1" },
      ],
      () => null,
    );
    const req = headToHeadRequest({ task: "T.", rubric: "- One", first, second });
    expect(req?.state.reply_1).toBe("Key: [2, 1] <ok>\n\nFile: notes.md\nFlags parse.");
    expect(req?.state.reply_2).toBe("Ran `a\\_b` and snake_case\n\nA link Jev cannot open: https://example.com/run/1");
    expect(Object.keys(req?.state ?? {}).sort()).toEqual(["learning_targets", "reply_1", "reply_2", "rubric", "rubric_notes", "rubric_points", "task"]);
  });

  it("names unread items as no clear difference on both sides of both orders (KTD9)", () => {
    for (const criteria of [FIRST_OVER_CRITERIA, SECOND_OVER_CRITERIA]) {
      expect(criteria.true).toContain(PAIR_UNREAD_CLAUSE);
      expect(criteria.false).toContain(PAIR_UNREAD_CLAUSE);
    }
  });

  it("is null for a rubric with no points, which has no head-to-head (KTD6)", () => {
    expect(pair("Met when it installs.")).toBeNull();
    expect(pair("")).toBeNull();
    expect(pair("```\n- One\n```")).toBeNull();
  });

  it("fits Jev's budget for an ordinary pair", () => {
    const req = pair("- One\n- Two");
    expect(req).not.toBeNull();
    expect(fitsJev(req!)).toBe(true);
  });
});

describe("headToHeadPoints", () => {
  const rubricPoints = Array.from({ length: 11 }, (_, i) => `Point ${i + 1}`);

  it("puts both orders' answers beside each point's text, in rubric order", () => {
    // Keys arrive in any order; "a10" sorts before "a2" as text.
    const answers = Object.fromEntries(
      rubricPoints.flatMap((_, i) => [
        [firstOverId(i), i / 10],
        [secondOverId(i), 1 - i / 10],
      ]).reverse(),
    );
    expect(headToHeadPoints(rubricPoints, { answers })).toEqual(
      rubricPoints.map((text, i) => ({ text, firstOver: i / 10, secondOver: 1 - i / 10 })),
    );
  });

  it("reads every id FakeJev answers for a built request", async () => {
    const req = pair("- One\n- Two");
    if (!req) throw new Error("a rubric with points has a head-to-head");
    const answers = await new FakeJev(FAKE_ON).ask(req);
    expect(headToHeadPoints(req.state.rubric_points, answers)).toEqual([
      { text: "One", firstOver: FAKE_ANSWER, secondOver: FAKE_ANSWER },
      { text: "Two", firstOver: FAKE_ANSWER, secondOver: FAKE_ANSWER },
    ]);
  });

  it("is null when an answer is missing", () => {
    expect(headToHeadPoints(["One"], { answers: { a1: 0.9 } })).toBeNull();
    expect(headToHeadPoints(["One"], { answers: { b1: 0.9 } })).toBeNull();
    expect(headToHeadPoints(["One", "Two"], { answers: { a1: 0.9, b1: 0.1, a2: 0.5 } })).toBeNull();
  });

  it("is null when an answer is not a probability", () => {
    expect(headToHeadPoints(["One"], { answers: { a1: 0.9, b1: 1.2 } })).toBeNull();
    expect(headToHeadPoints(["One"], { answers: { a1: -0.1, b1: 0.2 } })).toBeNull();
    expect(headToHeadPoints(["One"], { answers: { a1: Number.NaN, b1: 0.2 } })).toBeNull();
    expect(headToHeadPoints(["One"], { answers: { a1: "0.9" as unknown as number, b1: 0.2 } })).toBeNull();
  });
});

describe("betterReply", () => {
  it("covers AE2: 82% and 12% on point 2 read as the first reply covering it better, 75% and 72% on point 1 as no clear difference", () => {
    const read = headToHeadPoints(["One", "Two"], { answers: { a1: 0.75, b1: 0.72, a2: 0.82, b2: 0.12 } });
    expect(read?.map(betterReply)).toEqual([null, "first"]);
  });

  it("covers AE2: 70% and 20% read as no clear difference, since 70 is inside the band", () => {
    expect(betterReply({ firstOver: 0.7, secondOver: 0.2 })).toBeNull();
    expect(betterReply({ firstOver: 0.2, secondOver: 0.7 })).toBeNull();
  });

  it("reads 10% and 90% as the second reply covering it better", () => {
    expect(betterReply({ firstOver: 0.1, secondOver: 0.9 })).toBe("second");
  });

  it("needs both orders to agree, so a lean toward answering yes reads as no clear difference", () => {
    expect(betterReply({ firstOver: 0.9, secondOver: 0.9 })).toBeNull();
    expect(betterReply({ firstOver: 0.1, secondOver: 0.1 })).toBeNull();
    expect(betterReply({ firstOver: 0.9, secondOver: 0.5 })).toBeNull();
  });

  it("rounds both answers to whole percents first, as calls are, against the default band", () => {
    expect(DEFAULT_CUT_OFFS).toEqual({ low: 30, high: 70 });
    expect(betterReply({ firstOver: 0.7051, secondOver: 0.2949 })).toBe("first");
    expect(betterReply({ firstOver: 0.7049, secondOver: 0.1 })).toBeNull();
    expect(betterReply({ firstOver: 0.9, secondOver: 0.2951 })).toBeNull();
    expect(betterReply({ firstOver: 0.2949, secondOver: 0.7051 })).toBe("second");
  });
});
