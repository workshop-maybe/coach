// The Jev deep dive's examples (KTD2-KTD5 of docs/plans/2026-10-04-1503-docs-jev-deep-dive-plan.md):
// every request, reading, saved file and cleanup the deep dive shows, produced by the app's
// own code from the screenshot sample folder and the case studies' scenarios in
// src/shots/shots.ts. Nothing here is written by hand except Jev's answers, which are
// illustrative: the deep dive never asks TypeSafe.
//
// site/tests/deepDive.test.ts compares each example with its committed file under
// examples/, and `npm run site:examples` rewrites them after an intended change. The pages
// show the files through the <Example> component.
//
// The second opinion follows src/ui/TestDeck.tsx: the ranked examples, the fitted request,
// the reading frozen with the pair for the model that answered, `savedReading` (in
// src/domain/savedReading.ts), then `recordAssessment`. The UI cross-check (site/tests/deepDiveFlow.test.tsx) proves the judge
// pane sends this request and saves this reading.
//
// Jev in compare follows src/ui/useCompareJev.ts and the take actions: `planCompareJev`, the
// pair's request, `headToHeadPoints` and `saveHeadToHead`, the grid (`compareGridOf`), then
// Met under both held replies (`judgeHeldReply`) and Change to Not yet under Codex's
// (`overruled`, `rejudgeResult`). The router follows src/ui/RouterDeck.tsx: `routeBatches`,
// `askRoute`, `matchOf`, `ratingOf`, `recommend` and `takeAgentForJob`. The same cross-check
// file drives the real compare view and router deck over the same scenarios.

import YAML from "yaml";
import { planCompareJev, type CompareTake } from "../../../src/domain/compareJev";
import { readingOfTake } from "../../../src/domain/handoffResults";
import { betterReply, headToHeadPoints } from "../../../src/domain/headToHead";
import { buildMatrix, type Matrix } from "../../../src/domain/matrix";
import { recommend, type CleanHolder, type Recommendation } from "../../../src/domain/recommend";
import {
  DIFFICULTY_ID,
  DIFFICULTY_LEVELS,
  JUDGMENT_BELOW,
  MATCH_THRESHOLD,
  ROUTINE_BELOW,
  askRoute,
  expectedLevel,
  matchOf,
  ratingOf,
  routeBadges,
  routeBatches,
} from "../../../src/domain/router";
import type { MemoryStorage } from "../../../src/storage/memory";
import { columnsOf, compareGridOf } from "../../../src/ui/CompareGrid";
import { CALL_WORDS, percent } from "../../../src/ui/JevReading";
import { overruled } from "../../../src/ui/JudgeStep";
import { DEFAULT_CUT_OFFS, calibrationOf, callOf, candidate, isOverrule, ranksAsOverrule, tally, wholePercent, type Calibration, type CutOffs, type JudgedReading } from "../../../src/domain/calls";
import { ROUTING_DIR, assessmentPath, headToHeadDir, loadFolder, rejudgedDir } from "../../../src/domain/folder";
import { BUILT_IN_HANDOFF, SKELETON_ID, fillHandoff } from "../../../src/domain/handoffs";
import { assignmentVersion } from "../../../src/domain/hash";
import { JEV_LIMITS, JEV_MODEL, MAX_EXAMPLES_PER_SIDE, answeringModel, type CriteriaSide, type JevAnswers, type JevExample, type JevExampleEntry, type SecondOpinionRequest } from "../../../src/domain/jevRequest";
import { fitSecondOpinion, fitsTokens, jevTokens } from "../../../src/domain/jevBudget";
import { examplesFor, rankExamples, type ExampleCandidate } from "../../../src/domain/jevExamples";
import { jevReply } from "../../../src/domain/jevReply";
import { cutOffAfter, joinLines, lineBreakBatches, lineBreakState, lineId } from "../../../src/domain/lineBreaks";
import { scanLines } from "../../../src/domain/markdownLines";
import { judgeHeldReply, recordAssessment, rejudgeResult, saveHeadToHead, takeAgentForJob } from "../../../src/domain/operations";
import { findJoinCandidates, fixPastedText, looksTerminalCopied, wrapWidth } from "../../../src/domain/pasteText";
import { reasonLine } from "../../../src/domain/reasonLine";
import { readingParts, rubricParts, tappedPoints } from "../../../src/domain/secondOpinion";
import { credentialKey, type Assessment, type AssessmentResult, type Credential, type FolderState, type HeldReply, type Rating } from "../../../src/domain/types";
import { SAMPLE, SAMPLE_READING, sampleFolder, sampleStorage } from "../../../src/shots/seed";
import {
  CASE_CALLS,
  CASE_MISSED_POINT,
  CASE_REASON,
  CASE_REPLY,
  COMPARE_MISSED_POINT,
  COMPARE_REASON,
  HEAD_TO_HEAD_CALLS,
  ROUTER_CALLS,
  ROUTER_JOB,
  ROUTER_LEVELS,
  TERMINAL_REPLY,
} from "../../../src/shots/shots";
import { savedReading } from "../../../src/domain/savedReading";
import type { ReadingInHand } from "../../../src/ui/TestDeck";

