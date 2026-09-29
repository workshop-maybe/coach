import { describe, expect, it } from "vitest";
import { ChangedOnDiskError } from "../storage/storage";
import { MemoryStorage } from "../storage/memory";
import { assignmentVersion } from "./hash";
import { collectionPath, credentialPath, loadFolder, profilePath } from "./folder";
import {
  SetupLockedError,
  createCollection,
  createCredential,
  createProfile,
  duplicateProfileDraft,
  importBadgeArt,
  isSetupLocked,
  recordAssessment,
  reorderCredentials,
  setCredentialBadgeOverride,
  updateCollection,
  updateCollectionBadge,
  updateCredential,
  updateProfile,
} from "./operations";
import type { AgentProfile, FolderState } from "./types";

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
  const next = await recordAssessment(
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
    const next = await recordAssessment(storage, state, { ...input, result: "not_met" }, now);
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

  it("stamps the edited assignment version after the credential changes", async () => {
    const { storage, state } = await setup();
    const path = credentialPath("go-basics", "write-a-cli");
    const edited = await updateCredential(storage, { ...state.credentials[0], rubric: "Flags parse and help prints." }, state.raw[path]);
    const next = await recordAssessment(storage, edited, { ...input, result: "met" });
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
