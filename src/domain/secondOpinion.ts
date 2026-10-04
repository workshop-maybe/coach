// Jev's second opinion (KTD7–KTD9): a badge's rubric split into points, the request that
// asks Jev about each point, each learning target and the whole rubric, and Jev's answers
// read back. Examples of the user's own judged replies ride inside the point and overall
// questions' criteria, never in the state, so each question sees only its own (growing
// context KTD2).
//
// A point is a top-level list item (`-`, `*`, `+` or ordered). Nested items and indented
// lines fold into it, task boxes are dropped, and fenced code is skipped. A point whose text
// repeats an earlier point's counts once, in its first place, as a repeated learning target
// does: both would ask Jev the same question, and missed points are kept by text. The rest of the
// rubric, such as "A rewrite in other words passes" or "Met when every point holds", is
// its notes, and reaches every point question beside the point (R12). Unlike CommonMark,
// an unindented line right after an item ends the list instead of continuing the item, so
// a closing line with no blank line before it still reads as a note.

import {
  isProbability,
  type CriteriaSide,
  type JevAnswers,
  type JevCriteria,
  type JevExample,
  type JevExampleMap,
  type OpinionCriteria,
  type OpinionQuestion,
  type SecondOpinionRequest,
} from "./jevRequest";
import { scanLines } from "./markdownLines";
import type { JevPoint, JevReading } from "./types";

export interface RubricParts {
  /** Top-level list items, in order, each as one line of text, each text once. */
  points: string[];
  /** Non-blank lines outside the list and outside fences, trimmed, joined with newlines. */
  notes: string;
}

export interface SecondOpinionInput {
  /** The badge's task. */
  task: string;
  /** The badge's rubric, in full. */
  rubric: string;
  /** The agent's reply. */
  reply: string;
  /** The badge's learning targets. Sent trimmed, without blanks or repeats (KTD12). */
  learningTargets?: readonly string[];
  /** Examples for the point and overall questions, by id and side. A side with none keeps its plain criteria. */
  examples?: JevExampleMap;
}

/** The question for each point. Backticked names are the request's state and instruction keys. */
export const POINT_QUESTION = "Does `reply` satisfy `point`, read with `rubric_notes`, given `task`?";
/** The point question when the rubric has no notes. */
export const POINT_QUESTION_WITHOUT_NOTES = "Does `reply` satisfy `point`, given `task`?";
/** The question over the whole rubric. */
export const OVERALL_QUESTION = "Does `reply` satisfy all of `rubric`, given `task`?";
/** The question for each learning target. */
export const TARGET_QUESTION = "Does `reply` show the work `target` describes, given `task`?";

/** Every point question's criteria. Without them, a reply that claims it is done reads high (KTD7). */
export const POINT_CRITERIA: JevCriteria = Object.freeze({
  true: "the reply gives specific, checkable evidence that this point is met: it names the files, commands or output, or shows the content",
  false: "the reply only asserts the point is met in general terms, or does not address it",
});

/** The overall question's criteria: the point criteria, for the whole rubric. */
export const OVERALL_CRITERIA: JevCriteria = Object.freeze({
  true: "the reply gives specific, checkable evidence that the rubric is met as a whole: it names the files, commands or output, or shows the content",
  false: "the reply only asserts the rubric is met in general terms, or does not address it",
});

/** Every target question's criteria: the point criteria, for the work a target describes. */
export const TARGET_CRITERIA: JevCriteria = Object.freeze({
  true: "the reply gives specific, checkable evidence of the work this target describes: it names the files, commands or output, or shows the content",
  false: "the reply only asserts this work in general terms, or does not show it",
});

/** The overall question's id. */
export const OVERALL_ID = "overall";

/** The question id for the point at this zero-based index: "p1" for the first. */
export function pointId(index: number): string {
  return `p${index + 1}`;
}

/** The question id for the learning target at this zero-based index: "t1" for the first. */
export function targetId(index: number): string {
  return `t${index + 1}`;
}

/** The tapped points that are among `points`, once each, in rubric order. Anything else tapped is dropped. */
export function tappedPoints(points: readonly string[], tapped: readonly string[]): string[] {
  const picked = new Set(tapped);
  return points.filter((point, i) => picked.has(point) && points.indexOf(point) === i);
}

/**
 * The saved entry for a point, found by its text: the first of `saved` with the same text.
 * A rubric's points are distinct (`rubricParts`), so the text finds one point, also in a
 * reading or head-to-head saved before a repeated point counted once.
 */
export function savedPointOf<T extends { text: string }>(saved: readonly T[] | null | undefined, point: string): T | undefined {
  return saved?.find((s) => s.text === point);
}

/** The rubric's points and notes. A rubric with no list has no points. */
export function rubricParts(rubric: string): RubricParts {
  const points: string[] = [];
  const notes: string[] = [];
  /** The open top-level item: its marker's indent and its text so far. */
  let item: { indent: number; parts: string[] } | null = null;

  for (const line of scanLines(rubric)) {
    if (line.inFence) continue;
    // A nested item or an indented line belongs to the open item.
    const nested = item !== null && line.indent > item.indent;
    if (line.fence) {
      // A fence at the top level ends the list. One nested under an item leaves it open.
      if (!nested) item = finish(item, points);
      continue;
    }
    const text = line.text.trim();
    if (text === "") continue;
    if (THEMATIC_BREAK.test(text)) {
      item = finish(item, points);
      continue;
    }
    const m = LIST_ITEM.exec(text);
    const content = m ? dropTaskBox((m[2] ?? "").trim()) : text;
    if (item !== null && nested) {
      if (content !== "") item.parts.push(m ? `${m[1]} ${content}` : content);
    } else if (m) {
      finish(item, points);
      item = { indent: line.indent, parts: [content] };
    } else {
      item = finish(item, points);
      notes.push(text);
    }
  }
  finish(item, points);
  return { points, notes: notes.join("\n") };
}