/**
 * What Jev answers about each candidate break in the cleanup case study. Illustrative, not
 * a real reading: every break is a wrap, and each answer clears its cut-off.
 */
export const CLEANUP_CALLS: Readonly<Record<string, number>> = { L004: 0.96, L005: 0.91, L008: 0.94, L009: 0.89, L010: 0.93 };

/** When the case study's ask and save happen. The app stamps both with the clock. */
export const CASE_ASKED_AT = "2026-10-01T09:12:00.000Z";
export const CASE_RECORDED_AT = "2026-10-01T09:14:00.000Z";

/** The second-opinion case study, as the app builds and saves it. */
export interface SecondOpinionCase {
  /** The folder before the result is saved. */
  state: FolderState;
  reply: string;
  /** The badge's results as example sources, best first. */
  ranked: ExampleCandidate[];
  request: SecondOpinionRequest;
  sources: string[];
  answers: JevAnswers;
  /** The badge's cut-offs and track record for the model that answered. */
  calibration: Calibration;
  /** The saved result file as recordAssessment wrote it, whole. */
  savedFile: string;
  /** That result, as the folder reads it back. */
  saved: Assessment;
}

/** When the compare case study's head-to-head is asked, and when its re-judge is saved. The app stamps both with the clock. */
export const COMPARE_ASKED_AT = "2026-10-01T09:30:00.000Z";
export const COMPARE_REJUDGED_AT = "2026-10-01T09:40:00.000Z";

/** Jev in compare, as the app builds and saves it. */
export interface CompareCase {
  key: string;
  credential: Credential;
  version: string;
  /** Claude Code's and Codex's held replies, in strip order, as the compare names them. */
  takes: CompareTake[];
  plan: ReturnType<typeof planCompareJev>;
  answers: JevAnswers;
  /** The full sample folder before anything is asked. */
  state: FolderState;
  /** The folder after the head-to-head is saved, and its file as `saveHeadToHead` wrote it. */
  afterPair: FolderState;
  headToHeadFile: string;
  /** The folder after Met under Claude Code's reply, then under Codex's, and Codex's result file. */
  afterClaudeMet: FolderState;
  afterMet: FolderState;
  codexResultFile: string;
  /** The folder after Change to Not yet under Codex's reply, and the re-judge file it wrote. */
  afterRejudge: FolderState;
  rejudgeFile: string;
}

/** The router case study, as the app builds and saves it. */
export interface RouterCase {
  state: FolderState;
  plan: NonNullable<ReturnType<typeof routeBatches>>;
  answers: JevAnswers;
  /** What the routing ask found, as the card reads it, and the folder's matrix the card recommends from. */
  outcome: NonNullable<Awaited<ReturnType<typeof askRoute>>>;
  matrix: Matrix;
  /** The routing record file as `takeAgentForJob` wrote it. */
  recordFile: string;
}

// Each is built once per process: the tests and the generator read them, and never change them.
let secondOpinion: Promise<SecondOpinionCase> | undefined;
let compare: Promise<CompareCase> | undefined;
let router: Promise<RouterCase> | undefined;
let examples: Promise<Record<string, string>> | undefined;

/** The second-opinion case study: Claude Code's reply to Check an answer key over the judged sample. */
export function secondOpinionCase(): Promise<SecondOpinionCase> {
  return (secondOpinion ??= buildSecondOpinionCase());
}

/** Jev in compare: the bake-off on Check an answer key over the full sample. */
export function compareCase(): Promise<CompareCase> {
  return (compare ??= buildCompareCase());
}

/** The router: the sample job over the full sample. */
export function routerCase(): Promise<RouterCase> {
  return (router ??= buildRouterCase());
}

/** Every example file the deep dive shows, by its path under examples/. */
export function buildExamples(): Promise<Record<string, string>> {
  return (examples ??= Promise.all([secondOpinionExamples(), compareExamples(), routerExamples()]).then(([opinion, compared, routed]) => ({
    ...opinion,
    ...cleanupExamples(),
    ...compared,
    ...routed,
  })));
}

