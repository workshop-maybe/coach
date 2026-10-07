import { describe, expect, it, vi } from "vitest";
import { ChangedOnDiskError } from "../storage/storage";
import { MemoryStorage } from "../storage/memory";
import { assignmentVersion } from "./hash";
import {
  assessmentPath,
  collectionPath,
  COST_ORDER_PATH,
  credentialPath,
  handoffPath,
  headToHeadDir,
  headToHeadPath,
  heldPath,
  heldReadingPath,
  loadFolder,
  readingsDir,
  rejudgedDir,
  markPath,
  marksDir,
  profilePath,
  rejudgedPath,
  routingPath,
  serializeHeadToHead,
  serializeHeldReading,
  serializeMark,
  serializeCollection,
  serializeRejudge,
  SKELETON_PATH,
} from "./folder";
import { buildMatrix, cellKey } from "./matrix";
import { BUILT_IN_HANDOFF, defaultHandoff, handoffsFor, isHandoffLocked, SKELETON_ID, winnerFor } from "./handoffs";
import {
  COST_ORDER_UNREADABLE,
  HandoffLockedError,
  HandoffProblemError,
  SetupLockedError,
  addBuiltinCollection,
  builtinStatus,
  createCollection,
  createCredential,
  createHandoff,
  createPresetCredential,
  createProfile,
  duplicateProfileDraft,
  ensureLandingCollection,
  holdReply,
  type HoldInput,
  importBadgeArt,
  isSetupLocked,
  judgeHeldReply,
  markGoTo,
  recordAssessment,
  rejudgeResult,
  reorderCredentials,
  saveCostOrder,
  saveHeadToHead,
  saveHeldReading,
  saveSkeleton,
  setCredentialBadgeOverride,
  takeAgentForJob,
  type RoutingInput,
  trashCollection,
  trashCredential,
  trashProfile,
  updateCollection,
  updateCollectionBadge,
  updateCredential,
  updateHandoff,
  updateProfile,
} from "./operations";
import { BUILT_INS } from "./builtins";
import { findPreset, presetCredential } from "./presets";
import { credentialKey, type AgentProfile, type Collection, type AssessmentResult, type FolderState, type HeadToHead, type HeldReading, type JevReading, type Rejudge, type ReplyItem } from "./types";

/** Records a result and returns only the folder, as most tests here need. */
async function recordState(...args: Parameters<typeof recordAssessment>): Promise<FolderState> {
  return (await recordAssessment(...args)).state;
}

const baseProfile: Omit<AgentProfile, "slug"> = {
  name: "Claude Opus",
  harness: "claude-code",
  model: "opus",
  effort: "high",
  repo: "~/projects/app",
  notes: "main agent",
  params: { temperature: "0" },
};

/** A folder with one collection, one credential and one profile. */
async function setup(): Promise<{ storage: MemoryStorage; state: FolderState }> {
  const storage = new MemoryStorage();
  let state = await loadFolder(storage);
  const col = await createCollection(storage, state, "Go Basics");
  state = col.state;
  const cred = await createCredential(storage, state, col.slug, "Write a CLI");
  state = cred.state;
  const credential = state.credentials[0];
  state = await updateCredential(
    storage,
    { ...credential, learningTargets: ["I can parse flags"], task: "Build a CLI.", rubric: "Flags parse." },
    state.raw[credentialPath(col.slug, credential.slug)],
  );
  const prof = await createProfile(storage, state, baseProfile);
  state = prof.state;
  return { storage, state };
}

async function withOneAssessment() {
  const { storage, state } = await setup();
  const next = await recordState(
    storage,
    state,
    { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli", result: "met", note: "", handBack: "Done." },
    new Date("2026-09-29T08:49:00.123Z"),
  );
  return { storage, state: next };
}

function profileOf(state: FolderState, slug = "claude-opus"): AgentProfile {
  return state.profiles.find((p) => p.slug === slug)!;
}

describe("collections and credentials", () => {
  it("creates a collection with a unique slug", async () => {
    const storage = new MemoryStorage();
    let state = await loadFolder(storage);
    const a = await createCollection(storage, state, "Go Basics");
    const b = await createCollection(storage, a.state, "Go Basics");
    state = b.state;
    expect(a.slug).toBe("go-basics");
    expect(b.slug).toBe("go-basics-2");
    expect(state.collections.map((c) => c.name)).toEqual(["Go Basics", "Go Basics"]);
  });

  it("creating a credential adds it to the collection's order with the next code", async () => {
    const { storage, state } = await setup();
    const { state: next, key } = await createCredential(storage, state, "go-basics", "Handle errors");
    expect(key).toBe("go-basics/handle-errors");
    const col = next.collections.find((c) => c.slug === "go-basics")!;
    expect(col.order).toEqual(["write-a-cli", "handle-errors"]);
    expect(col.codes).toEqual({ "write-a-cli": 1, "handle-errors": 2 });
    expect(JSON.parse(storage.file(collectionPath("go-basics"))!).order).toEqual(["write-a-cli", "handle-errors"]);
    expect(storage.file(credentialPath("go-basics", "handle-errors"))).toBeDefined();
  });

  it("creating a credential after a code gap never reuses a code", async () => {
    const storage = new MemoryStorage({
      [collectionPath("c")]: JSON.stringify({ name: "C", order: ["a"], codes: { a: 1, gone: 5 } }),
      [credentialPath("c", "a")]: "# A\n",
    });
    const state = await loadFolder(storage);
    const { state: next } = await createCredential(storage, state, "c", "B");
    expect(next.collections[0].codes).toEqual({ a: 1, gone: 5, b: 6 });
  });

  it("gives a credential a slug unique within its collection", async () => {
    const { storage, state } = await setup();
    const { key } = await createCredential(storage, state, "go-basics", "Write a CLI");
    expect(key).toBe("go-basics/write-a-cli-2");
  });

  it("reordering credentials changes the order and leaves every code unchanged", async () => {
    const { storage, state } = await setup();
    let s = (await createCredential(storage, state, "go-basics", "Handle errors")).state;
    s = (await createCredential(storage, s, "go-basics", "Test code")).state;
    const before = s.collections[0].codes;
    const base = s.raw[collectionPath("go-basics")];
    s = await reorderCredentials(storage, s, "go-basics", ["test-code", "write-a-cli", "handle-errors"], base);
    const onDisk = JSON.parse(storage.file(collectionPath("go-basics"))!);
    expect(onDisk.order).toEqual(["test-code", "write-a-cli", "handle-errors"]);
    expect(onDisk.codes).toEqual(before);
    expect(s.collections[0].order).toEqual(["test-code", "write-a-cli", "handle-errors"]);
  });

  it("rejects a reorder that is not a permutation of the current order", async () => {
    const { storage, state } = await setup();
    const base = state.raw[collectionPath("go-basics")];
    await expect(reorderCredentials(storage, state, "go-basics", ["write-a-cli", "nope"], base)).rejects.toThrow();
  });

  it("updates a collection's name and description and keeps its codes", async () => {
    const { storage, state } = await setup();
    const col = state.collections[0];
    const next = await updateCollection(
      storage,
      state,
      { ...col, name: "Go Fundamentals", description: "Start here", codes: {} },
      state.raw[collectionPath("go-basics")],
    );
    expect(next.collections[0]).toMatchObject({ slug: "go-basics", name: "Go Fundamentals", description: "Start here", codes: { "write-a-cli": 1 } });
  });

  it("updates a credential", async () => {
    const { state } = await setup();
    expect(state.credentials[0]).toMatchObject({ name: "Write a CLI", task: "Build a CLI.", rubric: "Flags parse." });
  });

  it("an outdated base text propagates ChangedOnDiskError and writes nothing", async () => {
    const { storage, state } = await setup();
    const path = credentialPath("go-basics", "write-a-cli");
    const base = state.raw[path];
    storage.seed({ [path]: `${base}\nHand edit.\n` });
    const writes = storage.writes.length;
    const files = storage.files();
    await expect(updateCredential(storage, { ...state.credentials[0], name: "Renamed" }, base)).rejects.toBeInstanceOf(
      ChangedOnDiskError,
    );
    expect(storage.writes.length).toBe(writes);
    expect(storage.files()).toEqual(files);
  });

  it("createCredential writes nothing when collection.json changed on disk", async () => {
    const { storage, state } = await setup();
    storage.seed({ [collectionPath("go-basics")]: JSON.stringify({ name: "Hand edited", order: ["write-a-cli"], codes: { "write-a-cli": 1 } }) });
    const writes = storage.writes.length;
    await expect(createCredential(storage, state, "go-basics", "New")).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect(storage.writes.length).toBe(writes);
    expect(storage.file(credentialPath("go-basics", "new"))).toBeUndefined();
  });
});

describe("making a badge from a preset", () => {
  const preset = findPreset("name-what-matters-next")!;

  it("an empty folder gets My credentials and the preset badge, written whole in one save", async () => {
    const storage = new MemoryStorage();
    const { state, key } = await createPresetCredential(storage, await loadFolder(storage), preset.id);
    expect(state.collections.map((c) => c.name)).toEqual(["My credentials"]);
    expect(key).toBe("my-credentials/name-what-matters-next");
    expect(state.credentials).toEqual([presetCredential(preset, "my-credentials")]);
    expect(storage.file(credentialPath("my-credentials", "name-what-matters-next"))).toBe(preset.markdown);
    expect(storage.writes.filter((w) => w.path === credentialPath("my-credentials", "name-what-matters-next"))).toHaveLength(1);
  });

  it("lands in the folder's one collection with the next module code", async () => {
    const { storage, state } = await setup();
    const { state: next, key } = await createPresetCredential(storage, state, preset.id);
    expect(key).toBe("go-basics/name-what-matters-next");
    expect(next.collections.map((c) => c.slug)).toEqual(["go-basics"]);
    expect(next.collections[0].codes).toEqual({ "write-a-cli": 1, "name-what-matters-next": 2 });
  });

  it("making the same preset twice gives two badges", async () => {
    const storage = new MemoryStorage();
    const first = await createPresetCredential(storage, await loadFolder(storage), preset.id);
    const second = await createPresetCredential(storage, first.state, preset.id);
    expect(second.key).toBe("my-credentials/name-what-matters-next-2");
    expect(second.state.credentials.map((c) => credentialKey(c))).toEqual([first.key, second.key]);
  });

  it("a failed collection write leaves no badge, and a retry makes exactly one", async () => {
    const { storage, state } = await setup();
    const real = storage.writeText.bind(storage);
    let failed = false;
    vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
      if (!failed && path === collectionPath("go-basics")) {
        failed = true;
        throw new Error("disk full");
      }
      return real(root, path, text);
    });
    await expect(createPresetCredential(storage, state, preset.id)).rejects.toThrow("disk full");
    expect(storage.file(credentialPath("go-basics", "name-what-matters-next"))).toBeUndefined();
    const retry = await createPresetCredential(storage, state, preset.id);
    expect(retry.state.credentials.filter((c) => c.name === "Name what matters next")).toHaveLength(1);
  });

  it("an unknown preset id throws and writes nothing", async () => {
    const storage = new MemoryStorage();
    const state = await loadFolder(storage);
    const writes = storage.writes.length;
    await expect(createPresetCredential(storage, state, "no-such-preset")).rejects.toThrow();
    expect(storage.writes.length).toBe(writes);
  });

  it("a failed credential write leaves no file, and a retry makes exactly one badge", async () => {
    const storage = new MemoryStorage();
    const state = await loadFolder(storage);
    const real = storage.writeText.bind(storage);
    let failed = false;
    vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
      if (!failed && path.endsWith(".md")) {
        failed = true;
        throw new Error("disk full");
      }
      return real(root, path, text);
    });
    await expect(createPresetCredential(storage, state, preset.id)).rejects.toThrow("disk full");
    expect(storage.file(credentialPath("my-credentials", "name-what-matters-next"))).toBeUndefined();
    // The retry starts from the same state, which never saw the collection the first try made.
    const retry = await createPresetCredential(storage, state, preset.id);
    expect(retry.state.collections.map((c) => c.slug)).toEqual(["my-credentials"]);
    expect(retry.state.credentials).toHaveLength(1);
  });

  describe("where it lands (KTD4)", () => {
    /** A folder holding only these collections, each with no badges yet. */
    function folderOf(...collections: Collection[]): MemoryStorage {
      return new MemoryStorage(Object.fromEntries(collections.map((c) => [collectionPath(c.slug), serializeCollection(c)])));
    }
    const col = (slug: string, name: string, from?: string): Collection => ({ slug, name, description: "", order: [], codes: {}, ...(from ? { from } : {}) });
    const cardano = col("cardano-dev-skills", "Cardano Dev Skills", "cardano-dev-skills");

    it("Covers AE2. lands in My credentials even though a built-in copy sorts first", async () => {
      const storage = folderOf(cardano, col("my-credentials", "My credentials"));
      const state = await loadFolder(storage);
      expect(state.collections[0].slug).toBe("cardano-dev-skills");
      const { key } = await createPresetCredential(storage, state, preset.id);
      expect(key).toBe("my-credentials/name-what-matters-next");
    });

    it("lands in the only collection of your own, and makes no second one", async () => {
      const storage = folderOf(col("work", "Work"));
      const { state, key } = await createPresetCredential(storage, await loadFolder(storage), preset.id);
      expect(key).toBe("work/name-what-matters-next");
      expect(state.collections.map((c) => c.slug)).toEqual(["work"]);
    });

    it("makes My credentials when two collections of your own leave it unclear", async () => {
      const storage = folderOf(col("client-work", "Client work"), col("archive", "Archive"));
      const { state, key } = await createPresetCredential(storage, await loadFolder(storage), preset.id);
      expect(key).toBe("my-credentials/name-what-matters-next");
      expect(state.collections.map((c) => c.name)).toEqual(["Archive", "Client work", "My credentials"]);
    });

    it("makes My credentials when the folder holds only a built-in copy", async () => {
      const storage = folderOf(cardano);
      const { state, key } = await createPresetCredential(storage, await loadFolder(storage), preset.id);
      expect(key).toBe("my-credentials/name-what-matters-next");
      expect(state.collections.find((c) => c.slug === "cardano-dev-skills")!.order).toEqual([]);
    });

    it("lands in the collection asked for, over the rule", async () => {
      const storage = folderOf(col("archive", "Archive"), cardano, col("my-credentials", "My credentials"));
      const { key } = await createPresetCredential(storage, await loadFolder(storage), preset.id, "cardano-dev-skills");
      expect(key).toBe("cardano-dev-skills/name-what-matters-next");
    });

    it("a retry after a failed badge write beside a built-in copy lands in the My credentials it already made", async () => {
      const storage = folderOf(cardano);
      const state = await loadFolder(storage);
      const real = storage.writeText.bind(storage);
      let failed = false;
      vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
        if (!failed && path.endsWith(".md")) {
          failed = true;
          throw new Error("disk full");
        }
        return real(root, path, text);
      });
      await expect(createPresetCredential(storage, state, preset.id)).rejects.toThrow("disk full");
      expect(storage.file(collectionPath("my-credentials"))).toBeDefined();
      // The retry starts from the same state, which never saw My credentials.
      const retry = await createPresetCredential(storage, state, preset.id);
      expect(retry.key.startsWith("my-credentials/")).toBe(true);
      expect(retry.state.collections.map((c) => c.slug)).toEqual(["cardano-dev-skills", "my-credentials"]);
      expect(retry.state.credentials).toHaveLength(1);
    });
  });
});