/**
 * The request for Jev's second opinion: one question per rubric point ("p1" … "pN"), one
 * per learning target ("t1" … "tM"), plus one overall. The state holds only the task, the
 * rubric, the learning targets and the reply (R5). Examples go on the point and overall
 * questions they are keyed to; one keyed to any other id is not sent.
 */
export function secondOpinionRequest({ task, rubric, reply, learningTargets = [], examples = {} }: SecondOpinionInput): SecondOpinionRequest {
  const { points, notes } = rubricParts(rubric);
  const targets = targetsToSend(learningTargets);
  const questions: SecondOpinionRequest["questions"] = {};
  points.forEach((point, i) => {
    const id = pointId(i);
    questions[id] = withExamples(
      {
        type: "noul",
        instructions: notes === "" ? { point, question: POINT_QUESTION_WITHOUT_NOTES } : { point, rubric_notes: notes, question: POINT_QUESTION },
        criteria: POINT_CRITERIA,
      },
      examples[id],
    );
  });
  targets.forEach((target, i) => {
    questions[targetId(i)] = { type: "noul", instructions: { target, question: TARGET_QUESTION }, criteria: TARGET_CRITERIA };
  });
  questions[OVERALL_ID] = withExamples({ type: "noul", instructions: OVERALL_QUESTION, criteria: OVERALL_CRITERIA }, examples[OVERALL_ID]);
  return {
    kind: "secondOpinion",
    state: { task, rubric_points: points, rubric_notes: notes, rubric, learning_targets: targets, reply },
    questions,
  };
}

/**
 * The question with each side that has examples turned into `{ what, examples }`, where
 * `what` is the side's plain criteria. With no examples on either side it is the question
 * as given, so a badge with no history sends today's criteria.
 */
export function withExamples(question: OpinionQuestion, examples: Partial<Record<CriteriaSide, readonly JevExample[]>> | undefined): OpinionQuestion {
  const yes = examples?.true ?? [];
  const no = examples?.false ?? [];
  const criteria = question.criteria;
  if (!criteria || (yes.length === 0 && no.length === 0)) return question;
  return { ...question, criteria: { true: side(criteria.true, yes), false: side(criteria.false, no) } };
}

/** The part of a reading that comes from Jev's answers. */
export type JevReadingParts = Pick<JevReading, "overall" | "points"> & { targets: JevPoint[] };

/**
 * Jev's answers read against the points and learning targets that were asked (the
 * request's `state.rubric_points` and `state.learning_targets`), each in order, with the
 * overall reading. Null when an answer is missing or is not a probability from 0 to 1,
 * which the caller treats as a failed ask (KTD12). The caller completes the reading:
 * `{ ...parts, model, assignmentVersion, askedAt, seen }`, plus `verdictWhenSeen` and
 * `verdictChanged` when seen "after".
 */
export function readingParts(points: readonly string[], { answers }: JevAnswers, targets: readonly string[] = []): JevReadingParts | null {
  const overall = answers[OVERALL_ID];
  if (!isProbability(overall)) return null;
  const readPoints = probabilities(answers, points, pointId);
  const readTargets = probabilities(answers, targets, targetId);
  if (!readPoints || !readTargets) return null;
  return { overall, points: readPoints, targets: readTargets };
}

// ---------------------------------------------------------------------------

/** A list marker, with its content when the line has any. */
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
/** Three or more of one of `-`, `*`, `_`, spaced or not: a rule, not an item. */
const THEMATIC_BREAK = /^([-*_])(?:[ \t]*\1){2,}$/;
const TASK_BOX = /^\[[ xX]\](?:[ \t]+|$)/;

/** The targets as sent: each trimmed, blanks and repeats dropped, in order (KTD12). */
export function targetsToSend(targets: readonly string[]): string[] {
  return [...new Set(targets.map((t) => t.trim()).filter((t) => t !== ""))];
}

/** A criteria side with these examples, or the side unchanged when there are none. */
function side(what: OpinionCriteria[CriteriaSide], examples: readonly JevExample[]): OpinionCriteria[CriteriaSide] {
  if (examples.length === 0) return what;
  return { what: typeof what === "string" ? what : what.what, examples: [...examples] };
}

/** Each text beside the answer for its id, in order, or null when one is missing or not a probability. */
function probabilities(answers: Record<string, number>, texts: readonly string[], id: (index: number) => string): JevPoint[] | null {
  const read: JevPoint[] = [];
  for (const [i, text] of texts.entries()) {
    const probability = answers[id(i)];
    if (!isProbability(probability)) return null;
    read.push({ text, probability });
  }
  return read;
}

function dropTaskBox(content: string): string {
  return content.replace(TASK_BOX, "").trim();
}

/** Adds the item's text to the points unless it is empty or already a point, and closes the item. */
function finish(item: { parts: string[] } | null, points: string[]): null {
  const text = item?.parts.filter((p) => p !== "").join(" ") ?? "";
  if (text !== "" && !points.includes(text)) points.push(text);
  return null;
}

