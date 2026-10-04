// Jev's budget, checked before every ask (KTD19). The native side checks again with the
// same rule (the doc comment at the top of src-tauri/src/jev.rs), so an ask this lets
// through is never refused there as too long. Tokens are estimated at characters of
// compact JSON over four, taken separately for the state and for each question object.
// A question's key is not counted, since TypeSafe does not send keys to the model.
//
// JS counts UTF-16 units where Rust counts characters, so this check is never looser.
//
// A second opinion's examples are fitted here too (growing context KTD10): whether the
// reply fits with no examples decides "too long", and examples that push it over are
// dropped, never the reply.

import { JEV_LIMITS, type CriteriaSide, type JevExampleEntry, type JevRequest, type SecondOpinionRequest } from "./jevRequest";
import { OVERALL_ID, secondOpinionRequest, withExamples, type SecondOpinionInput } from "./secondOpinion";

/** The most examples one criteria side carries. The native side refuses more. */
export const MAX_EXAMPLES_PER_SIDE = 2;

/** A second opinion that fits Jev's limits, and what it quotes. */
export interface FittedOpinion {
  request: SecondOpinionRequest;
  /** The distinct earlier results its examples quote, best rank first. */
  sources: string[];
  /** Whether any example carries the user's note. */
  withNotes: boolean;
}

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

/**
 * The second opinion for this input that fits Jev's limits, carrying as many of the
 * examples as fit. Each side keeps its two best-ranked examples; one for a target
 * question, or for a question the request doesn't ask, is not sent. While the request is
 * over, one example goes at a time: in the question holding the lowest-priority example
 * left (the earlier question on a tie), the side holding more gives up its lowest-priority
 * one, or with the sides even, that example goes. Null when the reply is too long with no
 * examples at all, which is what the UI calls too long.
 *
 * Questions never hold the reply, so the state is measured once per call and a question
 * again only when a drop changes it.
 */
export function fitSecondOpinion(input: SecondOpinionInput, entries: readonly JevExampleEntry[]): FittedOpinion | null {
  const bare = secondOpinionRequest({ ...input, examples: undefined });
  const ids = Object.keys(bare.questions);
  const takes = new Set(ids.filter((id) => id === OVERALL_ID || id.startsWith("p")));

  const kept = new Map<string, Record<CriteriaSide, JevExampleEntry[]>>();
  for (const entry of [...entries].sort((a, b) => a.rank - b.rank)) {
    if (!takes.has(entry.questionId)) continue;
    const sides = kept.get(entry.questionId) ?? { true: [], false: [] };
    kept.set(entry.questionId, sides);
    if (sides[entry.side].length < MAX_EXAMPLES_PER_SIDE) sides[entry.side].push(entry);
  }
  const question = (id: string) => {
    const sides = kept.get(id);
    return withExamples(bare.questions[id], sides && { true: sides.true.map((e) => e.item), false: sides.false.map((e) => e.item) });
  };

  const stateTokens = jevTokens(bare.state);
  const tokens = ids.map((id) => jevTokens(question(id)));
  while (!fitsTokens(stateTokens, tokens)) {
    const id = dropOne(kept, ids);
    if (id === null) return null;
    tokens[ids.indexOf(id)] = jevTokens(question(id));
  }

  const sent = [...kept.values()].flatMap((sides) => [...sides.true, ...sides.false]).sort((a, b) => a.rank - b.rank);
  return {
    request: { ...bare, questions: Object.fromEntries(ids.map((id) => [id, question(id)])) },
    sources: [...new Set(sent.map((e) => e.sourceId))],
    withNotes: sent.some((e) => !!e.item.user_reason),
  };
}

/** Drops one example by the rule in `fitSecondOpinion` and returns its question's id, or null when none is left. */
function dropOne(kept: Map<string, Record<CriteriaSide, JevExampleEntry[]>>, ids: readonly string[]): string | null {
  // Each side is in rank order, so its last example is its lowest-priority one.
  const last = (list: readonly JevExampleEntry[]) => list[list.length - 1];
  let lowest: { id: string; side: CriteriaSide; rank: number } | null = null;
  for (const id of ids) {
    const sides = kept.get(id);
    if (!sides) continue;
    for (const side of ["true", "false"] as const) {
      const entry = last(sides[side]);
      if (entry && (lowest === null || entry.rank > lowest.rank)) lowest = { id, side, rank: entry.rank };
    }
  }
  if (lowest === null) return null;
  const sides = kept.get(lowest.id)!;
  const other = lowest.side === "true" ? "false" : "true";
  sides[sides[other].length > sides[lowest.side].length ? other : lowest.side].pop();
  return lowest.id;
}
