import { describe, expect, it } from "vitest";
import { SKELETON_ID } from "./handoffs";
import { handoffRuns, heldOn, heldReadingOf, isHeld, latestRunId, readingOfTake, takeTime } from "./handoffResults";
import { buildMatrix } from "./matrix";
import {
  credentialKey,
  type AgentProfile,
  type Assessment,
  type Credential,
  type FolderState,
  type Handoff,
  type HeldReading,
  type HeldReply,
  type JevReading,
} from "./types";

const review: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: [],
  task: "Review the diff.",
  rubric: "",
  extraSections: [],
};
const key = credentialKey(review);

function agent(slug: string): AgentProfile {
  return { slug, name: `${slug} agent`, harness: "claude-code", model: slug, effort: "high", repo: "", notes: "", params: {} };
}
const opus = agent("opus");
const codex = agent("codex");
const haiku = agent("haiku");

function handoff(id: string): Handoff {
  return { id, collectionSlug: "eng", credentialSlug: "review", text: `# ${id}\n\n{{task}}\n` };
}

let stem = 0;
function result(profile: AgentProfile, handoffId: string | null, overrides: Partial<Assessment> = {}): Assessment {
  stem += 1;
  return {
    profileSlug: profile.slug,
    collectionSlug: "eng",
    credentialSlug: "review",
    fileStem: `2026090${stem}T090000Z`,
    result: "met",
    recordedAt: `2026-09-0${stem}T09:00:00.000Z`,
    assignmentVersion: "v",
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    note: "",
    handBack: `reply ${stem}`,
    ...(handoffId === null ? {} : { handoff: { id: handoffId, text: `filled ${handoffId}` } }),
    ...overrides,
  };
}

function folder(opts: { profiles?: AgentProfile[]; assessments?: Assessment[]; held?: HeldReply[]; handoffs?: Handoff[]; heldReadings?: HeldReading[] }): FolderState {
  return {
    collections: [{ slug: "eng", name: "Engineering", description: "", order: ["review"], codes: { review: 1 } }],
    credentials: [review],
    profiles: opts.profiles ?? [opus, codex, haiku],
    assessments: opts.assessments ?? [],
    held: opts.held ?? [],
    handoffs: opts.handoffs ?? [],
    marks: [],
    heldReadings: opts.heldReadings ?? [],
    headToHeads: [],
    skeleton: null,
    errors: [],
    warnings: [],
    raw: {},
  };
}

async function runsOf(state: FolderState) {
  return handoffRuns(await buildMatrix(state), state, key);
}

describe("handoffRuns", () => {
  it("Covers AE1. Every agent that ran the one handoff gets an entry, a Not met one included", async () => {
    stem = 0;
    const state = folder({
      handoffs: [handoff("a")],
      assessments: [result(opus, "a"), result(codex, "a", { result: "not_met" }), result(haiku, "a")],
    });
    const { mode, runs } = await runsOf(state);
    expect(mode).toBe("single");
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("a");
    expect(runs[0].agents.map((e) => e.profile.slug)).toEqual(["haiku", "codex", "opus"]);
    expect(runs[0].agents.find((e) => e.profile.slug === "codex")?.latest).toMatchObject({ result: "not_met" });
    expect(runs[0].met).toBe(2);
  });

  it("Covers AE2. A handoff with no results adds no run", async () => {
    stem = 0;
    const state = folder({ handoffs: [handoff("a"), handoff("b")], assessments: [result(opus, "a")] });
    const { mode, runs } = await runsOf(state);
    expect(mode).toBe("single");
    expect(runs.map((r) => r.id)).toEqual(["a"]);
  });

  it("Covers AE3. Two handoffs that ran make two runs in creation order, and the badge is multi", async () => {
    stem = 0;
    const state = folder({
      handoffs: [handoff("a"), handoff("b")],
      assessments: [result(opus, "b"), result(codex, "a"), result(haiku, "a", { result: "not_met" })],
    });
    const { mode, runs } = await runsOf(state);
    expect(mode).toBe("multi");
    expect(runs.map((r) => [r.id, r.agents.length, r.met])).toEqual([
      ["a", 2, 1],
      ["b", 1, 1],
    ]);
  });

  it("Covers AE4. A result from before handoffs runs the skeleton, which comes first", async () => {
    stem = 0;
    const state = folder({ handoffs: [handoff("a")], assessments: [result(opus, "a"), result(codex, null)] });
    const { mode, runs } = await runsOf(state);
    expect(mode).toBe("multi");
    expect(runs.map((r) => r.id)).toEqual([SKELETON_ID, "a"]);
  });

  it("Covers AE5. An agent's re-test keeps one entry: the latest, with the older take below", async () => {
    stem = 0;
    const first = result(opus, "a", { result: "not_met" });
    const second = result(opus, "a");
    const { runs } = await runsOf(folder({ handoffs: [handoff("a")], assessments: [first, second] }));
    expect(runs[0].agents).toHaveLength(1);
    expect(runs[0].agents[0].latest.fileStem).toBe(second.fileStem);
    expect(runs[0].agents[0].older.map((a) => a.fileStem)).toEqual([first.fileStem]);
  });

  it("leaves out results for an agent that is no longer in the folder", async () => {
    stem = 0;
    const gone = agent("gone");
    const state = folder({ profiles: [opus], handoffs: [handoff("a"), handoff("b")], assessments: [result(opus, "a"), result(gone, "b")] });
    const { mode, runs } = await runsOf(state);
    expect(mode).toBe("single");
    expect(runs.map((r) => r.id)).toEqual(["a"]);
  });

  it("a badge with no results has no runs and is single", async () => {
    const { mode, runs } = await runsOf(folder({}));
    expect(mode).toBe("single");
    expect(runs).toEqual([]);
  });
});

