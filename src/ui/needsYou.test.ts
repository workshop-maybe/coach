import { describe, expect, it } from "vitest";
import { needsYou } from "./needsYou";
import type { PendingTest } from "./pendingTests";
import { buildMatrix } from "../domain/matrix";
import { assignmentVersion } from "../domain/hash";
import type { AgentProfile, Assessment, Collection, Credential, FolderState } from "../domain/types";

const eng: Collection = { slug: "eng", name: "Engineering", description: "", order: ["review", "docs"], codes: { review: 1, docs: 2 } };
const review: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: ["I can find bugs in a diff."],
  task: "Review the attached diff.",
  rubric: "",
  extraSections: [],
};
const docs: Credential = { ...review, slug: "docs", name: "Write docs", task: "Document the module." };
const opus: AgentProfile = { slug: "opus", name: "Opus agent", harness: "claude-code", model: "opus", effort: "high", repo: "", notes: "", params: {} };
const codex: AgentProfile = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt" };

function folder(parts: Partial<FolderState>): FolderState {
  return { collections: [eng], credentials: [], profiles: [], assessments: [], held: [], skeleton: null, handoffs: [], marks: [], errors: [], warnings: [], raw: {}, ...parts };
}

async function met(profile: AgentProfile, credential: Credential, overrides: Partial<Assessment> = {}): Promise<Assessment> {
  return {
    profileSlug: profile.slug,
    collectionSlug: credential.collectionSlug,
    credentialSlug: credential.slug,
    fileStem: "20260901T090000Z",
    result: "met",
    recordedAt: "2026-09-01T09:00:00.000Z",
    assignmentVersion: await assignmentVersion(credential.task, credential.rubric),
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    note: "",
    handBack: "Done",
    ...overrides,
  };
}

async function run(state: FolderState, pending: PendingTest[] = []) {
  return needsYou(state, await buildMatrix(state), pending);
}

