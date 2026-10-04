// The examples a second opinion carries (growing context KTD9, KTD10, KTD11): openings of
// the user's own judged replies on the badge, each under the question it shows something
// about, overrules first. Like the cut-offs, they are worked out from the folder every time
// and never stored (KTD1), so a result moved to the trash leaves them at once.
//
// Ranking reads the badge's results once per folder state, badge and assignment version.
// Each reply then walks that ranked list, and only a result that some side still has room
// for is read and excerpted, since cleaning a long reply is the one real cost. The budget
// step (`fitSecondOpinion` in ./jevBudget) fits what this returns into the request.

import { calibrationsOf, ranksAsOverrule } from "./calls";
import { LINE_BREAK, MAX_EXAMPLES_PER_SIDE, MAX_OPENING_CHARS, MAX_REASON_CHARS, type CriteriaSide, type JevExample, type JevExampleEntry } from "./jevRequest";
import { newestFirst } from "./matrix";
import { OVERALL_ID, pointId, rubricParts } from "./secondOpinion";
import { credentialKey, type Assessment, type FolderState } from "./types";


/** A question side an earlier result can show on. */
export interface ExampleFeed {
  questionId: string;
  side: CriteriaSide;
}

/** One of the badge's results as a source of examples, in rank order. */
export interface ExampleCandidate {
  /** The agent's slug and the result's file stem, unique within the badge. */
  readonly sourceId: string;
  /** Its place in the ranking, the same in every question it shows on. */
  readonly rank: number;
  readonly result: Assessment;
  /** The result's note as a reason, or "" when it gives none. */
  readonly reason: string;
  /** Every question side it can show on, points in rubric order, then overall. */
  readonly feeds: readonly ExampleFeed[];
}

/**
 * The badge's results ranked as example sources (KTD10, KTD11): an overrule with a reason,
 * then an overrule, then any other result, newest first within each. A result with a note
 * ranks as an overrule with a reason whatever the cut-offs say: the reason step is asked
 * only when the user went against Jev, so the saved note is the proof, and a later fit that
 * reads its reading as can't call cannot demote it. A result with no note is an overrule
 * when its verdict opposes its reading under the default pair or under the badge's current
 * pair for that reading's model.
 *
 * Every result counts for the overall question, on the side of its verdict. Only those at
 * `version` count for the point questions (KTD9): a Met result holds for every point, and
 * a Not met result doesn't hold for each point whose current text it lists as missed; a
 * missed point that matches no current point is dropped. Held replies are not results and
 * never count. Empty when the folder has no such badge.
 */
export function rankExamples(state: FolderState, key: string, version: string): ExampleCandidate[] {
  const credential = state.credentials.find((c) => credentialKey(c) === key);
  if (!credential) return [];
  const points = rubricParts(credential.rubric).points;
  const calibrations = calibrationsOf(state, key);

  const tiered = state.assessments
    .filter((a) => credentialKey(a) === key)
    .map((result) => {
      const reason = reasonOf(result.note);
      if (result.note.trim() !== "") return { result, reason, tier: 0 };
      const pair = result.jev && calibrations.get(result.jev.model)?.pair;
      const overrule = !!pair && ranksAsOverrule(result, pair);
      return { result, reason, tier: overrule ? 1 : 2 };
    });
  tiered.sort((a, b) => a.tier - b.tier || newestFirst(a.result, b.result));

  return tiered.map(({ result, reason }, rank) => ({
    sourceId: `${result.profileSlug}/${result.fileStem}`,
    rank,
    result,
    reason,
    feeds: feedsOf(result, points, version),
  }));
}

/**
 * The examples a second opinion on `reply` may carry, from a ranked list: at most two per
 * question side, best rank first. A result whose reply, trimmed, equals `reply` trimmed is
 * never one (KTD9), and neither is one whose excerpt cleans to nothing; the next result
 * takes the place. A reason rides on every overall example and on a point's "doesn't hold"
 * examples, never on a point's "holds" examples.
 */