describe("profiles and setup locks", () => {
  it("creates a profile with a unique slug", async () => {
    const { storage, state } = await setup();
    const { slug, state: next } = await createProfile(storage, state, baseProfile);
    expect(slug).toBe("claude-opus-2");
    expect(profileOf(next, slug)).toEqual({ ...baseProfile, slug });
  });

  it("a profile without assessments is not locked", async () => {
    const { state } = await setup();
    expect(isSetupLocked(state, "claude-opus")).toBe(false);
  });

  it("Covers AE2. Changing the model of a profile with one assessment is rejected, and the stored model is unchanged.", async () => {
    const { storage, state } = await withOneAssessment();
    expect(isSetupLocked(state, "claude-opus")).toBe(true);
    const before = storage.file(profilePath("claude-opus"));
    await expect(
      updateProfile(storage, state, { ...profileOf(state), model: "sonnet" }, state.raw[profilePath("claude-opus")]),
    ).rejects.toBeInstanceOf(SetupLockedError);
    expect(storage.file(profilePath("claude-opus"))).toBe(before);
    expect(profileOf(await loadFolder(storage)).model).toBe("opus");
  });

  it("rejects harness and effort changes on a locked profile too", async () => {
    const { storage, state } = await withOneAssessment();
    const base = state.raw[profilePath("claude-opus")];
    await expect(updateProfile(storage, state, { ...profileOf(state), harness: "codex" }, base)).rejects.toBeInstanceOf(SetupLockedError);
    await expect(updateProfile(storage, state, { ...profileOf(state), effort: "low" }, base)).rejects.toBeInstanceOf(SetupLockedError);
  });

  it("Covers AE3. Changing the repo of that profile succeeds.", async () => {
    const { storage, state } = await withOneAssessment();
    const next = await updateProfile(storage, state, { ...profileOf(state), repo: "~/projects/other" }, state.raw[profilePath("claude-opus")]);
    expect(profileOf(next).repo).toBe("~/projects/other");
    expect(next.assessments).toHaveLength(1);
    expect(next.assessments[0].setup).toEqual({ harness: "claude-code", model: "opus", effort: "high" });
  });

  it("name, notes and params stay editable on a locked profile", async () => {
    const { storage, state } = await withOneAssessment();
    const next = await updateProfile(
      storage,
      state,
      { ...profileOf(state), name: "Opus main", notes: "n", params: { a: "b" } },
      state.raw[profilePath("claude-opus")],
    );
    expect(profileOf(next)).toMatchObject({ name: "Opus main", notes: "n", params: { a: "b" } });
  });

  it("editing the name does not unlock the setup", async () => {
    const { storage, state } = await withOneAssessment();
    const renamed = await updateProfile(storage, state, { ...profileOf(state), name: "Renamed" }, state.raw[profilePath("claude-opus")]);
    expect(isSetupLocked(renamed, "claude-opus")).toBe(true);
    await expect(
      updateProfile(storage, renamed, { ...profileOf(renamed), model: "sonnet" }, renamed.raw[profilePath("claude-opus")]),
    ).rejects.toBeInstanceOf(SetupLockedError);
  });

  it("changing the model of a profile with no assessments succeeds", async () => {
    const { storage, state } = await setup();
    const next = await updateProfile(storage, state, { ...profileOf(state), model: "sonnet" }, state.raw[profilePath("claude-opus")]);
    expect(profileOf(next).model).toBe("sonnet");
  });

  it("duplicating an assessed profile and saving the draft makes a new, unlocked profile with the same setup and no results", async () => {
    const { storage, state } = await withOneAssessment();
    const draft = duplicateProfileDraft(state, "claude-opus");
    expect(draft).toEqual({ ...baseProfile, name: "Claude Opus (copy)" });
    const { state: next, slug } = await createProfile(storage, state, draft);
    expect(slug).toBe("claude-opus-copy");
    expect(isSetupLocked(next, slug)).toBe(false);
    expect(next.assessments.filter((a) => a.profileSlug === slug)).toEqual([]);
    const saved = await updateProfile(storage, next, { ...profileOf(next, slug), model: "sonnet" }, next.raw[profilePath(slug)]);
    expect(profileOf(saved, slug).model).toBe("sonnet");
  });

  it("duplicating writes nothing, so discarding the draft leaves the folder unchanged", async () => {
    const { storage, state } = await withOneAssessment();
    const files = storage.files();
    const writes = storage.writes.length;
    const draft = duplicateProfileDraft(state, "claude-opus");
    draft.params.extra = "x";
    expect(storage.writes.length).toBe(writes);
    expect(storage.files()).toEqual(files);
    expect(profileOf(state).params).toEqual({ temperature: "0" });
  });
});

