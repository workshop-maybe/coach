// Where an agent's reply on a badge lives (KTD2, R4, R14): the badge page while one handoff
// has run, or the handoff item of the agent's latest result once two or more have. Holders,
// the agent page and What needs you open an agent's reply this way.
//
// The way back from one opened take (U5, R16, KTD7) follows the same split but starts from
// the take, not the agent's latest: the badge while one handoff has run, else the handoff
// page of the take's own run. It is worked out each time the view closes, from the folder
// as it is then, so a run that appeared or a take that went while the view was open is
// counted. While the matrix is still building, it goes to the badge.

import { handoffRuns, latestRunId, runIdOf } from "../domain/handoffResults";
import type { Matrix } from "../domain/matrix";
import { credentialKey, type AgentProfile, type Assessment, type FolderState, type Slug } from "../domain/types";
import type { ItemRoute, ReplyListState, TakeRef } from "./routes";

export function replyRoute(matrix: Matrix, state: FolderState, key: string, profileSlug: Slug): ItemRoute {
  const runId = latestRunId(matrix, profileSlug, key);
  if (runId === null || handoffRuns(matrix, state, key).mode === "single") {
    return { view: "item", item: "badge", credentialKey: key, lit: profileSlug };
  }
  return { view: "item", item: "handoff", credentialKey: key, handoffId: runId, lit: profileSlug };
}

/** A take as the folder holds it now, with its agent, or null when either is gone (KTD7). */
export function takeOf(state: FolderState, key: string, take: TakeRef): { profile: AgentProfile; result: Assessment } | null {
  const profile = state.profiles.find((p) => p.slug === take.profileSlug);
  const result = state.assessments.find((a) => a.profileSlug === take.profileSlug && a.fileStem === take.fileStem && credentialKey(a) === key);
  return profile && result ? { profile, result } : null;
}

/** Where closing a take's reply view goes: the page that holds the take now, with the take lit and the picks kept (R16, KTD7). */
export function backFromReply(matrix: Matrix | null, state: FolderState, key: string, take: TakeRef, picks?: TakeRef[]): ItemRoute {
  const kept: ReplyListState = picks && picks.length > 0 ? { picks } : {};
  const found = takeOf(state, key, take);
  // A take or agent that is gone has no row to light; its badge is the way back.
  if (!found) return { view: "item", item: "badge", credentialKey: key, ...kept };
  const back: ReplyListState = { lit: take.profileSlug, litTake: take.fileStem, ...kept };
  if (!matrix || handoffRuns(matrix, state, key).mode === "single") return { view: "item", item: "badge", credentialKey: key, ...back };
  return { view: "item", item: "handoff", credentialKey: key, handoffId: runIdOf(found.result), ...back };
}
