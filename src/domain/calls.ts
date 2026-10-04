// Jev's readings as calls (KTD8): a probability, rounded to the whole percent the reading
// shows, reads meets, misses or can't call under a cut-off pair. Each badge has one pair
// per Jev model, fitted to the user's verdicts on the badge's results, and Jev's track
// record there counts how often its overall call matched them.
//
// Like the go-to, all of it is worked out from the folder every time a view draws, and
// nothing derived is stored (KTD1). A new verdict, or a result moved to the trash, re-reads
// every saved reading on the badge from its saved probabilities, with no new ask (R12).

import { credentialKey, type Assessment, type AssessmentResult, type FolderState, type JevReading } from "./types";

/** How a probability reads under a pair (R9). */
export type Call = "meets" | "misses" | "cant_call";

/** A badge's cut-offs in whole percents. From `low` to `high`, both included, reads can't call. */
export interface CutOffs {
  readonly low: number;
  readonly high: number;
}

/** The pair every badge starts with, and keeps until the fit moves it (R10). */
export const DEFAULT_CUT_OFFS: CutOffs = Object.freeze({ low: 30, high: 70 });

// The fit's numbers come from the flow analysis and are tunable here alone.

/** Candidate cut-offs step by this many percent. */
export const CUT_OFF_STEP = 5;
/** Where a fitted low cut-off may sit, ends included. */
export const LOW_CUT_OFF_RANGE = Object.freeze({ min: 10, max: 45 });
/** Where a fitted high cut-off may sit, ends included. */
export const HIGH_CUT_OFF_RANGE = Object.freeze({ min: 55, max: 90 });
/** A wrong call costs this many matches, so the fit prefers can't call to a wrong call. */
export const WRONG_CALL_COST = 2;
/**
 * A candidate may leave at most this percent of the readings at can't call. The default is
 * exempt, so the cap stops the fit widening without forcing wrong calls where Jev is unsure.
 */
export const MAX_CANT_CALL_PERCENT = 40;
/** Judged readings from one model a badge needs before its pair is fitted and its track record shows. */
export const MIN_JUDGED_READINGS = 8;
/** Readings of each verdict the fit needs, so both verdicts are present. */
export const MIN_READINGS_PER_VERDICT = 2;

/** A probability as the whole percent a reading shows. The call and the shown percent share it. */
export function wholePercent(probability: number): number {
  return Math.round(probability * 100);
}

/** How a probability reads under a pair. */
export function callOf(probability: number, pair: CutOffs): Call {
  const pct = wholePercent(probability);
  if (pct > pair.high) return "meets";
  if (pct < pair.low) return "misses";
  return "cant_call";
}

/** Jev's overall probability on a result, and the user's verdict on that result. */
export interface JudgedReading {
  overall: number;
  verdict: AssessmentResult;
}

/** How often Jev's overall call matched the user's verdict on a badge (R11). */
export interface TrackRecord {
  /** Calls that matched the verdict. */
  matches: number;
  /** Calls made: every reading that read meets or misses. */
  calls: number;
  /** Readings that read can't call. */
  cantCalls: number;
}

/** A badge's reading of one Jev model's probabilities, worked out from the folder. */
export interface Calibration {
  /** The pair in force. */
  pair: CutOffs;
  /** Whether the fit moved the pair off the default. */
  fitted: boolean;
  /** The badge's results that carry a reading from this model. */
  judged: number;
  /** Null below MIN_JUDGED_READINGS, or when no reading made a call. */
  trackRecord: TrackRecord | null;
}

/**
 * The pair that best matches the user's verdicts: the highest score (matches less
 * WRONG_CALL_COST per wrong call) among grid pairs within the can't-call cap, plus the
 * default. A tie goes to the pair closest to 30/70, then to the narrower band, so the band
 * moves only when a reading changes the score; a tie on all three keeps the first in grid
 * order, lowest low then lowest high. Below MIN_JUDGED_READINGS, or without
 * MIN_READINGS_PER_VERDICT of each verdict, the default holds.
 */
export function fitCutOffs(readings: readonly JudgedReading[]): CutOffs {
  const met = readings.filter((r) => r.verdict === "met").length;
  if (readings.length < MIN_JUDGED_READINGS || met < MIN_READINGS_PER_VERDICT || readings.length - met < MIN_READINGS_PER_VERDICT) {
    return DEFAULT_CUT_OFFS;
  }
  let best = candidate(readings, DEFAULT_CUT_OFFS);
  for (let low = LOW_CUT_OFF_RANGE.min; low <= LOW_CUT_OFF_RANGE.max; low += CUT_OFF_STEP) {
    for (let high = HIGH_CUT_OFF_RANGE.min; high <= HIGH_CUT_OFF_RANGE.max; high += CUT_OFF_STEP) {
      const next = candidate(readings, { low, high });
      if (next.cantCalls * 100 <= readings.length * MAX_CANT_CALL_PERCENT && beats(next, best)) best = next;
    }
  }
  return best.pair;
}