describe("recording assessments", () => {
  const input = { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli", note: "ok", handBack: "Here it is." };

  it("carries the credential's current version and the profile's setup at record time", async () => {
    const { storage, state } = await setup();
    const now = new Date("2026-09-29T08:49:00.123Z");
    const next = await recordState(storage, state, { ...input, result: "not_met" }, now);
    expect(next.assessments).toHaveLength(1);
    expect(next.assessments[0]).toEqual({
      profileSlug: "claude-opus",
      collectionSlug: "go-basics",
      credentialSlug: "write-a-cli",
      fileStem: "20260929T084900Z",
      result: "not_met",
      recordedAt: "2026-09-29T08:49:00.123Z",
      assignmentVersion: await assignmentVersion("Build a CLI.", "Flags parse."),
      setup: { harness: "claude-code", model: "opus", effort: "high" },
      note: "ok",
      handBack: "Here it is.",
    });
  });

  it("saves the context the test started with, and none when there was none", async () => {
    const { storage, state } = await setup();
    const context = { machineId: "m1", machine: "Studio Mac", memory: "0123456789ab", capturedAt: "2026-09-29T08:40:00.000Z" };
    const withIt = await recordState(storage, state, { ...input, result: "met", context }, new Date("2026-09-29T08:49:00Z"));
    expect(withIt.assessments[0].context).toEqual(context);
    const without = await recordState(storage, withIt, { ...input, result: "met" }, new Date("2026-09-29T08:50:00Z"));
    const second = without.assessments.find((a) => a.fileStem === "20260929T085000Z");
    expect(second).not.toHaveProperty("context");
  });

  it("saves the handoff the test ran with, which locks it, and none when there was none", async () => {
    const { storage, state } = await setup();
    const made = await createHandoff(storage, state, "go-basics", "write-a-cli", "A {{task}}", new Date("2026-10-01T09:00:00Z"));
    const handoff = { id: made.id, text: "A Build a CLI.\n---\n## Handback\n" };
    const withIt = await recordState(storage, made.state, { ...input, result: "met", handoff }, new Date("2026-10-01T09:30:00Z"));
    expect(withIt.assessments[0].handoff).toEqual(handoff);
    expect(withIt.assessments[0].handBack).toBe(input.handBack);
    expect(isHandoffLocked(withIt, "go-basics/write-a-cli", made.id)).toBe(true);
    expect(await loadFolder(storage)).toEqual(withIt);
    const without = await recordState(storage, withIt, { ...input, result: "met" }, new Date("2026-10-01T09:40:00Z"));
    const second = without.assessments.find((a) => a.fileStem === "20261001T094000Z");
    expect(second).not.toHaveProperty("handoff");
  });

  /** A reading taken against `version`, seen after a Not yet the user then changed. */
  function reading(version: string): JevReading {
    return {
      model: "jev-1",
      assignmentVersion: version,
      askedAt: "2026-09-29T08:45:00.000Z",
      seen: "after",
      verdictWhenSeen: "not_met",
      verdictChanged: true,
      overall: 0.93,
      points: [{ text: "Flags parse.", probability: 0.95 }],
    };
  }

  it("saves Jev's reading taken against the version stamped at save, and none when there was none", async () => {
    const { storage, state } = await setup();
    const jev = reading(await assignmentVersion("Build a CLI.", "Flags parse."));
    const withIt = await recordState(storage, state, { ...input, result: "met", jev }, new Date("2026-09-29T08:49:00Z"));
    expect(withIt.assessments[0].jev).toEqual(jev);
    expect(storage.file(assessmentPath("claude-opus", "go-basics", "write-a-cli", "20260929T084900Z"))).toContain("jev:");
    expect(await loadFolder(storage)).toEqual(withIt);
    const without = await recordState(storage, withIt, { ...input, result: "met" }, new Date("2026-09-29T08:50:00Z"));
    const second = without.assessments.find((a) => a.fileStem === "20260929T085000Z");
    expect(second).not.toHaveProperty("jev");
    expect(storage.file(assessmentPath("claude-opus", "go-basics", "write-a-cli", "20260929T085000Z"))).not.toContain("jev");
  });

  it("drops a reading taken against an older assignment version, and still saves the result", async () => {
    const { storage, state } = await setup();
    const jev = reading(await assignmentVersion("Build a CLI.", "Flags parse."));
    const path = credentialPath("go-basics", "write-a-cli");
    const edited = await updateCredential(storage, { ...state.credentials[0], rubric: "Flags parse and help prints." }, state.raw[path]);
    const next = await recordState(storage, edited, { ...input, result: "met", jev }, new Date("2026-09-29T08:49:00Z"));
    expect(next.assessments).toHaveLength(1);
    expect(next.assessments[0].result).toBe("met");
    expect(next.assessments[0]).not.toHaveProperty("jev");
    expect(storage.file(assessmentPath("claude-opus", "go-basics", "write-a-cli", "20260929T084900Z"))).not.toContain("jev");
  });

  describe("missed points (KTD14)", () => {
    const rubric = "- Flags parse.\n- Help prints.\n- Errors exit non-zero.\n\nMet when every point holds.";
    const path = assessmentPath("claude-opus", "go-basics", "write-a-cli", "20260929T084900Z");
    const at = new Date("2026-09-29T08:49:00Z");

    /** setup() with a rubric of three points. */
    async function withPoints() {
      const { storage, state } = await setup();
      const edited = await updateCredential(storage, { ...state.credentials[0], rubric }, state.raw[credentialPath("go-basics", "write-a-cli")]);
      return { storage, state: edited };
    }

    it("keeps a Not met result's missed points that are current rubric points, once each, in rubric order", async () => {
      const { storage, state } = await withPoints();
      const missedPoints = ["Errors exit non-zero.", "Flags parse old.", "Flags parse.", "Errors exit non-zero.", "Met when every point holds."];
      const next = await recordState(storage, state, { ...input, result: "not_met", missedPoints }, at);
      expect(next.assessments[0].missedPoints).toEqual(["Flags parse.", "Errors exit non-zero."]);
      expect(storage.file(path)).toContain("missed_points:\n  - Flags parse.\n  - Errors exit non-zero.\n---\n");
    });

    it("saves missed points with no reading", async () => {
      const { storage, state } = await withPoints();
      const next = await recordState(storage, state, { ...input, result: "not_met", missedPoints: ["Help prints."] }, at);
      expect(next.assessments[0]).not.toHaveProperty("jev");
      expect(next.assessments[0].missedPoints).toEqual(["Help prints."]);
    });

    it("drops missed points on a Met result, and writes no key when none match", async () => {
      const { storage, state } = await withPoints();
      const met = await recordState(storage, state, { ...input, result: "met", missedPoints: ["Help prints."] }, at);
      expect(met.assessments[0]).not.toHaveProperty("missedPoints");
      expect(storage.file(path)).not.toContain("missed_points");
      const none = await recordState(storage, met, { ...input, result: "not_met", missedPoints: ["Not a point."] }, new Date("2026-09-29T08:50:00Z"));
      expect(none.assessments.find((a) => a.fileStem === "20260929T085000Z")).not.toHaveProperty("missedPoints");
    });

    it("drops a point from the rubric before an edit: only the rubric at the version stamped counts", async () => {
      const { storage, state } = await withPoints();
      const edited = await updateCredential(storage, { ...state.credentials[0], rubric: "- Flags parse.\n- Help prints in color." }, state.raw[credentialPath("go-basics", "write-a-cli")]);
      const next = await recordState(storage, edited, { ...input, result: "not_met", missedPoints: ["Help prints.", "Flags parse."] }, at);
      expect(next.assessments[0].missedPoints).toEqual(["Flags parse."]);
      expect(next.assessments[0].assignmentVersion).toBe(await assignmentVersion("Build a CLI.", "- Flags parse.\n- Help prints in color."));
    });
  });

  it("stamps the edited assignment version after the credential changes", async () => {
    const { storage, state } = await setup();
    const path = credentialPath("go-basics", "write-a-cli");
    const edited = await updateCredential(storage, { ...state.credentials[0], rubric: "Flags parse and help prints." }, state.raw[path]);
    const next = await recordState(storage, edited, { ...input, result: "met" });
    expect(next.assessments[0].assignmentVersion).toBe(await assignmentVersion("Build a CLI.", "Flags parse and help prints."));
  });

  it("is rejected with no result chosen", async () => {
    const { storage, state } = await setup();
    const writes = storage.writes.length;
    await expect(recordAssessment(storage, state, { ...input, result: undefined as never })).rejects.toThrow();
    await expect(recordAssessment(storage, state, { ...input, result: "maybe" as never })).rejects.toThrow();
    expect(storage.writes.length).toBe(writes);
  });

  it("is rejected with an empty or whitespace hand-back", async () => {
    const { storage, state } = await setup();
    const writes = storage.writes.length;
    await expect(recordAssessment(storage, state, { ...input, result: "met", handBack: "" })).rejects.toThrow();
    await expect(recordAssessment(storage, state, { ...input, result: "met", handBack: "  \n\t" })).rejects.toThrow();
    expect(storage.writes.length).toBe(writes);
  });

  it("is rejected for an unknown profile or credential", async () => {
    const { storage, state } = await setup();
    await expect(recordAssessment(storage, state, { ...input, result: "met", profileSlug: "nope" })).rejects.toThrow();
    await expect(recordAssessment(storage, state, { ...input, result: "met", credentialSlug: "nope" })).rejects.toThrow();
  });
});

describe("badge operations", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  /** setup() plus a second credential, a custom description and one override. */
  async function withBadges() {
    const { storage, state } = await setup();
    let s = (await createCredential(storage, state, "go-basics", "Handle errors")).state;
    s = await updateCollection(
      storage,
      s,
      { ...s.collections[0], description: "Go from zero." },
      s.raw[collectionPath("go-basics")],
    );
    s = await setCredentialBadgeOverride(
      storage,
      s,
      "go-basics",
      "handle-errors",
      { palette: "ember" },
      s.raw[collectionPath("go-basics")],
    );
    return { storage, state: s };
  }

  function onDisk(storage: MemoryStorage) {
    return JSON.parse(storage.file(collectionPath("go-basics"))!);
  }

  it("setting the collection badge keeps name, description, order, codes and overrides", async () => {
    const { storage, state } = await withBadges();
    const before = onDisk(storage);
    const next = await updateCollectionBadge(
      storage,
      state,
      "go-basics",
      { palette: "tide", title: { main: "GO" } },
      state.raw[collectionPath("go-basics")],
    );
    const after = onDisk(storage);
    expect(after.badge).toEqual({ palette: "tide", title: { main: "GO" } });
    expect(after.name).toBe(before.name);
    expect(after.description).toBe("Go from zero.");
    expect(after.order).toEqual(before.order);
    expect(after.codes).toEqual(before.codes);
    expect(after.badgeOverrides).toEqual({ "handle-errors": { palette: "ember" } });
    expect(next.collections[0].badge).toEqual({ palette: "tide", title: { main: "GO" } });
    expect(next.raw[collectionPath("go-basics")]).toBe(storage.file(collectionPath("go-basics")));
  });

  it("clearing the collection badge removes it from collection.json", async () => {
    const { storage, state } = await withBadges();
    let s = await updateCollectionBadge(storage, state, "go-basics", { palette: "tide" }, state.raw[collectionPath("go-basics")]);
    s = await updateCollectionBadge(storage, s, "go-basics", undefined, s.raw[collectionPath("go-basics")]);
    expect(onDisk(storage)).not.toHaveProperty("badge");
    expect(s.collections[0].badge).toBeUndefined();
    expect(onDisk(storage).badgeOverrides).toEqual({ "handle-errors": { palette: "ember" } });
  });

  it("clearing the collection badge also drops a malformed stored value", async () => {
    const storage = new MemoryStorage({
      [collectionPath("c")]: JSON.stringify({ name: "C", order: [], codes: {}, badge: "nonsense" }),
    });
    const state = await loadFolder(storage);
    await updateCollectionBadge(storage, state, "c", undefined, state.raw[collectionPath("c")]);
    expect(JSON.parse(storage.file(collectionPath("c"))!)).not.toHaveProperty("badge");
  });

  it("setting an override writes collection.json and leaves the other credentials untouched", async () => {
    const { storage, state } = await withBadges();
    const next = await setCredentialBadgeOverride(
      storage,
      state,
      "go-basics",
      "write-a-cli",
      { art: null, title: { eyebrow: "CLI" } },
      state.raw[collectionPath("go-basics")],
    );
    expect(onDisk(storage).badgeOverrides).toEqual({
      "handle-errors": { palette: "ember" },
      "write-a-cli": { art: null, title: { eyebrow: "CLI" } },
    });
    expect(next.collections[0].badgeOverrides?.["write-a-cli"]).toEqual({ art: null, title: { eyebrow: "CLI" } });
    expect(onDisk(storage).codes).toEqual({ "write-a-cli": 1, "handle-errors": 2 });
  });

  it("clearing an override removes only that entry", async () => {
    const { storage, state } = await withBadges();
    let s = await setCredentialBadgeOverride(
      storage,
      state,
      "go-basics",
      "write-a-cli",
      { palette: "tide" },
      state.raw[collectionPath("go-basics")],
    );
    s = await setCredentialBadgeOverride(storage, s, "go-basics", "handle-errors", null, s.raw[collectionPath("go-basics")]);
    expect(onDisk(storage).badgeOverrides).toEqual({ "write-a-cli": { palette: "tide" } });
    expect(s.collections[0].badgeOverrides).toEqual({ "write-a-cli": { palette: "tide" } });
  });

  it("clearing the last override removes badgeOverrides from collection.json", async () => {
    const { storage, state } = await withBadges();
    await setCredentialBadgeOverride(storage, state, "go-basics", "handle-errors", null, state.raw[collectionPath("go-basics")]);
    expect(onDisk(storage)).not.toHaveProperty("badgeOverrides");
  });

  it("clearing an override also drops a malformed stored entry for that credential", async () => {
    const storage = new MemoryStorage({
      [collectionPath("c")]: JSON.stringify({
        name: "C",
        order: ["a", "b"],
        codes: { a: 1, b: 2 },
        badgeOverrides: { a: "junk", b: { palette: "tide" } },
      }),
      [credentialPath("c", "a")]: "# A\n",
      [credentialPath("c", "b")]: "# B\n",
    });
    const state = await loadFolder(storage);
    await setCredentialBadgeOverride(storage, state, "c", "a", null, state.raw[collectionPath("c")]);
    expect(JSON.parse(storage.file(collectionPath("c"))!).badgeOverrides).toEqual({ b: { palette: "tide" } });
  });

  it("an outdated base text throws ChangedOnDiskError and writes nothing", async () => {
    const { storage, state } = await withBadges();
    const stale = state.raw[collectionPath("go-basics")];
    storage.seed({ [collectionPath("go-basics")]: `${stale} ` });
    const writes = storage.writes.length;
    await expect(updateCollectionBadge(storage, state, "go-basics", { palette: "tide" }, stale)).rejects.toBeInstanceOf(
      ChangedOnDiskError,
    );
    await expect(
      setCredentialBadgeOverride(storage, state, "go-basics", "write-a-cli", { palette: "tide" }, stale),
    ).rejects.toBeInstanceOf(ChangedOnDiskError);
    await expect(
      setCredentialBadgeOverride(storage, state, "go-basics", "handle-errors", null, stale),
    ).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect(storage.writes.length).toBe(writes);
    expect(storage.file(collectionPath("go-basics"))).toBe(`${stale} `);
  });

  it("a cancelled art import returns null and changes nothing", async () => {
    const { storage } = await withBadges();
    const files = storage.files();
    const writes = storage.writes.length;
    storage.queueArt(null);
    expect(await importBadgeArt(storage, "go-basics", null)).toBeNull();
    expect(storage.writes.length).toBe(writes);
    expect(storage.files()).toEqual(files);
  });

  it("an art import writes the image file only, never collection.json", async () => {
    const { storage } = await withBadges();
    const collectionText = storage.file(collectionPath("go-basics"));
    const writes = storage.writes.length;
    storage.queueArt(PNG);
    storage.queueArt(PNG);
    const plate = await importBadgeArt(storage, "go-basics", null);
    const override = await importBadgeArt(storage, "go-basics", "write-a-cli");
    expect(plate).toMatch(/^collections\/go-basics\/badge\/art-[0-9a-f]{8}\.png$/);
    expect(override).toMatch(/^collections\/go-basics\/badge\/write-a-cli-[0-9a-f]{8}\.png$/);
    expect(storage.writes.slice(writes)).toEqual([
      { root: "data", path: plate },
      { root: "data", path: override },
    ]);
    expect(storage.image(plate!)).toBe(PNG);
    expect(storage.file(collectionPath("go-basics"))).toBe(collectionText);
  });
});