async function buildSecondOpinionCase(): Promise<SecondOpinionCase> {
  const storage = sampleStorage(await sampleFolder("judged"));
  const state = await loadFolder(storage);
  const key = SAMPLE.badges.answerKey;
  const credential = state.credentials.find((c) => credentialKey(c) === key)!;
  const profile = state.profiles.find((p) => p.slug === SAMPLE.agents.claude)!;
  const version = await assignmentVersion(credential.task, credential.rubric);
  // The reply as the reply box holds a plain-text paste: after the paste's fixes.
  const reply = fixPastedText(CASE_REPLY).text;

  // Jev reads the reply as one text item, as TestDeck projects it (reply-artifacts KTD8).
  const read = jevReply([{ kind: "text", text: reply }], () => null);

  const ranked = rankExamples(state, key, version);
  const fitted = fitSecondOpinion({ task: credential.task, rubric: credential.rubric, reply: read, learningTargets: credential.learningTargets }, examplesFor(ranked, read))!;
  const answers: JevAnswers = { answers: { ...CASE_CALLS }, model: JEV_MODEL };
  const parts = readingParts(fitted.request.state.rubric_points, answers, fitted.request.state.learning_targets)!;
  const model = answeringModel(answers);
  // Not yet was picked before Check with Jev, so the reading is seen after the verdict.
  const inHand: ReadingInHand = {
    round: 0,
    reply,
    assignmentVersion: version,
    askedAt: CASE_ASKED_AT,
    parts,
    verdictWhenSeen: "not_met",
    model,
    calibration: calibrationOf(state, key, model),
    examplesSent: fitted.sources.length,
  };
  const points = rubricParts(credential.rubric).points;
  const { fileStem } = await recordAssessment(
    storage,
    state,
    {
      profileSlug: profile.slug,
      collectionSlug: credential.collectionSlug,
      credentialSlug: credential.slug,
      result: "not_met",
      note: isOverrule({ result: "not_met", jev: parts }, inHand.calibration.pair) ? reasonLine(CASE_REASON) : "",
      handBack: reply,
      context: { ...SAMPLE_READING, capturedAt: CASE_ASKED_AT },
      handoff: { id: SKELETON_ID, text: fillHandoff(BUILT_IN_HANDOFF, credential) },
      jev: savedReading(inHand, "not_met"),
      missedPoints: tappedPoints(points, [CASE_MISSED_POINT]),
    },
    new Date(CASE_RECORDED_AT),
  );
  const savedFile = (await storage.readText("data", assessmentPath(profile.slug, credential.collectionSlug, credential.slug, fileStem)))!;
  const saved = (await loadFolder(storage)).assessments.find((a) => a.profileSlug === profile.slug && credentialKey(a) === key && a.fileStem === fileStem)!;
  const { request, sources } = fitted;
  return { state, reply, ranked, request, sources, answers, calibration: inHand.calibration, savedFile, saved };
}

// ---------------------------------------------------------------------------
// The second opinion

async function secondOpinionExamples(): Promise<Record<string, string>> {
  const c = await secondOpinionCase();
  const { calibration } = c;
  const name = (slug: string) => c.state.profiles.find((p) => p.slug === slug)?.name ?? slug;

  // The badge's results as example sources, in the order the ranking puts them.
  const ranked = c.ranked.map((r) => ({
    rank: r.rank,
    result: `${name(r.result.profileSlug)}, ${r.result.recordedAt.slice(0, 10)}`,
    verdict: r.result.result,
    overall: r.result.jev ? `${wholePercent(r.result.jev.overall)}%` : null,
    note: r.result.note.trim() || null,
    ranks_as: r.result.note.trim() !== "" ? "overrule with a reason" : r.result.jev && ranksAsOverrule(r.result, calibration.pair) ? "overrule" : "other",
    sent: c.sources.includes(r.sourceId),
  }));

  const q = c.request.questions;
  const tokens = Object.fromEntries(Object.entries(q).map(([id, question]) => [id, jevTokens(question)]));
  const questionTokens = Object.values(tokens);
  const stateTokens = jevTokens(c.request.state);
  const budget = {
    state_tokens: stateTokens,
    question_tokens: tokens,
    state_plus_longest: stateTokens + Math.max(...questionTokens),
    state_plus_all: stateTokens + sum(questionTokens),
    limits: LIMITS,
    fits: fitsTokens(stateTokens, questionTokens),
  };

  // Each answer as the reading shows it: whole percent, and its call under both pairs.
  const row = (id: string, text: string, probability: number) => ({
    id,
    text,
    percent: wholePercent(probability),
    default_call: callOf(probability, DEFAULT_CUT_OFFS),
    fitted_call: callOf(probability, calibration.pair),
  });
  const s = c.request.state;
  const reading = {
    pair: calibration.pair,
    rows: [
      ...s.rubric_points.map((text, i) => row(`p${i + 1}`, text, c.answers.answers[`p${i + 1}`])),
      row("overall", "Overall", c.answers.answers.overall),
      ...s.learning_targets.map((text, i) => row(`t${i + 1}`, text, c.answers.answers[`t${i + 1}`])),
    ],
  };

  return {
    "second-opinion/reply.txt": `${c.reply}\n`,
    "second-opinion/ranking.json": json(ranked),
    "second-opinion/request.json": json(c.request),
    "second-opinion/request-state.json": json(c.request.state),
    "second-opinion/request-p2.json": json({ p2: q.p2 }),
    "second-opinion/request-t1.json": json({ t1: q.t1 }),
    "second-opinion/request-overall.json": json({ overall: q.overall }),
    "second-opinion/budget.json": json(budget),
    "second-opinion/answers.json": json(c.answers),
    "second-opinion/reading.json": json(reading),
    "second-opinion/fit.json": json(fitExample(c.state, calibration)),
    "second-opinion/saved-result.md": savedForPage(c.savedFile),
    "second-opinion/forced-drops.json": json(forcedDrops()),
  };
}

