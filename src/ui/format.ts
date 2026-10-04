// Display text for a result, a flag, a handoff, a setup, a date and a part's first line.

import { handoffKeys } from "../cast/mappings";
import type { ContextLine } from "../domain/context";
import { SKELETON_ID, handoffsFor } from "../domain/handoffs";
import type { CellFlag, CellStatus } from "../domain/matrix";
import type { AgentSetup, FolderState } from "../domain/types";
import type { PendingTest } from "./pendingTests";

const RESULT_LABELS: Record<CellStatus, string> = { met: "Met", not_met: "Not met", untested: "Untested" };

export function resultLabel(result: CellStatus): string {
  return RESULT_LABELS[result];
}

/** A flag in a few words, for a row that lists it after the result. */
export const FLAG_SHORT: Record<CellFlag, string> = {
  earlier_version: "task changed",
  setup_mismatch: "setup changed",
};

const MEMORY_SHORT: Record<ContextLine["memory"], string | null> = {
  changed: "memory changed",
  unchanged: null,
  "not-read": "memory not read",
};

/** The context a result's test started with, in a few words (R6, R7). */
export function contextText(line: ContextLine | null): string {
  if (!line) return "context unknown";
  const memory = MEMORY_SHORT[line.memory];
  return memory ? `${line.machine} · ${memory}` : line.machine;
}

/**
 * A handoff's key label on its badge: "S" for the skeleton, its letter for one of the
 * badge's handoffs, or null when the badge no longer has it. No id means the skeleton,
 * as on results and waiting tests from before handoffs (R14).
 */
export function handoffLabel(state: FolderState, key: string, id: string | undefined): string | null {
  const keys = handoffKeys(handoffsFor(state, key).map((h) => h.id));
  return keys.find((k) => k.id === (id ?? SKELETON_ID))?.label ?? null;
}

/** An agent's plug as its machine draws it, lettered with its handoff's key, or null when it holds none (R15). */
export function plugMark(state: FolderState, plug: PendingTest | undefined): { label?: string } | null {
  return plug ? { label: handoffLabel(state, plug.credentialKey, plug.handoff?.id) ?? undefined } : null;
}

/** The handoff a result ran with, in words: "Skeleton" or "Handoff B" (R20). */
export function handoffText(state: FolderState, key: string, id: string | undefined): string {
  if ((id ?? SKELETON_ID) === SKELETON_ID) return "Skeleton";
  const label = handoffLabel(state, key, id);
  return label ? `Handoff ${label}` : "Handoff";
}

/** The setup a result ran on: harness, model and effort. */
export const setupText = (setup: AgentSetup) => [setup.harness, setup.model, setup.effort].filter(Boolean).join(" · ");

/** A date as the person reads it, or the text itself when it is not a date. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A line that holds nothing but Markdown images. */
const IMAGES_ONLY = /^\s*(?:!\[(?:\\.|[^\]\\])*\]\((?:<[^>\n]*>|[^\s)]+)(?:\s+"(?:\\.|[^"\\])*")?\s*\)\s*)+$/;

/** The text's first line, skipping lines that hold only images, so a preview never shows raw image Markdown. */
export function firstLine(text: string): string {
  const lines = text.trim().split("\n");
  return lines.find((l) => l.trim() !== "" && !IMAGES_ONLY.test(l))?.trim() ?? lines[0] ?? "";
}
