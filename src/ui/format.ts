// Display text for a result, a take's state, a flag, the go-to, a handoff, a setup, a date and a part's first line.

import { handoffKeys } from "../cast/mappings";
import type { ContextLine } from "../domain/context";
import type { GoToFlag } from "../domain/goTo";
import { isHeld, takeTime, type Take } from "../domain/handoffResults";
import { SKELETON_ID, handoffsFor } from "../domain/handoffs";
import { isImagesOnlyLine } from "../domain/images";
import type { CellFlag, CellStatus } from "../domain/matrix";
import type { AgentSetup, FolderState } from "../domain/types";
import type { PendingTest } from "./pendingTests";

const RESULT_LABELS: Record<CellStatus, string> = { met: "Met", not_met: "Not met", untested: "Untested" };

export function resultLabel(result: CellStatus): string {
  return RESULT_LABELS[result];
}

/** A take's state: its verdict, or held while it has none (hold-and-compare KTD8). A display state, never stored. */
export type TakeState = "met" | "not_met" | "held";

const TAKE_LABELS: Record<TakeState, string> = { met: "Met", not_met: "Not met", held: "Held" };

export function takeStateOf(t: Take): TakeState {
  return isHeld(t) ? "held" : t.result;
}

/** A take's state in a word: Met, Not met or Held. */
export function takeLabel(t: Take): string {
  return TAKE_LABELS[takeStateOf(t)];
}

/**
 * When a take came back, as the person reads it: its date, and its time as well when
 * another take by the same agent in `among` shares that date, so two takes stay apart.
 */
export function takeWhen(t: Take, among: readonly Take[]): string {
  const date = formatDate(takeTime(t));
  const twin = among.some((o) => o !== t && o.profileSlug === t.profileSlug && formatDate(takeTime(o)) === date);
  if (!twin) return date;
  const d = new Date(takeTime(t));
  return Number.isNaN(d.getTime()) ? date : `${date}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

/** A flag in a few words, for a row that lists it after the result. */
export const FLAG_SHORT: Record<CellFlag, string> = {
  earlier_version: "task changed",
  setup_mismatch: "setup changed",
};

/** A go-to's flag in a few words. `not_met` reads as the result label does, and the cell's flags as they do on a row. */
const GO_TO_FLAG_SHORT: Record<GoToFlag, string> = {
  not_met: "not met",
  ...FLAG_SHORT,
};

/** The go-to's line on a badge card, or under a badge's holders when it no longer holds it (KTD8, KTD9). */
export function goToLine(name: string, flags: GoToFlag[]): string {
  return [`Go-to: ${name}`, ...flags.map((f) => GO_TO_FLAG_SHORT[f])].join(" · ");
}

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

/** The text's first line, skipping lines that hold only images, so a preview never shows raw image Markdown. */
export function firstLine(text: string): string {
  const lines = text.trim().split("\n");
  return lines.find((l) => l.trim() !== "" && !isImagesOnlyLine(l))?.trim() ?? lines[0] ?? "";
}
