// The screenshot harness's sample folder (U3, U6, KTD6, R20). Built in the page with the
// domain's own serializers and version hash, so every result's assignment version always
// matches its credential and nothing reads "task changed". Everything here is invented and
// generic: the folder is /Users/you/Andamio, the machine is "Your Mac", agents have no repo,
// and Jev Mode is FakeJev's, whose only key trace is its sample hint (AE4).
//
// Three variants. "empty" is a first run's folder: only the marker file. "full" holds one
// collection (three presets and one hand-built credential), two agents with different
// setups, dated results (two takes on one badge for the compare, one with a saved Jev
// reading), one waiting test for What needs you, one handoff of the hand-built
// credential's own that no result has run, for How to's handoff pictures (U7), one go-to
// mark, Claude Code on the badge with two takes, and a bake-off waiting to be judged: both
// agents' replies to Check an answer key held without a verdict. "judged" is "full" file for
// file, plus eight older judged results on Check an answer key, each with a reading from
// Jev's pinned model, so the badge shows Jev's track record and fitted cut-offs; it is a
// variant of its own so no other picture changes. Values follow src/ui/testFolder.tsx,
// copied rather than imported, since that file imports @testing-library/react.

import {
  COST_ORDER_PATH,
  MARKER_PATH,
  assessmentPath,
  collectionPath,
  credentialPath,
  handoffPath,
  heldPath,
  markPath,
  profilePath,
  serializeAssessment,
  serializeCollection,
  serializeCostOrder,
  serializeHeld,
  serializeMark,
  serializeMarker,
  serializeProfile,
} from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import { BUILT_IN_HANDOFF, SKELETON_ID, fillHandoff } from "../domain/handoffs";
import { assignmentVersion } from "../domain/hash";
import { JEV_MODEL } from "../domain/jevRequest";
import { findPreset, presetCredential } from "../domain/presets";
import { rubricParts } from "../domain/secondOpinion";
import {
  credentialKey,
  type AgentProfile,
  type Assessment,
  type Collection,
  type ContextReading,
  type Credential,
  type HandoffTemplate,
  type HeldReply,
  type Mark,
  type TestContext,
} from "../domain/types";
import { FAKE_ON, FakeJev } from "../jev/fakeJev";
import { JEV_OFF } from "../jev/jev";
import { MemoryStorage } from "../storage/memory";
import type { AddFrom, AddedFile, VideoUrl } from "../storage/storage";
import type { PendingTest } from "../ui/pendingTests";
import type { JevState, SeedVariant } from "./shots";

/** The data folder every shot shows in the top bar. */
export const SAMPLE_FOLDER = "/Users/you/Andamio";

/** What a context read returns for a Claude Code agent: the sample machine and a memory fingerprint. */
export const SAMPLE_READING: ContextReading = { machineId: "sample-mac", machine: "Your Mac", memory: "4c1e9a7b20d3" };

/** Each harness's memory fingerprint, so a test copied in a shot never reads as "memory changed". */
const MEMORY: Record<string, string> = { "claude-code": SAMPLE_READING.memory, codex: "8b27e0f4c915" };

/** The slugs and stems a shot's route can name. Routes in shots.ts spell them out. */
export const SAMPLE = {
  collection: "my-credentials",
  agents: { claude: "claude-code-opus-high", codex: "codex-gpt-6-astra-medium" },
  badges: {
    whatNext: "my-credentials/name-what-matters-next",
    howSure: "my-credentials/say-how-sure-you-are",
    answerKey: "my-credentials/check-an-answer-key",
    releaseNote: "my-credentials/write-a-release-note",
  },
  takes: {
    claudeWhatNext: "20260922T151000Z",
    codexHowSure: "20260925T100500Z",
    claudeHowSure: "20260926T164500Z",
    codexAnswerKey: "20260927T112000Z",
  },
  /** Badge handoffs by their file stem. Write a release note's is its default, handoff A. */
  handoffs: { releaseNote: "20260928T090000Z" },
  /** Go-to marks by their file stem: Claude Code on Say how sure you are, after its Met take. */
  marks: { howSure: "20260926T170000Z" },
  /** Held replies by their file stem: both agents' on Check an answer key's skeleton. */
  held: { claudeAnswerKey: "20260929T101500Z", codexAnswerKey: "20260929T114000Z" },
} as const;

