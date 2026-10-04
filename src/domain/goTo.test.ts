import { beforeAll, describe, expect, it } from "vitest";
import { goToOf, goToStanding } from "./goTo";
import { assignmentVersion } from "./hash";
import { buildMatrix } from "./matrix";
import type { AgentProfile, Assessment, AssessmentResult, Credential, FolderState, Mark } from "./types";

const review: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: ["I can find bugs."],
  task: "Review the diff.",
  rubric: "Names the bug.",
  extraSections: [],
};
const docs: Credential = { ...review, slug: "docs", name: "Docs" };
const KEY = "eng/review";

function agent(slug: string, name: string): AgentProfile {
  return { slug, name, harness: "claude-code", model: "opus", effort: "high", repo: "", notes: "", params: {} };
}
const codex = agent("codex", "Codex");
const claude = agent("claude", "Claude Code");

let version = "";
beforeAll(async () => {
  version = await assignmentVersion(review.task, review.rubric);
});

function result(p: AgentProfile, verdict: AssessmentResult, stem: string, overrides: Partial<Assessment> = {}): Assessment {
  const iso = `${stem.slice(0, 4)}-${stem.slice(4, 6)}-${stem.slice(6, 8)}T${stem.slice(9, 11)}:${stem.slice(11, 13)}:${stem.slice(13, 15)}.000Z`;
  return {
    profileSlug: p.slug,
    collectionSlug: "eng",
    credentialSlug: "review",
    fileStem: stem,
    result: verdict,
    recordedAt: iso,
    assignmentVersion: version,
    setup: { harness: p.harness, model: p.model, effort: p.effort },
    note: "",
    handBack: "Done",
    ...overrides,
  };
}

function mark(p: AgentProfile, resultStem: string, id: string, credentialSlug = "review"): Mark {
  return { collectionSlug: "eng", credentialSlug, id, profileSlug: p.slug, fileStem: resultStem };
}

function folder(parts: Partial<FolderState>): FolderState {
  return {
    collections: [{ slug: "eng", name: "Engineering", description: "", order: ["review", "docs"], codes: { review: 1, docs: 2 } }],
    credentials: [review, docs],
    profiles: [claude, codex],
    assessments: [],
    skeleton: null,
    handoffs: [],
    marks: [],
    errors: [],
    warnings: [],
    raw: {},
    ...parts,
  };
}

async function standing(state: FolderState) {
  const goTo = goToOf(state, KEY);
  return goTo ? { name: goTo.profile.name, ...goToStanding(await buildMatrix(state), goTo) } : null;
}

