import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory";
import { ChangedOnDiskError } from "../storage/storage";
import { serializeCredentialMd } from "./credential-md";
import {
  MARKER_PATH,
  assessmentPath,
  collectionPath,
  credentialPath,
  fileStemFor,
  loadFolder,
  parseAssessment,
  parseCollection,
  parseProfile,
  profilePath,
  saveAssessment,
  saveCollection,
  saveCredential,
  saveProfile,
  saveText,
  serializeAssessment,
  serializeCollection,
  serializeProfile,
} from "./folder";
import type { AgentProfile, Assessment, Collection, Credential } from "./types";

function cred(slug: string, name: string, collectionSlug = "eng"): Credential {
  return {
    slug,
    collectionSlug,
    name,
    learningTargets: [`I can ${name.toLowerCase()}.`],
    task: `Do ${name}.`,
    rubric: `Good ${name}.`,
    extraSections: [],
  };
}

const collection: Collection = {
  slug: "eng",
  name: "Engineering",
  description: "Core skills.",
  order: ["review"],
  codes: { review: 1 },
};

const profile: AgentProfile = {
  slug: "claude-high",
  name: "Claude high",
  harness: "claude-code",
  model: "opus",
  effort: "high",
  repo: "~/projects/app",
  notes: "",
  params: { temperature: "0" },
};

const handBack = [
  "---",
  "title: my own frontmatter",
  "---",
  "",
  "## Handback",
  "",
  "## Note",
  "I did the thing.",
  "---",
  "",
  "  trailing spaces   ",
  "",
].join("\n");

const assessment: Assessment = {
  profileSlug: "claude-high",
  collectionSlug: "eng",
  credentialSlug: "review",
  fileStem: "20260929T084900Z",
  result: "met",
  recordedAt: "2026-09-29T08:49:00.123Z",
  assignmentVersion: "12e456789012",
  setup: { harness: "claude-code", model: "opus", effort: "high" },
  note: "Looks right.\n\nSecond paragraph.",
  handBack,
};

function fixture(): MemoryStorage {
  return new MemoryStorage({
    [MARKER_PATH]: '{ "format": 1 }\n',
    [collectionPath("eng")]: serializeCollection(collection),
    [credentialPath("eng", "review")]: serializeCredentialMd(cred("review", "Review")),
    [profilePath("claude-high")]: serializeProfile(profile),
    [assessmentPath("claude-high", "eng", "review", assessment.fileStem)]: serializeAssessment(assessment),
  });
}

describe("paths", () => {
  it("follows the Output Structure layout", () => {
    expect(MARKER_PATH).toBe("andamio-desktop.json");
    expect(collectionPath("eng")).toBe("collections/eng/collection.json");
    expect(credentialPath("eng", "review")).toBe("collections/eng/credentials/review.md");
    expect(profilePath("claude-high")).toBe("agents/claude-high.json");
    expect(assessmentPath("p", "c", "r", "20260929T084900Z")).toBe("assessments/p/c/r/20260929T084900Z.md");
  });

  it("makes a Windows-safe UTC file stem", () => {
    expect(fileStemFor(new Date("2026-09-29T08:49:00.123Z"))).toBe("20260929T084900Z");
  });
});

describe("collection and profile JSON", () => {
  it("round-trips a collection and a profile", () => {
    expect(parseCollection(serializeCollection(collection), "eng")).toEqual(collection);
    expect(parseProfile(serializeProfile(profile), "claude-high")).toEqual(profile);
  });

  it("fills missing optional fields with defaults", () => {
    expect(parseCollection('{"name":"X"}', "x")).toEqual({ slug: "x", name: "X", description: "", order: [], codes: {} });
    expect(parseProfile('{"name":"P"}', "p")).toEqual({
      slug: "p",
      name: "P",
      harness: "",
      model: "",
      effort: "",
      repo: "",
      notes: "",
      params: {},
    });
  });

  it("rejects a syntax error or a wrong type", () => {
    expect(() => parseProfile("{ nope", "p")).toThrow();
    expect(() => parseProfile('{"name": 3}', "p")).toThrow(/name/);
    expect(() => parseCollection('{"name":"X","order":"a"}', "x")).toThrow(/order/);
    expect(() => parseCollection('{"name":"X","codes":{"a":"1"}}', "x")).toThrow(/codes/);
    expect(() => parseCollection("[]", "x")).toThrow();
  });
});

