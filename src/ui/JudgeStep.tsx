// The verdict step under a reply (jev-in-compare U7, R10-R12, KTD10, KTD11, KTD16): where a
// verdict in compare or the reply view goes against Jev's reading of that reply, a short step
// opens under it in place of its actions before anything saves. A verdict that agrees, or a
// reply with no reading or a can't-call one, saves at once. Only the reply's own reading
// decides, the one folded under it whatever its version, never a head-to-head; it and its
// pair are frozen when the step opens, so a fit moved by another verdict meanwhile never
// drops what the user wrote.
//
// One card at a time. On Not yet with rubric points, Which points did it miss lists the
// badge's points with Jev's call beside each point whose text the reading holds and nothing
// pressed, forward Next once one is pressed and Skip while none is. Then What did Jev miss,
// with the test's line and one-line field, forward Save. A quiet Back on each card goes back a
// card, or from the first back to the reply's actions with nothing saved. Escape follows the
// deck's rule: in the reason field it leaves the field, otherwise it is Back, and the step
// claims it either way, so the view around it closes only when no step is open. The view
// holds which reply has the step open (useVerdictStep), so a compare keeps one at a time.

import { useEffect, useId, useRef, useState } from "react";
import { calibrationOf, isOverrule, type CutOffs } from "../domain/calls";
import { isHeld, readingOfTake, type Take } from "../domain/handoffResults";
import type { VerdictExtras } from "../domain/operations";
import type { AssessmentResult, FolderState, JevReading } from "../domain/types";
import type { TakeWrites } from "./takeActions";
import { useFolder } from "./useFolderState";
import { MISSED_POINTS_TITLE, MissedPointsList, REASON_TITLE, ReasonBody } from "./verdictSteps";

/** The reading a verdict went against, and the pair it read with, frozen when the step opened. */
export interface Overruled {
  reading: JevReading;
  pair: CutOffs;
}

/**
 * Whether a verdict goes against the take's own reading (KTD10): the one folded under the
 * reply (`readingOfTake` at `version`), read with the badge's current pair for its model.
 * Returns that reading and pair, or null when the verdict saves at once (R10, R12).
 */
export function overruled(state: FolderState, key: string, take: Take, version: string | null, verdict: AssessmentResult): Overruled | null {
  const reading = readingOfTake(state, take, version);
  if (!reading) return null;
  const { pair } = calibrationOf(state, key, reading.model);
  return isOverrule({ result: verdict, jev: reading }, pair) ? { reading, pair } : null;
}

/** A step open under one reply. */
export interface OpenStep extends Overruled {
  /** The reply's take id (`takeIdOf`). */
  id: string;
  verdict: AssessmentResult;
  /** Whether the reply was held when the step opened: a held reply is judged, a result judged again. */
  held: boolean;
}

/**
 * A view's verdicts and its one open step. `verdict` saves at once or opens the step; opening
 * one closes any other. `stepOf` is the step under a take, only while that take is still the
 * reply it opened on and the verdict still changes it, so a step whose reply left the folder,
 * or was judged elsewhere, goes with it. `backTo` names the action that opened a step that
 * went back, so that action takes the focus again.
 */
