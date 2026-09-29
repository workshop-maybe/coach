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
  return { collections: [eng], credentials: [], profiles: [], assessments: [], errors: [], warnings: [], raw: {}, ...parts };
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
});
