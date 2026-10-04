// Jev's reading of one reply (U6, R10, R11, KTD13): each rubric point with the chance Jev
// gives that the reply meets it, as a whole percentage in the mono, then one reading for
// the whole rubric. A probability Jev can't call either way (KTD9) says so in words, as a
// point to sharpen in the bar. Numbers and words only: no reasons and no colored fills,
// since both raise acceptance whether or not the model is right.
//
// The judge pane shows the reading in hand below the rubric, under its own head. The
// reply and compare views show a saved one read-only, collapsed under the reply (R14).

import { isVague } from "../domain/secondOpinion";
import type { JevReading } from "../domain/types";

export interface JevReadingPanelProps {
  /** The overall probability and one per point, in rubric order, with each point's text as Jev read it. */
  reading: Pick<JevReading, "overall" | "points">;
  /** A saved reading where its result opens: the view around it names it, so the panel has no head of its own. */
  readOnly?: boolean;
}

/** A probability as a whole percentage, such as "52%". */
export function percent(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

function Probability({ value }: { value: number }) {
  return (
    <data className="jev-p" value={String(value)}>
      {percent(value)}
    </data>
  );
}

export function JevReadingPanel({ reading, readOnly = false }: JevReadingPanelProps) {
  return (
    <section className={readOnly ? "jev-reading jev-reading-saved" : "jev-reading"} aria-label="Jev's reading">
      {!readOnly && (
        <span className="jev-reading-head" aria-hidden="true">
          Jev
        </span>
      )}
      {reading.points.length > 0 && (
        <ol className="jev-points">
          {reading.points.map((point, i) => (
            <li key={i} className="jev-point">
              <span className="jev-point-text">{point.text}</span>
              <Probability value={point.probability} />
              {isVague(point.probability) && <span className="jev-vague">Can't call: sharpen this point</span>}
            </li>
          ))}
        </ol>
      )}
      <p className="jev-point jev-overall">
        <span className="jev-point-text">Overall</span>
        <Probability value={reading.overall} />
        {isVague(reading.overall) && <span className="jev-vague">Jev can't call the whole bar</span>}
      </p>
    </section>
  );
}

/**
 * Jev's reading saved on a result, collapsed, read-only (U7, R14, KTD12). It shows the
 * points as Jev read them, whatever the rubric says now, and whether or not Jev Mode is on.
 * The summary gives the overall reading and, for one seen after the verdict, whether the
 * verdict changed after it. The compare shows one in each take's record.
 */
export function SavedReading({ reading }: { reading: JevReading }) {
  const changed = reading.seen === "after" && reading.verdictChanged === true;
  const summary = `Jev's reading, ${percent(reading.overall)} overall${changed ? " · verdict changed after it" : ""}`;
  return (
    <details className="reply-ran reply-jev">
      <summary>{summary}</summary>
      <div className="reply-jev-body">
        <JevReadingPanel reading={reading} readOnly />
      </div>
    </details>
  );
}
