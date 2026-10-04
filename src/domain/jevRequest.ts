// The four requests the native `jev_ask` command accepts, a second opinion, a head-to-head,
// a line-break cleanup and a routing ask, and what it answers (KTD1, KTD7, KTD17; growing
// context KTD2, KTD3; jev-in-compare KTD5; router KTD1, KTD3, KTD7). These mirror the
// contract at the top of src-tauri/src/jev.rs; Rust refuses any other field, question type
// or key. State and instruction keys are TypeSafe's wire names, so backticked references in
// question text (`reply`, `reply_1`, `reply_2`, `point`, `rubric_notes`, `target`, `task`,
// `job`, `badge`) resolve against them.

/** The Jev model the native side pins (MODEL in src-tauri/src/jev.rs), and what an answer that names no model reads as. */
export const JEV_MODEL = "jev-1.13.0";

// The sizes and the line breaks the native side holds a second opinion's examples to, so
// every web-side module that builds or trims one reads the same numbers as Rust.

/** The most examples one criteria side carries (MAX_EXAMPLES_PER_SIDE in src-tauri/src/jev.rs). */
export const MAX_EXAMPLES_PER_SIDE = 2;
/** The longest `reply_opening`, in code points (MAX_OPENING_CHARS in src-tauri/src/jev.rs). */
export const MAX_OPENING_CHARS = 300;
/** The longest `user_reason`, in code points (MAX_REASON_CHARS in src-tauri/src/jev.rs). */
export const MAX_REASON_CHARS = 200;
/** The line breaks Rust refuses in a reason (`is_line_break` in src-tauri/src/jev.rs), a CRLF read as one. */
export const LINE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/;

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

/**
 * A head-to-head: two replies to one handoff, in the compare's order, asked for each rubric
 * point whether `reply_1` covers it better than `reply_2` ("a1" … "aN") and the reverse
 * ("b1" … "bN"). Rust holds each question's `point` to `rubric_points[i-1]`, and its
 * criteria to plain strings: no examples, no target.
 */
export interface HeadToHeadRequest {
  kind: "headToHead";
  state: {
    task: string;
    /** At least one: a rubric with no points has no head-to-head. */
    rubric_points: string[];
    rubric_notes: string;
    rubric: string;
    /** Trimmed, without blanks or repeats, as a second opinion sends them. Empty when the badge has none. */
    learning_targets: string[];
    reply_1: string;
    reply_2: string;
  };
  questions: Record<string, { type: "noul"; instructions: { point: string; rubric_notes?: string; question: string }; criteria?: JevCriteria }>;
}

/**
 * One match question, under an "m" id: does the `job` ask for the same kind of work as the
 * `badge`? The badge has no field for its rubric, and the criteria are strings only.
 */
export interface MatchQuestion {
  type: "noul";
  instructions: {
    badge: { name: string; task: string; learning_targets: string[] };
    question: string;
  };
  criteria?: JevCriteria;
}

/**
 * The job's difficulty: TypeSafe's Score, the one question that isn't a Noul, allowed under
 * "difficulty" in a route and nowhere else. Three levels in order (routine, needs judgment,
 * unusual or high-stakes). Rust holds the instructions and each level to 300 code points.
 */
export interface DifficultyQuestion {
  type: "score";
  instructions: string;
  criteria: readonly [string, string, string];
}

/**
 * A routing ask: one match question per badge ("m1" … "mN", N at least 1, no gaps), plus
 * "difficulty" at most once. Badges ride in their own questions, never in the state.
 */
export interface RouteRequest {
  kind: "route";
  state: { job: string };
  questions: Record<string, MatchQuestion | DifficultyQuestion>;
}

export type JevRequest = SecondOpinionRequest | HeadToHeadRequest | LineBreaksRequest | RouteRequest;

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

/** Every requested id, and the model that answered. Nothing else from TypeSafe. */
export interface JevAnswers {
  /** Each Noul id, a probability from 0 to 1. */
  answers: Record<string, number>;
  /**
   * Each Score id ("difficulty"), its three level probabilities in the order asked, summing
   * to 1. Absent when the request asked no Score, as for every second opinion and cleanup.
   */
  levels?: Record<string, number[]>;
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
