import { describe, expect, it, vi } from "vitest";
import { ChangedOnDiskError } from "../storage/storage";
import { MemoryStorage } from "../storage/memory";
import { assignmentVersion } from "./hash";
import { assessmentPath, collectionPath, credentialPath, handoffPath, heldPath, loadFolder, markPath, marksDir, profilePath, serializeMark, SKELETON_PATH } from "./folder";
import { buildMatrix, cellKey } from "./matrix";
import { BUILT_IN_HANDOFF, defaultHandoff, handoffsFor, isHandoffLocked, SKELETON_ID, winnerFor } from "./handoffs";
import {
  HandoffLockedError,
  HandoffProblemError,
  SetupLockedError,
  createCollection,
  createCredential,
  createHandoff,
  createPresetCredential,
  createProfile,
  duplicateProfileDraft,
  holdReply,
  importBadgeArt,
  isSetupLocked,
  judgeHeldReply,
  markGoTo,
  recordAssessment,
  reorderCredentials,
  saveSkeleton,
  setCredentialBadgeOverride,
  trashCredential,
  trashProfile,
  updateCollection,
  updateCollectionBadge,
  updateCredential,
  updateHandoff,
  updateProfile,
} from "./operations";
import { findPreset, presetCredential } from "./presets";
import { credentialKey, type AgentProfile, type AssessmentResult, type FolderState, type JevReading } from "./types";

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

  it("lands in the first collection with the next module code", async () => {
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
