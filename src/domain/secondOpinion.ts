// Jev's second opinion (KTD7–KTD9): a badge's rubric split into points, the request that
// asks Jev about each point and about the whole rubric, and Jev's answers read back.
//
// A point is a top-level list item (`-`, `*`, `+` or ordered). Nested items and indented
// lines fold into it, task boxes are dropped, and fenced code is skipped. The rest of the
// rubric, such as "A rewrite in other words passes" or "Met when every point holds", is
// its notes, and reaches every point question beside the point (R12). Unlike CommonMark,
// an unindented line right after an item ends the list instead of continuing the item, so
// a closing line with no blank line before it still reads as a note.

import { isProbability, type JevAnswers, type JevCriteria, type SecondOpinionRequest } from "./jevRequest";
import { scanLines } from "./markdownLines";
import type { JevPoint, JevReading } from "./types";

export interface RubricParts {
  /** Top-level list items, in order, each as one line of text. */
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
}

/** The question for each point. Backticked names are the request's state and instruction keys. */
export const POINT_QUESTION = "Does `reply` satisfy `point`, read with `rubric_notes`, given `task`?";
/** The point question when the rubric has no notes. */
export const POINT_QUESTION_WITHOUT_NOTES = "Does `reply` satisfy `point`, given `task`?";
/** The question over the whole rubric. */
export const OVERALL_QUESTION = "Does `reply` satisfy all of `rubric`, given `task`?";

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

/** The overall question's id. */
export const OVERALL_ID = "overall";

/** A probability in this band, ends included, is one Jev can't call (KTD9). Tunable. */
export const VAGUE_BAND = Object.freeze({ min: 0.3, max: 0.7 });

/** The question id for the point at this zero-based index: "p1" for the first. */
export function pointId(index: number): string {
  return `p${index + 1}`;
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
 * The request for Jev's second opinion: one question per rubric point ("p1" … "pN") plus
 * one overall. The state holds only the task, the rubric and the reply (R5).
 */
export function secondOpinionRequest({ task, rubric, reply }: SecondOpinionInput): SecondOpinionRequest {
  const { points, notes } = rubricParts(rubric);
  const questions: SecondOpinionRequest["questions"] = {};
  points.forEach((point, i) => {
    questions[pointId(i)] = {
      type: "noul",
      instructions: notes === "" ? { point, question: POINT_QUESTION_WITHOUT_NOTES } : { point, rubric_notes: notes, question: POINT_QUESTION },
      criteria: POINT_CRITERIA,
    };
  });
  questions[OVERALL_ID] = { type: "noul", instructions: OVERALL_QUESTION, criteria: OVERALL_CRITERIA };
  return { kind: "secondOpinion", state: { task, rubric_points: points, rubric_notes: notes, rubric, reply }, questions };
}

/** The part of a reading that comes from Jev's answers. */
export type JevReadingParts = Pick<JevReading, "overall" | "points">;

/**
 * Jev's answers read against the points that were asked (the request's
 * `state.rubric_points`), in rubric order, with the overall reading. Null when an answer
 * is missing or is not a probability from 0 to 1, which the caller treats as a failed ask.
 * The caller completes the reading: `{ ...parts, model, assignmentVersion, askedAt, seen }`,
 * plus `verdictWhenSeen` and `verdictChanged` when seen "after".
 */
export function readingParts(points: readonly string[], { answers }: JevAnswers): JevReadingParts | null {
  const overall = answers[OVERALL_ID];
  if (!isProbability(overall)) return null;
  const read: JevPoint[] = [];
  for (const [i, text] of points.entries()) {
    const probability = answers[pointId(i)];
    if (!isProbability(probability)) return null;
    read.push({ text, probability });
  }
  return { overall, points: read };
}

/** Whether Jev can't call this probability either way: a point to sharpen in the bar (R11). */
export function isVague(probability: number): boolean {
  return probability >= VAGUE_BAND.min && probability <= VAGUE_BAND.max;
}

// ---------------------------------------------------------------------------

/** A list marker, with its content when the line has any. */
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
/** Three or more of one of `-`, `*`, `_`, spaced or not: a rule, not an item. */
const THEMATIC_BREAK = /^([-*_])(?:[ \t]*\1){2,}$/;
const TASK_BOX = /^\[[ xX]\](?:[ \t]+|$)/;

function dropTaskBox(content: string): string {
  return content.replace(TASK_BOX, "").trim();
}

/** Adds the item's text to the points unless it is empty, and closes the item. */
function finish(item: { parts: string[] } | null, points: string[]): null {
  const text = item?.parts.filter((p) => p !== "").join(" ") ?? "";
  if (text !== "") points.push(text);
  return null;
}

