import { describe, expect, it } from "vitest";
import { SKELETON_ID } from "./handoffs";
import { handoffRuns, latestRunId } from "./handoffResults";
import { buildMatrix } from "./matrix";
import { credentialKey, type AgentProfile, type Assessment, type Credential, type FolderState, type Handoff } from "./types";

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

function folder(opts: { profiles?: AgentProfile[]; assessments?: Assessment[]; handoffs?: Handoff[] }): FolderState {
  return {
    collections: [{ slug: "eng", name: "Engineering", description: "", order: ["review"], codes: { review: 1 } }],
    credentials: [review],
    profiles: opts.profiles ?? [opus, codex, haiku],
    assessments: opts.assessments ?? [],
    handoffs: opts.handoffs ?? [],
    marks: [],
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
    expect(runs[0].agents.find((e) => e.profile.slug === "codex")?.latest.result).toBe("not_met");
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