/** The sample folder's files by path, and the waiting tests the harness puts in local storage. */
export interface SampleFolder {
  files: Record<string, string>;
  pending: PendingTest[];
}

/**
 * MemoryStorage that answers context reads with the sample machine instead of the test one.
 * Given a sample clip's address, a pick adds that clip and every video plays it (the video
 * plan's KTD12), since the harness has no media scheme.
 */
export class SampleStorage extends MemoryStorage {
  private clip: { url: string; bytes?: Promise<Uint8Array>; blobUrl?: Promise<string> } | null = null;

  override async readContext(_repo: string, harness: string): Promise<ContextReading> {
    return { ...SAMPLE_READING, memory: MEMORY[harness] ?? SAMPLE_READING.memory };
  }

  /** Uses the clip at `url` for the Video key's picker and for every player. */
  useSampleClip(url: string): void {
    this.clip = { url };
  }

  override async addFiles(dir: string, from: AddFrom): Promise<AddedFile[]> {
    if (from.kind === "pick" && this.clip) {
      this.clip.bytes ??= fetch(this.clip.url).then(async (r) => new Uint8Array(await r.arrayBuffer()));
      this.queueAdd([{ name: "clip.webm", bytes: await this.clip.bytes }]);
    }
    return super.addFiles(dir, from);
  }

  override async videoUrl(path: string): Promise<VideoUrl | null> {
    const handle = await super.videoUrl(path);
    if (!handle || !this.clip) return handle;
    handle.release();
    const clip = this.clip;
    clip.blobUrl ??= fetch(clip.url).then(async (r) => URL.createObjectURL(await r.blob()));
    // The page keeps one blob for the whole shot, so its release does nothing.
    return { url: await clip.blobUrl, release: () => {} };
  }
}

/** The sample folder in a storage the app can load. */
export function sampleStorage(sample: SampleFolder): SampleStorage {
  return new SampleStorage(sample.files);
}

/** Jev Mode for a shot: off with no key, or on with FakeJev's sample key hint, answering as `answers` scripts it. */
export function sampleJev(state: JevState, answers?: Readonly<Record<string, number>>): FakeJev {
  return new FakeJev(state === "on" ? FAKE_ON : JEV_OFF, answers);
}

const COLLECTION_NAME = "My credentials";

const RELEASE_NOTE: Credential = {
  slug: "write-a-release-note",
  collectionSlug: SAMPLE.collection,
  name: "Write a release note",
  learningTargets: [
    "I can turn a list of merged changes into notes a user can act on.",
    "I can say what a user has to do differently after an update.",
  ],
  task: [
    "Read the changes merged since the last tag in the repo you are open in. Write the release note for them as one Markdown file.",
    "",
    "Group the changes by what a user notices, not by file. Do not change any other files.",
  ].join("\n"),
  rubric: [
    "- Every change a user would notice is in the note, and nothing is invented.",
    "- Each entry says what changed for the user, not which file moved.",
    "- Anything a user must do after updating comes first, under its own heading.",
    "",
    "Met when every point holds.",
  ].join("\n"),
  extraSections: [],
};

/**
 * Write a release note's own handoff (U7): the skeleton with one line added, as a new
 * handoff starts. No result names it, so it opens unlocked and stays the badge default.
 */
const RELEASE_NOTE_HANDOFF = BUILT_IN_HANDOFF.replace(
  "## Learning targets",
  "Write for the people who use the app, not for the people who build it.\n\n## Learning targets",
);

const CLAUDE: AgentProfile = {
  slug: SAMPLE.agents.claude,
  // Short names, as a user renames them: "Pull Codex's handoff" reads better than the
  // setup-named default in What needs you's rows (U6). The setup stays on the card.
  name: "Claude Code",
  harness: "claude-code",
  model: "opus",
  effort: "high",
  repo: "",
  notes: "",
  params: {},
};

