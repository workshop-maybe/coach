import { beforeAll, describe, expect, it } from "vitest";
import { assignmentVersion } from "./hash";
import { buildMatrix } from "./matrix";
import { byCost, costPlaces, recommend, type Recommendation } from "./recommend";
import type { AgentProfile, Assessment, AssessmentResult, Credential, FolderState, Mark, Rating } from "./types";

const migration: Credential = {
  slug: "migration",
  collectionSlug: "eng",
  name: "Write a migration",
  learningTargets: ["I can write a reversible migration."],
  task: "Write the migration.",
  rubric: "Reversible.",
  extraSections: [],
};
const KEY = "eng/migration";

function agent(slug: string, name: string): AgentProfile {
  return { slug, name, harness: "claude-code", model: slug, effort: "high", repo: "", notes: "", params: {} };
}
const codex = agent("codex", "Codex");
const opus = agent("opus", "Opus");
const sonnet = agent("sonnet", "Sonnet");

let version = "";
beforeAll(async () => {
  version = await assignmentVersion(migration.task, migration.rubric);
});

function result(p: AgentProfile, verdict: AssessmentResult, stem = "20261001T090000Z", overrides: Partial<Assessment> = {}): Assessment {
  return {
    profileSlug: p.slug,
    collectionSlug: "eng",
    credentialSlug: "migration",
    fileStem: stem,
    result: verdict,
    recordedAt: "2026-10-01T09:00:00.000Z",
    assignmentVersion: version,
    setup: { harness: p.harness, model: p.model, effort: p.effort },
    note: "",
    handBack: "Done",
    ...overrides,
  };
}

function goTo(p: AgentProfile, stem = "20261001T090000Z"): Mark {
  return { collectionSlug: "eng", credentialSlug: "migration", id: "20261002T090000Z", profileSlug: p.slug, fileStem: stem };
}

function folder(parts: Partial<FolderState>): FolderState {
  return {
    collections: [{ slug: "eng", name: "Engineering", description: "", order: ["migration"], codes: { migration: 1 } }],
    credentials: [migration],
    profiles: [codex, opus, sonnet],
    assessments: [],
    held: [],
    skeleton: null,
    handoffs: [],
    marks: [],
    heldReadings: [],
    headToHeads: [],
    errors: [],
    warnings: [],
    raw: {},
    ...parts,
  };
}

async function rec(state: FolderState, rating: Rating | null = null): Promise<Recommendation> {
  return recommend(state, await buildMatrix(state), KEY, rating);
}

const names = (hs: { profile: AgentProfile }[]) => hs.map((h) => h.profile.name);

describe("the cost order", () => {
  it("places only agents in the folder, each once, and lists the rest after them by name", () => {
    const state = folder({ costOrder: ["gone", "sonnet", "sonnet", "codex"] });
    expect([...costPlaces(state)]).toEqual([
      ["sonnet", 0],
      ["codex", 1],
    ]);
    expect(byCost(state).map((p) => p.name)).toEqual(["Sonnet", "Codex", "Opus"]);
    expect(byCost(folder({})).map((p) => p.name)).toEqual(["Codex", "Opus", "Sonnet"]);
  });

  it("keeps names like __proto__ as plain names", () => {
    const state = folder({ costOrder: ["__proto__", "constructor", "opus"] });
    expect([...costPlaces(state)]).toEqual([["opus", 0]]);
  });
});

