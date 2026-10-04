// Judging a held reply and choosing the go-to where a reply is read (hold-and-compare R6,
// R9, R11, KTD11): the reply view and the compare. A held reply offers Met and Not yet, each
// recording at once; a Met reply can offer the quiet Make go-to, or say Go-to when the
// badge's go-to mark names it. One write at a time per view: while one saves, every action
// is disabled and the view's Escape waits (savingNow), and a failure shows once. After a
// save the caller moves the focus off the pressed button, which is gone by then.

import { useRef, useState } from "react";
import { isHeld, type Take } from "../domain/handoffResults";
import { judgeHeldReply, markGoTo } from "../domain/operations";
import type { AssessmentResult, FolderState } from "../domain/types";
import { describeError, useFolder } from "./useFolderState";

/** A take's agent, badge and stem, as the operations name it. */
const refOf = (t: Take) => ({ profileSlug: t.profileSlug, collectionSlug: t.collectionSlug, credentialSlug: t.credentialSlug, fileStem: t.fileStem });

/** The writes a reply view or a compare makes, one at a time, applied to the folder. `onSaved` runs after each. */
export function useTakeWrites(onSaved?: (take: Take) => void) {
  const { storage, state, apply } = useFolder();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set before the first await, so a second press, or an Escape while a write saves, does nothing.
  const savingNow = useRef(false);

  async function run(take: Take, write: (current: FolderState) => Promise<FolderState>) {
    if (!state || savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError(null);
    try {
      apply(await write(state));
      onSaved?.(take);
    } catch (e) {
      setError(describeError(e));
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  /**
   * Runs one async section behind the same gate (jev-in-compare KTD9), so compare's Jev saves
   * and its verdicts never interleave. It records no error and rethrows, so the caller says
   * what failed; a section asked for while another write saves is refused, never skipped.
   */
  async function exclusive<T>(section: () => Promise<T>): Promise<T> {
    if (savingNow.current) throw new Error("Another save is still in progress.");
    savingNow.current = true;
    setSaving(true);
    try {
      return await section();
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }

  return {
    saving,
    savingNow,
    error,
    judge: (take: Take, result: AssessmentResult) => run(take, (current) => judgeHeldReply(storage, current, refOf(take), result)),
    mark: (take: Take) => run(take, (current) => markGoTo(storage, current, refOf(take))),
    exclusive,
  };
}

/** Whether a Met take offers Make go-to, already is the go-to's marked result, or offers nothing. */
export type GoToOffer = "offer" | "is" | null;

/** One take's actions: Met and Not yet while it is held; Make go-to or Go-to once it is Met and the view asks. */
export function TakeActions({
  take,
  goTo = null,
  saving,
  describedBy,
  onJudge,
  onMark,
}: {
  take: Take;
  goTo?: GoToOffer;
  saving: boolean;
  /** The id of the heading that names the take, so each action says whose it is. */
  describedBy?: string;
  onJudge(result: AssessmentResult): void;
  onMark?(): void;
}) {
  if (isHeld(take)) {
    return (
      <div className="take-actions">
        <button type="button" disabled={saving} aria-describedby={describedBy} onClick={() => onJudge("met")}>
          Met
        </button>
        <button type="button" disabled={saving} aria-describedby={describedBy} onClick={() => onJudge("not_met")}>
          Not yet
        </button>
      </div>
    );
  }
  if (take.result !== "met" || goTo === null) return null;
  if (goTo === "is") return <p className="take-actions take-goto">Go-to</p>;
  return (
    <p className="take-actions">
      <button type="button" className="link" disabled={saving} aria-describedby={describedBy} onClick={onMark}>
        Make go-to
      </button>
    </p>
  );
}
