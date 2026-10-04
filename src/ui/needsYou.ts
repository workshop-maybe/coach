// "What needs you" (KTD7, R8, R18, R19), computed from the matrix and the waiting tests,
// never stored. Most urgent first: replies to paste, held replies to judge, re-tests,
// half-made things, then badges nobody holds. Each plugged agent gets one reply row, and
// each handoff with held replies one held row, even on a badge a reply row names: in a
// bake-off the next agent's test waits on the same badge (hold-and-compare KTD12). Below
// those, each credential appears at most once, at its most urgent item. Every item carries
// the one route its row opens.

import { SKELETON_ID, handoffsFor } from "../domain/handoffs";
import { heldOn, runIdOf } from "../domain/handoffResults";
import type { CellFlag, Matrix } from "../domain/matrix";
import { credentialKey, type FolderState, type Slug } from "../domain/types";
import { livePlugs, plugFor, type PendingTest } from "./pendingTests";
import type { Route, TakeRef } from "./routes";

export type NeedsYouItem =
  | { kind: "reply"; profileSlug: Slug; credentialKey: string; route: Route }
  /** One handoff's held replies, oldest first. `profileSlug` names the agent only when one is held. */
  | { kind: "held"; credentialKey: string; handoffId: string; takes: TakeRef[]; profileSlug?: Slug; route: Route }
  | { kind: "retest"; profileSlug: Slug; credentialKey: string; flags: CellFlag[]; route: Route }
  | { kind: "half-credential"; credentialKey: string; missing: "targets" | "task"; route: Route }
  | { kind: "half-agent"; profileSlug: Slug; route: Route }
  | { kind: "unheld"; credentialKey: string; route: Route };

export function needsYou(state: FolderState, matrix: Matrix, pending: PendingTest[]): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  const seen = new Set<string>();
  const credentials = matrix.columns.flatMap((g) => g.credentials);
  const keys = new Set(credentials.map(credentialKey));

  const live = livePlugs(pending, state).filter((p) => keys.has(p.credentialKey));
  const plugged = new Set<Slug>();
  for (const { profileSlug } of live) {
    if (plugged.has(profileSlug)) continue;
    plugged.add(profileSlug);
    const plug = plugFor(live, profileSlug)!;
    seen.add(plug.credentialKey);
    items.push({
      kind: "reply",
      profileSlug,
      credentialKey: plug.credentialKey,
      route: { view: "deck", deck: "test", profileSlug, credentialKey: plug.credentialKey, resume: true },
    });
  }

  for (const c of credentials) {
    const key = credentialKey(c);
    const held = heldOn(state, key);
    if (held.length === 0) continue;
    seen.add(key);
    const byRun = new Map<string, TakeRef[]>();
    for (const h of held) {
      const id = runIdOf(h);
      byRun.set(id, [...(byRun.get(id) ?? []), { profileSlug: h.profileSlug, fileStem: h.fileStem }]);
    }
    // The skeleton first, then the badge's handoffs in creation order; an id with no file comes last.
    const order = [SKELETON_ID, ...handoffsFor(state, key).map((h) => h.id)];
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    for (const [handoffId, takes] of [...byRun].sort(([a], [b]) => rank(a) - rank(b))) items.push(heldItem(key, handoffId, takes));
  }

  for (const cell of matrix.cells.values()) {
    if (cell.flags.length === 0 || seen.has(cell.credentialKey)) continue;
    seen.add(cell.credentialKey);
    items.push({
      kind: "retest",
      profileSlug: cell.profileSlug,
      credentialKey: cell.credentialKey,
      flags: cell.flags,
      route: { view: "deck", deck: "test", profileSlug: cell.profileSlug, credentialKey: cell.credentialKey },
    });
  }

  for (const c of credentials) {
    const key = credentialKey(c);
    if (seen.has(key)) continue;
    const missing = c.learningTargets.every((t) => t.trim() === "") ? "targets" : c.task.trim() === "" ? "task" : null;
    if (!missing) continue;
    seen.add(key);
    items.push({
      kind: "half-credential",
      credentialKey: key,
      missing,
      route: { view: "deck", deck: "edit-credential", credentialKey: key, part: missing },
    });
  }

  // A held reply is a test the agent took, waiting only on the user's verdict.
  const tested = new Set([...state.assessments, ...state.held].map((t) => t.profileSlug));
  for (const p of state.profiles) {
    if (tested.has(p.slug) || plugged.has(p.slug)) continue;
    items.push({ kind: "half-agent", profileSlug: p.slug, route: { view: "deck", deck: "test", profileSlug: p.slug } });
  }

  for (const c of credentials) {
    const key = credentialKey(c);
    if (seen.has(key) || !matrix.unmetByAnyone.has(key)) continue;
    seen.add(key);
    items.push({ kind: "unheld", credentialKey: key, route: { view: "deck", deck: "test", credentialKey: key } });
  }

  return items;
}

/**
 * A handoff's held row. Two or more open their compare with them all picked, so closing it
 * lands on their page with them ticked; one opens its reply, and its agent draws the row.
 */
function heldItem(key: string, handoffId: string, takes: TakeRef[]): NeedsYouItem {
  if (takes.length === 1) {
    const [take] = takes;
    return { kind: "held", credentialKey: key, handoffId, takes, profileSlug: take.profileSlug, route: { view: "item", item: "reply", credentialKey: key, take } };
  }
  return { kind: "held", credentialKey: key, handoffId, takes, route: { view: "item", item: "compare", credentialKey: key, takes, picks: [...takes] } };
}