export function examplesFor(ranked: readonly ExampleCandidate[], reply: string): JevExampleEntry[] {
  const judged = reply.trim();
  const filled = new Map<string, number>();
  const slot = (feed: ExampleFeed) => `${feed.questionId}:${feed.side}`;
  const entries: JevExampleEntry[] = [];
  for (const candidate of ranked) {
    const open = candidate.feeds.filter((feed) => (filled.get(slot(feed)) ?? 0) < MAX_EXAMPLES_PER_SIDE);
    if (open.length === 0 || candidate.result.handBack.trim() === judged) continue;
    const opening = cachedExcerpt(candidate.result);
    if (opening === "") continue;
    for (const feed of open) {
      filled.set(slot(feed), (filled.get(slot(feed)) ?? 0) + 1);
      const withReason = candidate.reason !== "" && (feed.questionId === OVERALL_ID || feed.side === "false");
      const item: JevExample = withReason ? { reply_opening: opening, user_reason: candidate.reason } : { reply_opening: opening };
      entries.push({ questionId: feed.questionId, side: feed.side, rank: candidate.rank, sourceId: candidate.sourceId, item });
    }
  }
  return entries;
}

/**
 * The opening of a reply as an example shows it (KTD10): cleaned (see `cleanLines`), then
 * its first 300 code points, cut back to the last line or sentence end inside them when
 * there is one. A reply of 300 code points or fewer is kept whole. Empty when nothing is
 * left after cleaning, and such a reply is no example.
 */
export function excerptOf(reply: string): string {
  // Lines are cleaned only until enough are kept for the cut: twice the cap in UTF-16
  // units is at least one code point past it, the most the cut ever looks at.
  const text = cleanLines(reply, 2 * (MAX_OPENING_CHARS + 1)).join("\n").trim();
  const head: string[] = [];
  for (const ch of text) {
    head.push(ch);
    if (head.length > MAX_OPENING_CHARS) break;
  }
  if (head.length <= MAX_OPENING_CHARS) return text;

  // The cut ends before the last line break, or after the last sentence's punctuation and
  // any closing quotes or brackets, whichever comes later inside the cap.
  let cut = 0;
  for (let i = 0; i < MAX_OPENING_CHARS; i++) {
    if (head[i] === "\n") cut = i;
    else if (SENTENCE_END.test(head[i])) {
      let end = i + 1;
      while (end < MAX_OPENING_CHARS && CLOSER.test(head[end])) end++;
      if (/\s/.test(head[end])) cut = end;
    }
  }
  return head.slice(0, cut || MAX_OPENING_CHARS).join("").trimEnd();
}

/**
 * A result's note as the reason an example carries (KTD10): cleaned as an excerpt is,
 * every line break turned into a space, trimmed and capped at 200 code points. Rust
 * refuses a reason holding any of those line breaks, so a note written by hand can never
 * fail every ask on its badge. Empty when the note gives none.
 */
export function reasonOf(note: string): string {
  const line = cleanLines(note)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join(" ");
  return Array.from(line).slice(0, MAX_REASON_CHARS).join("").trimEnd();
}

// ---------------------------------------------------------------------------

/**
 * Control and format characters other than tab, and the whole tag block (U+E0000 itself is
 * unassigned, not a format character). The user judged the rendered reply and never saw
 * them. Dropping the zero-width joiner splits a joined emoji into its parts.
 */
const INVISIBLE = /(?!\t)[\p{Cc}\p{Cf}\u{E0000}-\u{E007F}]/gu;

// A Markdown image, inline (`![alt](src "title")`) or by reference (`![alt][ref]`,
// `![alt][]`), with any src, data URIs included. Each part stops at the next bracket of its
// kind (an alt or label holds no `[`, an angle src no `<`, a bare src no paren and cannot
// start with `<`), so a long line of unclosed brackets is read in one pass, never once per
// bracket. An alt with nested brackets or a src with parens is left, its data URI still goes.
const ALT = String.raw`!\[(?:\\.|[^[\]\\])*\]`;
const INLINE_SRC = String.raw`\(\s*(?:<(?:\\.|[^<>\\])*>|[^<\s()][^\s()]*)(?:\s+"(?:\\.|[^"\\])*")?\s*\)`;
const REFERENCE = String.raw`\[(?:\\.|[^[\]\\])*\]`;
const IMAGE = new RegExp(`${ALT}(?:${INLINE_SRC}|${REFERENCE})`, "g");
/** A reference definition whose destination is an image data URI: `[ref]: data:image/png;base64,…`. */
const IMAGE_DEFINITION = /^ {0,3}\[(?:\\.|[^[\]\\])+\]:\s*<?data:image\//i;
/** An image data URI anywhere: its type and parameters, then its data up to whitespace, a closing bracket or a quote. */
const IMAGE_DATA = /data:image\/[\w.+;=-]*,[^\s)\]"'<>]*/gi;

