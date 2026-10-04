// Jev's reading of one reply (growing context U5, R9, R11, R12, KTD8, KTD13): each rubric
// point, then one reading for the whole rubric, then each learning target asked, read as a
// call under a cut-off pair: Meets, Misses or Can't call, with the probability after it as
// smaller mono text. A point Jev can't call says so in words, as a point to sharpen in the
// bar. Words and numbers only: no reasons and no colored fills, since both raise acceptance
// whether or not the model is right, and good green stays the user's own pass.
//
// The judge pane shows the reading in hand below the rubric, under its own head. The
// reply and compare views show a saved one read-only, collapsed under the reply, read
// with the pair the badge's results fit for the reading's own model, so a new verdict
// re-reads it from its saved probabilities without asking Jev again (R12).

import { useId } from "react";
import { calibrationOf, callOf, DEFAULT_CUT_OFFS, wholePercent, type Call, type CutOffs, type TrackRecord } from "../domain/calls";
import type { JevPoint, JevReading } from "../domain/types";
import { useFolder } from "./useFolderState";

export interface JevReadingPanelProps {
  /** The overall probability, one per point in rubric order and one per learning target asked, each with its text as Jev read it. */
  reading: Pick<JevReading, "overall" | "points" | "targets">;
  /** The cut-off pair the probabilities read with. */
  pair?: CutOffs;
  /** Whether the pair was fitted to the user's verdicts rather than the default. */
  fitted?: boolean;
  /** Jev's track record on the badge. Absent, or null, shows none: it shows only once a verdict exists (KTD7). */
  trackRecord?: TrackRecord | null;
  /** A saved reading where its result opens: the view around it names it, so the panel has no head of its own. */
  readOnly?: boolean;
}

/** Each call as the reading says it. */
const CALL_WORDS: Record<Call, string> = { meets: "Meets", misses: "Misses", cant_call: "Can't call" };
/** Each call as the saved reading's summary says it, mid-sentence. */
const SUMMARY_CALLS: Record<Call, string> = { meets: "meets", misses: "misses", cant_call: "can't call" };

/** A probability as a whole percentage, such as "52%": the percent its call reads. */
export function percent(probability: number): string {
  return `${wholePercent(probability)}%`;
}

/**
 * The call and the probability after it. Where a row asks something of the user at can't
 * call, `cantCall` says it, and the read takes its own line so the phrase never squeezes
 * the text it reads.
 */
function Read({ probability, pair, cantCall }: { probability: number; pair: CutOffs; cantCall?: string }) {
  const call = callOf(probability, pair);
  const phrase = call === "cant_call" ? cantCall : undefined;
  return (
    <span className={phrase ? "jev-read jev-read-own-line" : "jev-read"}>
      <span className="jev-call">{phrase ?? CALL_WORDS[call]}</span>{" "}
      <data className="jev-p" value={String(probability)}>
        {percent(probability)}
      </data>
    </span>
  );
}

/** One row per point or target, each with its call. */
function rows(points: readonly JevPoint[], pair: CutOffs, cantCall?: string) {
  return points.map((point, i) => (
    <li key={i} className="jev-point">
      <span className="jev-point-text">{point.text}</span>
      <Read probability={point.probability} pair={pair} cantCall={cantCall} />
    </li>
  ));
}

export function JevReadingPanel({ reading, pair = DEFAULT_CUT_OFFS, fitted = false, trackRecord, readOnly = false }: JevReadingPanelProps) {
  const targetsId = useId();
  const targets = reading.targets ?? [];
  return (
    <section className={readOnly ? "jev-reading jev-reading-saved" : "jev-reading"} aria-label="Jev's reading">
      {!readOnly && (
        <span className="jev-reading-head" aria-hidden="true">
          Jev
        </span>
      )}
      {reading.points.length > 0 && (
        <ol className="jev-points">
          {rows(reading.points, pair, "Can't call: sharpen this point")}
        </ol>
      )}
      <p className="jev-point jev-overall">
        <span className="jev-point-text">Overall</span>
        <Read probability={reading.overall} pair={pair} cantCall="Jev can't call the whole bar" />
      </p>
      {targets.length > 0 && (
        <>
          <span className="jev-targets-head" id={targetsId}>
            Learning targets
          </span>
          <ol className="jev-targets" aria-labelledby={targetsId}>
            {rows(targets, pair)}
          </ol>
        </>
      )}
      {trackRecord && (
        <p className="jev-note">
          {`Jev matched your verdict ${trackRecord.matches} of ${trackRecord.calls} times on this badge`}
          {trackRecord.cantCalls > 0 && `, and couldn't call ${trackRecord.cantCalls}`}
        </p>
      )}
      {fitted && <p className="jev-note">Cut-offs fitted to your verdicts</p>}
    </section>
  );
}

export interface SavedReadingProps {
  reading: JevReading;
  /** The badge the take is on. */
  credentialKey: string;
  /** Whether the take is a result. A held reply has no verdict, so it shows no track record (KTD7). */
  hasVerdict: boolean;
}

/**
 * Jev's reading saved on a take, collapsed, read-only (R14, KTD12). It shows the points as
 * Jev read them, whatever the rubric says now, and whether or not Jev Mode is on, each
 * read with the pair the badge's results fit for the model that answered (KTD8). The
 * summary gives the overall call and, for one seen after the verdict, whether the verdict
 * changed after it. When the pair was fitted it says so. Only a result shows Jev's track
 * record on the badge: a held reply has no verdict yet, and the record must not lead the one
 * the user is about to give (KTD7). The compare shows one in each take's record.
 */
export function SavedReading({ reading, credentialKey: key, hasVerdict }: SavedReadingProps) {
  const { state } = useFolder();
  const calibration = state ? calibrationOf(state, key, reading.model) : null;
  const pair = calibration?.pair ?? DEFAULT_CUT_OFFS;
  const changed = reading.seen === "after" && reading.verdictChanged === true;
  const summary = `Jev's reading, ${SUMMARY_CALLS[callOf(reading.overall, pair)]} overall` + (changed ? " · verdict changed after it" : "");
  return (
    <details className="reply-ran reply-jev">
      <summary>{summary}</summary>
      <div className="reply-jev-body">
        <JevReadingPanel
          reading={reading}
          pair={pair}
          fitted={calibration?.fitted === true}
          trackRecord={hasVerdict ? calibration?.trackRecord : null}
          readOnly
        />
      </div>
    </details>
  );
}
