// A badge's replies by the handoff that ran them (KTD1, R1, R2, R5-R7). Each handoff that
// has run gets one entry per agent: its latest take there, with its older takes below. A
// take is a result or a reply held without a verdict (hold-and-compare KTD7, KTD8), so a
// handoff has run once it has either. The rows are the matrix's agents and badges, so they
// use its filter: current agents only, on badges whose collection is in the folder. The
// takes themselves come from the folder state, which an apply() updates a render before
// the matrix does, so a take never drops out of a mounted list while the matrix rebuilds.

import { SKELETON_ID, handoffsFor } from "./handoffs";
import { cellKey, type Matrix } from "./matrix";
import { credentialKey, type AgentProfile, type Assessment, type FolderState, type HeldReply, type Slug } from "./types";

/** One of an agent's replies on a badge: a result, or a reply held without a verdict. */
export type Take = Assessment | HeldReply;

/** A take with no verdict yet. */
export function isHeld(t: Take): t is HeldReply {
  return !("result" in t);
}

/** When the take's reply came back: a result's recorded time, a held reply's held time. */
export function takeTime(t: Take): string {
  return isHeld(t) ? t.heldAt : t.recordedAt;
}

/** Newest first: time descending, then file stem descending, as results sort in the matrix. */
export function takesNewestFirst(a: Take, b: Take): number {
  const ta = Date.parse(takeTime(a));
  const tb = Date.parse(takeTime(b));
  if (ta !== tb) return tb - ta;
  return a.fileStem < b.fileStem ? 1 : a.fileStem > b.fileStem ? -1 : 0;
}

export interface AgentReplies {
  profile: AgentProfile;
  latest: Take;
  /** The agent's earlier takes on this handoff, newest first. */
  older: Take[];
}

export interface HandoffRun {
  /** The handoff's id, or SKELETON_ID. */
  id: string;
  /** Newest latest take first (KTD4). */
  agents: AgentReplies[];
  /** How many of those agents' latest results here are Met. Held replies are skipped. */
  met: number;
  /** How many replies here are still held. */
  held: number;
}

export interface BadgeRuns {
  /** "single" while zero or one handoff has run, "multi" from two on (R1). */
  mode: "single" | "multi";
  /** The skeleton first, then the badge's handoffs in creation order; an id with no file comes last. */
  runs: HandoffRun[];
}

/** The handoff a take ran, the skeleton for one recorded before handoffs (R2). A reply view goes back to its take's own run (KTD7). */
export function runIdOf(t: Take): string {
  return t.handoff?.id ?? SKELETON_ID;
}

/** A badge's replies still held, from agents still in the folder, oldest first. */
export function heldOn(state: FolderState, key: string): HeldReply[] {
  const agents = new Set(state.profiles.map((p) => p.slug));
  return state.held.filter((h) => credentialKey(h) === key && agents.has(h.profileSlug)).sort((a, b) => takesNewestFirst(b, a));
}

export function handoffRuns(matrix: Matrix, state: FolderState, key: string): BadgeRuns {
  const shown = matrix.columns.some((g) => g.credentials.some((c) => credentialKey(c) === key));
  const rows = new Map(matrix.rows.map((p) => [p.slug, p]));
  const takes: Take[] = shown ? [...state.assessments, ...state.held].filter((t) => credentialKey(t) === key && rows.has(t.profileSlug)) : [];

  const byRun = new Map<string, Map<Slug, { profile: AgentProfile; takes: Take[] }>>();
  for (const t of takes) {
    const id = runIdOf(t);
    const agents = byRun.get(id) ?? new Map();
    const entry = agents.get(t.profileSlug) ?? { profile: rows.get(t.profileSlug)!, takes: [] };
    entry.takes.push(t);
    agents.set(t.profileSlug, entry);
    byRun.set(id, agents);
  }

  const order = [SKELETON_ID, ...handoffsFor(state, key).map((h) => h.id)];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  const runs = [...byRun.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([id, agents]): HandoffRun => {
      const entries = [...agents.values()]
        .map(({ profile, takes: own }) => {
          const [latest, ...older] = [...own].sort(takesNewestFirst);
          return { profile, latest, older };
        })
        .sort((x, y) => takesNewestFirst(x.latest, y.latest));
      const met = entries.filter((e) => latestResult(e)?.result === "met").length;
      const held = entries.reduce((n, e) => n + [e.latest, ...e.older].filter(isHeld).length, 0);
      return { id, agents: entries, met, held };
    });

  return { mode: runs.length >= 2 ? "multi" : "single", runs };
}

/** An agent's newest result among its takes on a run, held replies skipped. */
function latestResult(e: AgentReplies): Assessment | undefined {
  return [e.latest, ...e.older].find((t): t is Assessment => !isHeld(t));
}

/** The handoff of the agent's latest result on the badge, across all handoffs, or null (R14). */
export function latestRunId(matrix: Matrix, profileSlug: Slug, key: string): string | null {
  const latest = matrix.cells.get(cellKey(profileSlug, key))?.latest;
  return latest ? runIdOf(latest) : null;
}
