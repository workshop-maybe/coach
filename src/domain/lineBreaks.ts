// Jev's cleanup of a terminal paste (KTD17): the requests that ask Jev about each line
// break that may be a terminal's wrap, and the joins its answers decide. Jev only answers
// join or keep; the app makes the edits, so the reply's words and their order never change
// (R19). Every request carries the whole paste as its state, each line tagged with its id
// ("L014| …"), and asks one Noul per candidate, keyed by the id of the line that may
// continue the one before it. Candidates are batched so each request fits Jev's budget
// (KTD19), the batches go one at a time, and a rate-limited or overloaded batch waits and
// retries. The result is all or nothing: a batch that still fails fails the cleanup.

import { JevError, toJevError } from "../jev/jev";
import { fitsTokens, jevTokens } from "./jevBudget";
import { isProbability, type JevAnswers, type JevCriteria, type LineBreaksRequest } from "./jevRequest";
import { scanLines } from "./markdownLines";
import { findJoinCandidates } from "./pasteText";

/** A break joins at this probability or above after a line with no terminal punctuation. Tunable. */
export const JOIN_AFTER_OPEN = 0.2;
/** A break joins at this probability or above after a line ending in terminal punctuation. Tunable. */
export const JOIN_AFTER_STOP = 0.5;

/** How many times a rate-limited or overloaded batch is tried again before the cleanup fails. */
export const LINE_BREAK_RETRIES = 3;
/** The first wait before a retry without a Retry-After; each later wait doubles it. */
export const BACKOFF_MS = 1000;
/**
 * The longest a batch waits before a retry. Next is disabled while a cleanup runs, so a
 * longer Retry-After fails the cleanup at once with its retryable line instead. Tunable.
 */
export const MAX_WAIT_MS = 30_000;

/** Every question's criteria, as TypeSafe's autoformat cookbook words them. */
export const LINE_BREAK_CRITERIA: JevCriteria = Object.freeze({
  true: "The line starts in the middle of a sentence that began on the previous line - the line break tore the sentence apart",
  false: "The line begins a new sentence, item, heading, or thought of its own",
});

/** The question about the break between line `first` and line `second`, by their ids. */
export function lineBreakQuestion(first: string, second: string): string {
  return `Does line ${second} pick up mid-sentence, continuing a sentence left unfinished at the end of line ${first}?`;
}

/** The paste as every request's state: each line, verbatim, after its id ("L014| …"). */
export function lineBreakState(text: string): string {
  const lines = scanLines(text);
  return lines.map((line, i) => `${lineId(i, lines.length)}| ${line.text}`).join("\n");
}

/**
 * The requests that ask about every candidate break in the text, in order, each within
 * Jev's limits. Empty when there are no candidates. Null when the text is too long for
 * Jev to be asked about even one break.
 */
export function lineBreakBatches(text: string): LineBreaksRequest[] | null {
  const count = scanLines(text).length;
  const state = lineBreakState(text);
  const stateTokens = jevTokens(state);
  const batches: LineBreaksRequest[] = [];
  let questions: LineBreaksRequest["questions"] = {};
  let tokens: number[] = [];
  for (const { first, second } of findJoinCandidates(text)) {
    const question = { type: "noul" as const, instructions: lineBreakQuestion(lineId(first, count), lineId(second, count)), criteria: LINE_BREAK_CRITERIA };
    const cost = jevTokens(question);
    if (!fitsTokens(stateTokens, [...tokens, cost])) {
      if (tokens.length === 0) return null;
      batches.push({ kind: "lineBreaks", state, questions });
      questions = {};
      tokens = [];
      if (!fitsTokens(stateTokens, [cost])) return null;
    }
    questions[lineId(second, count)] = question;
    tokens.push(cost);
  }
  if (tokens.length > 0) batches.push({ kind: "lineBreaks", state, questions });
  return batches;
}

/**
 * The text with each candidate break that Jev's answer calls a wrap joined: the two lines
 * become one, with one space between them and the second line's indent dropped. Answers
 * are keyed by the second line's id; a break with no answer is kept, and an answer about
 * a line that is no candidate is ignored. Only whitespace changes.
 */