describe("moving to trash", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");

  it("moves an agent and its results into the trash, and leaves the rest", async () => {
    const { storage, state } = await withOneAssessment();
    const other = await createProfile(storage, state, { ...baseProfile, name: "Other" });
    const kept = await recordState(storage, other.state, { profileSlug: "other", collectionSlug: "go-basics", credentialSlug: "write-a-cli", result: "met", note: "", handBack: "Mine." });
    const keptPath = "assessments/other/go-basics/write-a-cli/" + kept.assessments.find((a) => a.profileSlug === "other")!.fileStem + ".md";
    const result = "assessments/claude-opus/go-basics/write-a-cli/20260929T084900Z.md";
    const agentText = storage.file(profilePath("claude-opus"));
    const next = await trashProfile(storage, kept, "claude-opus", now);
    expect(storage.file(keptPath)).toBeDefined();
    expect(next.assessments.map((a) => a.profileSlug)).toEqual(["other"]);
    expect(storage.file(profilePath("claude-opus"))).toBeUndefined();
    expect(storage.file(result)).toBeUndefined();
    expect(storage.file(`trash/20260930T100000Z/${profilePath("claude-opus")}`)).toBe(agentText);
    expect(storage.file(`trash/20260930T100000Z/${result}`)).toBeDefined();
    expect(next.profiles.map((p) => p.slug)).toEqual(["other"]);
  });

  it("moves a credential and every agent's results for it, and drops it from its collection", async () => {
    const { storage, state: first } = await withOneAssessment();
    const second = await createCredential(storage, first, "go-basics", "Read a file");
    const withOther = await recordState(storage, second.state, { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "read-a-file", result: "met", note: "", handBack: "Read." });
    const otherResult = "assessments/claude-opus/go-basics/read-a-file/" + withOther.assessments.find((a) => a.credentialSlug === "read-a-file")!.fileStem + ".md";
    let state = await setCredentialBadgeOverride(storage, withOther, "go-basics", "write-a-cli", { palette: "ink" }, withOther.raw[collectionPath("go-basics")]);
    const credText = storage.file(credentialPath("go-basics", "write-a-cli"));
    const collectionBefore = storage.file(collectionPath("go-basics"));
    state = await trashCredential(storage, state, "go-basics", "write-a-cli", now);
    expect(storage.file(otherResult)).toBeDefined();
    expect(storage.file(`trash/20260930T100000Z/${collectionPath("go-basics")}`)).toBe(collectionBefore);
    expect(storage.file(credentialPath("go-basics", "write-a-cli"))).toBeUndefined();
    expect(storage.file(`trash/20260930T100000Z/${credentialPath("go-basics", "write-a-cli")}`)).toBe(credText);
    expect(storage.file("trash/20260930T100000Z/assessments/claude-opus/go-basics/write-a-cli/20260929T084900Z.md")).toBeDefined();
    expect(state.credentials.map((c) => c.slug)).toEqual(["read-a-file"]);
    expect(state.collections[0].order).toEqual(["read-a-file"]);
    expect(state.collections[0].badgeOverrides?.["write-a-cli"]).toBeUndefined();
    expect(state.assessments.map((a) => a.credentialSlug)).toEqual(["read-a-file"]);
    expect(state.profiles.map((p) => p.slug)).toEqual(["claude-opus"]);
  });

  it("moves a badge's handoff files into the same trash stamp, and leaves nothing in its handoffs folder", async () => {
    const { storage, state: first } = await withOneAssessment();
    const a = await createHandoff(storage, first, "go-basics", "write-a-cli", "A {{task}}", new Date("2026-09-30T08:00:00Z"));
    const b = await createHandoff(storage, a.state, "go-basics", "write-a-cli", "B {{task}}", new Date("2026-09-30T08:00:00Z"));
    storage.seed({ "collections/go-basics/handoffs/write-a-cli/.draft.md.swp": "x" });
    const state = await trashCredential(storage, b.state, "go-basics", "write-a-cli", now);
    const dir = "collections/go-basics/handoffs/write-a-cli/";
    expect(Object.keys(storage.files()).filter((p) => p.startsWith(dir))).toEqual([]);
    expect(storage.file(`trash/20260930T100000Z/${handoffPath("go-basics", "write-a-cli", a.id)}`)).toBe("A {{task}}");
    expect(storage.file(`trash/20260930T100000Z/${handoffPath("go-basics", "write-a-cli", b.id)}`)).toBe("B {{task}}");
    expect(storage.file("trash/20260930T100000Z/assessments/claude-opus/go-basics/write-a-cli/20260929T084900Z.md")).toBeDefined();
    expect(state.handoffs).toEqual([]);
    // The credential's own file moves last.
    const moved = storage.writes.filter((w) => w.path.startsWith("trash/20260930T100000Z/collections/go-basics/") && !w.path.endsWith("collection.json"));
    expect(moved[moved.length - 1].path).toBe(`trash/20260930T100000Z/${credentialPath("go-basics", "write-a-cli")}`);
  });

  it("moves nothing when the collection changed on disk since it was opened", async () => {
    const { storage, state } = await withOneAssessment();
    storage.seed({ [collectionPath("go-basics")]: `${storage.file(collectionPath("go-basics"))}\n` });
    await expect(trashCredential(storage, state, "go-basics", "write-a-cli", now)).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect(storage.file(credentialPath("go-basics", "write-a-cli"))).toBeDefined();
    expect(Object.keys(storage.files()).some((p) => p.startsWith("trash/"))).toBe(false);
  });

  it("a move that fails partway leaves the agent loadable, and trashing it again moves the rest", async () => {
    const { storage, state } = await withOneAssessment();
    const failing = Object.create(storage) as MemoryStorage;
    let calls = 0;
    failing.moveFile = async (root, from, to) => {
      if (++calls === 2) throw new Error("disk full");
      return storage.moveFile(root, from, to);
    };
    const withTwo = await recordState(storage, state, { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli", result: "met", note: "", handBack: "Again." }, new Date("2026-09-30T09:00:00Z"));
    await expect(trashProfile(failing, withTwo, "claude-opus", now)).rejects.toThrow("disk full");
    const between = await loadFolder(storage);
    expect(between.profiles.map((p) => p.slug)).toEqual(["claude-opus"]);
    const done = await trashProfile(storage, between, "claude-opus", new Date("2026-09-30T10:00:05Z"));
    expect(done.profiles).toEqual([]);
    expect(Object.keys(storage.files()).filter((p) => p.startsWith("assessments/"))).toEqual([]);
  });

  it("Covers AE8. Trashing the marked agent leaves the badge's marks where they are", async () => {
    const { storage, state } = await withOneAssessment();
    const marked = await markGoTo(storage, state, { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli", fileStem: "20260929T084900Z" }, now);
    const path = markPath("go-basics", "write-a-cli", "20260930T100000Z");
    const next = await trashProfile(storage, marked, "claude-opus", new Date("2026-09-30T11:00:00Z"));
    expect(storage.file(path)).toBe(serializeMark(marked.marks[0]));
    expect(next.marks).toEqual(marked.marks);
  });

  it("trashing a badge moves its marks under the same stamp, and leaves another badge's marks", async () => {
    const { storage, state: first } = await withOneAssessment();
    const second = await createCredential(storage, first, "go-basics", "Read a file");
    const other = await recordState(storage, second.state, { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "read-a-file", result: "met", note: "", handBack: "Read." }, new Date("2026-09-29T09:00:00Z"));
    let state = await markGoTo(storage, other, { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli", fileStem: "20260929T084900Z" }, new Date("2026-09-29T09:30:00Z"));
    state = await markGoTo(storage, state, { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "read-a-file", fileStem: "20260929T090000Z" }, new Date("2026-09-29T09:30:00Z"));
    const moved = markPath("go-basics", "write-a-cli", "20260929T093000Z");
    const movedText = storage.file(moved);
    state = await trashCredential(storage, state, "go-basics", "write-a-cli", now);
    expect(Object.keys(storage.files()).filter((p) => p.startsWith(`${marksDir("go-basics", "write-a-cli")}/`))).toEqual([]);
    expect(storage.file(`trash/20260930T100000Z/${moved}`)).toBe(movedText);
    expect(storage.file(markPath("go-basics", "read-a-file", "20260929T093000Z"))).toBeDefined();
    expect(state.marks.map((m) => m.credentialSlug)).toEqual(["read-a-file"]);
  });

  describe("what compare saves (jev-in-compare KTD1, KTD3, KTD4)", () => {
    const stem = "20260929T084900Z";
    const reading: JevReading = { model: "jev-1", assignmentVersion: "v1", askedAt: "2026-09-30T08:00:00.000Z", seen: "before", overall: 0.5, points: [] };
    const rejudge = (profileSlug: string, credentialSlug = "write-a-cli"): Rejudge => ({
      profileSlug,
      collectionSlug: "go-basics",
      credentialSlug,
      id: "20260930T080000Z",
      fileStem: stem,
      result: "not_met",
      judgedAt: "2026-09-30T08:00:00.000Z",
      note: "",
    });
    const heldReading = (profileSlug: string, credentialSlug = "write-a-cli"): HeldReading => ({
      profileSlug,
      collectionSlug: "go-basics",
      credentialSlug,
      id: "20260930T081000Z",
      fileStem: "20260930T070000Z",
      reading,
    });
    const headToHead = (credentialSlug: string): HeadToHead => ({
      collectionSlug: "go-basics",
      credentialSlug,
      id: "20260930T082000Z",
      model: "jev-1",
      assignmentVersion: "v1",
      askedAt: "2026-09-30T08:20:00.000Z",
      first: { profileSlug: "claude-opus", fileStem: stem },
      second: { profileSlug: "other", fileStem: "20260930T070000Z" },
      points: [{ text: "Flags parse.", firstOver: 0.9, secondOver: 0.1 }],
    });
    const files = (r: Rejudge[], h: HeldReading[], x: HeadToHead[]): Record<string, string> => ({
      ...Object.fromEntries(r.map((v) => [rejudgedPath(v.profileSlug, v.collectionSlug, v.credentialSlug, v.id), serializeRejudge(v)])),
      ...Object.fromEntries(h.map((v) => [heldReadingPath(v.profileSlug, v.collectionSlug, v.credentialSlug, v.id), serializeHeldReading(v)])),
      ...Object.fromEntries(x.map((v) => [headToHeadPath(v.collectionSlug, v.credentialSlug, v.id), serializeHeadToHead(v)])),
    });

    it("trashing a badge moves its head-to-heads and every agent's re-judges and readings under the same stamp, and leaves another badge's", async () => {
      const { storage, state: first } = await withOneAssessment();
      const second = await createCredential(storage, first, "go-basics", "Read a file");
      const moving = files([rejudge("claude-opus"), rejudge("other")], [heldReading("claude-opus"), heldReading("other")], [headToHead("write-a-cli")]);
      const staying = files([rejudge("claude-opus", "read-a-file")], [heldReading("claude-opus", "read-a-file")], [headToHead("read-a-file")]);
      storage.seed({ ...moving, ...staying });
      const state = await trashCredential(storage, second.state, "go-basics", "write-a-cli", now);
      for (const [path, text] of Object.entries(moving)) {
        expect(storage.file(path)).toBeUndefined();
        expect(storage.file(`trash/20260930T100000Z/${path}`)).toBe(text);
      }
      for (const [path, text] of Object.entries(staying)) expect(storage.file(path)).toBe(text);
      expect(state.headToHeads.map((h) => h.credentialSlug)).toEqual(["read-a-file"]);
      expect(state.heldReadings.map((h) => h.credentialSlug)).toEqual(["read-a-file"]);
    });

    it("trashing an agent moves its re-judges and readings and leaves the badge's head-to-heads", async () => {
      const { storage, state } = await withOneAssessment();
      const moving = files([rejudge("claude-opus")], [heldReading("claude-opus")], []);
      const staying = files([rejudge("other")], [heldReading("other")], [headToHead("write-a-cli")]);
      storage.seed({ ...moving, ...staying });
      const next = await trashProfile(storage, state, "claude-opus", now);
      for (const [path, text] of Object.entries(moving)) {
        expect(storage.file(path)).toBeUndefined();
        expect(storage.file(`trash/20260930T100000Z/${path}`)).toBe(text);
      }
      for (const [path, text] of Object.entries(staying)) expect(storage.file(path)).toBe(text);
      expect(next.headToHeads).toEqual([headToHead("write-a-cli")]);
      expect(next.heldReadings.map((h) => h.profileSlug)).toEqual(["other"]);
    });
  });
});

describe("go-to marks", () => {
  const ref = { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli", fileStem: "20260929T084900Z" };
  const now = new Date("2026-10-01T09:00:00.000Z");
  const markFiles = (storage: MemoryStorage) => Object.keys(storage.files()).filter((p) => p.startsWith(`${marksDir("go-basics", "write-a-cli")}/`));

  it("marks a Met result with a new file naming its agent and result, and never touches the result", async () => {
    const { storage, state } = await withOneAssessment();
    const result = assessmentPath("claude-opus", "go-basics", "write-a-cli", ref.fileStem);
    const before = storage.file(result);
    const next = await markGoTo(storage, state, ref, now);
    expect(markFiles(storage)).toEqual([markPath("go-basics", "write-a-cli", "20261001T090000Z")]);
    expect(JSON.parse(storage.file(markPath("go-basics", "write-a-cli", "20261001T090000Z"))!)).toEqual({ agent: "claude-opus", result: ref.fileStem });
    expect(next.marks).toEqual([{ collectionSlug: "go-basics", credentialSlug: "write-a-cli", id: "20261001T090000Z", profileSlug: "claude-opus", fileStem: ref.fileStem }]);
    expect(storage.file(result)).toBe(before);
  });

  it("two marks in the same second get two files, the second with the later stamp", async () => {
    const { storage, state } = await withOneAssessment();
    const one = await markGoTo(storage, state, ref, now);
    const two = await markGoTo(storage, one, ref, now);
    expect(two.marks.map((m) => m.id)).toEqual(["20261001T090000Z", "20261001T090001Z"]);
  });

  it("a mark made while the clock reads earlier than the newest mark still gets a later stamp", async () => {
    const { storage, state } = await withOneAssessment();
    const one = await markGoTo(storage, state, ref, now);
    const two = await markGoTo(storage, one, ref, new Date("2026-09-30T00:00:00Z"));
    expect(two.marks.map((m) => m.id)).toEqual(["20261001T090000Z", "20261001T090001Z"]);
  });

  it("refuses a Not met result and writes nothing (R3)", async () => {
    const { storage, state } = await setup();
    const notMet = await recordState(storage, state, { ...ref, result: "not_met", note: "", handBack: "Tried." }, new Date("2026-09-29T08:49:00Z"));
    await expect(markGoTo(storage, notMet, ref, now)).rejects.toThrow(/Met/);
    expect(markFiles(storage)).toEqual([]);
  });

  it("refuses a result, agent or badge the folder does not have, and writes nothing", async () => {
    const { storage, state } = await withOneAssessment();
    await expect(markGoTo(storage, state, { ...ref, fileStem: "20200101T000000Z" }, now)).rejects.toThrow();
    await expect(markGoTo(storage, state, { ...ref, profileSlug: "nobody" }, now)).rejects.toThrow();
    await expect(markGoTo(storage, state, { ...ref, credentialSlug: "nothing" }, now)).rejects.toThrow();
    expect(Object.keys(storage.files()).some((p) => p.includes("/marks/"))).toBe(false);
  });
});

describe("the cost order (router KTD9)", () => {
  async function twoAgents() {
    const { storage, state } = await setup();
    const sonnet = await createProfile(storage, state, { ...baseProfile, name: "Claude Sonnet", model: "sonnet" });
    return { storage, state: sonnet.state };
  }

  it("saves the agents cheapest first as pretty JSON, and the folder loads it back", async () => {
    const { storage, state } = await twoAgents();
    expect(state.costOrder).toBeNull();
    const next = await saveCostOrder(storage, state, ["claude-sonnet", "claude-opus"], null);
    expect(storage.file(COST_ORDER_PATH)).toBe('{\n  "agents": [\n    "claude-sonnet",\n    "claude-opus"\n  ]\n}\n');
    expect(next.costOrder).toEqual(["claude-sonnet", "claude-opus"]);
    expect(next.raw[COST_ORDER_PATH]).toBe(storage.file(COST_ORDER_PATH));
  });

  it("keeps only agents still in the folder, each once", async () => {
    const { storage, state } = await twoAgents();
    const next = await saveCostOrder(storage, state, ["gone", "claude-opus", "claude-opus", "claude-sonnet"], null);
    expect(next.costOrder).toEqual(["claude-opus", "claude-sonnet"]);
  });

  it("refuses with ChangedOnDiskError when the file changed since it was opened, and writes nothing", async () => {
    const { storage, state } = await twoAgents();
    await storage.writeText("data", COST_ORDER_PATH, '{ "agents": ["claude-opus"] }\n');
    await expect(saveCostOrder(storage, state, ["claude-sonnet"], null)).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect(storage.file(COST_ORDER_PATH)).toBe('{ "agents": ["claude-opus"] }\n');
  });

  it("never writes over a cost-order.json it could not read (R22), saying so by name", async () => {
    const { storage } = await twoAgents();
    await storage.writeText("data", COST_ORDER_PATH, "{ not json");
    const loaded = await loadFolder(storage);
    expect(loaded.costOrder).toBeNull();
    expect(loaded.errors.map((e) => e.path)).toEqual([COST_ORDER_PATH]);
    await expect(saveCostOrder(storage, loaded, ["claude-opus"], null)).rejects.toThrow(COST_ORDER_UNREADABLE);
    await expect(saveCostOrder(storage, loaded, ["claude-opus"], "{ not json")).rejects.toThrow(COST_ORDER_UNREADABLE);
    expect(storage.file(COST_ORDER_PATH)).toBe("{ not json");
  });
});

describe("routing records (router R14, KTD10)", () => {
  const now = new Date("2026-10-04T15:00:00.000Z");
  const routingFiles = (storage: MemoryStorage) => Object.keys(storage.files()).filter((p) => p.startsWith("routing/"));
  const taken: RoutingInput = {
    job: "# Fix the flaky login test\n\nIt fails one run in ten.",
    collectionSlug: "go-basics",
    credentialSlug: "write-a-cli",
    profileSlug: "claude-opus",
    recommended: "claude-sonnet",
    basis: "cheapest",
    steppedUp: false,
    matched: "picked",
  };

  it("Covers AE8. writes a new file naming the agent taken, its setup, the pick, the badge and the job's first line", async () => {
    const { storage, state } = await setup();
    await takeAgentForJob(storage, state, taken, now);
    expect(routingFiles(storage)).toEqual([routingPath("20261004T150000Z")]);
    expect(JSON.parse(storage.file(routingPath("20261004T150000Z"))!)).toEqual({
      job: "Fix the flaky login test",
      collection: "go-basics",
      credential: "write-a-cli",
      agent: "claude-opus",
      setup: { harness: "claude-code", model: "opus", effort: "high" },
      recommended: "claude-sonnet",
      basis: "cheapest",
      steppedUp: false,
      matched: "picked",
    });
  });

  it("a Jev-matched record keeps the rating and the model that answered", async () => {
    const { storage, state } = await setup();
    await takeAgentForJob(storage, state, { ...taken, matched: "jev", difficulty: "high-stakes", jevModel: "jev-1.13.0", steppedUp: true }, now);
    const record = JSON.parse(storage.file(routingPath("20261004T150000Z"))!);
    expect(record).toMatchObject({ matched: "jev", difficulty: "high-stakes", jevModel: "jev-1.13.0", steppedUp: true });
  });

  it("two records in the same second get distinct, ordered stamps, and nothing else changes", async () => {
    const { storage, state } = await setup();
    const before = Object.keys(storage.files()).filter((p) => !p.startsWith("routing/"));
    const one = await takeAgentForJob(storage, state, taken, now);
    await takeAgentForJob(storage, one, taken, now);
    expect(routingFiles(storage)).toEqual([routingPath("20261004T150000Z"), routingPath("20261004T150001Z")]);
    expect(Object.keys(storage.files()).filter((p) => !p.startsWith("routing/"))).toEqual(before);
  });

  it("refuses an agent or a badge no longer in the folder, and writes nothing", async () => {
    const { storage, state } = await setup();
    await expect(takeAgentForJob(storage, state, { ...taken, profileSlug: "nobody" }, now)).rejects.toThrow();
    await expect(takeAgentForJob(storage, state, { ...taken, credentialSlug: "nothing" }, now)).rejects.toThrow();
    expect(routingFiles(storage)).toEqual([]);
  });

  it("keeps the first line as one line, even when it holds line separators and a front-matter fence", async () => {
    const { storage, state } = await setup();
    await takeAgentForJob(storage, state, { ...taken, job: "Ship it\u2028---\u2029## now\nsecond line" }, now);
    const text = storage.file(routingPath("20261004T150000Z"))!;
    expect(JSON.parse(text).job).toBe("Ship it");
    expect(text.split("\n").filter((l) => l.includes("Ship it"))).toHaveLength(1);
  });
});

describe("handoffs", () => {
  const KEY = "go-basics/write-a-cli";
  const at = new Date("2026-10-01T09:00:00.000Z");

  /** Records a result, run with the handoff when one is named. */
  function recordWith(storage: MemoryStorage, state: FolderState, result: AssessmentResult, when: Date, handoffId?: string): Promise<FolderState> {
    const handoff = handoffId === undefined ? undefined : { id: handoffId, text: "filled" };
    return recordState(storage, state, { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli", result, note: "", handBack: "Done.", handoff }, when);
  }

  it("a folder with no skeleton file uses the built-in skeleton, and saving writes handoffs/skeleton.md", async () => {
    const { storage, state } = await setup();
    expect(defaultHandoff(state, KEY)).toEqual({ id: SKELETON_ID, text: BUILT_IN_HANDOFF });
    expect(storage.file(SKELETON_PATH)).toBeUndefined();
    const edited = `${BUILT_IN_HANDOFF}\nKeep it short.\n`;
    const next = await saveSkeleton(storage, edited, state.raw[SKELETON_PATH] ?? null);
    expect(storage.file(SKELETON_PATH)).toBe(edited);
    expect(next.skeleton).toBe(edited);
    expect(next.raw[SKELETON_PATH]).toBe(edited);
  });

  it("Covers AE1. After the skeleton is edited, a badge with no handoffs has the edited skeleton as its default", async () => {
    const { storage, state } = await setup();
    expect(defaultHandoff(state, KEY).text).toBe(BUILT_IN_HANDOFF);
    const first = await saveSkeleton(storage, "v1 {{task}}", null);
    const second = await saveSkeleton(storage, "v2 {{task}}", first.raw[SKELETON_PATH]);
    expect(handoffsFor(second, KEY)).toEqual([]);
    expect(defaultHandoff(second, KEY)).toEqual({ id: SKELETON_ID, text: "v2 {{task}}" });
  });

  it("a skeleton save from an outdated base is refused with ChangedOnDiskError", async () => {
    const { storage } = await setup();
    const first = await saveSkeleton(storage, "v1 {{task}}", null);
    storage.seed({ [SKELETON_PATH]: "hand edit {{task}}" });
    await expect(saveSkeleton(storage, "v2 {{task}}", first.raw[SKELETON_PATH])).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect(storage.file(SKELETON_PATH)).toBe("hand edit {{task}}");
  });

  it("two handoffs created in the same second load in creation order, with distinct ids, and the newer one is the default", async () => {
    const { storage, state } = await setup();
    const a = await createHandoff(storage, state, "go-basics", "write-a-cli", "A {{task}}", at);
    const b = await createHandoff(storage, a.state, "go-basics", "write-a-cli", "B {{task}}", at);
    expect(a.id).toBe("20261001T090000Z");
    expect(b.id).not.toBe(a.id);
    expect(b.id > a.id).toBe(true);
    expect(storage.file(handoffPath("go-basics", "write-a-cli", a.id))).toBe("A {{task}}");
    expect(storage.file(handoffPath("go-basics", "write-a-cli", b.id))).toBe("B {{task}}");
    expect(handoffsFor(b.state, KEY).map((h) => h.text)).toEqual(["A {{task}}", "B {{task}}"]);
    expect(defaultHandoff(b.state, KEY)).toEqual({ id: b.id, text: "B {{task}}" });
  });

  it("a handoff created while the clock reads earlier than the newest one still becomes the default", async () => {
    const { storage, state } = await setup();
    const a = await createHandoff(storage, state, "go-basics", "write-a-cli", "A {{task}}", at);
    const b = await createHandoff(storage, a.state, "go-basics", "write-a-cli", "B {{task}}", new Date("2026-10-01T08:00:00Z"));
    expect(defaultHandoff(b.state, KEY).id).toBe(b.id);
  });

  it("handoffs belong to one badge: another badge keeps the skeleton as its default", async () => {
    const { storage, state } = await setup();
    const other = await createCredential(storage, state, "go-basics", "Read a file");
    const a = await createHandoff(storage, other.state, "go-basics", "write-a-cli", "A {{task}}", at);
    expect(handoffsFor(a.state, other.key)).toEqual([]);
    expect(defaultHandoff(a.state, other.key).id).toBe(SKELETON_ID);
  });

  it("Covers AE2. Updating a handoff that a result names is refused and the file is unchanged; the edit saves as a new default handoff", async () => {
    const { storage, state } = await setup();
    const b = await createHandoff(storage, state, "go-basics", "write-a-cli", "B {{task}}", at);
    const earned = await recordWith(storage, b.state, "met", new Date("2026-10-01T09:30:00Z"), b.id);
    expect(isHandoffLocked(earned, KEY, b.id)).toBe(true);
    const path = handoffPath("go-basics", "write-a-cli", b.id);
    const writes = storage.writes.length;
    const err = await updateHandoff(storage, earned, "go-basics", "write-a-cli", b.id, "B2 {{task}}", earned.raw[path]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandoffLockedError);
    expect((err as HandoffLockedError).handoffId).toBe(b.id);
    expect(storage.file(path)).toBe("B {{task}}");
    expect(storage.writes.length).toBe(writes);

    const saved = await createHandoff(storage, earned, "go-basics", "write-a-cli", "B2 {{task}}", new Date("2026-10-01T10:00:00Z"));
    expect(storage.file(path)).toBe("B {{task}}");
    expect(defaultHandoff(saved.state, KEY)).toEqual({ id: saved.id, text: "B2 {{task}}" });
  });

  it("updating a handoff that no result names rewrites it in place and keeps its id", async () => {
    const { storage, state } = await setup();
    const a = await createHandoff(storage, state, "go-basics", "write-a-cli", "A {{task}}", at);
    const path = handoffPath("go-basics", "write-a-cli", a.id);
    expect(isHandoffLocked(a.state, KEY, a.id)).toBe(false);
    const next = await updateHandoff(storage, a.state, "go-basics", "write-a-cli", a.id, "A2 {{task}}", a.state.raw[path]);
    expect(storage.file(path)).toBe("A2 {{task}}");
    expect(handoffsFor(next, KEY)).toEqual([{ collectionSlug: "go-basics", credentialSlug: "write-a-cli", id: a.id, text: "A2 {{task}}" }]);
  });

  it("a result on another badge or with another handoff does not lock it, and the skeleton never locks", async () => {
    const { storage, state } = await setup();
    const a = await createHandoff(storage, state, "go-basics", "write-a-cli", "A {{task}}", at);
    const withOther = await recordWith(storage, a.state, "met", new Date("2026-10-01T09:30:00Z"), "20200101T000000Z");
    const withSkeleton = await recordWith(storage, withOther, "met", new Date("2026-10-01T09:40:00Z"));
    expect(isHandoffLocked(withSkeleton, KEY, a.id)).toBe(false);
    expect(isHandoffLocked(withSkeleton, KEY, SKELETON_ID)).toBe(false);
    expect(isHandoffLocked(withSkeleton, "go-basics/other", "20200101T000000Z")).toBe(false);
  });

  it("a handoff changed on disk since it was read refuses the save with ChangedOnDiskError", async () => {
    const { storage, state } = await setup();
    const a = await createHandoff(storage, state, "go-basics", "write-a-cli", "A {{task}}", at);
    const path = handoffPath("go-basics", "write-a-cli", a.id);
    storage.seed({ [path]: "hand edit {{task}}" });
    await expect(updateHandoff(storage, a.state, "go-basics", "write-a-cli", a.id, "A2 {{task}}", a.state.raw[path])).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect(storage.file(path)).toBe("hand edit {{task}}");
  });

  it("refuses a template without {{task}}, and a badge handoff holding that badge's rubric, writing nothing (KTD2)", async () => {
    const { storage, state } = await setup();
    const writes = storage.writes.length;
    await expect(saveSkeleton(storage, "no slot", null)).rejects.toBeInstanceOf(HandoffProblemError);
    await expect(createHandoff(storage, state, "go-basics", "write-a-cli", "no slot", at)).rejects.toBeInstanceOf(HandoffProblemError);
    const leak = await createHandoff(storage, state, "go-basics", "write-a-cli", "{{task}}\n\nFlags parse.", at).catch((e: unknown) => e);
    expect(leak).toBeInstanceOf(HandoffProblemError);
    expect((leak as HandoffProblemError).problem).toEqual({ kind: "has-rubric" });
    const a = await createHandoff(storage, state, "go-basics", "write-a-cli", "A {{task}}", at);
    const path = handoffPath("go-basics", "write-a-cli", a.id);
    await expect(updateHandoff(storage, a.state, "go-basics", "write-a-cli", a.id, "Flags parse. {{task}}", a.state.raw[path])).rejects.toBeInstanceOf(HandoffProblemError);
    expect(storage.file(path)).toBe("A {{task}}");
    expect(storage.writes.length).toBe(writes + 1);
  });

  it("winnerFor returns the handoff of the latest Met result, and nothing when the latest result is Not yet", async () => {
    const { storage, state } = await setup();
    expect(winnerFor(state, "claude-opus", KEY)).toBeNull();
    const a = await createHandoff(storage, state, "go-basics", "write-a-cli", "A {{task}}", at);
    const met = await recordWith(storage, a.state, "met", new Date("2026-10-01T09:30:00Z"), a.id);
    expect(winnerFor(met, "claude-opus", KEY)).toBe(a.id);
    expect(winnerFor(met, "someone-else", KEY)).toBeNull();
    const notYet = await recordWith(storage, met, "not_met", new Date("2026-10-01T09:40:00Z"), a.id);
    expect(winnerFor(notYet, "claude-opus", KEY)).toBeNull();
  });

  it("winnerFor counts a Met result with no handoff as the skeleton", async () => {
    const { storage, state } = await setup();
    const met = await recordWith(storage, state, "met", new Date("2026-10-01T09:30:00Z"));
    expect(winnerFor(met, "claude-opus", KEY)).toBe(SKELETON_ID);
  });
});

describe("holding and judging replies", () => {
  const KEY = "go-basics/write-a-cli";
  const ids = { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli" };
  const handoff = { id: SKELETON_ID, text: "Build a CLI." };
  const context = { machineId: "m-1", machine: "Studio", memory: "4c1e9a7b20d3", capturedAt: "2026-10-01T08:50:00.000Z" };
  const at = new Date("2026-10-01T09:00:00.123Z");
  const heldFiles = (storage: MemoryStorage) => Object.keys(storage.files()).filter((p) => p.includes("/held/")).sort();
  const resultFiles = (storage: MemoryStorage) =>
    Object.keys(storage.files())
      .filter((p) => p.startsWith("assessments/") && !p.includes("/held/"))
      .sort();
  const cellOf = async (state: FolderState, profileSlug = "claude-opus") => (await buildMatrix(state)).cells.get(cellKey(profileSlug, KEY))!;

  it("holds a reply as a new file one folder below the results, with what a result would record, and writes no result", async () => {
    const { storage, state } = await setup();
    const { state: next, fileStem } = await holdReply(storage, state, { ...ids, handBack: "Here it is.", handoff, context }, at);
    expect(fileStem).toBe("20261001T090000Z");
    expect(heldFiles(storage)).toEqual([heldPath("claude-opus", "go-basics", "write-a-cli", fileStem)]);
    expect(resultFiles(storage)).toEqual([]);
    expect(next.assessments).toEqual([]);
    expect(next.held).toEqual([
      {
        ...ids,
        fileStem,
        heldAt: "2026-10-01T09:00:00.123Z",
        assignmentVersion: await assignmentVersion("Build a CLI.", "Flags parse."),
        setup: { harness: "claude-code", model: "opus", effort: "high" },
        handBack: "Here it is.",
        handoff,
        context,
      },
    ]);
  });

  it("a held reply holds no badge, flags nothing and locks neither the setup nor the handoff (KTD6)", async () => {
    const { storage, state } = await setup();
    const a = await createHandoff(storage, state, "go-basics", "write-a-cli", "A {{task}}", new Date("2026-09-30T08:00:00Z"));
    const { state: next } = await holdReply(storage, a.state, { ...ids, handBack: "Here it is.", handoff: { id: a.id, text: "A Build a CLI." } }, at);
    expect((await cellOf(next)).status).toBe("untested");
    expect(isSetupLocked(next, "claude-opus")).toBe(false);
    expect(isHandoffLocked(next, KEY, a.id)).toBe(false);
  });

  it("keeps a reading only when it was taken against the version stamped", async () => {
    const { storage, state } = await setup();
    const version = await assignmentVersion("Build a CLI.", "Flags parse.");
    const jev: JevReading = { model: "jev-1", assignmentVersion: version, askedAt: "2026-10-01T08:59:00.000Z", seen: "before", overall: 0.8, points: [] };
    const kept = await holdReply(storage, state, { ...ids, handBack: "One.", jev }, at);
    const dropped = await holdReply(storage, kept.state, { ...ids, handBack: "Two.", jev: { ...jev, assignmentVersion: "old" } }, at);
    expect(dropped.state.held.map((h) => h.jev)).toEqual([jev, undefined]);
  });

  it("Covers AE6. Two holds by one agent in the same second are two held replies", async () => {
    const { storage, state } = await setup();
    const one = await holdReply(storage, state, { ...ids, handBack: "One." }, at);
    const two = await holdReply(storage, one.state, { ...ids, handBack: "Two." }, at);
    expect([one.fileStem, two.fileStem]).toEqual(["20261001T090000Z", "20261001T090001Z"]);
    expect(two.state.held.map((h) => h.handBack)).toEqual(["One.", "Two."]);
  });

  it("refuses an empty reply, an unknown agent or an unknown badge, and writes nothing", async () => {
    const { storage, state } = await setup();
    const before = Object.keys(storage.files()).length;
    await expect(holdReply(storage, state, { ...ids, handBack: "  \n" }, at)).rejects.toThrow();
    await expect(holdReply(storage, state, { ...ids, profileSlug: "nope", handBack: "Hi." }, at)).rejects.toThrow();
    await expect(holdReply(storage, state, { ...ids, credentialSlug: "nope", handBack: "Hi." }, at)).rejects.toThrow();
    expect(Object.keys(storage.files()).length).toBe(before);
  });

  it("Covers AE2. Judging Met writes a result under the held stem and time, leaves the held file, and the agent holds the badge", async () => {
    const { storage, state } = await setup();
    const held = await holdReply(storage, state, { ...ids, handBack: "Here it is.", handoff, context }, at);
    const heldText = storage.file(heldPath("claude-opus", "go-basics", "write-a-cli", held.fileStem));
    expect((await cellOf(held.state)).status).toBe("untested");
    const next = await judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "met");
    expect(next.held).toEqual([]);
    expect(next.assessments).toEqual([
      {
        ...ids,
        fileStem: held.fileStem,
        result: "met",
        recordedAt: "2026-10-01T09:00:00.123Z",
        assignmentVersion: held.state.held[0].assignmentVersion,
        setup: held.state.held[0].setup,
        note: "",
        handBack: "Here it is.",
        handoff,
        context,
      },
    ]);
    expect(storage.file(heldPath("claude-opus", "go-basics", "write-a-cli", held.fileStem))).toBe(heldText);
    expect((await cellOf(next)).status).toBe("met");
  });

  it("judging copies a reading's targets and examples sent to the result, with no missed points and an empty note (R8)", async () => {
    const { storage, state } = await setup();
    const version = await assignmentVersion("Build a CLI.", "Flags parse.");
    const jev: JevReading = {
      model: "jev-1.13.0",
      assignmentVersion: version,
      askedAt: "2026-10-01T08:59:00.000Z",
      seen: "before",
      overall: 0.2,
      points: [],
      targets: [{ text: "I can parse flags", probability: 0.3 }],
      examplesSent: 2,
    };
    const held = await holdReply(storage, state, { ...ids, handBack: "Hmm.", jev, missedPoints: ["Flags parse."] } as HoldInput, at);
    const heldText = storage.file(heldPath("claude-opus", "go-basics", "write-a-cli", held.fileStem));
    expect(heldText).not.toContain("missed_points");
    expect(held.state.held[0].jev).toEqual(jev);
    const next = await judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "not_met");
    expect(next.assessments[0].jev).toEqual(jev);
    expect(next.assessments[0].note).toBe("");
    expect(next.assessments[0]).not.toHaveProperty("missedPoints");
    expect(storage.file(assessmentPath("claude-opus", "go-basics", "write-a-cli", held.fileStem))).not.toContain("missed_points");
    expect(storage.file(heldPath("claude-opus", "go-basics", "write-a-cli", held.fileStem))).toBe(heldText);
  });

  it("judging Not yet records Not met", async () => {
    const { storage, state } = await setup();
    const held = await holdReply(storage, state, { ...ids, handBack: "Hmm." }, at);
    const next = await judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "not_met");
    expect(next.assessments.map((a) => a.result)).toEqual(["not_met"]);
    expect((await cellOf(next)).status).toBe("not_met");
  });

  it("refuses a reply that is no longer held, an unknown reference or a bad verdict, and writes nothing", async () => {
    const { storage, state } = await setup();
    const held = await holdReply(storage, state, { ...ids, handBack: "Hi." }, at);
    const judged = await judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "met");
    const before = resultFiles(storage);
    await expect(judgeHeldReply(storage, judged, { ...ids, fileStem: held.fileStem }, "not_met")).rejects.toThrow();
    await expect(judgeHeldReply(storage, held.state, { ...ids, fileStem: "20200101T000000Z" }, "met")).rejects.toThrow();
    await expect(judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "maybe" as never)).rejects.toThrow();
    expect(resultFiles(storage)).toEqual(before);
  });

  it("fails as changed on disk, writing nothing, when a file is already at the result's path", async () => {
    const { storage, state } = await setup();
    const held = await holdReply(storage, state, { ...ids, handBack: "Hi." }, at);
    const path = assessmentPath("claude-opus", "go-basics", "write-a-cli", held.fileStem);
    storage.seed({ [path]: "someone else's" });
    await expect(judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "met")).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect(storage.file(path)).toBe("someone else's");
  });

  it("judging an older held reply after a newer Met result leaves the newer Met as the agent's latest", async () => {
    const { storage, state } = await setup();
    const held = await holdReply(storage, state, { ...ids, handBack: "Old." }, at);
    const met = await recordState(storage, held.state, { ...ids, result: "met", note: "", handBack: "New." }, new Date("2026-10-02T09:00:00Z"));
    const next = await judgeHeldReply(storage, met, { ...ids, fileStem: held.fileStem }, "not_met");
    const cell = await cellOf(next);
    expect(cell.status).toBe("met");
    expect(cell.latest?.handBack).toBe("New.");
  });

  it("a setup change between hold and judge: the result keeps the setup the reply came from, flagged setup changed", async () => {
    const { storage, state } = await setup();
    const held = await holdReply(storage, state, { ...ids, handBack: "Hi." }, at);
    const profile = held.state.profiles[0];
    const changed = await updateProfile(storage, held.state, { ...profile, model: "sonnet" }, held.state.raw[profilePath("claude-opus")]);
    const next = await judgeHeldReply(storage, changed, { ...ids, fileStem: held.fileStem }, "met");
    expect(next.assessments[0].setup.model).toBe("opus");
    expect((await cellOf(next)).flags).toContain("setup_mismatch");
  });

  it("recordAssessment returns the stem it wrote, bumped past a reply held in the same second, which stays held", async () => {
    const { storage, state } = await setup();
    const held = await holdReply(storage, state, { ...ids, handBack: "Held." }, at);
    const recorded = await recordAssessment(storage, held.state, { ...ids, result: "met", note: "", handBack: "Recorded." }, at);
    expect(recorded.fileStem).toBe("20261001T090001Z");
    expect(recorded.state.assessments.map((a) => a.fileStem)).toEqual([recorded.fileStem]);
    expect(recorded.state.held.map((h) => h.fileStem)).toEqual([held.fileStem]);
  });

  it("two results in the same second get two stems", async () => {
    const { storage, state } = await setup();
    const one = await recordAssessment(storage, state, { ...ids, result: "met", note: "", handBack: "One." }, at);
    const two = await recordAssessment(storage, one.state, { ...ids, result: "not_met", note: "", handBack: "Two." }, at);
    expect([one.fileStem, two.fileStem]).toEqual(["20261001T090000Z", "20261001T090001Z"]);
  });

  it("Covers AE6. Trashing the agent moves its held replies, and trashing the badge moves every agent's", async () => {
    const { storage, state } = await setup();
    const other = await createProfile(storage, state, { ...baseProfile, name: "Other" });
    const mine = await holdReply(storage, other.state, { ...ids, handBack: "Mine." }, at);
    const theirs = await holdReply(storage, mine.state, { ...ids, profileSlug: "other", handBack: "Theirs." }, at);
    const now = new Date("2026-10-02T10:00:00Z");
    const afterAgent = await trashProfile(storage, theirs.state, "claude-opus", now);
    expect(storage.file(`trash/20261002T100000Z/${heldPath("claude-opus", "go-basics", "write-a-cli", mine.fileStem)}`)).toBeDefined();
    expect(afterAgent.held.map((h) => h.profileSlug)).toEqual(["other"]);
    const afterBadge = await trashCredential(storage, afterAgent, "go-basics", "write-a-cli", new Date("2026-10-02T11:00:00Z"));
    expect(storage.file(`trash/20261002T110000Z/${heldPath("other", "go-basics", "write-a-cli", theirs.fileStem)}`)).toBeDefined();
    expect(heldFiles(storage).filter((p) => !p.startsWith("trash/"))).toEqual([]);
    expect(afterBadge.held).toEqual([]);
  });
});

describe("writing from compare (jev-in-compare U4)", () => {
  const ids = { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli" };
  const TASK = "Build a CLI.";
  const RUBRIC = "- Flags parse.\n- Help prints.\n\nMet when both hold.";
  const at = new Date("2026-10-01T09:00:00.123Z");
  const now = new Date("2026-10-02T10:00:00.000Z");
  const filesUnder = (storage: MemoryStorage, dir: string) => Object.keys(storage.files()).filter((p) => p.startsWith(`${dir}/`)).sort();
  const reading = (assignmentVersion: string, askedAt: string, overall = 0.9): JevReading => ({
    model: "jev-1.13.0",
    assignmentVersion,
    askedAt,
    seen: "before",
    overall,
    points: [
      { text: "Flags parse.", probability: 0.9 },
      { text: "Help prints.", probability: 0.8 },
    ],
    targets: [{ text: "I can parse flags", probability: 0.7 }],
    examplesSent: 0,
  });

  /** A folder whose badge has two rubric points, a note and a learning target, and a second agent. */
  async function compareSetup() {
    const { storage, state: first } = await setup();
    const credential = first.credentials[0];
    const state = await updateCredential(storage, { ...credential, task: TASK, rubric: RUBRIC }, first.raw[credentialPath("go-basics", "write-a-cli")]);
    const other = await createProfile(storage, state, { ...baseProfile, name: "Other" });
    return { storage, state: other.state, version: await assignmentVersion(TASK, RUBRIC) };
  }

  describe("judging a held reply with a reason and missed points", () => {
    it("Covers AE6. Not yet with two points and a reason writes a result with both, its reading and the held reply's time and stem", async () => {
      const { storage, state, version } = await compareSetup();
      const jev = reading(version, "2026-10-01T08:59:00.000Z");
      const held = await holdReply(storage, state, { ...ids, handBack: "Here it is.", jev }, at);
      const heldText = storage.file(heldPath("claude-opus", "go-basics", "write-a-cli", held.fileStem));
      const next = await judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "not_met", {
        note: "It never ran the tests.",
        missedPoints: ["Help prints.", "Flags parse."],
      });
      expect(next.held).toEqual([]);
      expect(next.assessments).toHaveLength(1);
      expect(next.assessments[0]).toMatchObject({
        ...ids,
        fileStem: held.fileStem,
        result: "not_met",
        recordedAt: "2026-10-01T09:00:00.123Z",
        note: "It never ran the tests.",
        missedPoints: ["Flags parse.", "Help prints."],
        jev,
      });
      expect(storage.file(heldPath("claude-opus", "go-basics", "write-a-cli", held.fileStem))).toBe(heldText);
    });

    it("copies a reading taken in compare when it is newer than the hold-time one", async () => {
      const { storage, state, version } = await compareSetup();
      const atHold = reading(version, "2026-10-01T08:59:00.000Z", 0.2);
      const held = await holdReply(storage, state, { ...ids, handBack: "Here it is.", jev: atHold }, at);
      const newer = reading(version, "2026-10-02T09:00:00.000Z", 0.95);
      const read = await saveHeldReading(storage, held.state, { ...ids, fileStem: held.fileStem, reading: newer }, now);
      const next = await judgeHeldReply(storage, read, { ...ids, fileStem: held.fileStem }, "met");
      expect(next.assessments[0].jev).toEqual(newer);
    });

    it("copies a reading taken in compare when the reply was held without one", async () => {
      const { storage, state, version } = await compareSetup();
      const held = await holdReply(storage, state, { ...ids, handBack: "Here it is." }, at);
      const later = reading(version, "2026-10-02T09:00:00.000Z");
      const read = await saveHeldReading(storage, held.state, { ...ids, fileStem: held.fileStem, reading: later }, now);
      const next = await judgeHeldReply(storage, read, { ...ids, fileStem: held.fileStem }, "not_met");
      expect(next.assessments[0].jev).toEqual(later);
    });

    it("Met keeps no missed points, even when some are passed, and the reason goes through the reason line", async () => {
      const { storage, state } = await compareSetup();
      const held = await holdReply(storage, state, { ...ids, handBack: "Here it is." }, at);
      const next = await judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "met", {
        note: "  ## It did\nall of it  ",
        missedPoints: ["Flags parse."],
      });
      expect(next.assessments[0]).not.toHaveProperty("missedPoints");
      expect(next.assessments[0].note).toBe("It did all of it");
      expect(storage.file(assessmentPath("claude-opus", "go-basics", "write-a-cli", held.fileStem))).not.toContain("missed_points");
    });

    it("drops a missed point that is not a point of the current rubric", async () => {
      const { storage, state } = await compareSetup();
      const held = await holdReply(storage, state, { ...ids, handBack: "Here it is." }, at);
      const next = await judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "not_met", {
        missedPoints: ["Tests pass.", "Help prints."],
      });
      expect(next.assessments[0].missedPoints).toEqual(["Help prints."]);
    });
  });

  describe("saving a held reply's reading", () => {
    it("writes a new file beside the held reply, and the folder reads it back", async () => {
      const { storage, state, version } = await compareSetup();
      const held = await holdReply(storage, state, { ...ids, handBack: "Here it is." }, at);
      const heldText = storage.file(heldPath("claude-opus", "go-basics", "write-a-cli", held.fileStem));
      const r = reading(version, "2026-10-02T09:59:00.000Z");
      const next = await saveHeldReading(storage, held.state, { ...ids, fileStem: held.fileStem, reading: r }, now);
      expect(filesUnder(storage, readingsDir("claude-opus", "go-basics", "write-a-cli"))).toEqual([
        heldReadingPath("claude-opus", "go-basics", "write-a-cli", "20261002T100000Z"),
      ]);
      expect(next.heldReadings).toEqual([{ ...ids, id: "20261002T100000Z", fileStem: held.fileStem, reading: r }]);
      expect(next.held.map((h) => h.fileStem)).toEqual([held.fileStem]);
      expect(storage.file(heldPath("claude-opus", "go-basics", "write-a-cli", held.fileStem))).toBe(heldText);
    });

    it("two saves in one second get two stems", async () => {
      const { storage, state, version } = await compareSetup();
      const held = await holdReply(storage, state, { ...ids, handBack: "Here it is." }, at);
      const ref = { ...ids, fileStem: held.fileStem };
      const one = await saveHeldReading(storage, held.state, { ...ref, reading: reading(version, "2026-10-02T09:59:00.000Z") }, now);
      const two = await saveHeldReading(storage, one, { ...ref, reading: reading(version, "2026-10-02T09:59:30.000Z") }, now);
      expect(two.heldReadings.map((h) => h.id)).toEqual(["20261002T100000Z", "20261002T100001Z"]);
    });

    it("refuses a reply that has been judged or was never held, and writes nothing", async () => {
      const { storage, state, version } = await compareSetup();
      const held = await holdReply(storage, state, { ...ids, handBack: "Here it is." }, at);
      const judged = await judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "met");
      const before = storage.files();
      await expect(
        saveHeldReading(storage, judged, { ...ids, fileStem: held.fileStem, reading: reading(version, "2026-10-02T09:59:00.000Z") }, now),
      ).rejects.toThrow("That reply is no longer held.");
      await expect(
        saveHeldReading(storage, held.state, { ...ids, fileStem: "20200101T000000Z", reading: reading(version, "2026-10-02T09:59:00.000Z") }, now),
      ).rejects.toThrow("That reply is no longer held.");
      expect(storage.files()).toEqual(before);
    });

    it("refuses a reading asked against another version of the badge, and writes nothing", async () => {
      const { storage, state } = await compareSetup();
      const held = await holdReply(storage, state, { ...ids, handBack: "Here it is." }, at);
      const before = storage.files();
      await expect(
        saveHeldReading(storage, held.state, { ...ids, fileStem: held.fileStem, reading: reading("old", "2026-10-02T09:59:00.000Z") }, now),
      ).rejects.toThrow("The badge's task or rubric changed. Compare with Jev again.");
      expect(storage.files()).toEqual(before);
    });
  });

  describe("saving a head-to-head", () => {
    const points = [
      { text: "Flags parse.", firstOver: 0.9, secondOver: 0.1 },
      { text: "Help prints.", firstOver: 0.4, secondOver: 0.6 },
    ];

    async function twoReplies() {
      const { storage, state, version } = await compareSetup();
      const mine = await holdReply(storage, state, { ...ids, handBack: "Mine." }, at);
      const theirs = await recordAssessment(storage, mine.state, { ...ids, profileSlug: "other", result: "met", note: "", handBack: "Theirs." }, at);
      const pair = {
        collectionSlug: "go-basics",
        credentialSlug: "write-a-cli",
        model: "jev-1.13.0",
        assignmentVersion: version,
        askedAt: "2026-10-02T09:59:00.000Z",
        first: { profileSlug: "claude-opus", fileStem: mine.fileStem },
        second: { profileSlug: "other", fileStem: theirs.fileStem },
        points,
      };
      return { storage, state: theirs.state, pair };
    }

    it("writes a new file beside the badge's marks naming both replies, a held one and a result, and the folder reads it back", async () => {
      const { storage, state, pair } = await twoReplies();
      const next = await saveHeadToHead(storage, state, pair, now);
      expect(filesUnder(storage, headToHeadDir("go-basics", "write-a-cli"))).toEqual([headToHeadPath("go-basics", "write-a-cli", "20261002T100000Z")]);
      expect(next.headToHeads).toEqual([{ ...pair, id: "20261002T100000Z" }]);
    });

    it("two saves in one second get two stems", async () => {
      const { storage, state, pair } = await twoReplies();
      const one = await saveHeadToHead(storage, state, pair, now);
      const two = await saveHeadToHead(storage, one, { ...pair, first: pair.second, second: pair.first }, now);
      expect(two.headToHeads.map((h) => h.id)).toEqual(["20261002T100000Z", "20261002T100001Z"]);
    });

    it("refuses when either reply is gone from the folder, and writes nothing", async () => {
      const { storage, state, pair } = await twoReplies();
      const before = storage.files();
      const gone = { profileSlug: "claude-opus", fileStem: "20200101T000000Z" };
      await expect(saveHeadToHead(storage, state, { ...pair, first: gone }, now)).rejects.toThrow("One of those replies is no longer in the folder.");
      await expect(saveHeadToHead(storage, state, { ...pair, second: { ...pair.second, profileSlug: "nobody" } }, now)).rejects.toThrow(
        "One of those replies is no longer in the folder.",
      );
      expect(storage.files()).toEqual(before);
    });

    it("refuses a pair asked against another version of the badge, and writes nothing", async () => {
      const { storage, state, pair } = await twoReplies();
      const before = storage.files();
      await expect(saveHeadToHead(storage, state, { ...pair, assignmentVersion: "old" }, now)).rejects.toThrow(
        "The badge's task or rubric changed. Compare with Jev again.",
      );
      expect(storage.files()).toEqual(before);
    });
  });

  describe("re-judging a result", () => {
    async function oneMet() {
      const { storage, state, version } = await compareSetup();
      const jev = reading(version, "2026-10-01T08:59:00.000Z");
      const recorded = await recordAssessment(storage, state, { ...ids, result: "met", note: "Looks right.", handBack: "Done.", jev }, at);
      const ref = { ...ids, fileStem: recorded.fileStem };
      const path = assessmentPath("claude-opus", "go-basics", "write-a-cli", recorded.fileStem);
      return { storage, state: recorded.state, ref, path, jev };
    }

    it("Met to Not yet writes one re-judge file, leaves the result file byte for byte, and reads back as Not met", async () => {
      const { storage, state, ref, path, jev } = await oneMet();
      const resultText = storage.file(path);
      const next = await rejudgeResult(storage, state, ref, "not_met", { note: "# Missed the help\ntext.", missedPoints: ["Help prints."] }, now);
      expect(filesUnder(storage, rejudgedDir("claude-opus", "go-basics", "write-a-cli"))).toEqual([
        rejudgedPath("claude-opus", "go-basics", "write-a-cli", "20261002T100000Z"),
      ]);
      expect(storage.file(path)).toBe(resultText);
      expect(next.assessments).toHaveLength(1);
      expect(next.assessments[0]).toMatchObject({
        ...ref,
        result: "not_met",
        recordedAt: "2026-10-01T09:00:00.123Z",
        note: "Missed the help text.",
        missedPoints: ["Help prints."],
        earlierVerdicts: ["met"],
        handBack: "Done.",
        jev,
      });
      const reloaded = await loadFolder(storage);
      expect(reloaded.assessments[0].result).toBe("not_met");
      expect(reloaded.assessments[0].earlierVerdicts).toEqual(["met"]);
    });

    it("Met, then Not yet, then Met again: each re-judge checks the verdict it has now, and both earlier verdicts stay", async () => {
      const { storage, state, ref } = await oneMet();
      const once = await rejudgeResult(storage, state, ref, "not_met", { missedPoints: ["Flags parse."] }, now);
      const twice = await rejudgeResult(storage, once, ref, "met", { missedPoints: ["Flags parse."] }, now);
      expect(filesUnder(storage, rejudgedDir("claude-opus", "go-basics", "write-a-cli"))).toHaveLength(2);
      expect(twice.assessments[0].result).toBe("met");
      expect(twice.assessments[0].earlierVerdicts).toEqual(["met", "not_met"]);
      expect(twice.assessments[0]).not.toHaveProperty("missedPoints");
    });

    it("refuses the verdict the result already has, and a result that has gone, and writes nothing", async () => {
      const { storage, state, ref } = await oneMet();
      const before = storage.files();
      await expect(rejudgeResult(storage, state, ref, "met", undefined, now)).rejects.toThrow("That result already has that verdict.");
      await expect(rejudgeResult(storage, state, { ...ref, fileStem: "20200101T000000Z" }, "not_met", undefined, now)).rejects.toThrow(
        "That result is no longer in the folder.",
      );
      await expect(rejudgeResult(storage, state, ref, "maybe" as never, undefined, now)).rejects.toThrow();
      expect(storage.files()).toEqual(before);
    });

    it("drops a missed point that is not a point of the current rubric", async () => {
      const { storage, state, ref } = await oneMet();
      const next = await rejudgeResult(storage, state, ref, "not_met", { missedPoints: ["Tests pass.", "Flags parse."] }, now);
      expect(next.assessments[0].missedPoints).toEqual(["Flags parse."]);
    });

    it("a re-judge with no reason or points saves an empty note and no missed points", async () => {
      const { storage, state, ref } = await oneMet();
      const next = await rejudgeResult(storage, state, ref, "not_met", undefined, now);
      expect(next.assessments[0].note).toBe("");
      expect(next.assessments[0]).not.toHaveProperty("missedPoints");
    });
  });
});

