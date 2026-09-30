// The machine's pure mappings (KTD2): where each encoder points for a setup, which trig
// keys are lit and on which page, and what the small screen shows. The drawing in
// Machine.tsx reads only these, so every rule is tested without a DOM. Named apart from
// Machine.tsx because "machine.ts" and "Machine.tsx" collide on case-insensitive disks.

import { cellKey, type Matrix } from "../domain/matrix";
import { credentialKey, type AgentSetup, type Collection, type Slug } from "../domain/types";
import { EFFORTS, HARNESSES, modelsFor, splitModel } from "../ui/dialLists";

export type EncoderDial = "harness" | "model" | "effort";

export const ENCODER_DIALS: readonly EncoderDial[] = ["harness", "model", "effort"];

/** Listed values spread across this sweep, in degrees clockwise from twelve o'clock. */
export const LISTED_ARC = { from: -135, to: 135 } as const;

/** Typed values (Other, a custom effort) point somewhere in here, never at a listed value. */
export const OTHER_ARC = { from: 135, to: 225 } as const;

// Kept a few degrees inside the Other arc so a typed value never sits on the listed sweep's end stop.
const OTHER_INSET = 8;

/** The listed values a dial turns through for a setup. Models depend on the harness. */
export function dialOptions(dial: EncoderDial, setup: AgentSetup): string[] {
  if (dial === "harness") return HARNESSES.map((h) => h.value);
  if (dial === "model") return modelsFor(setup.harness.trim());
  return EFFORTS;
}

/** FNV-1a, 32 bits: a small stable hash, so a typed value always points the same way. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Where one encoder points for a setup, in degrees clockwise from twelve o'clock. */
export function encoderAngle(dial: EncoderDial, setup: AgentSetup): number {
  let value = setup[dial].trim();
  // A pinned version turns no encoder: "opus-5.5" points where "opus" does.
  if (dial === "model") value = splitModel(setup.harness, value)?.model ?? value;
  const options = dialOptions(dial, setup);
  const index = options.indexOf(value);
  if (index >= 0) {
    if (options.length === 1) return 0;
    return LISTED_ARC.from + ((LISTED_ARC.to - LISTED_ARC.from) * index) / (options.length - 1);
  }
  if (value === "") return (OTHER_ARC.from + OTHER_ARC.to) / 2;
  const span = OTHER_ARC.to - OTHER_ARC.from - 2 * OTHER_INSET;
  return OTHER_ARC.from + OTHER_INSET + (span * stableHash(value.toLowerCase())) / 0xffffffff;
}

/** One lit key: a credential the agent earned. */
export interface TrigKey {
  /** The credential key (`<collection>/<credential>`). */
  id: string;
  collectionSlug: Slug;
  credentialSlug: Slug;
  /** The first met result's recorded time, which orders the keys. */
  earnedAt: string;
  /** Needs a re-test: the latest result is flagged (R8). */
  halfRaised: boolean;
}

/** An earned credential as the cells give it. Only met cells light a key. */
export interface EarnedCell {
  credentialKey: string;
  status: "untested" | "met" | "not_met";
  flags: readonly string[];
  history: readonly { result: "met" | "not_met"; recordedAt: string; collectionSlug: Slug; credentialSlug: Slug }[];
}

export const KEYS_PER_PAGE = 16;

/** Earned keys, oldest first by the first met result's `recordedAt`. */
export function trigKeys(cells: Iterable<EarnedCell>): TrigKey[] {
  const keys: TrigKey[] = [];
  for (const cell of cells) {
    if (cell.status !== "met") continue;
    const mets = cell.history.filter((a) => a.result === "met");
    if (mets.length === 0) continue;
    const first = mets.reduce((a, b) => (Date.parse(b.recordedAt) < Date.parse(a.recordedAt) ? b : a));
    keys.push({
      id: cell.credentialKey,
      collectionSlug: first.collectionSlug,
      credentialSlug: first.credentialSlug,
      earnedAt: first.recordedAt,
      halfRaised: cell.flags.length > 0,
    });
  }
  return keys.sort((a, b) => Date.parse(a.earnedAt) - Date.parse(b.earnedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Keys in pages of sixteen. Always at least one page, so an empty machine still has its strip. */
export function trigPages<T>(keys: readonly T[]): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < keys.length; i += KEYS_PER_PAGE) pages.push(keys.slice(i, i + KEYS_PER_PAGE));
  return pages.length ? pages : [[]];
}

/** A key ready to draw: the trig key with the collection whose badge colors it takes. */
export interface MachineKey extends TrigKey {
  collection: Collection | null;
  /** The credential's name, for hover and focus on an agent's own view (R8). */
  name: string;
}

/** An agent's lit keys from the matrix, in the order they were earned. */
export function machineKeys(matrix: Matrix, profileSlug: Slug): MachineKey[] {
  const cells = matrix.columns.flatMap(({ credentials }) =>
    credentials.map((c) => matrix.cells.get(cellKey(profileSlug, credentialKey(c)))).filter((c) => c !== undefined),
  );
  return trigKeys(cells).map((key) => {
    const column = matrix.columns.find((g) => g.collection.slug === key.collectionSlug);
    const credential = column?.credentials.find((c) => c.slug === key.credentialSlug);
    return { ...key, collection: column?.collection ?? null, name: credential?.name ?? key.credentialSlug };
  });
}

/** What the machine's small screen shows (R6). */
export type ScreenState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "waiting" }
  | { kind: "reply"; lines: string[] };

export const SCREEN_LINES = 3;

/** Characters that fit on one line of the full machine's screen. */
export const SCREEN_COLUMNS = 20;

/** Cuts a line to `columns` characters, ending in an ellipsis when it was longer. */
export function cutLine(line: string, columns: number): string {
  const chars = [...line];
  return chars.length <= columns ? line : `${chars.slice(0, columns - 1).join("").trimEnd()}…`;
}

/**
 * The screen for a pasted reply: its first three non-blank lines, each cut with an
 * ellipsis. An empty reply shows the idle screen; the whole reply stays in the deck.
 */
export function replyScreen(reply: string, columns = SCREEN_COLUMNS): ScreenState {
  const lines = reply
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, SCREEN_LINES)
    .map((l) => cutLine(l, columns));
  return lines.length ? { kind: "reply", lines } : { kind: "idle" };
}
