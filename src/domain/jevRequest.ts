// The two requests the native `jev_ask` command accepts, and what it answers (KTD1, KTD7,
// KTD17). These mirror the contract at the top of src-tauri/src/jev.rs; Rust refuses any
// other field, question type or key. State and instruction keys are TypeSafe's wire names,
// so backticked references in question text (`reply`, `point`, `rubric_notes`, `task`)
// resolve against them.

export interface JevCriteria {
  true: string;
  false: string;
}

/** A second opinion: one question per rubric point ("p1" … "pN") plus "overall". */
export interface SecondOpinionRequest {
  kind: "secondOpinion";
  state: {
    task: string;
    rubric_points: string[];
    rubric_notes: string;
    rubric: string;
    reply: string;
  };
  questions: Record<
    string,
    {
      type: "noul";
      instructions: string | { point?: string; rubric_notes?: string; question: string };
      criteria?: JevCriteria;
    }
  >;
}

/** A line-break cleanup: one question per candidate break, keyed by the id of the line that may continue ("L015"). */
export interface LineBreaksRequest {
  kind: "lineBreaks";
  /** Only the pasted text, each line tagged with its id ("L014| …"). */
  state: string;
  questions: Record<string, { type: "noul"; instructions: string; criteria?: JevCriteria }>;
}

export type JevRequest = SecondOpinionRequest | LineBreaksRequest;

/** Every requested id, each a probability from 0 to 1. Nothing else from TypeSafe. */
export interface JevAnswers {
  answers: Record<string, number>;
}

/** Jev 1.13's per-request limits, as the native side enforces them (KTD19). */
export const JEV_LIMITS = {
  maxQuestions: 256,
  /** Tokens for the state plus the longest question. */
  stateAndLongest: 32_000,
  /** Tokens for the state plus every question. */
  whole: 64_000,
} as const;
