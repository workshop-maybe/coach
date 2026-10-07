// jev-in-compare U1, KTD10, KTD14, KTD16: the two optional steps after a verdict, moved out
// of the test deck so compare asks them in the same words. One step lists the rubric points
// to tap the ones the reply missed, with Jev's call beside a point only where the reading
// holds that point's text. The other asks what Jev missed when the verdict goes against
// Jev's call. Each caller keeps its own gating: the test asks for missed points after every
// Not yet, compare only on an overrule. Titles and lines stay plain literals, so the
// guide's label check finds them here.

import type { Ref } from "react";
import { callOf, type CutOffs } from "../domain/calls";
import { MAX_REASON_CHARS } from "../domain/jevRequest";
import { savedPointOf } from "../domain/secondOpinion";
import type { AssessmentResult, JevPoint } from "../domain/types";
import { CALL_WORDS } from "./JevReading";
import { Field } from "./shared";

/** The missed-points step's title. */
export const MISSED_POINTS_TITLE = "Which points did it miss";

/** The reason step's title. */
export const REASON_TITLE = "What did Jev miss";

/** The line above the reason field, by the verdict that went against Jev's call. */
export const REASON_LINES: Readonly<Record<AssessmentResult, string>> = {
  not_met: "Jev called it meets. You said Not yet.",
  met: "Jev called it misses. You said Met.",
};

export interface MissedPointsListProps {
  /** The badge's current rubric points, in rubric order. */
  points: readonly string[];
  /** The reading's points, in the order it read them, or none when no reading is shown. */
  readingPoints?: readonly JevPoint[] | null;
  /** The cut-off pair the reading's calls read with. Jev's call shows only with both a reading and a pair. */
  pair?: CutOffs | null;
  /** The points pressed as missed. */
  picked: readonly string[];
  /** Presses or releases one point. */
  onToggle(point: string): void;
  disabled?: boolean;
}

/** Every rubric point as a toggle, with Jev's call beside a point whose text the reading holds. */
export function MissedPointsList({ points, readingPoints, pair, picked, onToggle, disabled }: MissedPointsListProps) {
  return (
    <ul className="missed-points" aria-label="Rubric points">
      {points.map((point, i) => {
        const read = savedPointOf(readingPoints, point);
        return (
          <li key={i} className="missed-point">
            <button type="button" aria-pressed={picked.includes(point)} disabled={disabled} onClick={() => onToggle(point)}>
              {point}
            </button>
            {pair && read && <span className="missed-call">{CALL_WORDS[callOf(read.probability, pair)]}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export interface ReasonBodyProps {
  /** The verdict that went against Jev's call. */
  verdict: AssessmentResult;
  value: string;
  onChange(value: string): void;
  /** The field, for a caller that moves focus into or out of it. */
  inputRef?: Ref<HTMLInputElement>;
}

/** The reason step's body: the line naming Jev's call and the verdict, then the one-line field. */
export function ReasonBody({ verdict, value, onChange, inputRef }: ReasonBodyProps) {
  return (
    <>
      <p className="muted">{REASON_LINES[verdict]}</p>
      <Field>
        <input ref={inputRef} aria-label="Reason" value={value} maxLength={MAX_REASON_CHARS} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      </Field>
    </>
  );
}
