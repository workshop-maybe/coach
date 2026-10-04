// The router (router plan): a job pasted as it would be handed to an agent, matched to the
// badge it is like, and rated for how hard it is. This module holds the text a routing ask
// sends, the requests that ask it, how their answers are read, and the job's first line a
// routing record keeps. The recommendation itself is in ./recommend.

import { JevError } from "../jev/jev";
import { DEFAULT_CUT_OFFS } from "./calls";
import { askBatches, type BatchOptions } from "./jevBatches";
import { fitsTokens, jevTokens } from "./jevBudget";
import { IMAGE, IMAGE_DATA, IMAGE_DEFINITION, INVISIBLE } from "./jevExamples";
import {
  JEV_MODEL,
  LINE_BREAK,
  answeringModel,
  isProbability,
  type DifficultyQuestion,
  type JevAnswers,
  type JevCriteria,
  type MatchQuestion,
  type RouteRequest,
} from "./jevRequest";
import { reasonLine } from "./reasonLine";
import { credentialKey, type Credential, type Rating } from "./types";

/**
 * Text as a routing ask sends it (KTD6): every line break read as `\n`, invisible and format
 * characters dropped line by line, image and video Markdown and their data URIs removed, and
 * a line left blank only by that removal dropped. Nothing else changes, so the user's words
 * and their order go as written. Trimmed.
 */
export function routeText(text: string): string {
  const kept: string[] = [];
  for (const raw of text.split(LINE_BREAK)) {
    const line = raw.replace(INVISIBLE, "");
    if (IMAGE_DEFINITION.test(line)) continue;
    const shown = line.replace(IMAGE, "").replace(IMAGE_DATA, "");
    if (shown !== line && shown.trim() === "") continue;
    kept.push(shown);
  }
  return kept.join("\n").trim();
}

/**
 * The job's first line as a routing record keeps it (KTD10): the first line with words once
 * pictures and invisible characters are gone, one line of at most 200 code points with any
 * leading heading marks dropped. Empty when the job has no words.
 */
export function jobFirstLine(job: string): string {
  const line = routeText(job)
    .split("\n")
    .find((l) => l.trim() !== "");
  return line === undefined ? "" : reasonLine(line);
}

/** What a routing ask found (KTD4, KTD11), kept with the job text and the badges it was asked about. */
export interface RouteOutcome {
  /** The job as it stood when Jev was asked. */
  job: string;
  /** The badges asked about, by credential key, in Home's order. */
  keys: string[];
  /** Jev's probability that the job is like each badge asked about, by credential key. */
  answers: Record<string, number>;
  /** The difficulty levels' probabilities, routine first, or null when none came back. */
  levels: number[] | null;
  /** The Jev model that answered the first request. */
  model: string;
}

// ---------------------------------------------------------------------------
// The routing ask (KTD1-KTD5): one Noul per badge, shaped like TypeSafe's duplicate check,
// with the badge in its own question and only the job in state, plus one Score for how hard
// the job is, in the first request it fits.

/** Every match question's text. Backticked names are the request's state and instruction keys. */
export const MATCH_QUESTION = "Does the `job` ask for the same kind of work as the `badge`?";

/** Every match question's criteria: literal, since a pasted job can argue for its own match. */
export const MATCH_CRITERIA: JevCriteria = Object.freeze({
  true: "The job asks for the kind of work the badge's task and learning targets describe, so an agent that can do the badge's task could take this job",
  false: "The job asks for a different kind of work, or only shares a topic, a tool or a word with the badge",
});

/** The id of a request's `n`th match question, from zero: "m1" … "mN", as the native side expects them. */
export function matchId(n: number): string {
  return `m${n + 1}`;
}

