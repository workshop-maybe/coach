import { describe, expect, it } from "vitest";
import {
  countLine,
  currentHeadToHead,
  currentReadingOf,
  marksOf,
  pairKey,
  planCompareJev,
  readingKey,
  type CompareTake,
} from "./compareJev";
import { assignmentVersion } from "./hash";
import type { Take } from "./handoffResults";
import type { AgentProfile, Assessment, Credential, FolderState, HeadToHead, HeadToHeadPoint, HeldReading, HeldReply, JevReading } from "./types";

const TASK = "Build a CLI.";
const RUBRIC = "- Flags parse.\n- Help prints.\n\nMet when both hold.";
const TARGET = "I can parse flags";

const badge: Credential = {
  slug: "cli",
  collectionSlug: "eng",
  name: "Write a CLI",
  learningTargets: [TARGET],
  task: TASK,
  rubric: RUBRIC,
  extraSections: [],
};
const KEY = "eng/cli";

function agent(slug: string, name: string): AgentProfile {
  return { slug, name, harness: "claude-code", model: slug, effort: "high", repo: "", notes: "", params: {} };
}
const claude = agent("claude", "Claude Code");
const codex = agent("codex", "Codex");
const gemini = agent("gemini", "Gemini");
const haiku = agent("haiku", "Haiku");
const PROFILES = [claude, codex, gemini, haiku];

function held(profile: AgentProfile, day: number, overrides: Partial<HeldReply> = {}): HeldReply {
  return {
    profileSlug: profile.slug,
    collectionSlug: "eng",
    credentialSlug: "cli",
    fileStem: `202609${String(day).padStart(2, "0")}T090000Z`,
    heldAt: `2026-09-${String(day).padStart(2, "0")}T09:00:00.000Z`,
    assignmentVersion: "v",
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    handBack: `${profile.name}'s reply.`,
    ...overrides,
  };
}

function result(profile: AgentProfile, day: number, overrides: Partial<Assessment> = {}): Assessment {
  return {
    profileSlug: profile.slug,
    collectionSlug: "eng",
    credentialSlug: "cli",
    fileStem: `202609${String(day).padStart(2, "0")}T090000Z`,
    result: "met",
    recordedAt: `2026-09-${String(day).padStart(2, "0")}T09:00:00.000Z`,
    assignmentVersion: "v",
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    note: "",
    handBack: `${profile.name}'s judged reply.`,
    ...overrides,
  };
}

function reading(version: string, targets: string[] = [TARGET], askedAt = "2026-09-20T09:00:00.000Z"): JevReading {
  return {
    model: "jev-1.13.0",
    assignmentVersion: version,
    askedAt,
    seen: "before",
    overall: 0.6,
    points: [
      { text: "Flags parse.", probability: 0.6 },
      { text: "Help prints.", probability: 0.6 },
    ],
    targets: targets.map((text) => ({ text, probability: 0.6 })),
    examplesSent: 0,
  };
}

/** A reading of `of` taken in compare. */
function readingFile(of: HeldReply, r: JevReading, id = "20260920T090000Z"): HeldReading {
  return { profileSlug: of.profileSlug, collectionSlug: "eng", credentialSlug: "cli", id, fileStem: of.fileStem, reading: r };
}

function headToHead(a: Take, b: Take, version: string, points: HeadToHeadPoint[], id = "20260921T090000Z"): HeadToHead {
  return {
    collectionSlug: "eng",
    credentialSlug: "cli",
    id,
    model: "jev-1.13.0",
    assignmentVersion: version,
    askedAt: "2026-09-21T09:00:00.000Z",
    first: { profileSlug: a.profileSlug, fileStem: a.fileStem },
    second: { profileSlug: b.profileSlug, fileStem: b.fileStem },
    points,
  };
}

const NO_CLEAR: HeadToHeadPoint[] = [
  { text: "Flags parse.", firstOver: 0.5, secondOver: 0.5 },
  { text: "Help prints.", firstOver: 0.5, secondOver: 0.5 },
];

