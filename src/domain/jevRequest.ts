// The two requests the native `jev_ask` command accepts, and what it answers (KTD1, KTD7,
// KTD17; growing context KTD2, KTD3). These mirror the contract at the top of
// src-tauri/src/jev.rs; Rust refuses any other field, question type or key. State and
// instruction keys are TypeSafe's wire names, so backticked references in question text
// (`reply`, `point`, `rubric_notes`, `target`, `task`) resolve against them.

/** The Jev model the native side pins (MODEL in src-tauri/src/jev.rs), and what an answer that names no model reads as. */
export const JEV_MODEL = "jev-1.13.0";

export interface JevCriteria {
  true: string;
  false: string;
}

/**
 * One example on a criteria side: the opening of an earlier reply on the badge, and the
 * user's own note on it when one goes. Kept as two fields so the user's words stay apart
 * from the agent's. Rust holds `reply_opening` to 1–300 characters and `user_reason` to
 * 200 with no line break, and refuses a reason on a point question's true side.
 */
export interface JevExample {
  reply_opening: string;
  user_reason?: string;
}

/** A criteria side: today's string, or the same string as `what` with one or two examples (TypeSafe's structured Noul criteria). */
export type JevCriterion = string | { what: string; examples: JevExample[] };

/** A second-opinion question's criteria. Examples ride only on "p" questions and "overall". */
export interface OpinionCriteria {
  true: JevCriterion;
  false: JevCriterion;
}

/** A criteria side's key. "true" is the side where the point, or the whole bar, holds. */
export type CriteriaSide = keyof OpinionCriteria;

/** One second-opinion question. `target` is set on a "t" question and only there. */
export interface OpinionQuestion {
  type: "noul";
  instructions: string | { point?: string; rubric_notes?: string; target?: string; question: string };
  criteria?: OpinionCriteria;
}

/**
 * A second opinion: one question per rubric point ("p1" … "pN"), one per learning target
 * ("t1" … "tM"), plus "overall".
 */
export interface SecondOpinionRequest {
  kind: "secondOpinion";
  state: {
    task: string;
    rubric_points: string[];
    rubric_notes: string;
    rubric: string;
    /** Trimmed, without blanks or repeats. Empty when the badge has none. */
    learning_targets: string[];
    reply: string;
  };
  questions: Record<string, OpinionQuestion>;
}

/** A line-break cleanup: one question per candidate break, keyed by the id of the line that may continue ("L015"). */
export interface LineBreaksRequest {
  kind: "lineBreaks";
  /** Only the pasted text, each line tagged with its id ("L014| …"). */
  state: string;
  questions: Record<string, { type: "noul"; instructions: string; criteria?: JevCriteria }>;
}

export type JevRequest = SecondOpinionRequest | LineBreaksRequest;

/** Examples by question id and criteria side, each side's in the order they go. */
export type JevExampleMap = Readonly<Record<string, Partial<Record<CriteriaSide, readonly JevExample[]>>>>;

/**
 * One example a second opinion may carry, as the examples step ranks it and the budget
 * step (`fitSecondOpinion` in ./jevBudget) takes it.
 */
export interface JevExampleEntry {
  /** The question it rides on: "p1" … "pN" or "overall". */
  questionId: string;
  /** The side it shows: "true" for a reply judged to meet it, "false" for one that didn't. */
  side: CriteriaSide;
  /** Lower ranks go first and are dropped last. One earlier result keeps one rank across every question. */
  rank: number;
  /** The earlier result it came from, so the request can say how many results it quotes. */
  sourceId: string;
  item: JevExample;
}

/** Every requested id, each a probability from 0 to 1, and the model that answered. Nothing else from TypeSafe. */
export interface JevAnswers {
  answers: Record<string, number>;
  /** The versioned model that answered (KTD3). The native side always sends it; a missing one reads as JEV_MODEL. */
  model?: string;
}

/** The model that gave these answers: the one they name, or the pinned one. */
export function answeringModel(answers: JevAnswers): string {
  return answers.model ?? JEV_MODEL;
}

/** A probability as Jev gives one: a number from 0 to 1 (NaN is not one). */
export function isProbability(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

/** Jev 1.13's per-request limits, as the native side enforces them (KTD19). */
export const JEV_LIMITS = {
  maxQuestions: 256,
  /** Tokens for the state plus the longest question. */
  stateAndLongest: 32_000,
  /** Tokens for the state plus every question. */
  whole: 64_000,
} as const;
