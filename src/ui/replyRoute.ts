// Where an agent's reply on a badge lives (KTD2, R4, R14): the badge page while one handoff
// has run, or the handoff item of the agent's latest result once two or more have. Holders,
// the agent page and What needs you open an agent's reply this way.
//
// The way back from one opened take (U5, R16, KTD7) follows the same split but starts from
// the take, not the agent's latest: the badge while one handoff has run, else the handoff
// page of the take's own run. It is worked out each time the view closes, from the folder
// as it is then, so a run that appeared or a take that went while the view was open is
// counted. While the matrix is still building, it goes to the badge.
//
// The way back from a compare (U9, R17, KTD10) is the same page, named by the first of its
// takes still in the folder, with the picks kept and Compare focused.

import { handoffRuns, latestRunId, runIdOf, type Take } from "../domain/handoffResults";
import type { Matrix } from "../domain/matrix";
import { credentialKey, type AgentProfile, type FolderState, type Slug } from "../domain/types";
import type { ItemRoute, ReplyListState, TakeRef } from "./routes";

export function replyRoute(matrix: Matrix, state: FolderState, key: string, profileSlug: Slug): ItemRoute {
  const runId = latestRunId(matrix, profileSlug, key);
  if (runId === null || handoffRuns(matrix, state, key).mode === "single") {
    return { view: "item", item: "badge", credentialKey: key, lit: profileSlug };
  }
  return { view: "item", item: "handoff", credentialKey: key, handoffId: runId, lit: profileSlug };
}

/**
 * A take as the folder holds it now, with its agent, or null when either is gone (KTD7). A
 * take is a result or a held reply; a held reply's reference names its result once it is
 * judged, since the result takes its stem (hold-and-compare KTD3, KTD8).
 */
export function takeOf(state: FolderState, key: string, ref: TakeRef): { profile: AgentProfile; take: Take } | null {
  const profile = state.profiles.find((p) => p.slug === ref.profileSlug);
  const same = (t: Take) => t.profileSlug === ref.profileSlug && t.fileStem === ref.fileStem && credentialKey(t) === key;
  const take: Take | undefined = state.assessments.find(same) ?? state.held.find(same);
  return profile && take ? { profile, take } : null;
}

/** Where closing a take's reply view goes: the page that holds the take now, with the take lit and the picks kept (R16, KTD7). */
export function backFromReply(matrix: Matrix | null, state: FolderState, key: string, take: TakeRef, picks?: TakeRef[]): ItemRoute {
  const kept = keptPicks(picks);
  const found = takeOf(state, key, take);
  // A take or agent that is gone has no row to light; its badge is the way back.
  if (!found) return { view: "item", item: "badge", credentialKey: key, ...kept };
  return pageOf(matrix, state, key, found.take, { lit: take.profileSlug, litTake: take.fileStem, ...kept });
}

/** Where closing the compare goes: the page that lists the takes now, the picks kept and Compare focused (R17, KTD10). With every take gone, the badge. */
export function backFromCompare(matrix: Matrix | null, state: FolderState, key: string, takes: readonly TakeRef[], picks?: TakeRef[]): ItemRoute {
  const back: ReplyListState = { ...keptPicks(picks), focusCompare: true };
  const found = takes.map((t) => takeOf(state, key, t)).find((f) => f !== null);
  return found ? pageOf(matrix, state, key, found.take, back) : { view: "item", item: "badge", credentialKey: key, ...back };
}

const keptPicks = (picks?: TakeRef[]): ReplyListState => (picks && picks.length > 0 ? { picks } : {});

/** The page that lists a take's run: the badge while one handoff has run or the matrix is building, else the run's handoff page. */
function pageOf(matrix: Matrix | null, state: FolderState, key: string, take: Take, back: ReplyListState): ItemRoute {
  if (!matrix || handoffRuns(matrix, state, key).mode === "single") return { view: "item", item: "badge", credentialKey: key, ...back };
  return { view: "item", item: "handoff", credentialKey: key, handoffId: runIdOf(take), ...back };
}
