// What compare asks Jev (jev-in-compare U5, KTD8) and what its grid reads back (KTD7, KTD6),
// worked out from the folder every time, as the cut-offs are. The action covers the takes
// in the compare that ran the first take's handoff. A held take needs a reading when it has
// none at the badge's current version, or its reading lacks one of the badge's learning
// targets as a second opinion sends them; a judged take never gets one. Each pair of takes,
// in strip order, needs a head-to-head when the rubric has points and no current one names
// both. Each request is built as the test builds a second opinion, and one over Jev's
// budget, or one Jev refused as too long this session, is named in its own line instead
// of being counted.

import { betterReply, headToHeadRequest } from "./headToHead";
import { readingOfTake, isHeld, runIdOf, type Take } from "./handoffResults";
import { fitSecondOpinion, fitsJev } from "./jevBudget";
import { examplesFor, rankExamples, type ExampleCandidate } from "./jevExamples";
import type { HeadToHeadRequest, SecondOpinionRequest } from "./jevRequest";
import { rubricParts, savedPointOf, targetsToSend } from "./secondOpinion";
import { credentialKey, type Credential, type FolderState, type HeadToHead, type JevReading, type ReplyRef } from "./types";

/** One take in a compare, in strip order. */
export interface CompareTake {
  /** The take's agent and stem, `${profileSlug}/${fileStem}`, as the compare names it. */
  id: string;
  take: Take;
  /** The name the view gives the take's column, used in the lines. */
  name: string;
}

/** A reading to ask for a held take, with what the request quotes. */
export interface ReadingItem {
  kind: "reading";
  /** The item's key in the session's too-long set (`readingKey`). */
  itemKey: string;
  entry: CompareTake;
  request: SecondOpinionRequest;
  /** The distinct earlier results its examples quote. */
  sources: string[];
  /** Whether any example carries the user's note. */
  withNotes: boolean;
}

/** A head-to-head to ask for two takes, the first earlier in the strip. */
export interface PairItem {
  kind: "pair";
  /** The item's key in the session's too-long set (`pairKey`). */
  itemKey: string;
  first: CompareTake;
  second: CompareTake;
  request: HeadToHeadRequest;
}

export type CompareItem = ReadingItem | PairItem;

/** What one press of Compare with Jev would send, and the lines that say so. */
export interface CompareJevPlan {
  /** In strip order. */
  readings: ReadingItem[];
  /** In strip order: each take with every later one. */
  pairs: PairItem[];
  /** The count line, or null with nothing to send. */
  countLine: string | null;
  /** The line saying readings quote earlier replies, or null when none does. */
  examplesLine: string | null;
  /** One line per item too long for Jev: readings in strip order, then pairs. */
  tooLongLines: string[];
}

export interface CompareJevInput {
  state: FolderState;
  key: string;
  credential: Credential;
  /** The badge's current assignment version. */
  version: string;
  /** The compare's takes, in strip order. */
  takes: readonly CompareTake[];
  /** Items Jev refused as too long while this compare has been open (KTD9). */
  skipped?: ReadonlySet<string>;
}

const NOTHING: CompareJevPlan = { readings: [], pairs: [], countLine: null, examplesLine: null, tooLongLines: [] };

/** A reading's key in the session's too-long set. */
export function readingKey(id: string): string {
  return `reading ${id}`;
}

/** A pair's key in the session's too-long set, its takes in strip order. */
export function pairKey(firstId: string, secondId: string): string {
  return `pair ${firstId} ${secondId}`;
}

/** What the compare's takes are missing, each with its request, and the lines that say so. Nothing for a badge with no rubric. */
export function planCompareJev({ state, key, credential, version, takes, skipped = new Set() }: CompareJevInput): CompareJevPlan {
  if (credential.rubric.trim() === "" || takes.length === 0) return NOTHING;
  const run = runIdOf(takes[0].take);
  const covered = takes.filter((t) => runIdOf(t.take) === run);
  const { task, rubric, learningTargets } = credential;
  const targets = targetsToSend(learningTargets);
  const tooLongLines: string[] = [];

  const readings: ReadingItem[] = [];
  let ranked: ExampleCandidate[] | null = null;
  for (const entry of covered) {
    if (!needsReading(state, entry.take, version, targets)) continue;
    const itemKey = readingKey(entry.id);
    ranked ??= rankExamples(state, key, version);
    const fitted = skipped.has(itemKey)
      ? null
      : fitSecondOpinion({ task, rubric, reply: entry.take.handBack, learningTargets }, examplesFor(ranked, entry.take.handBack));
    if (fitted) readings.push({ kind: "reading", itemKey, entry, ...fitted });
    else tooLongLines.push(`${entry.name}'s reply is too long for Jev`);
  }

  const pairs: PairItem[] = [];
  if (rubricParts(rubric).points.length > 0) {
    covered.forEach((first, i) => {
      for (const second of covered.slice(i + 1)) {
        if (currentHeadToHead(state, key, first.take, second.take, version)) continue;
        const itemKey = pairKey(first.id, second.id);
        const request = headToHeadRequest({ task, rubric, learningTargets, first: first.take.handBack, second: second.take.handBack });
        if (request && !skipped.has(itemKey) && fitsJev(request)) pairs.push({ kind: "pair", itemKey, first, second, request });
        else tooLongLines.push(`${first.name} and ${second.name} are too long for Jev together`);
      }
    });
  }

  return { readings, pairs, countLine: countLine(readings.length, pairs.length), examplesLine: examplesLine(readings), tooLongLines };
}