describe("adding a built-in collection (KTD2)", () => {
  const nostr = BUILT_INS.find((b) => b.slug === "nostr-relays")!;
  const [firstBadge, secondBadge] = nostr.collection.order;

  it("writes the collection with from, then each badge file", async () => {
    const storage = new MemoryStorage();
    const { state, slug } = await addBuiltinCollection(storage, await loadFolder(storage), "nostr-relays");
    expect(slug).toBe("nostr-relays");
    const col = state.collections.find((c) => c.slug === "nostr-relays")!;
    expect(col).toMatchObject({ name: nostr.collection.name, description: nostr.collection.description, order: nostr.collection.order, codes: nostr.collection.codes, from: "nostr-relays" });
    expect(JSON.parse(storage.file(collectionPath("nostr-relays"))!).from).toBe("nostr-relays");
    expect(storage.file(credentialPath("nostr-relays", firstBadge))).toBe(nostr.credentials[firstBadge]);
    expect(storage.file(credentialPath("nostr-relays", secondBadge))).toBe(nostr.credentials[secondBadge]);
    expect(state.credentials.filter((c) => c.collectionSlug === "nostr-relays")).toHaveLength(2);
    expect(builtinStatus(state, nostr)).toEqual({ kind: "added", slug: "nostr-relays" });
  });

  it("takes the next free slug when a collection of your own has its slug", async () => {
    const storage = new MemoryStorage();
    const own = await createCollection(storage, await loadFolder(storage), "Nostr relays");
    const { state, slug } = await addBuiltinCollection(storage, own.state, "nostr-relays");
    expect(slug).toBe("nostr-relays-2");
    expect(state.collections.find((c) => c.slug === "nostr-relays-2")?.from).toBe("nostr-relays");
    expect(state.collections.find((c) => c.slug === "nostr-relays")?.from).toBeUndefined();
  });

  it("a failed second badge leaves a loadable copy, and adding again writes only that badge", async () => {
    const storage = new MemoryStorage();
    const state = await loadFolder(storage);
    const real = storage.writeText.bind(storage);
    let failed = false;
    const spy = vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
      if (!failed && path === credentialPath("nostr-relays", secondBadge)) {
        failed = true;
        throw new Error("disk full");
      }
      return real(root, path, text);
    });
    await expect(addBuiltinCollection(storage, state, "nostr-relays")).rejects.toThrow("disk full");
    const partial = await loadFolder(storage);
    expect(partial.credentials.map((c) => c.slug)).toEqual([firstBadge]);
    expect(builtinStatus(partial, nostr)).toEqual({ kind: "incomplete", slug: "nostr-relays", missing: [secondBadge] });

    spy.mockClear();
    // The retry starts from the state before the first try, which never saw the copy it made.
    const retry = await addBuiltinCollection(storage, state, "nostr-relays");
    expect(retry.slug).toBe("nostr-relays");
    expect(spy.mock.calls.map(([, path]) => path)).toEqual([credentialPath("nostr-relays", secondBadge)]);
    expect(retry.state.collections.map((c) => c.slug)).toEqual(["nostr-relays"]);
    expect(retry.state.credentials.map((c) => c.slug)).toEqual(nostr.collection.order);
  });

  it("a badge the user trashed from the copy is never written back", async () => {
    const storage = new MemoryStorage();
    const added = await addBuiltinCollection(storage, await loadFolder(storage), "nostr-relays");
    const trashed = await trashCredential(storage, added.state, "nostr-relays", secondBadge);
    expect(builtinStatus(trashed, nostr)).toEqual({ kind: "added", slug: "nostr-relays" });
    const writes = storage.writes.length;
    const again = await addBuiltinCollection(storage, trashed, "nostr-relays");
    expect(storage.writes.length).toBe(writes);
    expect(again.state.credentials.map((c) => c.slug)).toEqual([firstBadge]);
  });

  /** A copy whose add failed on its second badge: collection.json and the first badge are on disk. */
  async function partialCopy() {
    const storage = new MemoryStorage();
    const real = storage.writeText.bind(storage);
    const spy = vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
      if (path === credentialPath("nostr-relays", secondBadge)) throw new Error("disk full");
      return real(root, path, text);
    });
    await expect(addBuiltinCollection(storage, await loadFolder(storage), "nostr-relays")).rejects.toThrow("disk full");
    spy.mockRestore();
    return { storage, state: await loadFolder(storage) };
  }

  it("a badge made in an unfinished copy keeps the copy unfinished, and adding again writes the missing badge", async () => {
    const { storage, state } = await partialCopy();
    const made = await createCredential(storage, state, "nostr-relays", "My own relay");
    expect(builtinStatus(made.state, nostr)).toEqual({ kind: "incomplete", slug: "nostr-relays", missing: [secondBadge] });
    const done = await addBuiltinCollection(storage, made.state, "nostr-relays");
    expect(storage.file(credentialPath("nostr-relays", secondBadge))).toBe(nostr.credentials[secondBadge]);
    expect(done.state.credentials.map((c) => c.slug)).toEqual([...nostr.collection.order, "my-own-relay"]);
    expect(builtinStatus(done.state, nostr)).toEqual({ kind: "added", slug: "nostr-relays" });
  });

  it("trashing the written badge of an unfinished copy keeps it unfinished, and adding again writes only the missing badge", async () => {
    const { storage, state } = await partialCopy();
    const trashed = await trashCredential(storage, state, "nostr-relays", firstBadge);
    expect(builtinStatus(trashed, nostr)).toEqual({ kind: "incomplete", slug: "nostr-relays", missing: [secondBadge] });
    const done = await addBuiltinCollection(storage, trashed, "nostr-relays");
    expect(done.state.credentials.map((c) => c.slug)).toEqual([secondBadge]);
    expect(builtinStatus(done.state, nostr)).toEqual({ kind: "added", slug: "nostr-relays" });
  });

  it("finishing a copy checks its bases first, so a badge written meanwhile writes nothing", async () => {
    const storage = new MemoryStorage();
    const added = await addBuiltinCollection(storage, await loadFolder(storage), "nostr-relays");
    // A view from before the second badge landed: the file is on disk now.
    const partial = { ...added.state, raw: { ...added.state.raw } };
    delete partial.raw[credentialPath("nostr-relays", secondBadge)];
    const writes = storage.writes.length;
    await expect(addBuiltinCollection(storage, partial, "nostr-relays")).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect(storage.writes.length).toBe(writes);
  });

  it("an empty collection by name has an empty order and no codes", async () => {
    const storage = new MemoryStorage();
    const { state, slug } = await createCollection(storage, await loadFolder(storage), "Client work");
    expect(slug).toBe("client-work");
    expect(state.collections.find((c) => c.slug === "client-work")).toMatchObject({ name: "Client work", order: [], codes: {} });
  });
});

