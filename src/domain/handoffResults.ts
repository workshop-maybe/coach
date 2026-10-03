// A badge's results by the handoff that ran them (KTD1, R1, R2, R5-R7). Each handoff that
// has run gets one entry per agent: its latest result there, with its older takes below.
// The rows come from the matrix, so they use its filter: current agents only, and
// results moved to the trash are already gone from the folder.

import { SKELETON_ID, handoffsFor } from "./handoffs";
import { cellKey, newestFirst, type Matrix } from "./matrix";
import type { AgentProfile, Assessment, FolderState, Slug } from "./types";

export interface AgentReplies {
  profile: AgentProfile;
  latest: Assessment;
  /** The agent's earlier results on this handoff, newest first. */
  older: Assessment[];
}

export interface HandoffRun {
  /** The handoff's id, or SKELETON_ID. */
  id: string;
  /** Newest latest-result first (KTD4). */
  agents: AgentReplies[];
  /** How many of those agents' latest results here are Met. */
  met: number;
}

export interface BadgeRuns {
  /** "single" while zero or one handoff has run, "multi" from two on (R1). */
  mode: "single" | "multi";
  /** The skeleton first, then the badge's handoffs in creation order; an id with no file comes last. */
  runs: HandoffRun[];
}

/** The handoff a result ran, the skeleton for one recorded before handoffs (R2). A reply view goes back to its take's own run (KTD7). */
export function runIdOf(a: Assessment): string {
  return a.handoff?.id ?? SKELETON_ID;
}

export function handoffRuns(matrix: Matrix, state: FolderState, key: string): BadgeRuns {
  // A cell's history is newest first, so each agent's results stay in that order here.
  const byRun = new Map<string, Map<Slug, { profile: AgentProfile; results: Assessment[] }>>();
  for (const profile of matrix.rows) {
    for (const a of matrix.cells.get(cellKey(profile.slug, key))?.history ?? []) {
      const id = runIdOf(a);
      const agents = byRun.get(id) ?? new Map();
      const entry = agents.get(profile.slug) ?? { profile, results: [] };
      entry.results.push(a);
      agents.set(profile.slug, entry);
      byRun.set(id, agents);
    }
  }

  const order = [SKELETON_ID, ...handoffsFor(state, key).map((h) => h.id)];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  const runs = [...byRun.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([id, agents]): HandoffRun => {
      const entries = [...agents.values()]
        .map(({ profile, results: [latest, ...older] }) => ({ profile, latest, older }))
        .sort((x, y) => newestFirst(x.latest, y.latest));
      return { id, agents: entries, met: entries.filter((e) => e.latest.result === "met").length };
    });

  return { mode: runs.length >= 2 ? "multi" : "single", runs };
}

/** The handoff of the agent's latest result on the badge, across all handoffs, or null (R14). */
export function latestRunId(matrix: Matrix, profileSlug: Slug, key: string): string | null {
  const latest = matrix.cells.get(cellKey(profileSlug, key))?.latest;
  return latest ? runIdOf(latest) : null;
}