function held(profile: AgentProfile, handoffId: string | null, overrides: Partial<HeldReply> = {}): HeldReply {
  stem += 1;
  return {
    profileSlug: profile.slug,
    collectionSlug: "eng",
    credentialSlug: "review",
    fileStem: `2026090${stem}T090000Z`,
    heldAt: `2026-09-0${stem}T09:00:00.000Z`,
    assignmentVersion: "v",
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    handBack: `held ${stem}`,
    ...(handoffId === null ? {} : { handoff: { id: handoffId, text: `filled ${handoffId}` } }),
    ...overrides,
  };
}

describe("handoffRuns with held replies (KTD7)", () => {
  it("a held reply on a second handoff makes it a run, and the badge multi", async () => {
    stem = 0;
    const state = folder({ handoffs: [handoff("a")], assessments: [result(opus, null)], held: [held(codex, "a")] });
    const { mode, runs } = await runsOf(state);
    expect(mode).toBe("multi");
    expect(runs.map((r) => [r.id, r.agents.length, r.met, r.held])).toEqual([
      [SKELETON_ID, 1, 1, 0],
      ["a", 1, 0, 1],
    ]);
  });

  it("a badge whose only replies are held has one single run, with the held reply as its agent's latest", async () => {
    stem = 0;
    const one = held(opus, null);
    const { mode, runs } = await runsOf(folder({ held: [one] }));
    expect(mode).toBe("single");
    expect(runs[0].agents[0].latest).toEqual(one);
    expect(isHeld(runs[0].agents[0].latest)).toBe(true);
  });

  it("an agent's takes interleave by time: an older held reply sits below a newer result, a newer one leads", async () => {
    stem = 0;
    const older = held(opus, null);
    const met = result(opus, null);
    const newer = held(opus, null);
    const { runs } = await runsOf(folder({ assessments: [met], held: [older, newer] }));
    expect(runs[0].agents[0].latest).toEqual(newer);
    expect(runs[0].agents[0].older).toEqual([met, older]);
  });

  it("met counts agents whose latest result is Met, skipping held replies; held counts the replies still held", async () => {
    stem = 0;
    const state = folder({ assessments: [result(opus, null), result(codex, null, { result: "not_met" })], held: [held(opus, null), held(codex, null), held(codex, null)] });
    const { runs } = await runsOf(state);
    expect([runs[0].agents.length, runs[0].met, runs[0].held]).toEqual([2, 1, 3]);
  });

  it("leaves out held replies of an agent not in the folder, and of a badge whose collection is missing", async () => {
    stem = 0;
    const gone = agent("gone");
    expect((await runsOf(folder({ profiles: [opus], held: [held(gone, null)] }))).runs).toEqual([]);
    const orphan = { ...folder({ held: [held(opus, null)] }), collections: [] };
    expect((await runsOf(orphan)).runs).toEqual([]);
  });

  it("lists a take from the folder even while the matrix still lags behind it", async () => {
    stem = 0;
    const one = held(opus, null);
    const before = folder({ held: [one] });
    const matrix = await buildMatrix(before);
    // Judged: the folder now has the result and no held reply; the matrix has not caught up.
    const judged = { ...result(opus, null), fileStem: one.fileStem, recordedAt: one.heldAt };
    const after = { ...before, held: [], assessments: [judged] };
    expect(handoffRuns(matrix, after, key).runs[0].agents[0].latest).toEqual(judged);
  });
});

describe("takes", () => {
  it("takeTime reads a result's recorded time and a held reply's held time", () => {
    stem = 0;
    const r = result(opus, null);
    const h = held(opus, null);
    expect([takeTime(r), takeTime(h)]).toEqual([r.recordedAt, h.heldAt]);
    expect([isHeld(r), isHeld(h)]).toEqual([false, true]);
  });

  it("heldOn lists a badge's held replies from agents still in the folder, oldest first", () => {
    stem = 0;
    const first = held(codex, "a");
    const second = held(opus, null);
    const gone = held(agent("gone"), null);
    const state = folder({ held: [second, gone, first] });
    expect(heldOn(state, key)).toEqual([first, second]);
    expect(heldOn(state, "eng/other")).toEqual([]);
  });
});