describe("recommend", () => {
  it("Covers AE1. the go-to that holds cleanly wins over a cheaper holder, which is noted", async () => {
    const state = folder({ assessments: [result(codex, "met"), result(sonnet, "met")], marks: [goTo(codex)], costOrder: ["sonnet", "codex"] });
    const r = await rec(state);
    expect(r.kind).toBe("pick");
    if (r.kind !== "pick") return;
    expect(r.pick.profile.name).toBe("Codex");
    expect(r.basis).toBe("go-to");
    expect(r.step).toBe("none");
    expect(names(r.cheaper)).toEqual(["Sonnet"]);
    expect(r.nextUp).toBeNull();
    expect(names(r.alternatives)).toEqual(["Sonnet"]);
  });

  it("Covers AE2. a go-to whose latest result is Not met gives way to the cheapest clean holder", async () => {
    const state = folder({
      assessments: [result(opus, "met"), result(opus, "not_met", "20261003T090000Z", { recordedAt: "2026-10-03T09:00:00.000Z" }), result(codex, "met"), result(sonnet, "met")],
      marks: [goTo(opus)],
      costOrder: ["sonnet", "codex", "opus"],
    });
    const r = await rec(state);
    expect(r.kind === "pick" && r.pick.profile.name).toBe("Sonnet");
    expect(r.kind === "pick" && r.basis).toBe("cheapest");
    expect(r.kind === "pick" && r.nextUp?.profile.name).toBe("Codex");
  });

  it("Covers AE3. a job rated unusual or high-stakes steps up to the next placed clean holder", async () => {
    const state = folder({ assessments: [result(codex, "met"), result(sonnet, "met")], costOrder: ["sonnet", "codex"] });
    const r = await rec(state, "high-stakes");
    expect(r.kind).toBe("pick");
    if (r.kind !== "pick") return;
    expect(r.pick.profile.name).toBe("Codex");
    expect(r.step).toBe("stepped-up");
    expect(r.basis).toBe("cheapest");
    expect(names(r.cheaper)).toEqual(["Sonnet"]);
  });

  it("a lower rating never steps up", async () => {
    const state = folder({ assessments: [result(codex, "met"), result(sonnet, "met")], costOrder: ["sonnet", "codex"] });
    for (const rating of ["routine", "judgment", null] as const) {
      const r = await rec(state, rating);
      expect(r.kind === "pick" && [r.pick.profile.name, r.step]).toEqual(["Sonnet", "none"]);
    }
  });

  it("rated unusual or high-stakes with no clean holder above, the pick stands with nothing above", async () => {
    const state = folder({ assessments: [result(codex, "met"), result(sonnet, "met")], costOrder: ["sonnet", "codex"], marks: [goTo(codex)] });
    const r = await rec(state, "high-stakes");
    expect(r.kind === "pick" && [r.pick.profile.name, r.step]).toEqual(["Codex", "nothing-above"]);
  });

  it("a placed base with only unplaced clean holders above ends blocked by order, not nothing above", async () => {
    const state = folder({ assessments: [result(codex, "met"), result(sonnet, "met"), result(opus, "met")], costOrder: ["sonnet"] });
    const r = await rec(state, "high-stakes");
    expect(r.kind).toBe("pick");
    if (r.kind !== "pick") return;
    expect([r.pick.profile.name, r.step]).toEqual(["Sonnet", "blocked-by-order"]);
    expect(r.nextUp).toBeNull();
    expect(r.alternatives.map((h) => [h.profile.name, h.placed])).toEqual([
      ["Codex", false],
      ["Opus", false],
    ]);
  });

  it("an unplaced go-to is still the pick, blocked by order beside another unplaced holder and nothing above alone", async () => {
    const tied = folder({ assessments: [result(codex, "met"), result(opus, "met"), result(sonnet, "met")], marks: [goTo(codex)], costOrder: ["sonnet"] });
    const r = await rec(tied, "high-stakes");
    expect(r.kind === "pick" && [r.pick.profile.name, r.step, r.basis]).toEqual(["Codex", "blocked-by-order", "go-to"]);
    expect(r.kind === "pick" && names(r.cheaper)).toEqual(["Sonnet"]);
    const alone = folder({ assessments: [result(codex, "met"), result(sonnet, "met")], marks: [goTo(codex)], costOrder: ["sonnet"] });
    const s = await rec(alone, "high-stakes");
    expect(s.kind === "pick" && [s.pick.profile.name, s.step]).toEqual(["Codex", "nothing-above"]);
  });

  it("Covers AE7. no cost order and no go-to gives no pick, with the clean holders to take", async () => {
    const r = await rec(folder({ assessments: [result(codex, "met"), result(sonnet, "met")] }));
    expect(r).toMatchObject({ kind: "no-pick", noCostOrder: true });
    expect(r.kind === "no-pick" && names(r.holders)).toEqual(["Codex", "Sonnet"]);
  });

  it("one clean holder, no go-to and no cost order still gives no pick, as R10 reads", async () => {
    const r = await rec(folder({ assessments: [result(codex, "met")] }));
    expect(r).toMatchObject({ kind: "no-pick", noCostOrder: true });
  });

  it("clean holders that are all unplaced give no pick, though other agents are placed", async () => {
    const r = await rec(folder({ assessments: [result(codex, "met"), result(sonnet, "met")], costOrder: ["opus"] }));
    expect(r).toMatchObject({ kind: "no-pick", noCostOrder: false });
  });

  it("a go-to flagged as task changed isn't clean, so the cheapest clean holder is picked", async () => {
    const state = folder({
      assessments: [result(codex, "met", "20261001T090000Z", { assignmentVersion: "older" }), result(sonnet, "met")],
      marks: [goTo(codex)],
      costOrder: ["opus", "sonnet", "codex"],
    });
    const r = await rec(state);
    expect(r.kind === "pick" && [r.pick.profile.name, r.basis]).toEqual(["Sonnet", "cheapest"]);
  });

  it("Covers AE5 (domain). no clean holder names each flagged holder and why", async () => {
    const state = folder({ assessments: [result(codex, "met", "20261001T090000Z", { assignmentVersion: "older" }), result(sonnet, "not_met")] });
    const r = await rec(state);
    expect(r.kind).toBe("no-holder");
    expect(r.kind === "no-holder" && r.flagged.map((f) => [f.profile.name, f.flags])).toEqual([["Codex", ["earlier_version"]]]);
  });

  it("an agent the matrix still has but the folder no longer does is never offered", async () => {
    const before = folder({ assessments: [result(codex, "met"), result(sonnet, "met")], costOrder: ["sonnet", "codex"] });
    const matrix = await buildMatrix(before);
    const after = { ...before, profiles: [codex, opus] };
    const r = recommend(after, matrix, KEY, "high-stakes");
    expect(r.kind === "pick" && [r.pick.profile.name, names(r.alternatives)]).toEqual(["Codex", []]);
  });
});