/** The difficulty question's id, the one Score a route may carry. */
export const DIFFICULTY_ID = "difficulty";
/** The difficulty question's text. */
export const DIFFICULTY_QUESTION = "How hard is the work the `job` asks for?";
/** The difficulty levels, in order: routine, needs judgment, unusual or high-stakes. Each describes a situation (TypeSafe's Score guidance). */
export const DIFFICULTY_LEVELS = Object.freeze([
  "Routine: a familiar, clearly defined piece of work with an obvious way to do it",
  "Needs judgment: several steps or choices to weigh, or details the job leaves open",
  "Unusual or high-stakes: an unfamiliar problem or edge case, or a mistake that would be costly or hard to undo",
] as const);

/** A badge's yes counts as a match at this probability or above (KTD4): the app's default meets cut-off. */
export const MATCH_THRESHOLD = DEFAULT_CUT_OFFS.high / 100;

/** A badge as a routing ask sends it: its key, name, task and learning targets. Never its rubric. */
export interface RouteBadge {
  key: string;
  name: string;
  task: string;
  learningTargets: readonly string[];
}

/** One request and which badge each of its match ids asks about. */
export interface RouteBatch {
  request: RouteRequest;
  /** Each match id ("m1" …) to its badge's credential key. Ids restart in every request. */
  keys: Record<string, string>;
}

/** The requests a routing ask sends, and the badges it leaves out because each is too long to fit beside the job. */
export interface RoutePlan {
  batches: RouteBatch[];
  /** The badges sent, by credential key, in the order given. */
  sent: string[];
  /** Badges left out as too long to send, by credential key. */
  tooLong: string[];
}

/** The badges a routing ask can be about, in the order given: every badge with a task, since nobody can hold one without. */
export function routeBadges(credentials: readonly Credential[]): RouteBadge[] {
  return credentials
    .filter((c) => c.task.trim() !== "")
    .map((c) => ({ key: credentialKey(c), name: c.name, task: c.task, learningTargets: c.learningTargets }));
}

/** One badge's match question. Its targets go trimmed, without blanks or repeats. */
export function matchQuestion(badge: RouteBadge): MatchQuestion {
  const learning_targets = [...new Set(badge.learningTargets.map((t) => t.trim()).filter((t) => t !== ""))];
  return {
    type: "noul",
    instructions: { badge: { name: badge.name.trim(), task: routeText(badge.task), learning_targets }, question: MATCH_QUESTION },
    criteria: MATCH_CRITERIA,
  };
}

/** The difficulty question (KTD1). */
export function difficultyQuestion(): DifficultyQuestion {
  const [routine, judgment, highStakes] = DIFFICULTY_LEVELS;
  return { type: "score", instructions: DIFFICULTY_QUESTION, criteria: [routine, judgment, highStakes] };
}

/**
 * The requests that ask Jev which of these badges the job is like, and how hard it is (KTD5).
 * Every request carries the job as its state, and packs as many match questions as fit Jev's
 * budget. A badge whose question can't fit beside the job alone is left out and counted. The
 * difficulty question rides in the first request it fits. Null when the job is too long for
 * every badge, which is what the deck calls too long. No batches when there are no badges.
 */
export function routeBatches(job: string, badges: readonly RouteBadge[]): RoutePlan | null {
  const state = { job: routeText(job) };
  const stateTokens = jevTokens(state);
  const packs: { questions: [string, MatchQuestion][]; tokens: number[] }[] = [];
  const sent: string[] = [];
  const tooLong: string[] = [];
  for (const badge of badges) {
    const question = matchQuestion(badge);
    const cost = jevTokens(question);
    if (!fitsTokens(stateTokens, [cost])) {
      tooLong.push(badge.key);
      continue;
    }
    let pack = packs[packs.length - 1];
    if (!pack || !fitsTokens(stateTokens, [...pack.tokens, cost])) packs.push((pack = { questions: [], tokens: [] }));
    pack.questions.push([badge.key, question]);
    pack.tokens.push(cost);
    sent.push(badge.key);
  }
  if (badges.length > 0 && sent.length === 0) return null;

  const difficulty = difficultyQuestion();
  const difficultyCost = jevTokens(difficulty);
  const withDifficulty = packs.findIndex((p) => fitsTokens(stateTokens, [...p.tokens, difficultyCost]));
  const batches = packs.map((pack, i): RouteBatch => {
    const keys: Record<string, string> = {};
    const questions: RouteRequest["questions"] = {};
    pack.questions.forEach(([key, question], n) => {
      const id = matchId(n);
      keys[id] = key;
      questions[id] = question;
    });
    if (i === withDifficulty) questions[DIFFICULTY_ID] = difficulty;
    return { request: { kind: "route", state, questions }, keys };
  });
  return { batches, sent, tooLong };
}