// Lines that look like secrets (KTD10). A heuristic, not a guarantee: earlier replies may
// hold keys an agent printed, and some never left the machine before.
const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]+-----/;
const PEM_END = /-----END [A-Z0-9 ]+-----/;
/** A known token prefix followed by a token, so a line that only mentions `ghp_` stays. */
const TOKEN =
  /\b(?:sk-|[sr]k_(?:live|test)_|gh[pousr]_|github_pat_|xox[abposr]-|xapp-|glpat-|npm_|AKIA|ASIA|AIza|eyJ)[A-Za-z0-9_-]{16,}/;
/** An environment-style assignment with a long value: `API_KEY=…`. */
const ASSIGNMENT = /\b[A-Z][A-Z0-9_]+[ \t]*=[ \t]*["']?[^\s"']{16,}/;
const HEX_RUN = /[0-9A-Fa-f]{32,}/;
/**
 * A run of base64 or base64url characters. It reads as a key only with a digit and both
 * cases, so a long file path or URL, which uses the same characters, is kept.
 */
const BASE64_RUN = /[A-Za-z0-9+/_-]{32,}/g;

const SENTENCE_END = /[.!?…]/;
const CLOSER = /["'”’)\]*_`]/;

function looksSecret(line: string): boolean {
  if (TOKEN.test(line) || ASSIGNMENT.test(line) || HEX_RUN.test(line)) return true;
  return [...line.matchAll(BASE64_RUN)].some(([run]) => /\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run));
}

/**
 * The text's lines as an example may show them (KTD10), leading blank lines dropped: every
 * line break read as `\n`, invisible characters dropped, image Markdown and image data
 * removed (a line left blank by that goes), and lines that look like secrets dropped, a
 * PEM block from its BEGIN line to its END line. Images go before the secret check, since
 * a data URI is itself a long base64 run and would take the line's words with it.
 * Stops once the kept lines reach `enough` UTF-16 units.
 */
function cleanLines(text: string, enough = Infinity): string[] {
  const kept: string[] = [];
  let units = 0;
  let inPem = false;
  for (const raw of text.split(LINE_BREAK)) {
    if (units >= enough) break;
    const line = raw.replace(INVISIBLE, "");
    if (inPem || PEM_BEGIN.test(line)) {
      inPem = !PEM_END.test(line);
      continue;
    }
    if (IMAGE_DEFINITION.test(line)) continue;
    const shown = line.replace(IMAGE, "").replace(IMAGE_DATA, "");
    if ((shown !== line && shown.trim() === "") || looksSecret(shown)) continue;
    if (kept.length === 0 && shown.trim() === "") continue;
    kept.push(kept.length === 0 ? shown.trimStart() : shown);
    units += kept[kept.length - 1].length + 1;
  }
  return kept;
}

// Excerpts depend only on the reply, so each result's is built once, and the cache lets go
// of it with the folder state that holds the result.
const excerpts = new WeakMap<Assessment, string>();

function cachedExcerpt(result: Assessment): string {
  let excerpt = excerpts.get(result);
  if (excerpt === undefined) {
    excerpt = excerptOf(result.handBack);
    excerpts.set(result, excerpt);
  }
  return excerpt;
}

/** The question sides a result can show on, per `rankExamples`. */
function feedsOf(result: Assessment, points: readonly string[], version: string): ExampleFeed[] {
  const feeds: ExampleFeed[] = [];
  if (result.assignmentVersion === version) {
    if (result.result === "met") {
      points.forEach((_, i) => feeds.push({ questionId: pointId(i), side: "true" }));
    } else {
      const missed = new Set(result.missedPoints ?? []);
      points.forEach((point, i) => {
        if (missed.has(point)) feeds.push({ questionId: pointId(i), side: "false" });
      });
    }
  }
  feeds.push({ questionId: OVERALL_ID, side: result.result === "met" ? "true" : "false" });
  return feeds;
}