/** Jev's track record under a pair, or null below MIN_JUDGED_READINGS or when no call was made. */
export function trackRecordOf(readings: readonly JudgedReading[], pair: CutOffs): TrackRecord | null {
  if (readings.length < MIN_JUDGED_READINGS) return null;
  const { matches, wrong, cantCalls } = tally(readings, pair);
  const calls = matches + wrong;
  return calls === 0 ? null : { matches, calls, cantCalls };
}

/** The badge's calibration for every Jev model with a reading on one of its results. */
export function calibrationsOf(state: FolderState, key: string): Map<string, Calibration> {
  return new Map([...readingsByModel(state, key)].map(([model, readings]) => [model, calibrate(readings)]));
}

/** The badge's calibration for one Jev model. A model with no readings there reads with the default. */
export function calibrationOf(state: FolderState, key: string, model: string): Calibration {
  return calibrate(readingsByModel(state, key).get(model) ?? []);
}

/** A verdict and Jev's overall reading on it: a saved result, or a pick and a reading in hand. */
export type Judged = Pick<Assessment, "result"> & { jev?: Pick<JevReading, "overall"> };

/**
 * Whether the user overruled Jev under this pair (KTD11): a meets call on a Not met verdict,
 * or a misses call on a Met one. Can't call is never an overrule, nor is a verdict with no
 * reading. A saved reading takes the current pair for its own model; a reading in hand
 * takes the pair frozen when it arrived.
 */
export function isOverrule(judged: Judged, pair: CutOffs): boolean {
  if (!judged.jev) return false;
  const call = callOf(judged.jev.overall, pair);
  return call !== "cant_call" && call !== agreeingCall(judged.result);
}

/**
 * Whether a result ranks as an overrule when examples are picked (KTD10, KTD11): opposed
 * under the default pair, or under `pair`, the badge's current pair for that reading's
 * model. So a fit that widens the band to absorb a confidently wrong reading never demotes
 * the reply the user overruled.
 */
export function ranksAsOverrule(judged: Judged, pair: CutOffs): boolean {
  return isOverrule(judged, DEFAULT_CUT_OFFS) || isOverrule(judged, pair);
}

// ---------------------------------------------------------------------------

export interface Candidate {
  pair: CutOffs;
  score: number;
  cantCalls: number;
}

/**
 * The badge's results that carry a reading, by the model that answered. A Map, since a
 * model id read from a hand-edited file can be any text, `__proto__` included. Held
 * replies are not results and never count; older assignment versions do.
 */
function readingsByModel(state: FolderState, key: string): Map<string, JudgedReading[]> {
  const byModel = new Map<string, JudgedReading[]>();
  for (const a of state.assessments) {
    if (!a.jev || credentialKey(a) !== key) continue;
    const reading = { overall: a.jev.overall, verdict: a.result };
    const list = byModel.get(a.jev.model);
    if (list) list.push(reading);
    else byModel.set(a.jev.model, [reading]);
  }
  return byModel;
}

function calibrate(readings: readonly JudgedReading[]): Calibration {
  const pair = fitCutOffs(readings);
  const fitted = pair.low !== DEFAULT_CUT_OFFS.low || pair.high !== DEFAULT_CUT_OFFS.high;
  return { pair, fitted, judged: readings.length, trackRecord: trackRecordOf(readings, pair) };
}

/** The call that agrees with a verdict. */
function agreeingCall(verdict: AssessmentResult): Call {
  return verdict === "met" ? "meets" : "misses";
}

export function tally(readings: readonly JudgedReading[], pair: CutOffs): { matches: number; wrong: number; cantCalls: number } {
  let matches = 0;
  let wrong = 0;
  let cantCalls = 0;
  for (const r of readings) {
    const call = callOf(r.overall, pair);
    if (call === "cant_call") cantCalls++;
    else if (call === agreeingCall(r.verdict)) matches++;
    else wrong++;
  }
  return { matches, wrong, cantCalls };
}

export function candidate(readings: readonly JudgedReading[], pair: CutOffs): Candidate {
  const { matches, wrong, cantCalls } = tally(readings, pair);
  return { pair, score: matches - WRONG_CALL_COST * wrong, cantCalls };
}

/** Whether `a` wins over `b`: a higher score, then closer to the default, then a narrower band. */
function beats(a: Candidate, b: Candidate): boolean {
  if (a.score !== b.score) return a.score > b.score;
  const distance = distanceFromDefault(a.pair) - distanceFromDefault(b.pair);
  if (distance !== 0) return distance < 0;
  return a.pair.high - a.pair.low < b.pair.high - b.pair.low;
}

function distanceFromDefault(pair: CutOffs): number {
  return Math.abs(pair.low - DEFAULT_CUT_OFFS.low) + Math.abs(pair.high - DEFAULT_CUT_OFFS.high);
}