/** The judged sample's readings on Check an answer key, each read under both pairs, and what the fit and the track record make of them. */
function fitExample(state: FolderState, calibration: Calibration) {
  const results = state.assessments
    .filter((a) => credentialKey(a) === SAMPLE.badges.answerKey && a.jev?.model === JEV_MODEL)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const readings: JudgedReading[] = results.map((a) => ({ overall: a.jev!.overall, verdict: a.result }));
  // The fit's own counting and score, under one pair.
  const scored = (pair: CutOffs) => {
    const { matches, wrong, cantCalls } = tally(readings, pair);
    return { pair, matches, wrong, cant_calls: cantCalls, score: candidate(readings, pair).score };
  };
  return {
    readings: readings.map((r) => ({
      verdict: r.verdict,
      overall: wholePercent(r.overall),
      default_call: callOf(r.overall, DEFAULT_CUT_OFFS),
      fitted_call: callOf(r.overall, calibration.pair),
    })),
    default_pair: scored(DEFAULT_CUT_OFFS),
    fitted_pair: scored(calibration.pair),
    fitted: calibration.fitted,
    judged: calibration.judged,
    track_record: calibration.trackRecord,
  };
}

/**
 * The saved result file as a page shows it: the front matter without the context the test
 * started with (it names the sample computer) or the handoff text (shown on its own), and the
 * note. The reply follows under its Handback heading in the real file.
 */
