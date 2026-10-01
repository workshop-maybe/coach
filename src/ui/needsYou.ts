// "What needs you" (KTD7, R8, R18, R19), computed from the matrix and the waiting tests,
// never stored. Most urgent first: replies to paste, re-tests, half-made things, then
// badges nobody holds. Each plugged agent gets one reply row. Below the replies, each
// credential appears at most once, at its most urgent item. Every item carries the one
// route its row opens.

import type { CellFlag, Matrix } from "../domain/matrix";
import { credentialKey, type FolderState, type Slug } from "../domain/types";
import { livePlugs, plugFor, type PendingTest } from "./pendingTests";
import type { Route } from "./routes";

export type NeedsYouItem =
  | { kind: "reply"; profileSlug: Slug; credentialKey: string; route: Route }
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

  const tested = new Set(state.assessments.map((a) => a.profileSlug));
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