describe("a badge's go-to", () => {
  it("a badge with no marks has no go-to", () => {
    expect(goToOf(folder({ assessments: [result(codex, "met", "20261001T090000Z")] }), KEY)).toBeNull();
  });

  it("one mark on a Met result names that agent, holding and unflagged", async () => {
    const met = result(codex, "met", "20261001T090000Z");
    const state = folder({ assessments: [met], marks: [mark(codex, met.fileStem, "20261001T091000Z")] });
    expect(goToOf(state, KEY)?.result).toEqual(met);
    expect(await standing(state)).toEqual({ name: "Codex", holds: true, flags: [] });
  });

  it("Covers AE7. A later mark on Claude Code's latest result beats an earlier mark on Codex's older result", async () => {
    const older = result(codex, "met", "20260901T090000Z");
    const latest = result(claude, "met", "20260902T090000Z");
    const state = folder({
      assessments: [older, latest],
      marks: [mark(codex, older.fileStem, "20261001T090000Z"), mark(claude, latest.fileStem, "20261002T090000Z")],
    });
    expect((await standing(state))?.name).toBe("Claude Code");
  });

  it("marks order by their stamp: the one written second in the same second wins", () => {
    const a = result(codex, "met", "20260901T090000Z");
    const b = result(claude, "met", "20260902T090000Z");
    const state = folder({ assessments: [a, b], marks: [mark(claude, b.fileStem, "20261001T090001Z"), mark(codex, a.fileStem, "20261001T090000Z")] });
    expect(goToOf(state, KEY)?.profile.slug).toBe("claude");
  });

  it("only marks on this badge count", () => {
    const met = result(codex, "met", "20261001T090000Z");
    const state = folder({ assessments: [met], marks: [mark(codex, met.fileStem, "20261001T091000Z", "docs")] });
    expect(goToOf(state, KEY)).toBeNull();
  });

  it("Covers AE5. A go-to whose latest result is Not met stays the go-to, flagged and not holding, and its later Met clears the flag", async () => {
    const met = result(codex, "met", "20260901T090000Z");
    const notMet = result(codex, "not_met", "20260905T090000Z");
    const marks = [mark(codex, met.fileStem, "20260901T091000Z")];
    expect(await standing(folder({ assessments: [met, notMet], marks }))).toEqual({ name: "Codex", holds: false, flags: ["not_met"] });
    const again = result(codex, "met", "20260909T090000Z");
    expect(await standing(folder({ assessments: [met, notMet, again], marks }))).toEqual({ name: "Codex", holds: true, flags: [] });
  });

  it("Covers AE6. A go-to whose setup changed since its latest result is flagged setup changed", async () => {
    const met = result(codex, "met", "20260901T090000Z", { setup: { harness: "codex", model: "gpt", effort: "low" } });
    const state = folder({ assessments: [met], marks: [mark(codex, met.fileStem, "20260901T091000Z")] });
    expect(await standing(state)).toEqual({ name: "Codex", holds: true, flags: ["setup_mismatch"] });
  });

  it("Covers AE9. A go-to whose latest result was recorded against an earlier task is flagged task changed, and its later Met clears the flag", async () => {
    const met = result(codex, "met", "20260901T090000Z", { assignmentVersion: "000000000000" });
    const marks = [mark(codex, met.fileStem, "20260901T091000Z")];
    expect(await standing(folder({ assessments: [met], marks }))).toEqual({ name: "Codex", holds: true, flags: ["earlier_version"] });
    const again = result(codex, "met", "20260909T090000Z");
    expect(await standing(folder({ assessments: [met, again], marks }))).toEqual({ name: "Codex", holds: true, flags: [] });
  });

  it("a go-to's flags keep the matrix's order: not met, then task changed, then setup changed (KTD4)", async () => {
    const met = result(codex, "met", "20260901T090000Z");
    const notMet = result(codex, "not_met", "20260905T090000Z", { assignmentVersion: "000000000000", setup: { harness: "codex", model: "gpt", effort: "low" } });
    const state = folder({ assessments: [met, notMet], marks: [mark(codex, met.fileStem, "20260901T091000Z")] });
    expect(await standing(state)).toEqual({ name: "Codex", holds: false, flags: ["not_met", "earlier_version", "setup_mismatch"] });
  });

  it("Covers AE8. A trashed go-to leaves no go-to, even when an older mark names an agent who still holds", () => {
    const a = result(claude, "met", "20260901T090000Z");
    const b = result(codex, "met", "20260902T090000Z");
    const state = folder({
      profiles: [claude],
      assessments: [a],
      marks: [mark(claude, a.fileStem, "20260901T091000Z"), mark(codex, b.fileStem, "20260902T091000Z")],
    });
    expect(goToOf(state, KEY)).toBeNull();
  });

  it("a marked result that is gone leaves no go-to, even while the agent holds through a newer Met", () => {
    const newer = result(codex, "met", "20260905T090000Z");
    const state = folder({ assessments: [newer], marks: [mark(codex, "20260901T090000Z", "20260901T091000Z")] });
    expect(goToOf(state, KEY)).toBeNull();
  });

  it("a mark naming a result recorded Not met leaves no go-to", () => {
    const notMet = result(codex, "not_met", "20260901T090000Z");
    const state = folder({ assessments: [notMet], marks: [mark(codex, notMet.fileStem, "20260901T091000Z")] });
    expect(goToOf(state, KEY)).toBeNull();
  });

  it("a mark naming another badge's result does not resolve", () => {
    const other = result(codex, "met", "20260901T090000Z", { credentialSlug: "docs" });
    const state = folder({ assessments: [other], marks: [mark(codex, other.fileStem, "20260901T091000Z")] });
    expect(goToOf(state, KEY)).toBeNull();
  });
});