function savedForPage(file: string): string {
  const [, front, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(file)!;
  const data = YAML.parse(front) as Record<string, unknown>;
  delete data.context;
  delete data.handoff;
  const note = body.slice(0, body.indexOf("## Handback")).trim();
  return `---\n${YAML.stringify(data)}---\n\n${note}\n`;
}

/**
 * A second opinion too big for every example it was offered: three rubric points, four
 * earlier results each offering an example on every side it can show on, so every side holds
 * exactly as many as the per-side cap admits, as examplesFor hands them over, and a reply long
 * enough that about half the examples must go. Which go is the budget step's call.
 */
function forcedDrops() {
  const rubric = ["- The summary names the change.", "- It says who is affected.", "- It says what to do next.", "", "Met when every point holds."].join("\n");
  const input = { task: "Summarize the change for the people it affects.", rubric, learningTargets: [] };
  const opening = (rank: number) => `Reply ${rank + 1} opens here. ${"It explains the change, who it reaches, and what they do next. ".repeat(4)}`.trim().slice(0, 300);
  const entries: JevExampleEntry[] = [];
  for (let rank = 0; rank < 2 * MAX_EXAMPLES_PER_SIDE; rank++) {
    const met = rank % 2 === 0;
    const item = met ? { reply_opening: opening(rank) } : { reply_opening: opening(rank), user_reason: `Reason ${rank + 1}: it never says who is affected.` };
    const sides = met ? [["p1", "true"], ["p2", "true"], ["p3", "true"], ["overall", "true"]] : [["p2", "false"], ["overall", "false"]];
    for (const [questionId, side] of sides) {
      const withReason = side === "false" || questionId === "overall";
      entries.push({ questionId, side: side as "true" | "false", rank, sourceId: `reply-${rank + 1}`, item: withReason ? item : { reply_opening: item.reply_opening } });
    }
  }
  const kept = (length: number) => {
    const fitted = fitSecondOpinion({ ...input, reply: filler(length) }, entries);
    return fitted ? sum(Object.values(fitted.request.questions).flatMap((question) => examplesBySide(question).map(({ examples }) => examples.length))) : -1;
  };
  // The shortest reply that drops every example but still fits, then halfway back to the
  // shortest that drops any: a reply that keeps some examples and drops others.
  const offered = kept(0);
  const firstDrop = smallest((n) => kept(n) < offered, 0);
  const allDropped = smallest((n) => kept(n) <= 0, firstDrop);
  const length = Math.round((firstDrop + allDropped) / 2);
  const fitted = fitSecondOpinion({ ...input, reply: filler(length) }, entries)!;
  // Each rank's opening is its own, so an example is known by its question, side and opening.
  const sent = new Set(
    Object.entries(fitted.request.questions).flatMap(([questionId, question]) =>
      examplesBySide(question).flatMap(({ side, examples }) => examples.map((ex) => `${questionId}:${side}:${ex.reply_opening}`)),
    ),
  );
  const status = entries.map((e) => ({ question: e.questionId, side: e.side, rank: e.rank, kept: sent.has(`${e.questionId}:${e.side}:${e.item.reply_opening}`) }));
  const questionTokens = Object.values(fitted.request.questions).map(jevTokens);
  return {
    reply_characters: length,
    state_tokens: jevTokens(fitted.request.state),
    longest_question_tokens: Math.max(...questionTokens),
    all_question_tokens: sum(questionTokens),
    limits: { state_plus_longest: JEV_LIMITS.stateAndLongest, state_plus_all: JEV_LIMITS.whole },
    offered: status.length,
    kept: status.filter((e) => e.kept).length,
    examples: status,
  };
}

/** The examples on each side of a question's criteria. A plain side has none. */
function examplesBySide(question: SecondOpinionRequest["questions"][string]): { side: CriteriaSide; examples: readonly JevExample[] }[] {
  return (["true", "false"] as const).map((side) => {
    const criterion = question.criteria?.[side];
    return { side, examples: criterion && typeof criterion !== "string" ? criterion.examples : [] };
  });
}

/** Plain prose of the given length, standing in for a long reply. */
function filler(length: number): string {
  const sentence = "The agent describes each step it took and the files it changed. ";
  return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
}

/** The smallest whole number from `from` for which `holds` is true, over a range wide enough for Jev's budget. */
function smallest(holds: (n: number) => boolean, from: number): number {
  let lo = from;
  let hi = 400_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (holds(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Jev in compare

/** One of the folder's held replies, by agent slug and stem. */
function heldIn(state: FolderState, profileSlug: string, fileStem: string): HeldReply | undefined {
  return state.held.find((h) => h.profileSlug === profileSlug && h.fileStem === fileStem);
}

/** The folder's take for a compare take: still held, or the result it became. */
function takeIn(state: FolderState, t: CompareTake) {
  const { profileSlug, fileStem } = t.take;
  return heldIn(state, profileSlug, fileStem) ?? state.assessments.find((a) => a.profileSlug === profileSlug && credentialKey(a) === credentialKey(t.take) && a.fileStem === fileStem)!;
}

/** The text of the one file a folder holds under `dir`. */
async function onlyFileUnder(storage: MemoryStorage, dir: string): Promise<string> {
  const [path] = await storage.listFiles("data", dir);
  return (await storage.readText("data", path))!;
}

async function buildCompareCase(): Promise<CompareCase> {
  const storage = sampleStorage(await sampleFolder("full"));
  const state = await loadFolder(storage);
  const key = SAMPLE.badges.answerKey;
  const credential = state.credentials.find((c) => credentialKey(c) === key)!;
  const version = await assignmentVersion(credential.task, credential.rubric);
  const claudeHeld = heldIn(state, SAMPLE.agents.claude, SAMPLE.held.claudeAnswerKey)!;
  const codexHeld = heldIn(state, SAMPLE.agents.codex, SAMPLE.held.codexAnswerKey)!;
  // The compare What needs you opens for the bake-off: Claude Code, then Codex.
  const takes: CompareTake[] = columnsOf(
    [claudeHeld, codexHeld].map((take) => ({ id: `${take.profileSlug}/${take.fileStem}`, profile: state.profiles.find((p) => p.slug === take.profileSlug)!, take })),
  );
  const plan = planCompareJev({ state, key, credential, version, takes });
  const [pair] = plan.pairs;
  const answers: JevAnswers = { answers: { ...HEAD_TO_HEAD_CALLS }, model: JEV_MODEL };
  const points = headToHeadPoints(pair.request.state.rubric_points, answers)!;
  const afterPair = await saveHeadToHead(
    storage,
    state,
    {
      collectionSlug: credential.collectionSlug,
      credentialSlug: credential.slug,
      model: answeringModel(answers),
      assignmentVersion: version,
      askedAt: COMPARE_ASKED_AT,
      first: { profileSlug: claudeHeld.profileSlug, fileStem: claudeHeld.fileStem },
      second: { profileSlug: codexHeld.profileSlug, fileStem: codexHeld.fileStem },
      points,
    },
    new Date(COMPARE_ASKED_AT),
  );
  const headToHeadFile = await onlyFileUnder(storage, headToHeadDir(credential.collectionSlug, credential.slug));

  // Met under both: each agrees with its reply's reading, so each saves at once.
  const ref = (h: HeldReply) => ({ profileSlug: h.profileSlug, collectionSlug: h.collectionSlug, credentialSlug: h.credentialSlug, fileStem: h.fileStem });
  const afterClaudeMet = await judgeHeldReply(storage, afterPair, ref(claudeHeld), "met");
  const afterMet = await judgeHeldReply(storage, afterClaudeMet, ref(codexHeld), "met");
  const codexResultFile = (await storage.readText("data", assessmentPath(codexHeld.profileSlug, codexHeld.collectionSlug, codexHeld.credentialSlug, codexHeld.fileStem)))!;

  // Change to Not yet under Codex's reply goes against its meets reading: what the step gathers, saved as a re-judge.
  const afterRejudge = await rejudgeResult(
    storage,
    afterMet,
    ref(codexHeld),
    "not_met",
    { note: COMPARE_REASON, missedPoints: [COMPARE_MISSED_POINT] },
    new Date(COMPARE_REJUDGED_AT),
  );
  const rejudgeFile = await onlyFileUnder(storage, rejudgedDir(codexHeld.profileSlug, codexHeld.collectionSlug, codexHeld.credentialSlug));
  return { key, credential, version, takes, plan, answers, state, afterPair, headToHeadFile, afterClaudeMet, afterMet, codexResultFile, afterRejudge, rejudgeFile };
}

async function compareExamples(): Promise<Record<string, string>> {
  const c = await compareCase();
  const { credential } = c;
  const [pair] = c.plan.pairs;
  const q = pair.request.questions;
  const nameOf = (id: string) => c.takes.find((t) => t.id === id)!.name;

  // What one press asks for: whether each held reply needs a reading, and the pairs.
  const plan = {
    replies: c.takes.map((t) => {
      const reading = readingOfTake(c.state, t.take, c.version);
      return {
        reply: t.name,
        state: "held",
        reading: reading && reading.assignmentVersion === c.version ? `current, ${percent(reading.overall)} overall` : null,
        needs_a_reading: c.plan.readings.some((r) => r.entry.id === t.id),
      };
    }),
    pairs: c.plan.pairs.map((p) => ({ reply_1: p.first.name, reply_2: p.second.name })),
    count_line: c.plan.countLine,
    examples_line: c.plan.examplesLine,
    too_long_lines: c.plan.tooLongLines,
  };

  // Each point's two answers, their calls under the fixed band, and which reply covers it better.
  const points = headToHeadPoints(pair.request.state.rubric_points, c.answers)!;
  const marks = points.map((p, i) => {
    const better = betterReply(p);
    return {
      point: i + 1,
      [`a${i + 1}`]: percent(p.firstOver),
      [`b${i + 1}`]: percent(p.secondOver),
      a_call: CALL_WORDS[callOf(p.firstOver, DEFAULT_CUT_OFFS)],
      b_call: CALL_WORDS[callOf(p.secondOver, DEFAULT_CUT_OFFS)],
      better: better === "first" ? pair.first.name : better === "second" ? pair.second.name : null,
    };
  });

  // The grid after the head-to-head is saved, as the view draws it: each row's cell under each reply.
  const columns = columnsOf(c.takes.map((t) => ({ id: t.id, profile: c.afterPair.profiles.find((p) => p.slug === t.take.profileSlug)!, take: takeIn(c.afterPair, t) })));
  const grid = compareGridOf(c.afterPair, c.key, credential, c.version, columns)!;
  const cell = (id: string, probability: number | undefined, better: readonly string[] = []) => {
    const read = grid.readings.get(id);
    const call = probability === undefined || !read ? null : `${CALL_WORDS[callOf(probability, read.pair)]} ${percent(probability)}`;
    return better.length > 0 ? `${call} · Better than ${better.map(nameOf).join(", ")}` : call;
  };
  const row = (text: string, value: (id: string) => string | null) => ({ row: text, cells: Object.fromEntries(columns.map((col) => [col.name, value(col.id)])) });
  const gridRows = [
    ...grid.points.map((text, i) =>
      row(text, (id) => cell(id, grid.readings.get(id)?.reading.points.find((p) => p.text === text)?.probability, grid.marks.get(id)?.[i])),
    ),
    ...grid.targets.map((text) => row(text, (id) => cell(id, grid.readings.get(id)?.reading.targets?.find((t) => t.text === text)?.probability))),
    row("Overall", (id) => cell(id, grid.readings.get(id)?.reading.overall)),
  ];

  // Each verdict the story gives, read against the reply's own reading, and whether the step opens.
  const verdict = (state: FolderState, t: CompareTake, result: AssessmentResult, action: string) => {
    const take = takeIn(state, t);
    const reading = readingOfTake(state, take, c.version)!;
    const against = overruled(state, c.key, take, c.version, result);
    return { reply: t.name, action, reading_overall: percent(reading.overall), reading_calls: CALL_WORDS[callOf(reading.overall, against?.pair ?? DEFAULT_CUT_OFFS)], step_opens: against !== null };
  };
  const [claude, codex] = c.takes;
  const verdicts = [verdict(c.afterPair, claude, "met", "Met"), verdict(c.afterClaudeMet, codex, "met", "Met"), verdict(c.afterMet, codex, "not_met", "Change to Not yet")];

  const rejudged = takeIn(c.afterRejudge, codex) as Assessment;
  return {
    "compare/plan.json": json(plan),
    "compare/request-state.json": json(pair.request.state),
    "compare/request-point-4.json": json({ a4: q.a4, b4: q.b4 }),
    "compare/request.json": json(pair.request),
    "compare/answers.json": json(c.answers),
    "compare/marks.json": json(marks),
    "compare/head-to-head.json": c.headToHeadFile,
    "compare/grid.json": json(gridRows),
    "compare/verdicts.json": json(verdicts),
    "compare/judged-result.md": savedForPage(c.codexResultFile),
    "compare/rejudge.md": c.rejudgeFile,
    "compare/rejudged-result.json": json({
      result: rejudged.result,
      recorded_at: rejudged.recordedAt,
      note: rejudged.note,
      missed_points: rejudged.missedPoints ?? [],
      earlier_verdicts: rejudged.earlierVerdicts ?? [],
    }),
  };
}

// ---------------------------------------------------------------------------
// The router

/** The badge the case study's user taps under Also like, and takes the card's pick for. */
const ROUTER_TAPPED = SAMPLE.badges.answerKey;

async function buildRouterCase(): Promise<RouterCase> {
  const storage = sampleStorage(await sampleFolder("full"));
  const state = await loadFolder(storage);
  const plan = routeBatches(ROUTER_JOB, routeBadges(state.credentials))!;
  const answers: JevAnswers = { answers: { ...ROUTER_CALLS }, levels: { [DIFFICULTY_ID]: [...ROUTER_LEVELS] }, model: JEV_MODEL };
  const outcome = (await askRoute(ROUTER_JOB, plan, async () => answers))!;
  const rating = ratingOf(outcome.levels);
  const credential = state.credentials.find((c) => credentialKey(c) === ROUTER_TAPPED)!;
  const matrix = await buildMatrix(state);
  const rec = recommend(state, matrix, ROUTER_TAPPED, rating);
  if (rec.kind !== "pick" || !matchOf(outcome.answers, state.credentials.map(credentialKey)).alsoLike.includes(ROUTER_TAPPED)) {
    throw new Error("The router case study expects its tapped badge under Also like, with a pick.");
  }
  await takeAgentForJob(storage, state, {
    job: ROUTER_JOB,
    collectionSlug: credential.collectionSlug,
    credentialSlug: credential.slug,
    profileSlug: rec.pick.profile.slug,
    recommended: rec.pick.profile.slug,
    basis: rec.basis,
    steppedUp: rec.step === "stepped-up",
    matched: "also-like",
    ...(rating ? { difficulty: rating } : {}),
    jevModel: outcome.model,
  });
  return { state, plan, answers, outcome, matrix, recordFile: await onlyFileUnder(storage, ROUTING_DIR) };
}

/** A recommendation as the card states it, agents by name. */
function cardOf(rec: Recommendation) {
  const name = (h: CleanHolder) => h.profile.name;
  if (rec.kind === "no-holder") return { kind: rec.kind, flagged: rec.flagged.map((f) => f.profile.name) };
  if (rec.kind === "no-pick") return { kind: rec.kind, holders: rec.holders.map(name), no_cost_order: rec.noCostOrder };
  return {
    kind: rec.kind,
    pick: name(rec.pick),
    basis: rec.basis,
    step: rec.step,
    cheaper: rec.cheaper.map(name),
    next_up: rec.nextUp ? name(rec.nextUp) : null,
    other_holders: rec.alternatives.map(name),
  };
}

async function routerExamples(): Promise<Record<string, string>> {
  const r = await routerCase();
  const [batch] = r.plan.batches;
  const nameOf = (key: string) => r.state.credentials.find((c) => credentialKey(c) === key)!.name;
  const { outcome, matrix } = r;
  const match = matchOf(outcome.answers, r.state.credentials.map(credentialKey));
  const levels = outcome.levels!;
  const rating = ratingOf(levels)!;
  const ratings: Rating[] = [rating, "high-stakes"];
  const recommendations = [match.best!, ...match.alsoLike].flatMap((key) =>
    ratings.map((asRated) => ({ badge: nameOf(key), rating: asRated, card: cardOf(recommend(r.state, matrix, key, asRated)) })),
  );
  return {
    "router/job.txt": `${ROUTER_JOB}\n`,
    "router/request.json": json(batch.request),
    "router/request-m2.json": json({ m2: batch.request.questions.m2 }),
    "router/request-difficulty.json": json({ [DIFFICULTY_ID]: batch.request.questions[DIFFICULTY_ID] }),
    "router/answers.json": json(r.answers),
    "router/match.json": json({
      threshold: `${Math.round(MATCH_THRESHOLD * 100)}%`,
      badges: Object.entries(batch.keys).map(([id, key]) => ({
        id,
        badge: nameOf(key),
        yes: percent(outcome.answers[key]),
        role: key === match.best ? "match" : match.alsoLike.includes(key) ? "also like" : null,
      })),
    }),
    "router/rating.json": json({
      levels: Object.fromEntries(DIFFICULTY_LEVELS.map((level, i) => [level.slice(0, level.indexOf(":")), levels[i]])),
      expected_level: Math.round(expectedLevel(levels) * 100) / 100,
      routine_below: ROUTINE_BELOW,
      judgment_below: JUDGMENT_BELOW,
      rating,
    }),
    "router/recommendations.json": json(recommendations),
    "router/routing-record.json": r.recordFile,
  };
}

// ---------------------------------------------------------------------------
// The paste cleanup

function cleanupExamples(): Record<string, string> {
  const fixed = fixPastedText(TERMINAL_REPLY);
  const lines = scanLines(fixed.text);
  const id = (i: number) => lineId(i, lines.length);
  const candidates = findJoinCandidates(fixed.text);
  const batches = lineBreakBatches(fixed.text)!;
  const joined = joinLines(fixed.text, CLEANUP_CALLS);
  return {
    "cleanup/paste.txt": `${TERMINAL_REPLY}\n`,
    "cleanup/fixed.txt": `${fixed.text}\n`,
    "cleanup/detection.json": json({
      looks_terminal_copied: looksTerminalCopied(TERMINAL_REPLY),
      wrap_width: wrapWidth(fixed.text),
      candidates: candidates.map(({ first, second }) => `${id(first)} → ${id(second)}`),
    }),
    "cleanup/state.txt": `${lineBreakState(fixed.text)}\n`,
    "cleanup/request.json": json(batches),
    "cleanup/answers.json": json({ answers: CLEANUP_CALLS, model: JEV_MODEL }),
    "cleanup/joins.json": json(
      candidates.map(({ first, second }) => {
        const p = CLEANUP_CALLS[id(second)];
        const cutOff = cutOffAfter(lines[first].text);
        return { break: `${id(first)} → ${id(second)}`, first_line_ends: lines[first].text.trimEnd().split(" ").slice(-2).join(" "), cut_off: cutOff, answer: p, joins: p >= cutOff };
      }),
    ),
    "cleanup/joined.txt": `${joined.text}\n`,
    "cleanup/two-batches.json": json(twoBatches()),
  };
}

/** A paste long enough that its candidate breaks need two requests. */
function twoBatches() {
  const text = Array.from({ length: 300 }, (_, i) => `part ${i + 1} of a sentence that runs on`).join("\n");
  const batches = lineBreakBatches(text)!;
  const state = jevTokens(lineBreakState(text));
  return {
    lines: 300,
    candidates: findJoinCandidates(text).length,
    batches: batches.map((b) => {
      const ids = Object.keys(b.questions);
      const tokens = Object.values(b.questions).map(jevTokens);
      return { questions: ids.length, first: ids[0], last: ids[ids.length - 1], state_tokens: state, question_tokens: sum(tokens) };
    }),
    limits: LIMITS,
  };
}

/** Jev's limits as the examples name them. */
const LIMITS = { questions: JEV_LIMITS.maxQuestions, state_plus_longest: JEV_LIMITS.stateAndLongest, state_plus_all: JEV_LIMITS.whole };

function sum(numbers: readonly number[]): number {
  return numbers.reduce((total, n) => total + n, 0);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
