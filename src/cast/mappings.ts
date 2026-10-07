// The machine's pure mappings (KTD2): where each encoder points for a setup, which trig
// keys are lit and on which page, and what the small screen shows. The drawing in
// Machine.tsx reads only these, so every rule is tested without a DOM. Named apart from
// Machine.tsx because "machine.ts" and "Machine.tsx" collide on case-insensitive disks.

import { SKELETON_ID } from "../domain/handoffs";
import { cellKey, type Matrix } from "../domain/matrix";
import { previewText } from "../domain/replyItems";
import { credentialKey, type AgentSetup, type Collection, type ReplyItem, type Slug } from "../domain/types";
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
  const lines = firstLines(reply, columns);
  return lines.length ? { kind: "reply", lines } : { kind: "idle" };
}

/**
 * The screen for a reply's items (reply artifacts U4): its first text item with something in
 * it, else its first other item's name or URL (`previewText`).
 */
export function replyItemsScreen(items: readonly ReplyItem[], columns = SCREEN_COLUMNS): ScreenState {
  return replyScreen(previewText(items), columns);
}

/** A text's first three non-blank lines, spaces collapsed, each cut to `columns`. */
function firstLines(text: string, columns: number): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, SCREEN_LINES)
    .map((l) => cutLine(l, columns));
}

// The handoff box's rules (KTD9): its keys' letters and places, which key is lit, and
// which two carry marks when the test asks (R9, R11).

/** The skeleton key's label, set apart from the handoffs' letters. */
export const SKELETON_LABEL = "S";

/** One of the box's pattern keys: a handoff id and its label. */
export interface HandoffKey {
  id: string;
  label: string;
}

/** The letter for the handoff at `index` in creation order: A to Z, then AA, AB and on. */
export function handoffLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** The box's keys: the skeleton's first, then a badge's handoffs lettered in creation order. `ids` are oldest first. */
export function handoffKeys(ids: readonly string[]): HandoffKey[] {
  return [{ id: SKELETON_ID, label: SKELETON_LABEL }, ...ids.map((id, i) => ({ id, label: handoffLetter(i) }))];
}

/** The two keys the test offers when an agent's winner is not the badge default (R11). */
export interface BoxAsk {
  winner: string;
  default: string;
}

/** What the box lights: one key, or none while it asks. A pick in the ask state keeps the marks. */
export interface BoxChoice {
  lit: string | null;
  ask: BoxAsk | null;
}

/** The box as a test opens it: the default lit, unless the agent's winner differs, then it asks (KTD8). */
export function openingChoice(defaultId: string, winnerId: string | null): BoxChoice {
  if (winnerId === null || winnerId === defaultId) return { lit: defaultId, ask: null };
  return { lit: null, ask: { winner: winnerId, default: defaultId } };
}

/** A key ready to draw. */
export interface BoxKey extends HandoffKey {
  state: "lit" | "off";
  mark: "winner" | "default" | null;
}

export function boxKeys(keys: readonly HandoffKey[], { lit, ask }: BoxChoice): BoxKey[] {
  return keys.map((k) => ({
    ...k,
    state: k.id === lit ? "lit" : "off",
    mark: ask?.winner === k.id ? "winner" : ask?.default === k.id ? "default" : null,
  }));
}

export const BOX_KEYS_PER_ROW = 8;

/** Where the key at `index` sits on the box's panel. */
export function boxKeyPlace(index: number): { row: number; col: number } {
  return { row: Math.floor(index / BOX_KEYS_PER_ROW), col: index % BOX_KEYS_PER_ROW };
}

/** Rows of keys for `count` keys. Always at least one, so an empty panel still has its row. */
export function boxRows(count: number): number {
  return Math.max(1, Math.ceil(count / BOX_KEYS_PER_ROW));
}

/** Characters that fit on one line of the box's screen. */
export const BOX_SCREEN_COLUMNS = 26;

/** The box's screen: the lit handoff's first three non-blank lines, each cut with an ellipsis. */
export function boxScreen(text: string, columns = BOX_SCREEN_COLUMNS): string[] {
  return firstLines(text, columns);
}
