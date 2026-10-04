// Judging a reply and choosing the go-to where a reply is read (hold-and-compare R6, R9, R11,
// KTD11; jev-in-compare R10, R14, KTD10, KTD11): the reply view and the compare. A held reply
// offers Met and Not yet. A result offers its other verdict as a quiet link, Change to Not yet
// under a Met one and Change to Met under a Not met one, and a Met one can also offer the quiet
// Make go-to, or say Go-to when the badge's go-to mark names it. A result judged again says
// what it was just before, Changed from Met or Changed from Not met, at its foot. The view
// decides what a verdict does: save it at once, or open the verdict step first when it goes
// against Jev's reading (JudgeStep.tsx). One write at a time per view: while one saves, every
// action is disabled and the view's Escape waits (savingNow), and a failure shows once. After
// a save the caller moves the focus off the pressed button, which is gone by then. Both views
// also work out the badge's current version here, once per task and rubric, to choose a held
// reply's reading with it.

import { useEffect, useRef, useState } from "react";
import { isHeld, type Take } from "../domain/handoffResults";
import { assignmentVersion } from "../domain/hash";
import { judgeHeldReply, markGoTo, rejudgeResult, type VerdictExtras } from "../domain/operations";
import type { AssessmentResult, Credential, FolderState } from "../domain/types";
import { focusOnMount } from "./shared";
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

  /** Runs one write. True once it saved; false when it failed or another write was saving. */
  async function run(take: Take, write: (current: FolderState) => Promise<FolderState>): Promise<boolean> {
    if (!state || savingNow.current) return false;
    savingNow.current = true;
    setSaving(true);
    setError(null);
    try {
      apply(await write(state));
      onSaved?.(take);
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
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
    /** Judges a held reply, keeping a reason and missed points when the verdict step gave them. */
    judge: (take: Take, result: AssessmentResult, extras?: VerdictExtras) =>
      run(take, (current) => judgeHeldReply(storage, current, refOf(take), result, extras)),
    /** Judges a result again, as a new re-judge the folder lays over it (jev-in-compare KTD1). */
    rejudge: (take: Take, result: AssessmentResult, extras?: VerdictExtras) =>
      run(take, (current) => rejudgeResult(storage, current, refOf(take), result, extras)),
    mark: (take: Take) => run(take, (current) => markGoTo(storage, current, refOf(take))),
    exclusive,
  };
}

/** A view's writes, as `useTakeWrites` gives them. */
export type TakeWrites = ReturnType<typeof useTakeWrites>;

/**
 * The badge's current assignment version, worked out once per task and rubric as the test
 * deck does, or null until it has been. A view picks a held reply's reading with it.
 */
export function useAssignmentVersion(credential: Credential | undefined): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setVersion(null);
    if (credential) void assignmentVersion(credential.task, credential.rubric).then((v) => live && setVersion(v));
    return () => {
      live = false;
    };
  }, [credential?.task, credential?.rubric]); // eslint-disable-line react-hooks/exhaustive-deps
  return version;
}

/** Whether a Met take offers Make go-to, already is the go-to's marked result, or offers nothing. */
export type GoToOffer = "offer" | "is" | null;

/** A result's quiet link to its other verdict, by the verdict it has now (KTD11). */
const CHANGE_TO: Readonly<Record<AssessmentResult, string>> = { met: "Change to Not yet", not_met: "Change to Met" };

/** The verdict a result's change link gives it, by the verdict it has now. */
const OTHER: Readonly<Record<AssessmentResult, AssessmentResult>> = { met: "not_met", not_met: "met" };

/** What a re-judged result was just before its verdict now, by that earlier verdict (KTD11). */
const CHANGED_FROM: Readonly<Record<AssessmentResult, string>> = { met: "Changed from Met", not_met: "Changed from Not met" };

/**
 * One take's actions: Met and Not yet while it is held; once judged, the change link, with
 * Make go-to or Go-to beside it on a Met one when the view asks, and the line saying what it
 * was when it has been judged again. `onVerdict` gets the verdict asked for; the view saves it
 * or opens the verdict step. `focus` names the verdict whose action takes the focus when these
 * actions show again, after the verdict step went back with nothing saved.
 */
export function TakeActions({
  take,
  goTo = null,
  saving,
  describedBy,
  focus = null,
  onVerdict,
  onMark,
}: {
  take: Take;
  goTo?: GoToOffer;
  /** A write is saving, or compare is asking Jev: every action waits. */
  saving: boolean;
  /** The id of the heading that names the take, so each action says whose it is. */
  describedBy?: string;
  focus?: AssessmentResult | null;
  onVerdict(result: AssessmentResult): void;
  onMark?(): void;
}) {
  const focusIf = (result: AssessmentResult) => (focus === result ? focusOnMount : undefined);
  if (isHeld(take)) {
    return (
      <div className="take-actions">
        <button type="button" ref={focusIf("met")} disabled={saving} aria-describedby={describedBy} onClick={() => onVerdict("met")}>
          Met
        </button>
        <button type="button" ref={focusIf("not_met")} disabled={saving} aria-describedby={describedBy} onClick={() => onVerdict("not_met")}>
          Not yet
        </button>
      </div>
    );
  }
  const other = OTHER[take.result];
  const earlier = take.earlierVerdicts ?? [];
  const before = earlier.length > 0 ? earlier[earlier.length - 1] : null;
  return (
    <div className="take-actions">
      {take.result === "met" && goTo === "is" && <span className="take-goto">Go-to</span>}
      {take.result === "met" && goTo === "offer" && (
        <button type="button" className="link" disabled={saving} aria-describedby={describedBy} onClick={onMark}>
          Make go-to
        </button>
      )}
      <button type="button" className="link" ref={focusIf(other)} disabled={saving} aria-describedby={describedBy} onClick={() => onVerdict(other)}>
        {CHANGE_TO[take.result]}
      </button>
      {before && <span className="take-changed">{CHANGED_FROM[before]}</span>}
    </div>
  );
}