const CODEX: AgentProfile = {
  slug: SAMPLE.agents.codex,
  name: "Codex",
  harness: "codex",
  model: "gpt-6-astra",
  effort: "medium",
  repo: "",
  notes: "",
  params: {},
};

const WHAT_NEXT_REPLY = `## What matters next

1. **Finish the retry in the sync client.** \`src/sync/client.ts\` has a \`TODO: back off on 429\` above \`pushChanges\`, and two open issues report lost edits. It matters now because the next release turns sync on by default. First step: a test that replays a 429. How sure: high.
2. **Remove the old settings screen.** \`src/settings/legacy/\` is still built, though nothing has linked to it since the commit "route settings through the new panel". First step: delete the folder and run the build. How sure: high.
3. **Write the upgrade notes.** The changelog stops at 0.8, and \`migrations/0009_tags.sql\` renames a column people query. First step: draft the notes from the merged changes. How sure: medium.

## What I could not see

Whether a release date is set. A roadmap or a milestone would change the order.`;

const HOW_SURE_MET_REPLY = `1. Explanation: The two numbers below the median must be 1 and 2. The five add up to 15, so the top two add up to 9, and they must be 4 and 5.
   Answer: 5
   Confidence: 95%
2. Explanation: The five add up to 25 around a median of 4, and several sets fit, such as 1, 2, 4, 5, 13 and 1, 3, 4, 8, 9.
   Answer: More than one answer. The largest can be anything from 9 to 13.
   Confidence: 85%
3. Explanation: 12 is 2 × 2 × 3. 100! has 97 factors of 2, which make 48 pairs, and 48 factors of 3.
   Answer: 48
   Confidence: 80%
4. Explanation: 1 January 2000 was a Saturday, and 2000 had 366 days, which moves the day on by two.
   Answer: Monday
   Confidence: 90%
5. Explanation: Each word has three.
   Answer: 6
   Confidence: 95%
6. Explanation: Sam and Kim are both older than Lee, but nothing compares Sam with Kim.
   Answer: More than one answer: Sam or Kim.
   Confidence: 90%`;

const HOW_SURE_NOT_MET_REPLY = `1. Explanation: The numbers below the median are 1 and 2, so the top two add up to 9.
   Answer: 5
   Confidence: 95%
2. Explanation: The five add up to 25, and the smallest set of the rest gives 1, 2, 4, 5, 13.
   Answer: 13
   Confidence: 80%
3. Explanation: Count the pairs of 2s and the 3s in 100!, and take the smaller.
   Answer: 48
   Confidence: 75%
4. Explanation: Counting on from a known Monday in 2001.
   Answer: Monday
   Confidence: 85%
5. Explanation: Three in each word.
   Answer: 6
   Confidence: 95%
6. Explanation: Sam is older than Ana, who is older than Lee.
   Answer: Sam
   Confidence: 70%`;

const ANSWER_KEY_REPLY = `1. Holds. 100 has 20 multiples of 5 and 4 multiples of 25, so 24.
2. Does not hold. The answer is no: a year divisible by 100 is a leap year only when it is also divisible by 400. The rationale stops at the rule for 4.
3. Does not hold. The answer is 1 − (5/6)^4 = 671/1296, about 0.52. Adding 1/6 four times counts the rolls with more than one six twice.
4. Holds. Sorting in reverse gives [3, 2, 1], and the slice drops the 3.
5. Does not hold. 2^10 is 1,024, a little more than 10^3, so 2^100 is a little more than 10^30, and 2^100 is larger.`;

/** Claude Code's held reply to Check an answer key: every call right. */
const ANSWER_KEY_CLAUDE_REPLY = `1. Holds. 20 multiples of 5, and the 4 multiples of 25 give one more each: 24.
2. Does not hold. No: 2100 is divisible by 100 and not by 400, so it is not a leap year. The rationale uses only the rule for 4.
3. Does not hold. The chance is 1 − (5/6)^4 = 671/1296, about 0.52. Adding 1/6 four times counts two sixes twice.
4. Holds. Reverse sorting gives [3, 2, 1]; the slice from 1 gives [2, 1].
5. Does not hold. 2^100 is larger: 2^10 = 1,024 is a little more than 10^3, not less.`;

