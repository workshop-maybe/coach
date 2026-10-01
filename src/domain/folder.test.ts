import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory";
import { ChangedOnDiskError } from "../storage/storage";
import { serializeCredentialMd } from "./credential-md";
import {
  isCredentialResult,
  MARKER_PATH,
  assessmentPath,
  collectionPath,
  credentialPath,
  fileStemFor,
  handoffPath,
  handoffsDir,
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
  SKELETON_PATH,
  serializeAssessment,
  serializeCollection,
  serializeProfile,
} from "./folder";
import { buildExport } from "./export";
import { reorderCredentials } from "./operations";
import { resolveBadgeSettings } from "../badge/settings";
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

  const context = {
    machineId: "a1b2c3d4e5f60718",
    machine: "Studio Mac",
    memory: "0123456789ab",
    capturedAt: "2026-09-29T08:40:00.000Z",
  };

  it("round-trips the context a test started with", () => {
    const withContext = { ...assessment, context };
    const text = serializeAssessment(withContext);
    expect(text).toContain("context:");
    expect(text).toContain("machine_id: a1b2c3d4e5f60718");
    expect(parseAssessment(text, withContext)).toEqual(withContext);
  });

  it("writes a result without context exactly as before", () => {
    const text = serializeAssessment(assessment);
    expect(text).not.toContain("context");
    expect(parseAssessment(text, assessment)).not.toHaveProperty("context");
  });

  it("reads a malformed context as none instead of failing the file", () => {
    const text = serializeAssessment({ ...assessment, context });
    const asString = text.replace(/context:\n(?:  .*\n)+/, "context: nonsense\n");
    expect(asString).toContain("context: nonsense");
    expect(parseAssessment(asString, assessment)).not.toHaveProperty("context");
    const missingKey = text.replace(/  memory: .*\n/, "");
    expect(parseAssessment(missingKey, assessment)).not.toHaveProperty("context");
    const wrongType = text.replace(/  machine: .*\n/, "  machine: [1, 2]\n");
    expect(parseAssessment(wrongType, assessment)).not.toHaveProperty("context");
  });

  const handoff = {
    id: "20261001T090000Z",
    text: ["Hi.", "---", "## Note", "", "Not a note.", "", "## Handback", "", "  indented", "trailing  ", ""].join("\n"),
  };

  it("round-trips the handoff a result ran with, even when its text holds ---, ## Note and ## Handback lines", () => {
    const withHandoff = { ...assessment, handoff };
    const text = serializeAssessment(withHandoff);
    expect(text).toContain("handoff:");
    expect(text).toContain("id: 20261001T090000Z");
    const parsed = parseAssessment(text, withHandoff);
    expect(parsed).toEqual(withHandoff);
    expect(parsed.note).toBe(assessment.note);
    expect(parsed.handBack).toBe(handBack);
  });

  it("round-trips handoff text with edge whitespace, carriage returns and no final newline", () => {
    for (const t of ["\n  lead\n", "a\n\n\n", "a\r\nb\tc", "no newline end", "--- at the start\n---\n", ""]) {
      const withHandoff = { ...assessment, handoff: { id: "skeleton", text: t } };
      expect(parseAssessment(serializeAssessment(withHandoff), withHandoff).handoff).toEqual({ id: "skeleton", text: t });
    }
  });

  it("writes a result without a handoff byte for byte as before", () => {
    const plain: Assessment = { ...assessment, note: "Fine.", handBack: "Done.\n---\n" };
    expect(serializeAssessment(plain)).toBe(
      [
        "---",
        "result: met",
        "recorded_at: 2026-09-29T08:49:00.123Z",
        'assignment_version: "12e456789012"',
        "setup:",
        "  harness: claude-code",
        "  model: opus",
        "  effort: high",
        "---",
        "",
        "## Note",
        "",
        "Fine.",
        "",
        "## Handback",
        "",
        "Done.",
        "---",
        "",
        "",
      ].join("\n"),
    );
    expect(parseAssessment(serializeAssessment(plain), plain)).not.toHaveProperty("handoff");
  });

  it("reads a handoff id YAML takes as a number as text", () => {
    const text = serializeAssessment({ ...assessment, handoff: { id: "x", text: "hi" } }).replace("  id: x\n", "  id: 20261001\n");
    expect(parseAssessment(text, assessment).handoff).toEqual({ id: "20261001", text: "hi" });
  });

  it("reads a malformed handoff as none instead of failing the file", () => {
    const text = serializeAssessment({ ...assessment, handoff });
    const asString = text.replace(/handoff:\n(?:  .*\n|\n)+?(?=---\n)/, "handoff: nonsense\n");
    expect(asString).toContain("handoff: nonsense\n---\n");
    expect(parseAssessment(asString, assessment)).not.toHaveProperty("handoff");
    const plain = serializeAssessment({ ...assessment, handoff: { id: "x", text: "hi" } });
    expect(parseAssessment(plain.replace("  id: x\n", ""), assessment)).not.toHaveProperty("handoff");
    expect(parseAssessment(plain.replace("  id: x\n", '  id: ""\n'), assessment)).not.toHaveProperty("handoff");
    expect(parseAssessment(plain.replace("  id: x\n", "  id: [1, 2]\n"), assessment)).not.toHaveProperty("handoff");
    expect(parseAssessment(plain.replace("  text: hi\n", ""), assessment)).not.toHaveProperty("handoff");
    expect(parseAssessment(plain.replace("  text: hi\n", "  text: { a: 1 }\n"), assessment)).not.toHaveProperty("handoff");
    expect(parseAssessment(plain.replace(/handoff:\n.*\n.*\n/, "handoff: [x, hi]\n"), assessment)).not.toHaveProperty("handoff");
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

describe("badge settings in collection.json", () => {
  const badged: Collection = {
    ...collection,
    order: ["review", "testing"],
    codes: { review: 1, testing: 2 },
    badge: {
      palette: "pine-gold",
      colors: { ring: "#112233", innerRing: "#445566" },
      art: "collections/eng/badge/art-1234abcd.png",
      title: { eyebrow: "ENG" },
    },
    badgeOverrides: { testing: { palette: "teal-ice", art: null, title: { main: "Tester" } } },
  };

  function badgedFolder(text: string): MemoryStorage {
    return new MemoryStorage({
      [MARKER_PATH]: '{ "format": 1 }\n',
      [collectionPath("eng")]: text,
      [credentialPath("eng", "review")]: serializeCredentialMd(cred("review", "Review")),
      [credentialPath("eng", "testing")]: serializeCredentialMd(cred("testing", "Testing")),
    });
  }

  it("a collection.json without badge fields loads and serializes exactly as before", async () => {
    const text = '{\n  "name": "Engineering",\n  "description": "Core skills.",\n  "order": [\n    "review"\n  ],\n  "codes": {\n    "review": 1\n  }\n}\n';
    expect(serializeCollection(collection)).toBe(text);
    const parsed = parseCollection(text, "eng");
    expect(Object.keys(parsed).sort()).toEqual(["codes", "description", "name", "order", "slug"]);
    expect(serializeCollection(parsed)).toBe(text);
    const state = await loadFolder(fixture());
    expect(state.warnings).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  it("the badge fields survive a save and reload round trip", async () => {
    const text = serializeCollection(badged);
    expect(JSON.parse(text)).toMatchObject({ badge: badged.badge, badgeOverrides: badged.badgeOverrides });
    expect(parseCollection(text, "eng")).toEqual(badged);

    const storage = badgedFolder(text);
    const state = await loadFolder(storage);
    expect(state.warnings).toEqual([]);
    expect(state.collections[0]).toEqual(badged);
    await saveCollection(storage, state.collections[0], state.raw[collectionPath("eng")]);
    expect(storage.file(collectionPath("eng"))).toBe(text);
  });

  it("a malformed badge is a warning, renders with defaults, survives a reorder save byte for byte, and export still runs", async () => {
    const text = [
      "{",
      '  "name": "Engineering",',
      '  "description": "Core skills.",',
      '  "order": [',
      '    "review",',
      '    "testing"',
      "  ],",
      '  "codes": {',
      '    "review": 1,',
      '    "testing": 2',
      "  },",
      '  "badge": {',
      '    "palette": 7,',
      '    "colors": "loud"',
      "  }",
      "}",
      "",
    ].join("\n");
    const storage = badgedFolder(text);
    const state = await loadFolder(storage);
    expect(state.errors).toEqual([]);
    expect(state.warnings).toEqual([{ path: collectionPath("eng"), message: expect.stringMatching(/badge/) }]);
    expect(state.collections[0].badge).toBeUndefined();
    expect(resolveBadgeSettings(state.collections[0], "review")).toEqual({ palette: null, colors: null, art: null, title: {} });

    const next = await reorderCredentials(storage, state, "eng", ["testing", "review"], state.raw[collectionPath("eng")]);
    const expected = text.replace('    "review",\n    "testing"\n', '    "testing",\n    "review"\n');
    expect(storage.file(collectionPath("eng"))).toBe(expected);
    expect(next.warnings).toHaveLength(1);
    expect(next.errors).toEqual([]);

    const files = buildExport(next.collections[0], next.credentials, { includeRubric: false });
    expect(files.size).toBeGreaterThan(0);
  });

  it("keeps a whole malformed badgeOverrides value and malformed entries raw, with a warning each", async () => {
    const whole = { name: "Engineering", description: "", order: [], codes: {}, badgeOverrides: ["nope"] };
    const wholeText = `${JSON.stringify(whole, null, 2)}\n`;
    const parsedWhole = parseCollection(wholeText, "eng");
    expect(parsedWhole.badgeOverrides).toBeUndefined();
    expect(serializeCollection(parsedWhole)).toBe(wholeText);

    const entries = {
      name: "Engineering",
      description: "",
      order: ["review", "testing"],
      codes: { review: 1, testing: 2 },
      badgeOverrides: { review: { palette: "teal-ice" }, testing: { title: "bad" } },
    };
    const entriesText = `${JSON.stringify(entries, null, 2)}\n`;
    const storage = badgedFolder(entriesText);
    const state = await loadFolder(storage);
    expect(state.errors).toEqual([]);
    expect(state.warnings).toEqual([
      { path: collectionPath("eng"), message: expect.stringMatching(/badgeOverrides\.testing/) },
    ]);
    expect(state.collections[0].badgeOverrides).toEqual({ review: { palette: "teal-ice" } });
    expect(resolveBadgeSettings(state.collections[0], "testing").title).toEqual({});
    await saveCollection(storage, state.collections[0], state.raw[collectionPath("eng")]);
    expect(storage.file(collectionPath("eng"))).toBe(entriesText);
  });

  it("a palette-only override does not inherit the collection's custom colors after a load", async () => {
    const state = await loadFolder(badgedFolder(serializeCollection(badged)));
    expect(resolveBadgeSettings(state.collections[0], "review")).toMatchObject({ palette: "pine-gold", colors: { ring: "#112233" } });
    expect(resolveBadgeSettings(state.collections[0], "testing")).toEqual({
      palette: "teal-ice",
      colors: null,
      art: null,
      title: { main: "Tester", eyebrow: "ENG" },
    });
  });

  it("Covers AE2. A collection palette change saves while the override stays", async () => {
    const start: Collection = { ...collection, order: ["review", "testing"], codes: { review: 1, testing: 2 }, badge: { palette: "pine-gold" }, badgeOverrides: { testing: { palette: "teal-ice" } } };
    const storage = badgedFolder(serializeCollection(start));
    const state = await loadFolder(storage);
    await saveCollection(storage, { ...state.collections[0], badge: { palette: "wine-crimson" } }, state.raw[collectionPath("eng")]);
    const again = await loadFolder(storage);
    expect(resolveBadgeSettings(again.collections[0], "review").palette).toBe("wine-crimson");
    expect(resolveBadgeSettings(again.collections[0], "testing").palette).toBe("teal-ice");
  });

  it("Covers AE3. Clearing the override saves and falls back to the collection palette", async () => {
    const start: Collection = { ...collection, order: ["review", "testing"], codes: { review: 1, testing: 2 }, badge: { palette: "wine-crimson" }, badgeOverrides: { testing: { palette: "teal-ice" } } };
    const storage = badgedFolder(serializeCollection(start));
    const state = await loadFolder(storage);
    await saveCollection(storage, { ...state.collections[0], badgeOverrides: {} }, state.raw[collectionPath("eng")]);
    const again = await loadFolder(storage);
    expect(resolveBadgeSettings(again.collections[0], "testing").palette).toBe("wine-crimson");
  });
});

describe("isCredentialResult", () => {
  it("matches any agent's result files for exactly that credential", () => {
    expect(isCredentialResult("assessments/opus/eng/review/20260930T000000Z.md", "eng", "review")).toBe(true);
    expect(isCredentialResult("assessments/other/eng/review/notes.txt", "eng", "review")).toBe(true);
    expect(isCredentialResult("assessments/opus/eng/review-2/20260930T000000Z.md", "eng", "review")).toBe(false);
    expect(isCredentialResult("assessments/opus/ops/review/20260930T000000Z.md", "eng", "review")).toBe(false);
    expect(isCredentialResult("assessments/opus/eng/review", "eng", "review")).toBe(false);
    expect(isCredentialResult("trash/x/eng/review/a.md", "eng", "review")).toBe(false);
  });
});

describe("handoff files", () => {
  const skeletonText = "# {{name}}\n\n{{task}}\n";

  it("puts the skeleton and a badge's handoffs at their layout paths (KTD1)", () => {
    expect(SKELETON_PATH).toBe("handoffs/skeleton.md");
    expect(handoffsDir("eng", "review")).toBe("collections/eng/handoffs/review");
    expect(handoffPath("eng", "review", "20260929T084900Z")).toBe("collections/eng/handoffs/review/20260929T084900Z.md");
  });

  it("a folder from before handoffs loads as before, with no skeleton file and no handoffs, and writes nothing", async () => {
    const storage = fixture();
    const state = await loadFolder(storage);
    expect(state.errors).toEqual([]);
    expect(state.skeleton).toBeNull();
    expect(state.handoffs).toEqual([]);
    expect(storage.writes).toEqual([]);
  });

  it("loads the skeleton text and each badge's handoffs verbatim, oldest first, with raw text", async () => {
    const storage = fixture();
    const newer = "# Newer\n\n{{task}}\n\n---\n\n## Handback\n";
    const older = "Older {{task}}";
    storage.seed({
      [SKELETON_PATH]: skeletonText,
      [handoffPath("eng", "review", "20261001T090000Z")]: newer,
      [handoffPath("eng", "review", "20260930T090000Z")]: older,
    });
    const state = await loadFolder(storage);
    expect(state.errors).toEqual([]);
    expect(state.skeleton).toBe(skeletonText);
    expect(state.handoffs).toEqual([
      { collectionSlug: "eng", credentialSlug: "review", id: "20260930T090000Z", text: older },
      { collectionSlug: "eng", credentialSlug: "review", id: "20261001T090000Z", text: newer },
    ]);
    expect(state.raw[SKELETON_PATH]).toBe(skeletonText);
    expect(state.raw[handoffPath("eng", "review", "20261001T090000Z")]).toBe(newer);
    expect(state.credentials.map((c) => c.slug)).toEqual(["review"]);
    expect(storage.writes).toEqual([]);
  });

  it("ignores editor temp files and anything else in a handoffs folder", async () => {
    const storage = fixture();
    storage.seed({
      [handoffPath("eng", "review", "20260930T090000Z")]: "{{task}}",
      "collections/eng/handoffs/review/.20260930T090000Z.md.swp": "x",
      "collections/eng/handoffs/review/20260930T090000Z.md~": "x",
      "collections/eng/handoffs/review/20260930T090000Z.md.tmp-1": "x",
      "collections/eng/handoffs/review/notes.txt": "x",
      "collections/eng/handoffs/.hidden/20260930T090000Z.md": "x",
      "handoffs/.skeleton.md.swp": "x",
    });
    const state = await loadFolder(storage);
    expect(state.errors).toEqual([]);
    expect(state.skeleton).toBeNull();
    expect(state.handoffs.map((h) => h.id)).toEqual(["20260930T090000Z"]);
  });

  it("reports an unreadable skeleton or handoff by path, keeps loading, and never rewrites it", async () => {
    const storage = fixture();
    const bad = handoffPath("eng", "review", "20260930T090000Z");
    storage.seed({ [SKELETON_PATH]: skeletonText, [bad]: "{{task}}", [handoffPath("eng", "review", "20261001T090000Z")]: "ok {{task}}" });
    const failing = Object.create(storage) as MemoryStorage;
    failing.readText = async (root, path) => {
      if (path === bad || path === SKELETON_PATH) throw new Error("stream did not contain valid UTF-8");
      return storage.readText(root, path);
    };
    const state = await loadFolder(failing);
    expect(state.errors.map((e) => e.path).sort()).toEqual([bad, SKELETON_PATH].sort());
    expect(state.skeleton).toBeNull();
    expect(state.handoffs.map((h) => h.id)).toEqual(["20261001T090000Z"]);
    expect(state.raw[bad]).toBeUndefined();
    expect(state.credentials.map((c) => c.slug)).toEqual(["review"]);
    expect(storage.writes).toEqual([]);
  });
});