export function joinLines(text: string, answers: Record<string, number>): { text: string; joined: number } {
  const lines = scanLines(text);
  const joins = new Set(
    findJoinCandidates(text)
      .filter(({ first, second }) => {
        const p = answers[lineId(second, lines.length)];
        return typeof p === "number" && p >= cutOffAfter(lines[first].text);
      })
      .map(({ second }) => second),
  );
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (joins.has(i)) out[out.length - 1] = `${out[out.length - 1].trimEnd()} ${line.text.trimStart()}`;
    else out.push(line.text);
  });
  return { text: out.join("\n"), joined: joins.size };
}

export interface LineBreakOptions {
  /** Waits this many milliseconds before a retry. Defaults to a timer; tests pass one that doesn't sleep. */
  wait?(ms: number): Promise<void>;
  /** Checked before each ask and after each answer or wait: true stops the cleanup, which then resolves to null. */
  cancelled?(): boolean;
}

/**
 * Sends the batches one at a time and gathers every answer. A rate-limited or overloaded
 * batch waits for its Retry-After, or backs off exponentially without one, and is tried
 * again up to `LINE_BREAK_RETRIES` times; a wait past `MAX_WAIT_MS` fails at once. Rejects with the JevError that ends it, or with
 * kind "other" for an answer that misses an id or is not a probability. Null once cancelled.
 */
export async function askLineBreaks(
  batches: readonly LineBreaksRequest[],
  ask: (request: LineBreaksRequest) => Promise<JevAnswers>,
  { wait = sleep, cancelled = () => false }: LineBreakOptions = {},
): Promise<Record<string, number> | null> {
  const answers: Record<string, number> = {};
  for (const batch of batches) {
    for (let retry = 0; ; retry++) {
      if (cancelled()) return null;
      let got: JevAnswers;
      try {
        got = await ask(batch);
      } catch (e) {
        const error = toJevError(e);
        const busy = error.kind === "rateLimited" || error.kind === "overloaded";
        const ms = error.retryAfter !== null ? error.retryAfter * 1000 : BACKOFF_MS * 2 ** retry;
        if (!busy || retry >= LINE_BREAK_RETRIES || ms > MAX_WAIT_MS) throw error;
        await wait(ms);
        continue;
      }
      if (cancelled()) return null;
      for (const id of Object.keys(batch.questions)) {
        const p = (got?.answers as Record<string, unknown> | undefined)?.[id];
        if (!isProbability(p)) throw new JevError("other");
        answers[id] = p;
      }
      break;
    }
  }
  return answers;
}

/**
 * Asks Jev about every candidate break in the text and joins the ones it calls wraps.
 * Asks nothing when there are none. Rejects as "tooLong", asking nothing, when the text is
 * over Jev's budget, and with whatever ends a batch otherwise; either way nothing is
 * joined. Null once cancelled.
 */
export async function cleanUpLineBreaks(
  text: string,
  ask: (request: LineBreaksRequest) => Promise<JevAnswers>,
  options: LineBreakOptions = {},
): Promise<{ text: string; joined: number } | null> {
  const batches = lineBreakBatches(text);
  if (batches === null) throw new JevError("tooLong");
  if (batches.length === 0) return { text, joined: 0 };
  const answers = await askLineBreaks(batches, ask, options);
  return answers && joinLines(text, answers);
}

// ---------------------------------------------------------------------------

/** Terminal punctuation at a line's end, then any closing quotes or brackets. */
const TERMINAL_PUNCTUATION = /[.!?:;…]["'”’»)\]}]*$/;

/** The probability at or above which the break after this line joins. */
function cutOffAfter(line: string): number {
  return TERMINAL_PUNCTUATION.test(line.trimEnd()) ? JOIN_AFTER_STOP : JOIN_AFTER_OPEN;
}

/** The id of the line at this zero-based index: "L" and its number, padded to the line count's digits and at least three. */
function lineId(index: number, count: number): string {
  return `L${String(index + 1).padStart(Math.max(3, String(count).length), "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