/**
 * The count line (KTD8): how many requests go, leaving out a zero part and using singulars.
 * Each variant is its own literal, so the guide can cite it. Null with nothing to send.
 */
export function countLine(readings: number, pairs: number): string | null {
  const n = readings + pairs;
  if (pairs === 0) {
    if (readings === 0) return null;
    return readings === 1 ? "Sends 1 request: 1 reading" : `Sends ${n} requests: ${readings} readings`;
  }
  if (readings === 0) return pairs === 1 ? "Sends 1 request: 1 head-to-head" : `Sends ${n} requests: ${pairs} head-to-heads`;
  if (readings === 1) return pairs === 1 ? "Sends 2 requests: 1 reading and 1 head-to-head" : `Sends ${n} requests: 1 reading and ${pairs} head-to-heads`;
  return pairs === 1 ? `Sends ${n} requests: ${readings} readings and 1 head-to-head` : `Sends ${n} requests: ${readings} readings and ${pairs} head-to-heads`;
}

/** The line saying readings quote earlier replies on the badge, with the user's notes when one goes; null when none quotes one. */
function examplesLine(readings: readonly ReadingItem[]): string | null {
  if (!readings.some((r) => r.sources.length > 0)) return null;
  return readings.some((r) => r.withNotes) ? "Readings also send earlier replies on this badge with your notes" : "Readings also send earlier replies on this badge";
}

/** Whether a take needs a reading: held, with none at `version` or one lacking a target as sent. */
function needsReading(state: FolderState, take: Take, version: string, targets: readonly string[]): boolean {
  if (!isHeld(take)) return false;
  const reading = currentReadingOf(state, take, version);
  if (!reading) return true;
  const read = new Set((reading.targets ?? []).map((t) => t.text.trim()));
  return targets.some((t) => !read.has(t));
}

// ---------------------------------------------------------------------------
// What the grid reads (KTD7): only what is current.

/** A take's reading (`readingOfTake`) when it was asked at `version`, else undefined. */
export function currentReadingOf(state: FolderState, take: Take, version: string): JevReading | undefined {
  const reading = readingOfTake(state, take, version);
  return reading && reading.assignmentVersion === version ? reading : undefined;
}

const sameReply = (a: ReplyRef, b: ReplyRef) => a.profileSlug === b.profileSlug && a.fileStem === b.fileStem;

/** The newest head-to-head on the badge naming both replies, in either order, at `version` (KTD4). */
export function currentHeadToHead(state: FolderState, key: string, a: ReplyRef, b: ReplyRef, version: string): HeadToHead | undefined {
  let newest: HeadToHead | undefined;
  for (const h of state.headToHeads) {
    if (credentialKey(h) !== key || h.assignmentVersion !== version) continue;
    const names = (sameReply(h.first, a) && sameReply(h.second, b)) || (sameReply(h.first, b) && sameReply(h.second, a));
    if (names && (!newest || h.id > newest.id)) newest = h;
  }
  return newest;
}

/**
 * The grid's head-to-head marks (KTD6, R7): for each take id, one list per current rubric
 * point, by index, of the take ids it covers that point better than, in strip order. Only
 * current head-to-heads count, and a point counts only where the head-to-head holds a point
 * with the same text (`savedPointOf`). Every take has a list for every point, empty when
 * unmarked.
 */
export function marksOf(state: FolderState, key: string, takes: readonly CompareTake[], version: string): Map<string, string[][]> {
  const credential = state.credentials.find((c) => credentialKey(c) === key);
  const points = credential ? rubricParts(credential.rubric).points : [];
  const marks = new Map(takes.map((t) => [t.id, points.map((): string[] => [])]));
  // Pairs go in strip order, each take with every later one, so every list fills in strip order.
  takes.forEach((a, i) => {
    for (const b of takes.slice(i + 1)) {
      const h = currentHeadToHead(state, key, a.take, b.take, version);
      if (!h) continue;
      const [first, second] = sameReply(h.first, a.take) ? [a, b] : [b, a];
      points.forEach((text, p) => {
        const point = savedPointOf(h.points, text);
        if (!point) return;
        const better = betterReply(point);
        if (better === "first") marks.get(first.id)![p].push(second.id);
        else if (better === "second") marks.get(second.id)![p].push(first.id);
      });
    }
  });
  return marks;
}