describe("needsYou", () => {
  it("an empty folder needs nothing", async () => {
    expect(await run(folder({ collections: [] }))).toEqual([]);
  });

  it("a badge nobody holds opens who takes it", async () => {
    const items = await run(folder({ credentials: [review] }));
    expect(items).toEqual([
      { kind: "unheld", credentialKey: "eng/review", route: { view: "deck", deck: "test", credentialKey: "eng/review" } },
    ]);
  });

  it("a waiting reply comes first and opens the test at what came back", async () => {
    const pending: PendingTest = {
      profileSlug: "opus",
      credentialKey: "eng/docs",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: "x",
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    };
    const items = await run(folder({ credentials: [review, docs], profiles: [opus], assessments: [await met(opus, review)] }), [pending]);
    expect(items[0]).toEqual({
      kind: "reply",
      profileSlug: "opus",
      credentialKey: "eng/docs",
      route: { view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/docs", resume: true },
    });
    // Write docs appears once, at its most urgent item.
    expect(items.filter((i) => "credentialKey" in i && i.credentialKey === "eng/docs")).toHaveLength(1);
  });

  it("skips a waiting reply whose agent or credential is gone", async () => {
    const pending: PendingTest = {
      profileSlug: "ghost",
      credentialKey: "eng/review",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: "x",
      setup: { harness: "", model: "", effort: "" },
    };
    const items = await run(folder({ credentials: [review] }), [pending]);
    expect(items.map((i) => i.kind)).toEqual(["unheld"]);
  });

  it("Covers AE5. An edited task keeps the badge held and suggests a re-test", async () => {
    const earned = await met(opus, review);
    const edited = { ...review, task: "Review the attached diff, twice." };
    const items = await run(folder({ credentials: [edited], profiles: [opus], assessments: [earned] }));
    expect(items).toEqual([
      {
        kind: "retest",
        profileSlug: "opus",
        credentialKey: "eng/review",
        flags: ["earlier_version"],
        route: { view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review" },
      },
    ]);
  });

  it("a changed setup suggests a re-test", async () => {
    const earned = await met(opus, review, { setup: { harness: "claude-code", model: "sonnet", effort: "high" } });
    const items = await run(folder({ credentials: [review], profiles: [opus], assessments: [earned] }));
    expect(items[0]).toMatchObject({ kind: "retest", flags: ["setup_mismatch"] });
  });

  it("a credential missing its task is half-made, listed once, and opens that part", async () => {
    const bare = { ...docs, task: "  " };
    const items = await run(folder({ credentials: [bare] }));
    expect(items).toEqual([
      {
        kind: "half-credential",
        credentialKey: "eng/docs",
        missing: "task",
        route: { view: "deck", deck: "edit-credential", credentialKey: "eng/docs", part: "task" },
      },
    ]);
  });

  it("a credential with no learning target opens its targets first", async () => {
    const items = await run(folder({ credentials: [{ ...docs, learningTargets: [], task: "" }] }));
    expect(items[0]).toMatchObject({ kind: "half-credential", missing: "targets" });
  });

  it("an agent with no results is half-made and opens the test with the agent picked", async () => {
    const items = await run(folder({ credentials: [review], profiles: [opus, codex], assessments: [await met(opus, review)] }));
    expect(items).toEqual([
      { kind: "half-agent", profileSlug: "codex", route: { view: "deck", deck: "test", profileSlug: "codex" } },
    ]);
  });

  it("orders replies, re-tests, half-made things, then unheld badges", async () => {
    const third: Credential = { ...review, slug: "third", name: "Third" };
    const fourth: Credential = { ...review, slug: "fourth", name: "Fourth", task: "" };
    const earned = await met(opus, review, { assignmentVersion: "old" });
    const pending: PendingTest = {
      profileSlug: "opus",
      credentialKey: "eng/third",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: "x",
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    };
    const state = folder({ credentials: [docs, fourth, review, third], profiles: [opus, codex], assessments: [earned] });
    const items = await run(state, [pending]);
    expect(items.map((i) => i.kind)).toEqual(["reply", "retest", "half-credential", "half-agent", "unheld"]);
  });

  const plug = (profileSlug: string, credentialKey: string, copiedAt = "2026-09-29T10:00:00.000Z"): PendingTest => ({
    profileSlug,
    credentialKey,
    copiedAt,
    assignmentVersion: "x",
    setup: { harness: "claude-code", model: "opus", effort: "high" },
    handoff: { id: "skeleton", text: "This is a test." },
  });

  it("Covers R19. Two agents plugged on the same badge give two reply rows", async () => {
    const state = folder({ credentials: [review], profiles: [opus, codex], assessments: [await met(opus, review), await met(codex, review)] });
    const items = await run(state, [plug("codex", "eng/review", "2026-09-29T11:00:00.000Z"), plug("opus", "eng/review")]);
    expect(items).toEqual([
      {
        kind: "reply",
        profileSlug: "codex",
        credentialKey: "eng/review",
        route: { view: "deck", deck: "test", profileSlug: "codex", credentialKey: "eng/review", resume: true },
      },
      {
        kind: "reply",
        profileSlug: "opus",
        credentialKey: "eng/review",
        route: { view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review", resume: true },
      },
    ]);
  });

  it("a plugged agent's badge is seen, so lower rows skip it", async () => {
    const earned = await met(opus, review, { assignmentVersion: "old" });
    const items = await run(folder({ credentials: [review], profiles: [opus], assessments: [earned] }), [plug("opus", "eng/review")]);
    expect(items.map((i) => i.kind)).toEqual(["reply"]);
  });

  it("a legacy agent with several waiting tests gets one reply row, for the newest", async () => {
    const state = folder({ credentials: [review, docs], profiles: [opus], assessments: [await met(opus, review)] });
    const items = await run(state, [plug("opus", "eng/review", "2026-09-28T10:00:00.000Z"), plug("opus", "eng/docs", "2026-09-30T10:00:00.000Z")]);
    expect(items.filter((i) => i.kind === "reply")).toEqual([
      {
        kind: "reply",
        profileSlug: "opus",
        credentialKey: "eng/docs",
        route: { view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/docs", resume: true },
      },
    ]);
  });

  it("a plugged agent with no results gets a reply row and no half-agent row", async () => {
    const items = await run(folder({ credentials: [review], profiles: [codex] }), [plug("codex", "eng/review")]);
    expect(items).toEqual([
      {
        kind: "reply",
        profileSlug: "codex",
        credentialKey: "eng/review",
        route: { view: "deck", deck: "test", profileSlug: "codex", credentialKey: "eng/review", resume: true },
      },
    ]);
  });

  it("a plug whose badge is gone leaves its agent unplugged, so it is half-made again", async () => {
    const items = await run(folder({ credentials: [review], profiles: [codex] }), [plug("codex", "eng/gone")]);
    expect(items.map((i) => i.kind)).toEqual(["half-agent", "unheld"]);
  });
});