describe("assessment Markdown", () => {
  it("round-trips result, version, snapshot, note and a hand-back with its own --- lines and headings", () => {
    const text = serializeAssessment(assessment);
    expect(text.startsWith("---\n")).toBe(true);
    const parsed = parseAssessment(text, {
      profileSlug: "claude-high",
      collectionSlug: "eng",
      credentialSlug: "review",
      fileStem: assessment.fileStem,
    });
    expect(parsed).toEqual(assessment);
    expect(parsed.handBack).toBe(handBack);
  });

  it("keeps hand-back edge whitespace verbatim", () => {
    const edgy = { ...assessment, handBack: "\n\n  indented start\n\n\n" };
    const text = serializeAssessment(edgy);
    expect(parseAssessment(text, edgy).handBack).toBe(edgy.handBack);
    const empty = { ...assessment, note: "", handBack: "" };
    expect(parseAssessment(serializeAssessment(empty), empty)).toEqual(empty);
  });

  it("rejects missing frontmatter or an invalid result", () => {
    expect(() => parseAssessment("## Note\n\nx\n", assessment)).toThrow(/frontmatter/);
    const bad = serializeAssessment(assessment).replace("result: met", "result: maybe");
    expect(() => parseAssessment(bad, assessment)).toThrow(/result/);
  });
});

