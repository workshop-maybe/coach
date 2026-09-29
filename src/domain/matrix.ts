// The agent × credential matrix (R17-R19). Each cell takes its status from the
// latest assessment and gains flags when that result no longer matches the
// current assignment version or the profile's current setup.

import { assignmentVersion } from "./hash";
import {
  credentialKey,
  type AgentProfile,
  type AgentSetup,
  type Assessment,
  type Collection,
  type Credential,
  type FolderState,
  type Slug,
} from "./types";

export type CellStatus = "untested" | "met" | "not_met";

export type CellFlag = "earlier_version" | "setup_mismatch";

export const FLAG_REASONS: Record<CellFlag, string> = {
  earlier_version: "Tested against an earlier version of the assignment",
  setup_mismatch: "Agent setup changed since this result",
};

export interface Cell {
  profileSlug: Slug;
  credentialKey: string;
  status: CellStatus;
  /** In flowchart order: earlier_version before setup_mismatch. */
  flags: CellFlag[];
  latest: Assessment | null;
  /** Every assessment for this cell, newest first. */
  history: Assessment[];
}

export interface Matrix {
  rows: AgentProfile[];
  columns: { collection: Collection; credentials: Credential[] }[];
  /** Keyed by cellKey(profileSlug, credentialKey). */
  cells: Map<string, Cell>;
  /** Credential keys that no current profile's latest result meets (R19). */
  unmetByAnyone: Set<string>;
}

export function cellKey(profileSlug: Slug, credentialKey: string): string {
  return `${profileSlug}|${credentialKey}`;
}

/** Newest first: recorded time descending, then file stem descending. */
function newestFirst(a: Assessment, b: Assessment): number {
  const ta = Date.parse(a.recordedAt);
  const tb = Date.parse(b.recordedAt);
  if (ta !== tb) return tb - ta;
  return a.fileStem < b.fileStem ? 1 : a.fileStem > b.fileStem ? -1 : 0;
}

function sameSetup(a: AgentSetup, b: AgentSetup): boolean {
  return a.harness === b.harness && a.model === b.model && a.effort === b.effort;
}

export async function buildMatrix(state: FolderState): Promise<Matrix> {
  const rows = state.profiles;

  // Credentials whose collection is missing have nowhere to show, so they are left out.
  const columns = state.collections.map((collection) => ({
    collection,
    credentials: state.credentials.filter((c) => c.collectionSlug === collection.slug),
  }));
  const shown = columns.flatMap((g) => g.credentials);

  const versions = new Map<string, string>();
  await Promise.all(
    shown.map(async (c) => versions.set(credentialKey(c), await assignmentVersion(c.task, c.rubric))),
  );

  // Group assessments by cell. Orphans (no matching profile or credential) are ignored.
  const profileSlugs = new Set(rows.map((p) => p.slug));
  const byCell = new Map<string, Assessment[]>();
  for (const a of state.assessments) {
    const key = credentialKey(a);
    if (!profileSlugs.has(a.profileSlug) || !versions.has(key)) continue;
    const k = cellKey(a.profileSlug, key);
    const list = byCell.get(k);
    if (list) list.push(a);
    else byCell.set(k, [a]);
  }

  const cells = new Map<string, Cell>();
  const metByAnyone = new Set<string>();
  for (const profile of rows) {
    for (const credential of shown) {
      const key = credentialKey(credential);
      const k = cellKey(profile.slug, key);
      const history = (byCell.get(k) ?? []).slice().sort(newestFirst);
      const latest = history[0] ?? null;
      const flags: CellFlag[] = [];
      if (latest) {
        if (latest.assignmentVersion !== versions.get(key)) flags.push("earlier_version");
        if (!sameSetup(latest.setup, profile)) flags.push("setup_mismatch");
        // A flagged met still counts as met (Assumptions).
        if (latest.result === "met") metByAnyone.add(key);
      }
      cells.set(k, {
        profileSlug: profile.slug,
        credentialKey: key,
        status: latest ? latest.result : "untested",
        flags,
        latest,
        history,
      });
    }
  }

  const unmetByAnyone = new Set(shown.map(credentialKey).filter((key) => !metByAnyone.has(key)));

  return { rows, columns, cells, unmetByAnyone };
}
