// A badge's go-to (R2, R3, R9, R10): the agent of its newest mark, worked out from the
// folder every time a view draws (KTD3). The newest mark decides alone: when its agent or
// its Met result is no longer in the folder, the badge has no go-to, and an older mark
// never stands in. So a trashed agent stops being the go-to, moving its files back brings
// it back, and a new agent under a reused slug cannot inherit it.

import { cellKey, type CellFlag, type Matrix } from "./matrix";
import { credentialKey, type AgentProfile, type Assessment, type FolderState, type Mark } from "./types";

/** Why a go-to needs a look (KTD4): its latest result there is not Met, or the badge's task or the agent's setup changed since (its cell's flags). */
export type GoToFlag = "not_met" | CellFlag;

export interface GoTo {
  profile: AgentProfile;
  mark: Mark;
  /** The Met result the mark was made on. */
  result: Assessment;
}

/** One agent's result on a badge by its file stem, if the folder still has it. */
export function resultOf(state: FolderState, profileSlug: string, key: string, fileStem: string): Assessment | undefined {
  return state.assessments.find((a) => a.profileSlug === profileSlug && credentialKey(a) === key && a.fileStem === fileStem);
}

/** The badge's go-to, from the folder alone, or null when it has none. */
export function goToOf(state: FolderState, key: string): GoTo | null {
  let mark: Mark | null = null;
  for (const m of state.marks) if (credentialKey(m) === key && (!mark || m.id > mark.id)) mark = m;
  if (!mark) return null;
  const profileSlug = mark.profileSlug;
  const profile = state.profiles.find((p) => p.slug === profileSlug);
  const result = resultOf(state, profileSlug, key, mark.fileStem);
  if (!profile || !result || result.result !== "met") return null;
  return { profile, mark, result };
}

/** How the go-to stands on its badge now, read from its agent's cell: whether it still holds the badge, and its flags, "not met" first and then the cell's own in the matrix's order. */
export function goToStanding(matrix: Matrix, goTo: GoTo): { holds: boolean; flags: GoToFlag[] } {
  const cell = matrix.cells.get(cellKey(goTo.profile.slug, credentialKey(goTo.mark)));
  if (!cell) return { holds: false, flags: [] };
  const holds = cell.status === "met";
  return { holds, flags: holds ? [...cell.flags] : ["not_met", ...cell.flags] };
}