describe("latestRunId", () => {
  it("names the handoff of the agent's latest result across all handoffs", async () => {
    stem = 0;
    const state = folder({ handoffs: [handoff("a")], assessments: [result(opus, null), result(opus, "a", { result: "not_met" })] });
    expect(latestRunId(await buildMatrix(state), opus.slug, key)).toBe("a");
  });

  it("is null for an agent with no result on the badge", async () => {
    expect(latestRunId(await buildMatrix(folder({})), opus.slug, key)).toBeNull();
  });
});

describe("a held reply's reading (jev-in-compare KTD3)", () => {
  const reading = (assignmentVersion: string, askedAt: string, overall = 0.5): JevReading => ({
    model: "jev-1",
    assignmentVersion,
    askedAt,
    seen: "before",
    overall,
    points: [],
  });
  /** A reading file of `of`, taken after it was held. */
  const later = (of: HeldReply, id: string, r: JevReading, overrides: Partial<HeldReading> = {}): HeldReading => ({
    profileSlug: of.profileSlug,
    collectionSlug: of.collectionSlug,
    credentialSlug: of.credentialSlug,
    id,
    fileStem: of.fileStem,
    reading: r,
    ...overrides,
  });

  it("is the hold-time reading when no later one was taken, and undefined when there is none", () => {
    stem = 0;
    const atHold = reading("v", "2026-09-01T08:00:00.000Z");
    const h = held(opus, null, { jev: atHold });
    const bare = held(codex, null);
    const state = folder({ held: [h, bare] });
    expect(heldReadingOf(state, h, "v")).toEqual(atHold);
    expect(heldReadingOf(state, bare, "v")).toBeUndefined();
  });

  it("a later reading at the current version is the reply's, over the hold-time one", () => {
    stem = 0;
    const h = held(opus, null, { jev: reading("v", "2026-09-01T08:00:00.000Z", 0.2) });
    const newer = reading("v", "2026-09-03T08:00:00.000Z", 0.9);
    const state = folder({ held: [h], heldReadings: [later(h, "20260903T080000Z", newer)] });
    expect(heldReadingOf(state, h, "v")).toEqual(newer);
  });

  it("the newest by asked time wins, whatever order the files are in", () => {
    stem = 0;
    const h = held(opus, null);
    const newest = reading("v", "2026-09-05T08:00:00.000Z", 0.9);
    const state = folder({
      held: [h],
      heldReadings: [later(h, "20260904T080000Z", newest), later(h, "20260906T080000Z", reading("v", "2026-09-04T08:00:00.000Z", 0.1))],
    });
    expect(heldReadingOf(state, h, "v")).toEqual(newest);
  });

  it("prefers a reading at the current version over a newer one at another, so a rubric edited and put back finds its reading again", () => {
    stem = 0;
    const atV = reading("v", "2026-09-02T08:00:00.000Z", 0.3);
    const atEdit = reading("edited", "2026-09-04T08:00:00.000Z", 0.8);
    const h = held(opus, null, { jev: atV });
    const state = folder({ held: [h], heldReadings: [later(h, "20260904T080000Z", atEdit)] });
    expect(heldReadingOf(state, h, "v")).toEqual(atV);
    expect(heldReadingOf(state, h, "edited")).toEqual(atEdit);
  });

  it("with none at the current version, or the version unknown, it is the newest overall", () => {
    stem = 0;
    const older = reading("a", "2026-09-02T08:00:00.000Z");
    const newer = reading("b", "2026-09-03T08:00:00.000Z");
    const h = held(opus, null, { jev: older });
    const state = folder({ held: [h], heldReadings: [later(h, "20260903T080000Z", newer)] });
    expect(heldReadingOf(state, h, "c")).toEqual(newer);
    expect(heldReadingOf(state, h, null)).toEqual(newer);
  });

  it("ignores readings of another stem, another agent or another badge", () => {
    stem = 0;
    const h = held(opus, null);
    const other = reading("v", "2026-09-09T08:00:00.000Z");
    const state = folder({
      held: [h],
      heldReadings: [
        later(h, "20260909T080000Z", other, { fileStem: "20200101T000000Z" }),
        later(h, "20260909T080001Z", other, { profileSlug: codex.slug }),
        later(h, "20260909T080002Z", other, { credentialSlug: "other" }),
      ],
    });
    expect(heldReadingOf(state, h, "v")).toBeUndefined();
  });

  it("readingOfTake: a held take's reading as above, a result's own", () => {
    stem = 0;
    const own = reading("v", "2026-09-01T08:00:00.000Z");
    const r = result(opus, null, { jev: own });
    const h = held(codex, null);
    const newer = reading("v", "2026-09-03T08:00:00.000Z");
    const state = folder({ assessments: [r], held: [h], heldReadings: [later(h, "20260903T080000Z", newer)] });
    expect(readingOfTake(state, r, "v")).toEqual(own);
    expect(readingOfTake(state, h, "v")).toEqual(newer);
    expect(readingOfTake(state, result(opus, null), "v")).toBeUndefined();
  });
});