/**
 * Asks Jev every request of a plan, one at a time (KTD5), and reads what it found. All or
 * nothing: an answer missing an id, not a probability, or with levels that aren't three
 * probabilities fails the ask as "other" before the next request goes. Null once cancelled.
 */
export async function askRoute(
  job: string,
  plan: RoutePlan,
  ask: (request: RouteRequest) => Promise<JevAnswers>,
  options: Pick<BatchOptions<RouteRequest>, "wait" | "cancelled"> = {},
): Promise<RouteOutcome | null> {
  const answers: Record<string, number> = {};
  let levels: number[] | null = null;
  const check = (request: RouteRequest, got: JevAnswers, index: number) => {
    for (const [id, key] of Object.entries(plan.batches[index].keys)) {
      const p = (got.answers as Record<string, unknown> | undefined)?.[id];
      if (!isProbability(p)) throw new JevError("other");
      answers[key] = p;
    }
    if (DIFFICULTY_ID in request.questions) {
      const read: unknown = (got.levels as Record<string, unknown> | undefined)?.[DIFFICULTY_ID];
      if (!Array.isArray(read) || read.length !== DIFFICULTY_LEVELS.length || !read.every(isProbability)) throw new JevError("other");
      levels = [...read];
    }
  };
  const got = await askBatches(
    plan.batches.map((b) => b.request),
    ask,
    { ...options, check },
  );
  if (got === null) return null;
  return { job, keys: plan.sent, answers, levels, model: got.length > 0 ? answeringModel(got[0]) : JEV_MODEL };
}

/**
 * The badge a job matches, from Jev's answers and the badges still in the folder in Home's
 * order (KTD4): the strongest yes at or above the threshold, the first on Home on a tie, and
 * the others at or above it as "also like". A badge no longer in the folder never matches.
 */
export function matchOf(answers: Readonly<Record<string, number>>, keys: readonly string[]): { best: string | null; alsoLike: string[] } {
  const over = keys.filter((k) => (answers[k] ?? 0) >= MATCH_THRESHOLD);
  let best: string | null = null;
  for (const k of over) if (best === null || answers[k] > answers[best]) best = k;
  return { best, alsoLike: over.filter((k) => k !== best) };
}

/** An expected level below this rates the job routine (KTD2): nearer level 0 than level 1. */
export const ROUTINE_BELOW = 0.5;
/** An expected level below this, and not routine, rates the job as needing judgment; at or above it, unusual or high-stakes. */
export const JUDGMENT_BELOW = 1.5;

/** The expected level the difficulty's probabilities give: each level's number times its probability, summed. */
export function expectedLevel(levels: readonly number[]): number {
  return levels.reduce((sum, p, i) => sum + i * p, 0);
}

/**
 * How hard Jev rates the job (KTD2): the level nearest the expected level its probabilities
 * give, worked out here rather than read from TypeSafe's score. Null without levels.
 */
export function ratingOf(levels: readonly number[] | null): Rating | null {
  if (!levels || levels.length !== DIFFICULTY_LEVELS.length) return null;
  const expected = expectedLevel(levels);
  return expected < ROUTINE_BELOW ? "routine" : expected < JUDGMENT_BELOW ? "judgment" : "high-stakes";
}