export function useVerdictStep(writes: TakeWrites) {
  const { state } = useFolder();
  const [step, setStep] = useState<OpenStep | null>(null);
  const [backTo, setBackTo] = useState<{ id: string; verdict: AssessmentResult } | null>(null);
  // Once the actions have shown again and taken the focus, the name is spent: a later remount never takes it.
  useEffect(() => {
    if (backTo) setBackTo(null);
  }, [backTo]);

  function save(take: Take, result: AssessmentResult, extras?: VerdictExtras): Promise<boolean> {
    return isHeld(take) ? writes.judge(take, result, extras) : writes.rejudge(take, result, extras);
  }

  return {
    stepOf(id: string, take: Take): OpenStep | null {
      if (!step || step.id !== id || step.held !== isHeld(take)) return null;
      return isHeld(take) || take.result !== step.verdict ? step : null;
    },
    backTo(id: string): AssessmentResult | null {
      return backTo && backTo.id === id ? backTo.verdict : null;
    },
    /** A verdict asked for on a take: the step opens when it goes against the reply's reading, else it saves at once. */
    verdict(id: string, take: Take, key: string, version: string | null, result: AssessmentResult) {
      if (!state) return;
      setBackTo(null);
      const against = overruled(state, key, take, version, result);
      if (against) setStep({ id, verdict: result, held: isHeld(take), ...against });
      else void save(take, result);
    },
    /** Saves the open step's verdict with what it gathered; the step closes once it saved, and stays with its drafts if not. */
    async finish(open: OpenStep, take: Take, extras: VerdictExtras) {
      if (await save(take, open.verdict, extras)) setStep((s) => (s === open ? null : s));
    },
    /** Back from the step's first card: the reply's actions again, with nothing saved. */
    back(open: OpenStep) {
      setStep((s) => (s === open ? null : s));
      setBackTo({ id: open.id, verdict: open.verdict });
    },
  };
}

export interface JudgeStepProps {
  step: OpenStep;
  /** The badge's current rubric points, in rubric order. */
  points: readonly string[];
  /** A write is saving: the step waits, and Escape does nothing. */
  saving: boolean;
  /** Save waits too, as while compare asks Jev (KTD9). */
  waiting?: boolean;
  /** The id of the heading that names the take, so the step's buttons say whose they are. */
  describedBy?: string;
  onBack(): void;
  onSave(extras: VerdictExtras): void;
}

type Card = "points" | "reason";

/** The step's cards, one at a time, with their drafts. Key it by the step, so a new step starts afresh. */
export function JudgeStep({ step, points, saving, waiting = false, describedBy, onBack, onSave }: JudgeStepProps) {
  const asksPoints = step.verdict === "not_met" && points.length > 0;
  const [card, setCard] = useState<Card>(asksPoints ? "points" : "reason");
  const [missed, setMissed] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const forwardButton = useRef<HTMLButtonElement>(null);

  // The card's heading takes the focus each time a card shows.
  useEffect(() => {
    heading.current?.focus();
  }, [card]);

  const back = () => (card === "reason" && asksPoints ? setCard("points") : onBack());

  // Escape is the step's while it is open, wherever the focus is: the view's own Escape
  // listens later, on the way back up, and skips an Escape claimed here.
  const latest = useRef({ back, saving });
  latest.current = { back, saving };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (field.current !== null && e.target === field.current) {
        const go = forwardButton.current;
        (go && !go.disabled ? go : heading.current)?.focus();
      } else if (!latest.current.saving) latest.current.back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function forward() {
    if (card === "points") setCard("reason");
    else if (!saving && !waiting) onSave({ note, ...(step.verdict === "not_met" ? { missedPoints: missed } : {}) });
  }

  const toggle = (point: string) => setMissed((m) => (m.includes(point) ? m.filter((p) => p !== point) : [...m, point]));
  const forwardLabel = card === "reason" ? "Save" : missed.length > 0 ? "Next" : "Skip";

  return (
    <form
      className="judge-step"
      aria-labelledby={headingId}
      onSubmit={(e) => {
        e.preventDefault();
        forward();
      }}
    >
      <h3 id={headingId} tabIndex={-1} ref={heading}>
        {card === "points" ? MISSED_POINTS_TITLE : REASON_TITLE}
      </h3>
      {card === "points" ? (
        <MissedPointsList points={points} readingPoints={step.reading.points} pair={step.pair} picked={missed} onToggle={toggle} disabled={saving} />
      ) : (
        <ReasonBody verdict={step.verdict} value={note} onChange={setNote} inputRef={field} />
      )}
      <div className="judge-step-actions">
        <button type="button" className="ghost" disabled={saving} aria-describedby={describedBy} onClick={back}>
          Back
        </button>
        <button type="submit" ref={forwardButton} disabled={saving || (card === "reason" && waiting)} aria-describedby={describedBy}>
          {forwardLabel}
        </button>
      </div>
    </form>
  );
}