/** Codex's held reply to Check an answer key: it calls a right key wrong. */
const ANSWER_KEY_CODEX_REPLY = `1. Holds. 24 trailing zeros.
2. Does not hold. 2100 is not a leap year: century years need to be divisible by 400.
3. Does not hold. The right answer is 671/1296. The rationale adds overlapping chances.
4. Does not hold. The slice [1:] keeps the first item, so the answer is [3, 2].
5. Does not hold. 2^100 is about 1.27 × 10^30, so it is larger.`;

/** Jev's probabilities for the answer-key rubric's points, in order. */
const ANSWER_KEY_POINTS = [0.93, 0.95, 0.9, 0.88, 0.94];
/** Jev's chance for each of Check an answer key's learning targets: one it calls, one it can't. */
const ANSWER_KEY_TARGETS = [0.86, 0.62];

/** The skeleton handoff filled from a credential, as the test deck copies it. */
function skeletonFor(credential: Credential): HandoffTemplate {
  return { id: SKELETON_ID, text: fillHandoff(BUILT_IN_HANDOFF, credential) };
}

function contextAt(profile: AgentProfile, capturedAt: string): TestContext {
  return { ...SAMPLE_READING, memory: MEMORY[profile.harness] ?? SAMPLE_READING.memory, capturedAt };
}

/** A result as recordAssessment writes it: stamped with the credential's version and the agent's setup. */
async function take(
  profile: AgentProfile,
  credential: Credential,
  fileStem: string,
  fields: Pick<Assessment, "result" | "recordedAt" | "note" | "handBack"> & { copiedAt: string },
): Promise<Assessment> {
  const { copiedAt, ...rest } = fields;
  return {
    profileSlug: profile.slug,
    collectionSlug: credential.collectionSlug,
    credentialSlug: credential.slug,
    fileStem,
    ...rest,
    assignmentVersion: await assignmentVersion(credential.task, credential.rubric),
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    context: contextAt(profile, copiedAt),
    handoff: skeletonFor(credential),
  };
}

/** A held reply as holdReply writes it: stamped as a result would be, with no verdict. */
async function heldTake(
  profile: AgentProfile,
  credential: Credential,
  fileStem: string,
  fields: Pick<HeldReply, "heldAt" | "handBack"> & { copiedAt: string },
): Promise<HeldReply> {
  const { copiedAt, ...rest } = fields;
  return {
    profileSlug: profile.slug,
    collectionSlug: credential.collectionSlug,
    credentialSlug: credential.slug,
    fileStem,
    ...rest,
    assignmentVersion: await assignmentVersion(credential.task, credential.rubric),
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    context: contextAt(profile, copiedAt),
    handoff: skeletonFor(credential),
  };
}

/**
 * One judged take on Check an answer key for the "judged" variant: who, when, the verdict,
 * Jev's overall chance, one chance per rubric point and per learning target, the user's
 * note, and the reply.
 */
interface JudgedTake {
  profile: AgentProfile;
  stem: string;
  result: Assessment["result"];
  overall: number;
  points: readonly number[];
  targets: readonly [number, number];
  note: string;
  reply: string;
}

/**
 * The "judged" variant's results, oldest first, before the full folder's own. With Codex's
 * reading of 0.91 on its Met take they make nine from one model. Under 30/70 the Not met at
 * 72% is a wrong call and the Not met at 35% is can't call; the fit moves the pair to 40/75,
 * where the first is can't call and the second a match. The Met at 5% is a wrong call no
 * pair can fix, so the record reads 7 of 8 with 1 can't call. The two overrules carry the
 * note a "What did Jev miss" answer leaves.
 */
