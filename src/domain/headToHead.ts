// Jev's head-to-head (jev-in-compare U2, KTD5, KTD6): two replies to one handoff compared
// point by point. One request per pair asks, for each rubric point, whether the first
// reply covers it better than the second ("a1" … "aN") and whether the second covers it
// better than the first ("b1" … "bN"). The state holds the badge's task, rubric and
// learning targets and the two replies, with no earlier replies as examples (R3).
//
// A reply covers a point better only when both orders agree beyond the default can't-call
// band (R4): its own question reads above 70% and the other's below 30%, each rounded to a
// whole percent as calls are. Anything else is no clear difference. The band is always
// DEFAULT_CUT_OFFS, never a badge's fitted pair, since a head-to-head has no verdict to fit,
// and the rule is worked out from the saved probabilities every time it is read.

import { callOf, DEFAULT_CUT_OFFS } from "./calls";
import { isProbability, type HeadToHeadRequest, type JevAnswers, type JevCriteria } from "./jevRequest";
import { rubricParts, targetsToSend } from "./secondOpinion";
import type { HeadToHeadPoint } from "./types";

export interface HeadToHeadInput {
  /** The badge's task. */
  task: string;
  /** The badge's rubric, in full. */
  rubric: string;
  /** The badge's learning targets, sent as context only, as a second opinion sends them. */
  learningTargets?: readonly string[];
  /** The reply first in the compare's order, as Jev reads it (`jevReply`, reply-artifacts KTD8), sent as given. */
  first: string;
  /** The reply second in the compare's order, as Jev reads it, sent as given. */
  second: string;
}

/** Which reply covers a point better. */
export type BetterReply = "first" | "second";

/** The question whether the first reply covers a point better. Backticked names are the request's state and instruction keys. */
export const FIRST_OVER_QUESTION = "Does `reply_1` cover `point` better than `reply_2`, read with `rubric_notes`, given `task`?";
/** The first-over-second question when the rubric has no notes. */
export const FIRST_OVER_QUESTION_WITHOUT_NOTES = "Does `reply_1` cover `point` better than `reply_2`, given `task`?";
/** The question whether the second reply covers a point better: the first's, with the replies swapped. */
export const SECOND_OVER_QUESTION = "Does `reply_2` cover `point` better than `reply_1`, read with `rubric_notes`, given `task`?";
/** The second-over-first question when the rubric has no notes. */
export const SECOND_OVER_QUESTION_WITHOUT_NOTES = "Does `reply_2` cover `point` better than `reply_1`, given `task`?";

/**
 * The clause on both sides of every head-to-head criteria (reply-artifacts KTD9): evidence that
 * would sit only in an item a reply names as one Jev can't read is no clear difference. It
 * names neither reply, so the second order's criteria stay the first's with the replies swapped.
 */
export const PAIR_UNREAD_CLAUSE =
  "Neither holds when this point's evidence, in either reply, would sit only in an item that reply names as one Jev cannot see or open";

/** Every first-over-second question's criteria, evidence first as POINT_CRITERIA, so a reply that only claims a point never covers it better. */
export const FIRST_OVER_CRITERIA: JevCriteria = Object.freeze({
  true: `\`reply_1\` gives more specific, checkable evidence that this point is met than \`reply_2\` does: it names more of the files, commands or output, or shows more of the content. ${PAIR_UNREAD_CLAUSE}`,
  false: `\`reply_2\` gives evidence as strong or stronger, or neither reply addresses this point. ${PAIR_UNREAD_CLAUSE}`,
});

/** Every second-over-first question's criteria: the first's, with the replies swapped. */
export const SECOND_OVER_CRITERIA: JevCriteria = Object.freeze({
  true: `\`reply_2\` gives more specific, checkable evidence that this point is met than \`reply_1\` does: it names more of the files, commands or output, or shows more of the content. ${PAIR_UNREAD_CLAUSE}`,
  false: `\`reply_1\` gives evidence as strong or stronger, or neither reply addresses this point. ${PAIR_UNREAD_CLAUSE}`,
});

/** The id asking whether the first reply covers the point at this zero-based index better: "a1" for the first point. */
export function firstOverId(index: number): string {
  return `a${index + 1}`;
}

/** The id asking whether the second reply covers the point at this zero-based index better: "b1" for the first point. */
export function secondOverId(index: number): string {
  return `b${index + 1}`;
}

/**
 * The head-to-head request for two replies: "a1" … "aN", then "b1" … "bN", each naming
 * its point, with the rubric's notes when it has any. Both replies go as `jevReply` built
 * them, as a second opinion sends its reply. Null for a rubric with no points, which has no
 * head-to-head (KTD6).
 */
export function headToHeadRequest({ task, rubric, learningTargets = [], first, second }: HeadToHeadInput): HeadToHeadRequest | null {
  const { points, notes } = rubricParts(rubric);
  if (points.length === 0) return null;
  const ask = (point: string, withNotes: string, withoutNotes: string): HeadToHeadRequest["questions"][string]["instructions"] =>
    notes === "" ? { point, question: withoutNotes } : { point, rubric_notes: notes, question: withNotes };
  const questions: HeadToHeadRequest["questions"] = {};
  points.forEach((point, i) => {
    questions[firstOverId(i)] = {
      type: "noul",
      instructions: ask(point, FIRST_OVER_QUESTION, FIRST_OVER_QUESTION_WITHOUT_NOTES),
      criteria: FIRST_OVER_CRITERIA,
    };
  });
  points.forEach((point, i) => {
    questions[secondOverId(i)] = {
      type: "noul",
      instructions: ask(point, SECOND_OVER_QUESTION, SECOND_OVER_QUESTION_WITHOUT_NOTES),
      criteria: SECOND_OVER_CRITERIA,
    };
  });
  return {
    kind: "headToHead",
    state: {
      task,
      rubric_points: points,
      rubric_notes: notes,
      rubric,
      learning_targets: targetsToSend(learningTargets),
      reply_1: first,
      reply_2: second,
    },
    questions,
  };
}

/**
 * Jev's answers read against the points that were asked (the request's
 * `state.rubric_points`), in order: each point's text with both orders' raw answers. Null
 * when an answer is missing or is not a probability from 0 to 1, which the caller treats
 * as a failed ask.
 */
export function headToHeadPoints(points: readonly string[], { answers }: JevAnswers): HeadToHeadPoint[] | null {
  const read: HeadToHeadPoint[] = [];
  for (const [i, text] of points.entries()) {
    const firstOver = answers[firstOverId(i)];
    const secondOver = answers[secondOverId(i)];
    if (!isProbability(firstOver) || !isProbability(secondOver)) return null;
    read.push({ text, firstOver, secondOver });
  }
  return read;
}

/**
 * Which reply covers a point better, or null for no clear difference (KTD6): the first
 * when its question reads above the default band and the reverse below it, the second for
 * the reverse. `callOf` rounds each to a whole percent first, as every call is.
 */
export function betterReply({ firstOver, secondOver }: Pick<HeadToHeadPoint, "firstOver" | "secondOver">): BetterReply | null {
  const first = callOf(firstOver, DEFAULT_CUT_OFFS);
  const second = callOf(secondOver, DEFAULT_CUT_OFFS);
  if (first === "meets" && second === "misses") return "first";
  if (second === "meets" && first === "misses") return "second";
  return null;
}
