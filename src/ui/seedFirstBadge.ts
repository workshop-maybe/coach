// The newcomer's first badge, saved from the held line once a folder has loaded (KTD6, R6,
// R20). It lives here, not in `src/intro/`, because it writes to the folder (KTD1).
//
// The held line is taken and cleared before the first await, so a second run finds nothing
// to save. The in-flight save is held at module scope, not in a ref, so a run that starts
// while one is pending (StrictMode's second effect, or the folder provider remounting) gets
// the same promise and its result still reaches navigation. A save that throws puts the line
// back, so the next launch tries again.

import { createCredential, ensureLandingCollection } from "../domain/operations";
import type { FolderState } from "../domain/types";
import { clearHeldLine, readHeldLine, writeHeldLine } from "../intro/heldLine";
import type { Storage } from "../storage/storage";
import { describeError } from "./useFolderState";

export type SeedResult = { ok: true; state: FolderState; key: string } | { ok: false; message: string };

let inflight: Promise<SeedResult> | null = null;

/**
 * Saves the held line as a badge: named from the line, the line its one learning target,
 * no task yet. Null when no line is held and no save is in flight.
 */
export function seedFirstBadge(storage: Storage, state: FolderState, store?: globalThis.Storage | null): Promise<SeedResult> | null {
  if (inflight) return inflight;
  // Undefined falls through to the held line's own default store.
  const held = readHeldLine(store);
  if (!held) return null;
  clearHeldLine(store);

  const run = async (): Promise<SeedResult> => {
    try {
      const target = await ensureLandingCollection(storage, state);
      const made = await createCredential(storage, target.state, target.slug, held.name, {
        learningTargets: [held.line],
        task: "",
        rubric: "",
        extraSections: [],
      });
      return { ok: true, state: made.state, key: made.key };
    } catch (e) {
      writeHeldLine(held, store);
      return { ok: false, message: describeError(e) };
    }
  };
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** The notice shown when the first badge could not be saved. */
export function seedFailedNotice(message: string): string {
  return `Your first badge could not be saved. It will be tried again next time the app opens. ${message}`;
}