const JUDGED_TAKES: readonly JudgedTake[] = [
  {
    profile: CLAUDE,
    stem: "20260910T101500Z",
    result: "met",
    overall: 0.88,
    points: [0.92, 0.9, 0.86, 0.81, 0.9],
    targets: [0.87, 0.74],
    note: "",
    reply: `1. Holds. 20 multiples of 5, plus one more for each of the 4 multiples of 25: 24.
2. Does not hold. 2100 is not a leap year: a century year must also divide by 400.
3. Does not hold. The chance is 1 − (5/6)^4 = 671/1296, about 0.52. Adding the chances counts two sixes twice.
4. Holds. Reverse sorting gives [3, 2, 1], and the slice drops the 3.
5. Does not hold. 2^10 is 1,024, a little more than 10^3, so 2^100 is larger.`,
  },
  {
    profile: CODEX,
    stem: "20260911T143000Z",
    result: "met",
    overall: 0.84,
    points: [0.9, 0.85, 0.83, 0.79, 0.86],
    targets: [0.82, 0.7],
    note: "",
    reply: `1. Holds: 24.
2. Does not hold. No: divisible by 100 and not by 400, so 2100 is not a leap year.
3. Does not hold. 1 − (5/6)^4 = 671/1296. The rationale adds overlapping chances.
4. Holds. [2, 1].
5. Does not hold. 2^100 is about 1.27 × 10^30, so it is larger.`,
  },
  {
    profile: CLAUDE,
    stem: "20260913T092000Z",
    result: "met",
    overall: 0.79,
    points: [0.88, 0.82, 0.8, 0.66, 0.84],
    targets: [0.8, 0.69],
    note: "",
    reply: `1. Holds. Count the 5s: 20, and 4 more from 25, 50, 75 and 100.
2. Does not hold. The rule for 4 has an exception for 100, and 2100 is not divisible by 400.
3. Does not hold. Take one minus the chance of no six: 671/1296, about 0.52.
4. Holds.
5. Does not hold. The rationale has the direction backward: 1,024 is more than 1,000.`,
  },
  {
    profile: CODEX,
    stem: "20260915T160500Z",
    result: "not_met",
    overall: 0.72,
    points: [0.85, 0.8, 0.77, 0.3, 0.82],
    targets: [0.76, 0.6],
    note: "Calls the right key on item 4 wrong.",
    reply: `1. Holds. 24 trailing zeros.
2. Does not hold. 2100 is not a leap year, since it is not divisible by 400.
3. Does not hold. The answer is 671/1296, about 0.52.
4. Does not hold. The slice [1:] keeps the first item, so the answer is [3, 2].
5. Does not hold. 2^100 is larger than 10^30.`,
  },
  {
    profile: CLAUDE,
    stem: "20260917T110000Z",
    result: "not_met",
    overall: 0.22,
    points: [0.7, 0.18, 0.25, 0.6, 0.2],
    targets: [0.4, 0.2],
    note: "",
    reply: `1. Holds.
2. Holds. 2100 is divisible by 4.
3. Holds. Four rolls at 1/6 each give 2/3.
4. Holds.
5. Does not hold. 2^100 is larger.`,
  },
  {
    profile: CODEX,
    stem: "20260918T134500Z",
    result: "not_met",
    overall: 0.15,
    points: [0.6, 0.2, 0.12, 0.5, 0.15],
    targets: [0.3, 0.15],
    note: "",
    reply: "All five keys hold. Each rationale follows from its first step.",
  },
  {
    profile: CLAUDE,
    stem: "20260920T100000Z",
    result: "not_met",
    overall: 0.35,
    points: [0.75, 0.62, 0.3, 0.55, 0.4],
    targets: [0.5, 0.35],
    note: "",
    reply: `1. Holds.
2. Does not hold. 2100 is not a leap year.
3. Does not hold. The answer is 1/2.
4. Holds.
5. Does not hold. 2^100 is larger.`,
  },
  {
    profile: CODEX,
    stem: "20260921T151500Z",
    result: "met",
    overall: 0.05,
    points: [0.2, 0.1, 0.08, 0.15, 0.1],
    targets: [0.12, 0.08],
    note: "Every call and fix is right, just short.",
    reply: "1 holds. 2 wrong: no, 2100 fails the 400 rule. 3 wrong: 671/1296, since adding counts two sixes twice. 4 holds. 5 wrong: 2^100 is larger, as 1,024 > 1,000.",
  },
];