function folder(opts: {
  credential?: Credential;
  assessments?: Assessment[];
  held?: HeldReply[];
  heldReadings?: HeldReading[];
  headToHeads?: HeadToHead[];
}): FolderState {
  return {
    collections: [{ slug: "eng", name: "Engineering", description: "", order: ["cli"], codes: { cli: 1 } }],
    credentials: [opts.credential ?? badge],
    profiles: PROFILES,
    assessments: opts.assessments ?? [],
    held: opts.held ?? [],
    handoffs: [],
    marks: [],
    heldReadings: opts.heldReadings ?? [],
    headToHeads: opts.headToHeads ?? [],
    skeleton: null,
    errors: [],
    warnings: [],
    raw: {},
  };
}

/** The compare's takes in strip order, as the view names them. */
function entries(takes: Take[]): CompareTake[] {
  return takes.map((take) => ({ id: `${take.profileSlug}/${take.fileStem}`, take, name: PROFILES.find((p) => p.slug === take.profileSlug)!.name }));
}

const idOf = (t: Take) => `${t.profileSlug}/${t.fileStem}`;

async function plan(state: FolderState, takes: Take[], skipped?: ReadonlySet<string>, credential = state.credentials[0]) {
  const version = await assignmentVersion(credential.task, credential.rubric);
  return planCompareJev({ state, key: KEY, credential, version, takes: entries(takes), skipped });
}

const pairsOf = (p: Awaited<ReturnType<typeof plan>>) => p.pairs.map((x) => [x.first.id, x.second.id]);