describe("renaming and trashing a collection (collections plan U6, KTD7)", () => {
  const now = new Date("2026-10-06T10:00:00.000Z");
  const stamp = "20261006T100000Z";
  const at = (minute: number) => new Date(`2026-10-06T08:${String(minute).padStart(2, "0")}:00Z`);

  /** My credentials with two badges, results from two agents, a handoff, a mark, a held reply and a pasted image, beside another collection. */
  async function full() {
    const storage = new MemoryStorage();
    let state = await loadFolder(storage);
    state = (await createCollection(storage, state, "My credentials")).state;
    state = (await createCollection(storage, state, "Other")).state;
    state = (await createCredential(storage, state, "my-credentials", "Write a CLI")).state;
    state = (await createCredential(storage, state, "my-credentials", "Read a file")).state;
    state = (await createCredential(storage, state, "other", "Keep me")).state;
    state = (await createProfile(storage, state, baseProfile)).state;
    state = (await createProfile(storage, state, { ...baseProfile, name: "Codex" })).state;
    const ids = (profileSlug: string, credentialSlug: string) => ({ profileSlug, collectionSlug: "my-credentials", credentialSlug });
    state = (await recordAssessment(storage, state, { ...ids("claude-opus", "write-a-cli"), result: "met", note: "", handBack: "Done." }, at(1))).state;
    state = (await recordAssessment(storage, state, { ...ids("codex", "write-a-cli"), result: "not_met", note: "", handBack: "Tried." }, at(2))).state;
    state = (await recordAssessment(storage, state, { profileSlug: "codex", collectionSlug: "other", credentialSlug: "keep-me", result: "met", note: "", handBack: "Kept." }, at(3))).state;
    state = (await createHandoff(storage, state, "my-credentials", "write-a-cli", "A {{task}}", at(4))).state;
    state = await markGoTo(storage, state, { ...ids("claude-opus", "write-a-cli"), fileStem: "20261006T080100Z" }, at(5));
    state = (await holdReply(storage, state, { ...ids("codex", "read-a-file"), handBack: "Held." }, at(6))).state;
    storage.seedImage("collections/my-credentials/credentials/pasted.png", "data:image/png;base64,AAAA");
    state = await loadFolder(storage);
    return { storage, state };
  }

  /** Every file under a folder, text, image or video. */
  const under = (storage: MemoryStorage, dir: string) => storage.listFiles("data", dir);
  const goesWith = async (storage: MemoryStorage) =>
    [...(await under(storage, "collections/my-credentials")), ...(await under(storage, "assessments")).filter((p) => p.split("/")[2] === "my-credentials")].sort();

  it("renaming My credentials to Daily work changes its name only, and its badges keep their keys", async () => {
    const { storage, state } = await full();
    const before = state.collections.find((c) => c.slug === "my-credentials")!;
    const next = await updateCollection(storage, state, { ...before, name: "Daily work" }, state.raw[collectionPath("my-credentials")]);
    const after = next.collections.find((c) => c.slug === "my-credentials")!;
    expect(after).toEqual({ ...before, name: "Daily work" });
    expect(next.credentials.filter((c) => c.collectionSlug === "my-credentials").map(credentialKey).sort()).toEqual(["my-credentials/read-a-file", "my-credentials/write-a-cli"]);
  });

  it("Covers AE4. moves every file of the collection and its results under one stamp, and leaves the rest", async () => {
    const { storage, state } = await full();
    const files = (await goesWith(storage));
    expect(files).toEqual(
      expect.arrayContaining([
        collectionPath("my-credentials"),
        credentialPath("my-credentials", "write-a-cli"),
        credentialPath("my-credentials", "read-a-file"),
        "collections/my-credentials/credentials/pasted.png",
        "assessments/claude-opus/my-credentials/write-a-cli/20261006T080100Z.md",
        "assessments/codex/my-credentials/write-a-cli/20261006T080200Z.md",
        heldPath("codex", "my-credentials", "read-a-file", "20261006T080600Z"),
        markPath("my-credentials", "write-a-cli", "20261006T080500Z"),
      ]),
    );
    expect(files.some((p) => p.startsWith("collections/my-credentials/handoffs/write-a-cli/"))).toBe(true);
    const texts = Object.fromEntries(files.map((p) => [p, storage.file(p)]));

    const next = await trashCollection(storage, state, "my-credentials", now);
    expect((await goesWith(storage))).toEqual([]);
    for (const p of files) {
      if (p.endsWith(".png")) expect(storage.image(`trash/${stamp}/${p}`)).toBeDefined();
      else expect(storage.file(`trash/${stamp}/${p}`)).toBe(texts[p]);
    }
    // collection.json moves last.
    expect(storage.writes[storage.writes.length - 1].path).toBe(`trash/${stamp}/${collectionPath("my-credentials")}`);
    expect(next.collections.map((c) => c.slug)).toEqual(["other"]);
    expect(next.credentials.map(credentialKey)).toEqual(["other/keep-me"]);
    expect(next.assessments.map(credentialKey)).toEqual(["other/keep-me"]);
    expect(next.held).toEqual([]);
    expect(next.marks).toEqual([]);
    expect(next.profiles.map((p) => p.slug)).toEqual(["claude-opus", "codex"]);
  });

  it("Covers AE4. after My credentials is trashed, a new badge lands in a new My credentials", async () => {
    const storage = new MemoryStorage();
    let state = (await createCollection(storage, await loadFolder(storage), "My credentials")).state;
    state = (await createCredential(storage, state, "my-credentials", "Write a CLI")).state;
    state = (await addBuiltinCollection(storage, state, "nostr-relays")).state;
    state = await trashCollection(storage, state, "my-credentials", now);
    const landing = await ensureLandingCollection(storage, state);
    const made = await createCredential(storage, landing.state, landing.slug, "Fresh");
    expect(made.key).toBe("my-credentials/fresh");
    expect(made.state.collections.find((c) => c.slug === "my-credentials")).toMatchObject({ name: "My credentials", order: ["fresh"] });
    expect(made.state.credentials.map(credentialKey).sort()).toEqual([...BUILT_INS.find((b) => b.slug === "nostr-relays")!.collection.order.map((s) => `nostr-relays/${s}`), "my-credentials/fresh"].sort());
  });

  it("a move that fails on the third file leaves the collection loadable, and trashing again finishes", async () => {
    const { storage, state } = await full();
    const files = (await goesWith(storage));
    const failing = Object.create(storage) as MemoryStorage;
    let calls = 0;
    failing.moveFile = async (root, from, to) => {
      if (++calls === 3) throw new Error("disk full");
      return storage.moveFile(root, from, to);
    };
    await expect(trashCollection(failing, state, "my-credentials", now)).rejects.toThrow("disk full");
    const between = await loadFolder(storage);
    expect(between.collections.map((c) => c.slug)).toEqual(["my-credentials", "other"]);
    expect(between.errors).toEqual([]);

    const done = await trashCollection(storage, between, "my-credentials", new Date("2026-10-06T10:00:05Z"));
    expect((await goesWith(storage))).toEqual([]);
    expect(done.collections.map((c) => c.slug)).toEqual(["other"]);
    const trashed = (await under(storage, "trash")).map((p) => p.split("/").slice(2).join("/"));
    expect(trashed.sort()).toEqual(files);
  });

  it("moves nothing when a badge file changed on disk since it was opened", async () => {
    const { storage, state } = await full();
    const path = credentialPath("my-credentials", "read-a-file");
    storage.seed({ [path]: `${storage.file(path)}\nmore\n` });
    await expect(trashCollection(storage, state, "my-credentials", now)).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect((await under(storage, "trash"))).toEqual([]);
  });

  it("moves nothing when collection.json changed on disk since it was opened", async () => {
    const { storage, state } = await full();
    storage.seed({ [collectionPath("my-credentials")]: `${storage.file(collectionPath("my-credentials"))}\n` });
    await expect(trashCollection(storage, state, "my-credentials", now)).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect((await under(storage, "trash"))).toEqual([]);
  });

  it("a collection.json that cannot be parsed still moves to the trash with its badges", async () => {
    const { storage } = await full();
    storage.seed({ [collectionPath("my-credentials")]: "{not json" });
    const state = await loadFolder(storage);
    expect(state.errors.map((e) => e.path)).toContain(collectionPath("my-credentials"));
    const next = await trashCollection(storage, state, "my-credentials", now);
    expect((await goesWith(storage))).toEqual([]);
    expect(storage.file(`trash/${stamp}/${collectionPath("my-credentials")}`)).toBe("{not json");
    expect(next.collections.map((c) => c.slug)).toEqual(["other"]);
  });

  it("trashing an added built-in's copy makes the built-in addable again", async () => {
    const storage = new MemoryStorage();
    const nostr = BUILT_INS.find((b) => b.slug === "nostr-relays")!;
    const added = await addBuiltinCollection(storage, await loadFolder(storage), "nostr-relays");
    expect(builtinStatus(added.state, nostr).kind).toBe("added");
    const next = await trashCollection(storage, added.state, added.slug, now);
    expect(builtinStatus(next, nostr)).toEqual({ kind: "not-added" });
  });
});