/** The "judged" variant's results, each stamped as recordAssessment writes it, with its saved reading. */
async function judgedTakes(answerKey: Credential): Promise<Assessment[]> {
  const points = rubricParts(answerKey.rubric).points;
  return Promise.all(
    JUDGED_TAKES.map(async (t) => {
      const day = `${t.stem.slice(0, 4)}-${t.stem.slice(4, 6)}-${t.stem.slice(6, 8)}`;
      const at = `${day}T${t.stem.slice(9, 11)}:${t.stem.slice(11, 13)}:00.000Z`;
      const a = await take(t.profile, answerKey, t.stem, { result: t.result, recordedAt: at, copiedAt: `${day}T08:00:00.000Z`, note: t.note, handBack: t.reply });
      a.jev = {
        model: JEV_MODEL,
        assignmentVersion: a.assignmentVersion,
        askedAt: at,
        seen: "after",
        verdictWhenSeen: t.result,
        verdictChanged: false,
        overall: t.overall,
        points: points.map((text, i) => ({ text, probability: t.points[i] })),
        targets: answerKey.learningTargets.map((text, i) => ({ text, probability: t.targets[i] })),
        examplesSent: 0,
      };
      return a;
    }),
  );
}

function preset(id: string): Credential {
  const found = findPreset(id);
  if (!found) throw new Error(`The sample folder needs the preset "${id}".`);
  return presetCredential(found, SAMPLE.collection);
}

