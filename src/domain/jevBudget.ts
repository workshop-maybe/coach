// Jev's budget, checked before every ask (KTD19). The native side checks again with the
// same rule (the doc comment at the top of src-tauri/src/jev.rs), so an ask this lets
// through is never refused there as too long. Tokens are estimated at characters of
// compact JSON over four, taken separately for the state and for each question object.
// A question's key is not counted, since TypeSafe does not send keys to the model.
//
// JS counts UTF-16 units where Rust counts characters, so this check is never looser.

import { JEV_LIMITS, type JevRequest } from "./jevRequest";

/** The token estimate for one value: its compact JSON's length over four, rounded up. */
export function jevTokens(value: unknown): number {
  return Math.ceil((JSON.stringify(value) ?? "").length / 4);
}

/**
 * Whether a state and questions of these token counts fit Jev 1.13's limits: at most 256
 * questions, 32k for the state plus the longest question, 64k for the state plus all of
 * them. For callers that batch questions and measure each one once.
 */
export function fitsTokens(stateTokens: number, questionTokens: readonly number[]): boolean {
  const longest = questionTokens.reduce((max, t) => Math.max(max, t), 0);
  const all = questionTokens.reduce((sum, t) => sum + t, 0);
  return (
    questionTokens.length <= JEV_LIMITS.maxQuestions &&
    stateTokens + longest <= JEV_LIMITS.stateAndLongest &&
    stateTokens + all <= JEV_LIMITS.whole
  );
}

/** Whether a request fits Jev's limits. False is what the UI calls too long. */
export function fitsJev(request: Pick<JevRequest, "state" | "questions">): boolean {
  return fitsTokens(jevTokens(request.state), Object.values(request.questions).map(jevTokens));
}