describe("replies with items (reply-artifacts U1)", () => {
  const ids = { profileSlug: "claude-opus", collectionSlug: "go-basics", credentialSlug: "write-a-cli" };
  const at = new Date("2026-10-07T09:00:00.000Z");
  const pdf: ReplyItem = { kind: "file", name: "report.pdf", ref: "files/file-1a2b3c4d.pdf" };
  const video: ReplyItem = { kind: "video", name: "demo.mov", ref: "video-5e6f7a8b.mov" };
  const link: ReplyItem = { kind: "link", url: "https://example.com/pr/12" };
  const text = (t: string): ReplyItem => ({ kind: "text", text: t });

  it("records a reply's items in order, with its text items joined as the hand-back", async () => {
    const { storage, state } = await setup();
    const items = [text("Summary."), pdf, video, link, text("Closing.")];
    const { state: next, fileStem } = await recordAssessment(storage, state, { ...ids, result: "met", note: "", items }, at);
    const a = next.assessments.find((x) => x.fileStem === fileStem)!;
    expect(a.items).toEqual(items);
    expect(a.handBack).toBe("Summary.\n\nClosing.");
    expect(await loadFolder(storage)).toEqual(next);
  });

  it("records one text item exactly as a bare hand-back would be", async () => {
    const one = await setup();
    await recordAssessment(one.storage, one.state, { ...ids, result: "met", note: "", items: [text(" Here it is. ")] }, at);
    const bare = await setup();
    await recordAssessment(bare.storage, bare.state, { ...ids, result: "met", note: "", handBack: " Here it is. " }, at);
    const path = assessmentPath("claude-opus", "go-basics", "write-a-cli", "20261007T090000Z");
    expect(one.storage.file(path)).toBe(bare.storage.file(path));
    expect(one.storage.file(path)).not.toContain("items:");
  });

  it("drops whitespace-only text items, so one empty text item plus a PDF saves as one PDF item", async () => {
    const { storage, state } = await setup();
    const { state: next } = await holdReply(storage, state, { ...ids, items: [text("  \n"), pdf] }, at);
    expect(next.held[0].items).toEqual([pdf]);
    expect(next.held[0].handBack).toBe("");
  });

  it("Covers AE2. Refuses a reply of only an empty text item, and saves one with a link item", async () => {
    const { storage, state } = await setup();
    const before = Object.keys(storage.files()).length;
    await expect(holdReply(storage, state, { ...ids, items: [text(" ")] }, at)).rejects.toThrow(/hand-back|reply/i);
    await expect(recordAssessment(storage, state, { ...ids, result: "met", note: "", items: [] }, at)).rejects.toThrow(/hand-back|reply/i);
    await expect(recordAssessment(storage, state, { ...ids, result: "met", note: "" }, at)).rejects.toThrow(/hand-back|reply/i);
    expect(Object.keys(storage.files()).length).toBe(before);
    const { state: next } = await holdReply(storage, state, { ...ids, items: [text(" "), link] }, at);
    expect(next.held[0].items).toEqual([link]);
  });

  it("judging a held reply with items records a result with the same items", async () => {
    const { storage, state } = await setup();
    const items = [text("Summary."), pdf, link];
    const held = await holdReply(storage, state, { ...ids, items }, at);
    const next = await judgeHeldReply(storage, held.state, { ...ids, fileStem: held.fileStem }, "met");
    const a = next.assessments.find((x) => x.fileStem === held.fileStem)!;
    expect(a.items).toEqual(items);
    expect(a.handBack).toBe("Summary.");
    expect(next.held).toEqual([]);
  });
});