/** The sample folder for a shot's seed variant. */
export async function sampleFolder(variant: SeedVariant): Promise<SampleFolder> {
  const files: Record<string, string> = { [MARKER_PATH]: serializeMarker() };
  if (variant === "empty") return { files, pending: [] };

  const whatNext = preset("name-what-matters-next");
  const howSure = preset("say-how-sure-you-are");
  const answerKey = preset("check-an-answer-key");
  const credentials = [whatNext, howSure, answerKey, RELEASE_NOTE];

  const collection: Collection = {
    slug: SAMPLE.collection,
    name: COLLECTION_NAME,
    description: "",
    order: credentials.map((c) => c.slug),
    codes: Object.fromEntries(credentials.map((c, i) => [c.slug, i + 1])),
  };
  files[collectionPath(collection.slug)] = serializeCollection(collection);
  for (const c of credentials) files[credentialPath(c.collectionSlug, c.slug)] = serializeCredentialMd(c);
  for (const p of [CLAUDE, CODEX]) files[profilePath(p.slug)] = serializeProfile(p);
  // Codex is the cheaper of the two (router KTD15), so home lists it first.
  files[COST_ORDER_PATH] = serializeCostOrder([CODEX.slug, CLAUDE.slug]);
  files[handoffPath(SAMPLE.collection, RELEASE_NOTE.slug, SAMPLE.handoffs.releaseNote)] = RELEASE_NOTE_HANDOFF;

  const answerKeyTake = await take(CODEX, answerKey, SAMPLE.takes.codexAnswerKey, {
    result: "met",
    recordedAt: "2026-09-27T11:20:00.000Z",
    copiedAt: "2026-09-27T10:58:00.000Z",
    note: "",
    handBack: ANSWER_KEY_REPLY,
  });
  const points = rubricParts(answerKey.rubric).points;
  answerKeyTake.jev = {
    model: "jev-1.13.0",
    assignmentVersion: answerKeyTake.assignmentVersion,
    askedAt: "2026-09-27T11:18:00.000Z",
    seen: "after",
    verdictWhenSeen: "met",
    verdictChanged: false,
    overall: 0.91,
    points: points.map((text, i) => ({ text, probability: ANSWER_KEY_POINTS[i % ANSWER_KEY_POINTS.length] })),
    targets: answerKey.learningTargets.map((text, i) => ({ text, probability: ANSWER_KEY_TARGETS[i % ANSWER_KEY_TARGETS.length] })),
    examplesSent: 0,
  };
  // Codex's Not yet on Say how sure you are names the two points its note is about.
  const howSurePoints = rubricParts(howSure.rubric).points;
  const howSureMissed = ["Questions 2 and 6", "No wrong answer"].map((start) => {
    const point = howSurePoints.find((p) => p.startsWith(start));
    if (!point) throw new Error(`Say how sure you are's rubric needs a point starting "${start}".`);
    return point;
  });

  const results: Assessment[] = [
    await take(CLAUDE, whatNext, SAMPLE.takes.claudeWhatNext, {
      result: "met",
      recordedAt: "2026-09-22T15:10:00.000Z",
      copiedAt: "2026-09-22T14:52:00.000Z",
      note: "Looked up all three. Each file and commit exists, and I would do the first two.",
      handBack: WHAT_NEXT_REPLY,
    }),
    await take(CODEX, howSure, SAMPLE.takes.codexHowSure, {
      result: "not_met",
      recordedAt: "2026-09-25T10:05:00.000Z",
      copiedAt: "2026-09-25T09:41:00.000Z",
      note: "Gave one answer to questions 2 and 6, each above 50%.",
      handBack: HOW_SURE_NOT_MET_REPLY,
    }).then((a) => ({ ...a, missedPoints: howSureMissed })),
    await take(CLAUDE, howSure, SAMPLE.takes.claudeHowSure, {
      result: "met",
      recordedAt: "2026-09-26T16:45:00.000Z",
      copiedAt: "2026-09-26T16:20:00.000Z",
      note: "",
      handBack: HOW_SURE_MET_REPLY,
    }),
    answerKeyTake,
  ];
  for (const a of results) {
    files[assessmentPath(a.profileSlug, a.collectionSlug, a.credentialSlug, a.fileStem)] = serializeAssessment(a);
  }

  // A bake-off waiting on Check an answer key's skeleton (hold-and-compare): each agent's
  // reply held without a verdict, Codex's after its Met take there.
  const held: HeldReply[] = [
    await heldTake(CLAUDE, answerKey, SAMPLE.held.claudeAnswerKey, { heldAt: "2026-09-29T10:15:00.000Z", copiedAt: "2026-09-29T10:02:00.000Z", handBack: ANSWER_KEY_CLAUDE_REPLY }),
    await heldTake(CODEX, answerKey, SAMPLE.held.codexAnswerKey, { heldAt: "2026-09-29T11:40:00.000Z", copiedAt: "2026-09-29T11:21:00.000Z", handBack: ANSWER_KEY_CODEX_REPLY }),
  ];
  for (const h of held) files[heldPath(h.profileSlug, h.collectionSlug, h.credentialSlug, h.fileStem)] = serializeHeld(h);

  // Claude Code is Say how sure you are's go-to, marked on the Met take that earned it.
  const goTo: Mark = {
    collectionSlug: SAMPLE.collection,
    credentialSlug: howSure.slug,
    id: SAMPLE.marks.howSure,
    profileSlug: CLAUDE.slug,
    fileStem: SAMPLE.takes.claudeHowSure,
  };
  files[markPath(goTo.collectionSlug, goTo.credentialSlug, goTo.id)] = serializeMark(goTo);

  if (variant === "judged") {
    for (const a of await judgedTakes(answerKey)) {
      files[assessmentPath(a.profileSlug, a.collectionSlug, a.credentialSlug, a.fileStem)] = serializeAssessment(a);
    }
  }

  // Codex holds Name what matters next's handoff, waiting on its reply.
  const copiedAt = "2026-09-30T08:15:00.000Z";
  const pending: PendingTest[] = [
    {
      profileSlug: CODEX.slug,
      credentialKey: credentialKey(whatNext),
      copiedAt,
      assignmentVersion: await assignmentVersion(whatNext.task, whatNext.rubric),
      setup: { harness: CODEX.harness, model: CODEX.model, effort: CODEX.effort },
      context: contextAt(CODEX, copiedAt),
      handoff: skeletonFor(whatNext),
    },
  ];

  return { files, pending };
}
