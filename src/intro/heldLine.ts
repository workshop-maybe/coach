// The newcomer's line, held on this computer from the play beat until the badge is saved
// (KTD6, R20). It lives in the webview's local storage, guarded like `src/ui/pendingTests.ts`:
// storage that is missing or throws reads as nothing held and drops the write, so a
// blocked store never stops the newcomer reaching the folder gate.

import { defaultStore } from "./localStore";

export const HELD_LINE_KEY = "coach:first-run-line";

/** The line as the badge's first learning target, and the name drawn from it. */
export interface HeldLine {
  line: string;
  name: string;
}

function isHeld(v: unknown): v is HeldLine {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return typeof h.line === "string" && h.line.trim() !== "" && typeof h.name === "string" && h.name.trim() !== "";
}

/** The held line, or null when none is held or storage can't be read. */
export function readHeldLine(store: globalThis.Storage | null = defaultStore()): HeldLine | null {
  try {
    const text = store?.getItem(HELD_LINE_KEY);
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    return isHeld(parsed) ? { line: parsed.line, name: parsed.name } : null;
  } catch {
    return null;
  }
}

/** Holds the line. False when storage is missing or refuses the write. */
export function writeHeldLine(held: HeldLine, store: globalThis.Storage | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(HELD_LINE_KEY, JSON.stringify({ line: held.line, name: held.name }));
    return true;
  } catch {
    return false;
  }
}

/** Lets go of any held line. */
export function clearHeldLine(store: globalThis.Storage | null = defaultStore()): void {
  try {
    store?.removeItem(HELD_LINE_KEY);
  } catch {
    // Blocked storage held nothing this run could read either.
  }
}
