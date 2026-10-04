import { describe, expect, it } from "vitest";
import { exportAll, exportMessage } from "./exportAll";
import { MemoryStorage } from "../storage/memory";
import { MARKER_PATH, collectionPath, credentialPath, loadFolder, serializeCollection } from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import { bytesToBase64 } from "../domain/images";
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

describe("exportAll task images", () => {
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const PNG = `data:image/png;base64,${bytesToBase64(PNG_BYTES)}`;
  const credentials = "collections/eng/credentials";
  const TEXT_FILES = [
    "eng.json",
    "eng/1/assignment.md",
    "eng/1/badge.svg",
    "eng/1/outline.md",
    "words.json",
    "words/1/assignment.md",
    "words/1/badge.svg",
    "words/1/outline.md",
  ];

  function withTask(task: string, rubric = review.rubric): MemoryStorage {
    return seed({ [credentialPath("eng", "review")]: serializeCredentialMd({ ...review, task, rubric }) });
  }

  async function exported(storage: MemoryStorage) {
    const result = await exportAll(storage, await loadFolder(storage));
    const md = storage.file("eng/1/assignment.md", "export") ?? "";
    const json = JSON.parse(storage.file("eng.json", "export") ?? "{}") as { course: { modules: { assignment: { content: string } }[] } };
    return { result, md, content: json.course.modules[0].assignment.content };
  }

  it("copies an app-pasted image into the module's assets folder under the same name", async () => {
    // The name the app gave the image when it was pasted: content-addressed, so it comes back unchanged.
    const name = await new MemoryStorage().saveImage("data", "", PNG_BYTES);
    const storage = withTask(`Look at this.\n\n![a diff](${name})`);
    storage.seedImage(`${credentials}/${name}`, PNG);
    const { result, md, content } = await exported(storage);
    expect(storage.image(`eng/1/assets/${name}`, "export")).toBe(PNG);
    expect(await storage.listFiles("export", "")).toEqual([...TEXT_FILES, `eng/1/assets/${name}`].sort());
    expect(md).toContain(`![a diff](assets/${name})`);
    expect(content).toBe(`Look at this.\n\n![a diff](assets/${name})`);
    expect(result.files).toBe(9);
    expect(result.imagesNotCopied).toEqual([]);
  });

  it("copies a hand-placed image under its content-addressed name", async () => {
    const storage = withTask("![](photo.png)");
    storage.seedImage(`${credentials}/photo.png`, PNG);
    const { md, content } = await exported(storage);
    const copied = await storage.listFiles("export", "eng/1/assets");
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatch(/^eng\/1\/assets\/image-[0-9a-f]{8}\.png$/);
    expect(storage.image(copied[0], "export")).toBe(PNG);
    const ref = copied[0].slice("eng/1/".length);
    expect(md).toContain(`![](${ref})`);
    expect(content).toBe(`![](${ref})`);
    expect(md).not.toContain("photo.png");
  });

  it("leaves a missing image's ref as written and names it", async () => {
    const storage = withTask("![](gone.png)");
    const { result, md, content } = await exported(storage);
    expect(md).toContain("![](gone.png)");
    expect(content).toBe("![](gone.png)");
    expect(await storage.listFiles("export", "eng/1/assets")).toEqual([]);
    expect(result.imagesNotCopied).toEqual([`${credentials}/gone.png`]);
    expect(result.files).toBe(8);
    expect(exportMessage(result, "/out")).toContain(`1 image could not be copied: ${credentials}/gone.png.`);
  });

  it("leaves an unreadable image's ref as written, names it once and still exports", async () => {
    const storage = seed({
      [credentialPath("eng", "review")]: serializeCredentialMd({ ...review, task: "![](photo.png)" }),
      [credentialPath("eng", "extra")]: serializeCredentialMd({ ...review, slug: "extra", name: "Extra", task: "![](photo.png)" }),
      [`${credentials}/photo.png`]: "not an image",
    });
    const { result, md, content } = await exported(storage);
    expect(md).toContain("![](photo.png)");
    expect(content).toBe("![](photo.png)");
    expect(storage.file("eng/2/assignment.md", "export")).toContain("![](photo.png)");
    expect(result.imagesNotCopied).toEqual([`${credentials}/photo.png`]);
  });

  it("leaves a remote image alone and copies nothing, nor any image in the rubric", async () => {
    const storage = withTask("![](https://example.com/p.png)", "![](secret.png)");
    storage.seedImage(`${credentials}/secret.png`, PNG);
    const { result, md, content } = await exported(storage);
    expect(md).toContain("![](https://example.com/p.png)");
    expect(content).toBe("![](https://example.com/p.png)");
    expect(await storage.listFiles("export", "")).toEqual(TEXT_FILES);
    expect(result.imagesNotCopied).toEqual([]);
  });
});

describe("exportMessage", () => {
  it("reports files, art-less badges, uncopied images and skipped collections", () => {
    expect(exportMessage({ files: 1, withoutArt: 0, imagesNotCopied: [], skipped: [] }, "/out")).toBe("Exported 1 file to /out.");
    expect(exportMessage({ files: 4, withoutArt: 2, imagesNotCopied: [], skipped: ["collections/w/collection.json"] }, "/out")).toBe(
      "Exported 4 files to /out. 2 badges were exported without art because the image could not be read. Skipped collections/w/collection.json because it could not be read.",
    );
    expect(
      exportMessage({ files: 3, withoutArt: 0, imagesNotCopied: ["collections/e/credentials/a.png", "collections/e/credentials/b.png"], skipped: [] }, "/out"),
    ).toBe("Exported 3 files to /out. 2 images could not be copied: collections/e/credentials/a.png, collections/e/credentials/b.png.");
    expect(exportMessage({ files: 2, withoutArt: 1, imagesNotCopied: ["collections/e/credentials/a.png"], skipped: ["collections/w/collection.json"] }, "/out")).toBe(
      "Exported 2 files to /out. 1 badge was exported without art because the image could not be read. 1 image could not be copied: collections/e/credentials/a.png. Skipped collections/w/collection.json because it could not be read.",
    );
  });
});