describe("loadFolder", () => {
  it("loads every entity from a fixture folder with raw text", async () => {
    const storage = fixture();
    const state = await loadFolder(storage);
    expect(state.errors).toEqual([]);
    expect(state.collections).toEqual([collection]);
    expect(state.credentials).toEqual([cred("review", "Review")]);
    expect(state.profiles).toEqual([profile]);
    expect(state.assessments).toEqual([assessment]);
    for (const [path, text] of Object.entries(storage.files())) expect(state.raw[path]).toBe(text);
  });

  it("writes the marker into an empty folder", async () => {
    const storage = new MemoryStorage();
    const state = await loadFolder(storage);
    expect(JSON.parse(storage.file(MARKER_PATH)!)).toEqual({ format: 1 });
    expect(state).toMatchObject({ collections: [], credentials: [], profiles: [], assessments: [], errors: [] });
  });

  it("does not rewrite an existing marker", async () => {
    const storage = fixture();
    await loadFolder(storage);
    expect(storage.writes).toEqual([]);
  });

  it("ignores non-.md/.json files and temp files", async () => {
    const storage = fixture();
    storage.seed({
      "collections/eng/credentials/readme.txt": "hello",
      "collections/eng/credentials/.review.md.tmp": "# partial",
      "collections/eng/credentials/.hidden.md": "no H1",
      "collections/eng/credentials/draft.md~": "backup",
      "agents/.DS_Store": "x",
      "agents/p.json.tmp": "{",
    });
    const state = await loadFolder(storage);
    expect(state.errors).toEqual([]);
    expect(state.credentials.map((c) => c.slug)).toEqual(["review"]);
    expect(state.profiles.map((p) => p.slug)).toEqual(["claude-high"]);
  });

  it("Covers AE6. A profile JSON with a syntax error is reported by path, everything else loads, and the file is untouched", async () => {
    const storage = fixture();
    const broken = '{ "name": "Broken", ';
    storage.seed({ [profilePath("broken")]: broken });
    const state = await loadFolder(storage);
    expect(state.errors.map((e) => e.path)).toEqual([profilePath("broken")]);
    expect(state.errors[0].message).not.toBe("");
    expect(state.profiles.map((p) => p.slug)).toEqual(["claude-high"]);
    expect(state.collections).toHaveLength(1);
    expect(state.credentials).toHaveLength(1);
    expect(state.assessments).toHaveLength(1);
    expect(state.raw[profilePath("broken")]).toBeUndefined();
    expect(storage.file(profilePath("broken"))).toBe(broken);
    expect(storage.writes).toEqual([]);
  });

  it("reports a credential with no H1 by path and never rewrites it", async () => {
    const storage = fixture();
    const noH1 = "## Task\n\nNo title here.\n";
    const path = credentialPath("eng", "untitled");
    storage.seed({ [path]: noH1 });
    const state = await loadFolder(storage);
    expect(state.errors).toEqual([{ path, message: expect.stringMatching(/H1/) }]);
    expect(state.credentials.map((c) => c.slug)).toEqual(["review"]);
    expect(storage.file(path)).toBe(noH1);
    expect(storage.writes).toEqual([]);
  });

  it("reports unreadable collection and assessment files and keeps loading", async () => {
    const storage = fixture();
    storage.seed({
      [collectionPath("eng")]: "{ nope",
      [assessmentPath("claude-high", "eng", "review", "20260930T000000Z")]: "not frontmatter",
    });
    const state = await loadFolder(storage);
    expect(state.errors.map((e) => e.path).sort()).toEqual(
      [collectionPath("eng"), assessmentPath("claude-high", "eng", "review", "20260930T000000Z")].sort(),
    );
    expect(state.credentials.map((c) => c.slug)).toEqual(["review"]);
    expect(state.assessments).toHaveLength(1);
  });

  it("orders credentials by collection.json and appends missing ones by name", async () => {
    const storage = new MemoryStorage({
      [collectionPath("eng")]: serializeCollection({ ...collection, order: ["b", "gone", "a"], codes: { a: 1, b: 2 } }),
      [credentialPath("eng", "a")]: serializeCredentialMd(cred("a", "Alpha")),
      [credentialPath("eng", "b")]: serializeCredentialMd(cred("b", "Beta")),
      [credentialPath("eng", "z")]: serializeCredentialMd(cred("z", "Aardvark")),
      [credentialPath("eng", "y")]: serializeCredentialMd(cred("y", "Zebra")),
    });
    const state = await loadFolder(storage);
    expect(state.credentials.map((c) => c.slug)).toEqual(["b", "a", "z", "y"]);
    expect(state.collections[0].order).toEqual(["b", "a", "z", "y"]);
  });

  it("gives a credential missing from the code map the next unused code, kept after save", async () => {
    const storage = new MemoryStorage({
      [collectionPath("eng")]: serializeCollection({ ...collection, order: ["a", "b"], codes: { a: 1, retired: 2 } }),
      [credentialPath("eng", "a")]: serializeCredentialMd(cred("a", "Alpha")),
      [credentialPath("eng", "b")]: serializeCredentialMd(cred("b", "Beta")),
      [credentialPath("eng", "c")]: serializeCredentialMd(cred("c", "Gamma")),
    });
    const state = await loadFolder(storage);
    expect(state.collections[0].codes).toEqual({ a: 1, retired: 2, b: 3, c: 4 });
    expect(storage.writes.map((w) => w.path)).toEqual([MARKER_PATH]);

    await saveCollection(storage, state.collections[0], state.raw[collectionPath("eng")]);
    const again = await loadFolder(storage);
    expect(again.collections[0].codes).toEqual({ a: 1, retired: 2, b: 3, c: 4 });
  });

  it("starts module codes at 1", async () => {
    const storage = new MemoryStorage({
      [collectionPath("eng")]: '{"name":"Engineering"}',
      [credentialPath("eng", "a")]: serializeCredentialMd(cred("a", "Alpha")),
    });
    const state = await loadFolder(storage);
    expect(state.collections[0].codes).toEqual({ a: 1 });
  });
});