describe("what compare asks Jev (KTD8)", () => {
  it("Covers AE1. Three held replies, one already read in the test: two readings and three head-to-heads, said before sending", async () => {
    const version = await assignmentVersion(TASK, RUBRIC);
    const a = held(claude, 1, { jev: reading(version) });
    const b = held(codex, 2);
    const c = held(gemini, 3);
    const p = await plan(folder({ held: [a, b, c] }), [a, b, c]);
    expect(p.readings.map((r) => r.entry.id)).toEqual([idOf(b), idOf(c)]);
    expect(pairsOf(p)).toEqual([
      [idOf(a), idOf(b)],
      [idOf(a), idOf(c)],
      [idOf(b), idOf(c)],
    ]);
    expect(p.countLine).toBe("Sends 5 requests: 2 readings and 3 head-to-heads");
    expect(p.tooLongLines).toEqual([]);
    // Each reading asks about its own reply with the badge's targets; each pair sends its two replies in strip order.
    expect(p.readings.map((r) => r.request.state.reply)).toEqual([b.handBack, c.handBack]);
    expect(p.readings[0].request.state.learning_targets).toEqual([TARGET]);
    expect(p.pairs[2].request.state).toMatchObject({ reply_1: b.handBack, reply_2: c.handBack, rubric_points: ["Flags parse.", "Help prints."] });
    expect(p.readings.map((r) => r.itemKey)).toEqual([readingKey(idOf(b)), readingKey(idOf(c))]);
    expect(p.pairs.map((x) => x.itemKey)[0]).toBe(pairKey(idOf(a), idOf(b)));
  });

  it("Covers AE3. After a full set of answers, a fourth reply added: only its reading and its three new pairs", async () => {
    const version = await assignmentVersion(TASK, RUBRIC);
    const a = held(claude, 1, { jev: reading(version) });
    const b = held(codex, 2);
    const c = held(gemini, 3);
    const d = held(haiku, 4);
    const state = folder({
      held: [a, b, c, d],
      heldReadings: [readingFile(b, reading(version)), readingFile(c, reading(version), "20260920T090001Z")],
      headToHeads: [
        headToHead(a, b, version, NO_CLEAR),
        headToHead(c, a, version, NO_CLEAR, "20260921T090001Z"),
        headToHead(b, c, version, NO_CLEAR, "20260921T090002Z"),
      ],
    });
    expect((await plan(state, [a, b, c])).countLine).toBeNull();
    const p = await plan(state, [a, b, c, d]);
    expect(p.readings.map((r) => r.entry.id)).toEqual([idOf(d)]);
    expect(pairsOf(p)).toEqual([
      [idOf(a), idOf(d)],
      [idOf(b), idOf(d)],
      [idOf(c), idOf(d)],
    ]);
    expect(p.countLine).toBe("Sends 4 requests: 1 reading and 3 head-to-heads");
  });

  it("Covers AE4. After the rubric changes, every held reading and every pair is missing again", async () => {
    const version = await assignmentVersion(TASK, RUBRIC);
    const a = held(claude, 1, { jev: reading(version) });
    const b = held(codex, 2, { jev: reading(version) });
    const c = held(gemini, 3, { jev: reading(version) });
    const edited = { ...badge, rubric: `${RUBRIC}\n- Tests pass.` };
    const state = folder({
      credential: edited,
      held: [a, b, c],
      headToHeads: [headToHead(a, b, version, NO_CLEAR), headToHead(a, c, version, NO_CLEAR, "20260921T090001Z"), headToHead(b, c, version, NO_CLEAR, "20260921T090002Z")],
    });
    const p = await plan(state, [a, b, c]);
    expect(p.readings).toHaveLength(3);
    expect(p.pairs).toHaveLength(3);
    expect(p.pairs[0].request.state.rubric_points).toEqual(["Flags parse.", "Help prints.", "Tests pass."]);
    expect(p.countLine).toBe("Sends 6 requests: 3 readings and 3 head-to-heads");
  });

  it("a judged reply gets no reading, read or not, and still takes part in every pair", async () => {
    const a = result(claude, 1);
    const b = held(codex, 2);
    const c = held(gemini, 3);
    const p = await plan(folder({ assessments: [a], held: [b, c] }), [a, b, c]);
    expect(p.readings.map((r) => r.entry.id)).toEqual([idOf(b), idOf(c)]);
    expect(pairsOf(p)).toEqual([
      [idOf(a), idOf(b)],
      [idOf(a), idOf(c)],
      [idOf(b), idOf(c)],
    ]);
  });

  it("a rubric with no points asks only readings", async () => {
    const notesOnly = { ...badge, rubric: "Met when the CLI works." };
    const a = held(claude, 1);
    const b = held(codex, 2);
    const p = await plan(folder({ credential: notesOnly, held: [a, b] }), [a, b]);
    expect(p.readings).toHaveLength(2);
    expect(p.pairs).toEqual([]);
    expect(p.countLine).toBe("Sends 2 requests: 2 readings");
  });

  it("a badge with no rubric asks nothing and says nothing", async () => {
    const bare = { ...badge, rubric: "  \n" };
    const a = held(claude, 1, { handBack: "x".repeat(130_000) });
    const b = held(codex, 2);
    const p = await plan(folder({ credential: bare, held: [a, b] }), [a, b]);
    expect(p).toMatchObject({ readings: [], pairs: [], countLine: null, examplesLine: null, tooLongLines: [] });
  });

  it("a reading lacking one of the badge's current learning targets is missing", async () => {
    const version = await assignmentVersion(TASK, RUBRIC);
    const twoTargets = { ...badge, learningTargets: [TARGET, "I can print help"] };
    const a = held(claude, 1, { jev: reading(version) });
    const p = await plan(folder({ credential: twoTargets, held: [a] }), [a]);
    expect(p.readings.map((r) => r.entry.id)).toEqual([idOf(a)]);
    expect(p.readings[0].request.state.learning_targets).toEqual([TARGET, "I can print help"]);
  });

  it("a learning target with trailing spaces, already read, is not missing, and neither is a blank or repeated one", async () => {
    const version = await assignmentVersion(TASK, RUBRIC);
    const spaced = { ...badge, learningTargets: [`${TARGET}  `, "", ` ${TARGET}`] };
    const a = held(claude, 1, { jev: reading(version) });
    const p = await plan(folder({ credential: spaced, held: [a] }), [a]);
    expect(p.readings).toEqual([]);
    expect(p.countLine).toBeNull();
  });

  it("a reading at an old version is missing even when it is the reply's newest", async () => {
    const version = await assignmentVersion(TASK, RUBRIC);
    const a = held(claude, 1, { jev: reading(version, [TARGET], "2026-09-01T09:00:00.000Z") });
    const b = held(codex, 2);
    const state = folder({ held: [a, b], heldReadings: [readingFile(b, reading("old"))] });
    const p = await plan(state, [a, b]);
    expect(p.readings.map((r) => r.entry.id)).toEqual([idOf(b)]);
  });

  it("covers only the takes that ran the first take's handoff", async () => {
    const a = held(claude, 1);
    const b = held(codex, 2, { handoff: { id: "20260901T000000Z", text: "Another text." } });
    const c = held(gemini, 3);
    const p = await plan(folder({ held: [a, b, c] }), [a, b, c]);
    expect(p.readings.map((r) => r.entry.id)).toEqual([idOf(a), idOf(c)]);
    expect(pairsOf(p)).toEqual([[idOf(a), idOf(c)]]);
  });

  describe("too long for Jev", () => {
    it("a reply too long alone skips its reading and its pairs, each named, and leaves the count", async () => {
      const a = held(claude, 1, { handBack: "x".repeat(130_000) });
      const b = held(codex, 2);
      const c = held(gemini, 3);
      const p = await plan(folder({ held: [a, b, c] }), [a, b, c]);
      expect(p.readings.map((r) => r.entry.id)).toEqual([idOf(b), idOf(c)]);
      expect(pairsOf(p)).toEqual([[idOf(b), idOf(c)]]);
      expect(p.tooLongLines).toEqual([
        "Claude Code's reply is too long for Jev",
        "Claude Code and Codex are too long for Jev together",
        "Claude Code and Gemini are too long for Jev together",
      ]);
      expect(p.countLine).toBe("Sends 3 requests: 2 readings and 1 head-to-head");
    });

    it("two replies that fit alone but not together: the pair is named and left out", async () => {
      const version = await assignmentVersion(TASK, RUBRIC);
      const a = held(claude, 1, { handBack: "y".repeat(70_000), jev: reading(version) });
      const b = held(codex, 2, { handBack: "z".repeat(70_000), jev: reading(version) });
      const c = held(gemini, 3, { jev: reading(version) });
      const p = await plan(folder({ held: [a, b, c] }), [a, b, c]);
      expect(p.tooLongLines).toEqual(["Claude Code and Codex are too long for Jev together"]);
      expect(pairsOf(p)).toEqual([
        [idOf(a), idOf(c)],
        [idOf(b), idOf(c)],
      ]);
      expect(p.countLine).toBe("Sends 2 requests: 2 head-to-heads");
    });

    it("with only too-long items left, there is no count line and the too-long lines stay", async () => {
      const version = await assignmentVersion(TASK, RUBRIC);
      const a = held(claude, 1, { handBack: "y".repeat(70_000), jev: reading(version) });
      const b = held(codex, 2, { handBack: "z".repeat(70_000), jev: reading(version) });
      const p = await plan(folder({ held: [a, b] }), [a, b]);
      expect(p.readings).toEqual([]);
      expect(p.pairs).toEqual([]);
      expect(p.countLine).toBeNull();
      expect(p.examplesLine).toBeNull();
      expect(p.tooLongLines).toEqual(["Claude Code and Codex are too long for Jev together"]);
    });

    it("items Jev refused as too long this session join the too-long items in their place and leave the count", async () => {
      const a = held(claude, 1);
      const b = held(codex, 2);
      const c = held(gemini, 3);
      const skipped = new Set([readingKey(idOf(b)), pairKey(idOf(a), idOf(c))]);
      const p = await plan(folder({ held: [a, b, c] }), [a, b, c], skipped);
      expect(p.readings.map((r) => r.entry.id)).toEqual([idOf(a), idOf(c)]);
      expect(pairsOf(p)).toEqual([
        [idOf(a), idOf(b)],
        [idOf(b), idOf(c)],
      ]);
      expect(p.tooLongLines).toEqual(["Codex's reply is too long for Jev", "Claude Code and Gemini are too long for Jev together"]);
      expect(p.countLine).toBe("Sends 4 requests: 2 readings and 2 head-to-heads");
    });
  });

  it("the count line leaves out a zero part and uses singulars, each variant whole", () => {
    expect(countLine(0, 0)).toBeNull();
    expect(countLine(1, 0)).toBe("Sends 1 request: 1 reading");
    expect(countLine(2, 0)).toBe("Sends 2 requests: 2 readings");
    expect(countLine(0, 1)).toBe("Sends 1 request: 1 head-to-head");
    expect(countLine(0, 3)).toBe("Sends 3 requests: 3 head-to-heads");
    expect(countLine(1, 1)).toBe("Sends 2 requests: 1 reading and 1 head-to-head");
    expect(countLine(1, 3)).toBe("Sends 4 requests: 1 reading and 3 head-to-heads");
    expect(countLine(2, 1)).toBe("Sends 3 requests: 2 readings and 1 head-to-head");
    expect(countLine(2, 3)).toBe("Sends 5 requests: 2 readings and 3 head-to-heads");
  });

  describe("the examples line", () => {
    it("is null when no reading quotes an earlier reply", async () => {
      const a = held(claude, 1);
      const p = await plan(folder({ held: [a] }), [a]);
      expect(p.readings[0].sources).toEqual([]);
      expect(p.examplesLine).toBeNull();
    });

    it("says readings send earlier replies when one does, and with your notes when a note goes", async () => {
      const version = await assignmentVersion(TASK, RUBRIC);
      const a = held(claude, 1);
      const earlier = result(haiku, 5, { assignmentVersion: version, handBack: "An earlier reply on this badge." });
      const quiet = await plan(folder({ assessments: [earlier], held: [a] }), [a]);
      expect(quiet.readings[0].sources).toEqual([idOf(earlier)]);
      expect(quiet.examplesLine).toBe("Readings also send earlier replies on this badge");
      const noted = await plan(folder({ assessments: [{ ...earlier, note: "It skipped the help text." }], held: [a] }), [a]);
      expect(noted.examplesLine).toBe("Readings also send earlier replies on this badge with your notes");
    });

    it("is null when there is no reading to send, whatever the badge's results", async () => {
      const version = await assignmentVersion(TASK, RUBRIC);
      const a = held(claude, 1, { jev: reading(version) });
      const b = held(codex, 2, { jev: reading(version) });
      const earlier = result(haiku, 5, { assignmentVersion: version, handBack: "An earlier reply on this badge.", note: "A note." });
      const p = await plan(folder({ assessments: [earlier], held: [a, b] }), [a, b]);
      expect(p.countLine).toBe("Sends 1 request: 1 head-to-head");
      expect(p.examplesLine).toBeNull();
    });
  });
});

