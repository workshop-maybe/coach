import { describe, expect, it } from "vitest";
import { exportAll, exportMessage } from "./exportAll";
import { MemoryStorage } from "../storage/memory";
import { MARKER_PATH, collectionPath, credentialPath, loadFolder, serializeCollection } from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import type { Credential } from "../domain/types";

const review: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: ["I can find bugs in a diff."],
  task: "Review the attached diff.",
  rubric: "Secret rubric.",
  extraSections: [],
};
const writing: Credential = { ...review, slug: "essay", collectionSlug: "words", name: "Essay", task: "Write an essay." };

function seed(extra: Record<string, string> = {}): MemoryStorage {
  return new MemoryStorage({
    [MARKER_PATH]: '{ "format": 1 }\n',
    [collectionPath("eng")]: serializeCollection({ slug: "eng", name: "Engineering", description: "", order: ["review"], codes: { review: 1 } }),
    [credentialPath("eng", "review")]: serializeCredentialMd(review),
    [collectionPath("words")]: serializeCollection({ slug: "words", name: "Words", description: "", order: ["essay"], codes: { essay: 1 } }),
    [credentialPath("words", "essay")]: serializeCredentialMd(writing),
    ...extra,
  });
}

describe("exportAll", () => {
  it("writes every collection, with badges and without the rubric", async () => {
    const storage = seed();
    const result = await exportAll(storage, await loadFolder(storage));
    const out = storage.files("export");
    expect(Object.keys(out).sort()).toEqual([
      "eng.json",
      "eng/1/assignment.md",
      "eng/1/badge.svg",
      "eng/1/outline.md",
      "words.json",
      "words/1/assignment.md",
      "words/1/badge.svg",
      "words/1/outline.md",
    ]);
    expect(out["eng.json"]).not.toContain("Secret rubric.");
    expect(out["eng/1/assignment.md"]).not.toContain("Secret rubric.");
    expect(result.files).toBe(8);
    expect(result.skipped).toEqual([]);
    expect(result.withoutArt).toBe(0);
  });

  it("saves module codes that exist only in memory before exporting", async () => {
    // A credential file with no entry in its collection's order or codes.
    const storage = seed({ [credentialPath("eng", "extra")]: serializeCredentialMd({ ...review, slug: "extra", name: "Extra" }) });
    const result = await exportAll(storage, await loadFolder(storage));
    expect(storage.file(collectionPath("eng"))).toContain('"extra"');
    expect(storage.files("export")["eng/2/outline.md"]).toBeTruthy();
    expect(result.state.collections.find((c) => c.slug === "eng")?.codes.extra).toBe(2);
  });

  it("skips a collection whose file could not be read, and exports the rest", async () => {
    const storage = seed({ [collectionPath("words")]: "{ broken" });
    const result = await exportAll(storage, await loadFolder(storage));
    expect(result.skipped).toEqual([collectionPath("words")]);
    expect(Object.keys(storage.files("export")).some((p) => p.startsWith("words"))).toBe(false);
    expect(storage.files("export")["eng.json"]).toBeTruthy();
    expect(storage.file(collectionPath("words"))).toBe("{ broken");
  });

  it("counts badges exported without their art", async () => {
    const storage = seed({
      [collectionPath("eng")]: serializeCollection({
        slug: "eng",
        name: "Engineering",
        description: "",
        order: ["review"],
        codes: { review: 1 },
        badge: { art: "collections/eng/badge/missing.png" },
      }),
    });
    const result = await exportAll(storage, await loadFolder(storage));
    expect(result.withoutArt).toBe(1);
  });
});

describe("exportMessage", () => {
  it("reports files, art-less badges and skipped collections", () => {
    expect(exportMessage({ files: 1, withoutArt: 0, skipped: [] }, "/out")).toBe("Exported 1 file to /out.");
    expect(exportMessage({ files: 4, withoutArt: 2, skipped: ["collections/w/collection.json"] }, "/out")).toBe(
      "Exported 4 files to /out. 2 badges were exported without art because the image could not be read. Skipped collections/w/collection.json because it could not be read.",
    );
  });
});