describe("saving", () => {
  it("keeps the original filename when a credential is renamed", async () => {
    const storage = fixture();
    const state = await loadFolder(storage);
    const path = credentialPath("eng", "review");
    await saveCredential(storage, { ...state.credentials[0], name: "Deep code review" }, state.raw[path]);
    expect(storage.file(path)).toMatch(/^# Deep code review\n/);
    expect(Object.keys(storage.files()).filter((p) => p.endsWith(".md") && p.includes("credentials"))).toEqual([path]);
  });

  it("keeps a hand-added section through load, task edit and save", async () => {
    const storage = fixture();
    const path = credentialPath("eng", "review");
    storage.seed({ [path]: storage.file(path) + "\n## Notes\n\nBy hand.\n" });
    const state = await loadFolder(storage);
    await saveCredential(storage, { ...state.credentials[0], task: "New task." }, state.raw[path]);
    const again = await loadFolder(storage);
    expect(again.credentials[0].task).toBe("New task.");
    expect(again.credentials[0].extraSections).toEqual([{ heading: "Notes", body: "By hand." }]);
  });

  it("refuses to save a credential changed on disk since load and leaves the disk version", async () => {
    const storage = fixture();
    const state = await loadFolder(storage);
    const path = credentialPath("eng", "review");
    const outside = storage.file(path) + "\nEdited elsewhere.\n";
    storage.seed({ [path]: outside });
    await expect(saveCredential(storage, { ...state.credentials[0], task: "Mine." }, state.raw[path])).rejects.toBeInstanceOf(
      ChangedOnDiskError,
    );
    await expect(saveCredential(storage, state.credentials[0], state.raw[path])).rejects.toThrow(/changed on disk/i);
    expect(storage.file(path)).toBe(outside);
    expect(storage.writes).toEqual([]);
  });

  it("keeps the opening base across a reload: a save from the older base still fails", async () => {
    const storage = fixture();
    const opened = await loadFolder(storage);
    const path = credentialPath("eng", "review");
    const base = opened.raw[path];
    storage.seed({ [path]: base.replace("Do Review.", "Do Review twice.") });
    const reloaded = await loadFolder(storage);
    expect(reloaded.raw[path]).not.toBe(base);
    await expect(saveCredential(storage, { ...opened.credentials[0], task: "Draft." }, base)).rejects.toBeInstanceOf(
      ChangedOnDiskError,
    );
    expect(storage.file(path)).toContain("Do Review twice.");
  });

  it("saveText with a null base refuses when the file already exists and writes when it does not", async () => {
    const storage = fixture();
    await expect(saveText(storage, profilePath("claude-high"), "{}", null)).rejects.toBeInstanceOf(ChangedOnDiskError);
    await saveText(storage, "agents/new.json", "{}\n", null);
    expect(storage.file("agents/new.json")).toBe("{}\n");
  });

  it("saveText refuses when a file with a base was deleted on disk", async () => {
    const storage = fixture();
    const path = profilePath("claude-high");
    const base = storage.file(path)!;
    storage.remove(path);
    await expect(saveText(storage, path, base, base)).rejects.toBeInstanceOf(ChangedOnDiskError);
    expect(storage.file(path)).toBeUndefined();
  });

  it("saves profiles and new assessments at their layout paths", async () => {
    const storage = new MemoryStorage();
    await saveProfile(storage, profile, null);
    await saveAssessment(storage, assessment);
    const state = await loadFolder(storage);
    expect(state.profiles).toEqual([profile]);
    expect(state.assessments).toEqual([assessment]);
    await expect(saveAssessment(storage, assessment)).rejects.toBeInstanceOf(ChangedOnDiskError);
  });
});