describe("what the grid reads (KTD7)", () => {
  it("currentReadingOf: a take's reading only at the current version", async () => {
    const version = await assignmentVersion(TASK, RUBRIC);
    const oldHeld = held(claude, 1, { jev: reading("old") });
    const newHeld = held(codex, 2);
    const judged = result(gemini, 3, { jev: reading(version) });
    const oldJudged = result(haiku, 4, { jev: reading("old") });
    const state = folder({ held: [oldHeld, newHeld], assessments: [judged, oldJudged], heldReadings: [readingFile(newHeld, reading(version))] });
    expect(currentReadingOf(state, oldHeld, version)).toBeUndefined();
    expect(currentReadingOf(state, newHeld, version)).toEqual(reading(version));
    expect(currentReadingOf(state, judged, version)).toEqual(reading(version));
    expect(currentReadingOf(state, oldJudged, version)).toBeUndefined();
  });

  it("currentHeadToHead: the newest naming both replies, in either order, at the current version", async () => {
    const version = await assignmentVersion(TASK, RUBRIC);
    const a = held(claude, 1);
    const b = held(codex, 2);
    const c = held(gemini, 3);
    const older = headToHead(a, b, version, NO_CLEAR, "20260921T090000Z");
    const newer = headToHead(b, a, version, NO_CLEAR, "20260921T090001Z");
    const stale = headToHead(a, b, "old", NO_CLEAR, "20260921T090002Z");
    const state = folder({ held: [a, b, c], headToHeads: [older, newer, stale] });
    expect(currentHeadToHead(state, KEY, a, b, version)).toEqual(newer);
    expect(currentHeadToHead(state, KEY, b, a, version)).toEqual(newer);
    expect(currentHeadToHead(state, KEY, a, c, version)).toBeUndefined();
    expect(currentHeadToHead(state, KEY, a, b, "other")).toBeUndefined();
  });

  describe("marksOf", () => {
    const ae2: HeadToHeadPoint[] = [
      // Point 1: the two orders disagree, so neither covers it better.
      { text: "Flags parse.", firstOver: 0.8, secondOver: 0.8 },
      // Point 2: the second reply covers it better in both orders.
      { text: "Help prints.", firstOver: 0.1, secondOver: 0.9 },
    ];
    const flipped = ae2.map((p) => ({ text: p.text, firstOver: p.secondOver, secondOver: p.firstOver }));

    it("Covers AE2. Codex over Claude Code on point 2 in both orders marks Codex's point-2 cell with Claude Code, and the disagreeing point marks nothing", async () => {
      const version = await assignmentVersion(TASK, RUBRIC);
      const a = held(claude, 1);
      const b = held(codex, 2);
      for (const file of [headToHead(a, b, version, ae2), headToHead(b, a, version, flipped)]) {
        const marks = marksOf(folder({ held: [a, b], headToHeads: [file] }), KEY, entries([a, b]), version);
        expect(marks.get(idOf(b))).toEqual([[], [idOf(a)]]);
        expect(marks.get(idOf(a))).toEqual([[], []]);
      }
    });

    it("names every reply a take covers better than, in strip order", async () => {
      const version = await assignmentVersion(TASK, RUBRIC);
      const a = held(claude, 1);
      const b = held(codex, 2);
      const c = held(gemini, 3);
      const firstWins: HeadToHeadPoint[] = [
        { text: "Flags parse.", firstOver: 0.9, secondOver: 0.1 },
        { text: "Help prints.", firstOver: 0.5, secondOver: 0.5 },
      ];
      const state = folder({ held: [a, b, c], headToHeads: [headToHead(c, a, version, firstWins), headToHead(c, b, version, firstWins, "20260921T090001Z")] });
      const marks = marksOf(state, KEY, entries([a, b, c]), version);
      expect(marks.get(idOf(c))).toEqual([[idOf(a), idOf(b)], []]);
      expect(marks.get(idOf(a))).toEqual([[], []]);
    });

    it("finds each point by its text, so a head-to-head saved over a rubric that repeated a point still marks every point after it", async () => {
      // A badge made from the old preset keeps "Holds." twice; its parse counts it once now.
      const rubric = "1. Holds.\n2. Wrong A.\n3. Holds.\n4. Wrong B.";
      const repeated = { ...badge, rubric };
      const version = await assignmentVersion(TASK, rubric);
      const a = held(claude, 1);
      const b = held(codex, 2);
      const saved: HeadToHeadPoint[] = [
        { text: "Holds.", firstOver: 0.9, secondOver: 0.1 },
        { text: "Wrong A.", firstOver: 0.5, secondOver: 0.5 },
        { text: "Holds.", firstOver: 0.9, secondOver: 0.1 },
        { text: "Wrong B.", firstOver: 0.1, secondOver: 0.9 },
      ];
      const state = folder({ credential: repeated, held: [a, b], headToHeads: [headToHead(a, b, version, saved)] });
      const marks = marksOf(state, KEY, entries([a, b]), version);
      expect(marks.get(idOf(a))).toEqual([[idOf(b)], [], []]);
      expect(marks.get(idOf(b))).toEqual([[], [], [idOf(a)]]);
    });

    it("an old-version head-to-head marks nothing, nor does a point whose text no longer matches", async () => {
      const version = await assignmentVersion(TASK, RUBRIC);
      const a = held(claude, 1);
      const b = held(codex, 2);
      const renamed = ae2.map((p) => ({ ...p, text: `${p.text} (old)` }));
      for (const file of [headToHead(a, b, "old", ae2), headToHead(a, b, version, renamed)]) {
        const marks = marksOf(folder({ held: [a, b], headToHeads: [file] }), KEY, entries([a, b]), version);
        expect(marks.get(idOf(b))).toEqual([[], []]);
      }
    });
  });
});
