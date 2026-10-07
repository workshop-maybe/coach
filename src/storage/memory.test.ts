import { describe, expect, it } from "vitest";
import { IMAGE_TOO_LARGE } from "../domain/images";
import { FILE_NOT_APPROVED, ONLY_VIDEOS_AND_IMAGES, VIDEO_MAX_BYTES, VIDEO_TOO_LARGE, alreadyNamed } from "../domain/videos";
import {
  FILE_MAX_BYTES,
  FILE_TOO_LARGE,
  ITEM_MISSING,
  ITEM_TEXT_MAX_BYTES,
  ITEM_TEXT_TOO_LARGE,
  NOT_AN_ITEM,
  NOT_IN_FOLDER,
  NOT_TEXT,
  isFileItemName,
} from "../domain/files";
import { mkvBytes, movBytes, mp4Bytes, webmBytes } from "../test/videoBytes";
import { MemoryStorage } from "./memory";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const JPEG = "data:image/jpeg;base64,/9j/4AA=";

describe("MemoryStorage badge art", () => {
  it("returns null when no art is queued, as a cancelled picker would", async () => {
    const s = new MemoryStorage();
    expect(await s.importBadgeArt("engineering", null)).toBeNull();
  });

  it("imports queued art under a content-addressed collection path", async () => {
    const s = new MemoryStorage();
    s.queueArt(PNG);
    const path = await s.importBadgeArt("engineering", null);
    expect(path).toMatch(/^collections\/engineering\/badge\/art-[0-9a-f]{8}\.png$/);
    expect(await s.readDataUri("data", path!)).toBe(PNG);
    expect(await s.listFiles("data", "collections/engineering")).toEqual([path]);
    expect(s.writes).toEqual([{ root: "data", path }]);
  });

  it("names a credential override after the credential and keeps the jpg extension", async () => {
    const s = new MemoryStorage();
    s.queueArt(JPEG);
    s.queueArt(PNG);
    const a = await s.importBadgeArt("engineering", "code-review");
    const b = await s.importBadgeArt("engineering", "code-review");
    expect(a).toMatch(/^collections\/engineering\/badge\/code-review-[0-9a-f]{8}\.jpg$/);
    expect(b).toMatch(/\.png$/);
    expect(a).not.toBe(b);
  });

  it("queues a cancel with null, and rejects unsafe slugs", async () => {
    const s = new MemoryStorage();
    s.queueArt(null);
    expect(await s.importBadgeArt("engineering", null)).toBeNull();
    s.queueArt(PNG);
    await expect(s.importBadgeArt("../x", null)).rejects.toThrow();
  });

  it("reads seeded images and returns null for missing or text files", async () => {
    const s = new MemoryStorage({ "notes.md": "hi" });
    s.seedImage("collections/c/badge/art-00000000.png", PNG);
    expect(await s.readDataUri("data", "collections/c/badge/art-00000000.png")).toBe(PNG);
    expect(await s.readDataUri("data", "missing.png")).toBeNull();
    await expect(s.readDataUri("data", "notes.md")).rejects.toThrow();
    expect(await s.readDataUri("export", "collections/c/badge/art-00000000.png")).toBeNull();
    expect(await s.readText("data", "notes.md")).toBe("hi");
  });
});

describe("MemoryStorage pasted images", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5]);

  it("saves a PNG under a content-addressed name in the folder, readable as a data URI", async () => {
    const s = new MemoryStorage();
    const path = await s.saveImage("data", "collections/c/credentials", png);
    expect(path).toMatch(/^collections\/c\/credentials\/image-[0-9a-f]{8}\.png$/);
    expect(await s.readDataUri("data", path)).toMatch(/^data:image\/png;base64,/);
    expect(await s.listFiles("data", "collections/c")).toEqual([path]);
    expect(s.writes).toEqual([{ root: "data", path }]);
  });

  it("names a JPEG .jpg, and saves at the root for an empty folder", async () => {
    const s = new MemoryStorage();
    expect(await s.saveImage("data", "", jpeg)).toMatch(/^image-[0-9a-f]{8}\.jpg$/);
  });

  it("writes the same bytes once", async () => {
    const s = new MemoryStorage();
    const a = await s.saveImage("data", "agents", png);
    const b = await s.saveImage("data", "agents", png);
    expect(b).toBe(a);
    expect(s.writes).toHaveLength(1);
  });

  it("refuses a different image already at the name", async () => {
    const s = new MemoryStorage();
    const path = await s.saveImage("data", "agents", png);
    s.seedImage(path, "data:image/png;base64,AAAA");
    await expect(s.saveImage("data", "agents", png)).rejects.toThrow(/already named/);
    expect(s.image(path)).toBe("data:image/png;base64,AAAA");
  });

  it("refuses bytes that are not a PNG or JPEG, and images over 10 MB", async () => {
    const s = new MemoryStorage();
    await expect(s.saveImage("data", "agents", new TextEncoder().encode("GIF89a"))).rejects.toThrow("That file is not a JPEG or PNG image.");
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(png);
    await expect(s.saveImage("data", "agents", big)).rejects.toThrow("That image is larger than 10 MB.");
    expect(s.writes).toEqual([]);
  });

  it("saves into the export root only when asked", async () => {
    const s = new MemoryStorage();
    const path = await s.saveImage("export", "c/101/assets", png);
    expect(await s.readDataUri("export", path)).toMatch(/^data:image\/png;base64,/);
    expect(await s.readDataUri("data", path)).toBeNull();
  });
});

describe("MemoryStorage context", () => {
  it("returns a fixed reading when none is queued", async () => {
    const s = new MemoryStorage();
    expect(await s.readContext("/repo", "claude-code")).toEqual({
      machineId: "test-machine",
      machine: "Test Mac",
      memory: "000000000000",
    });
  });

  it("returns queued readings in order, then the default again", async () => {
    const s = new MemoryStorage();
    s.queueContext({ machineId: "m2", machine: "Studio Mac", memory: "abcdefabcdef" });
    expect((await s.readContext("/repo", "claude-code")).machine).toBe("Studio Mac");
    expect((await s.readContext("/repo", "claude-code")).machine).toBe("Test Mac");
  });

  it("rejects when an error is queued, as a failed native read would", async () => {
    const s = new MemoryStorage();
    s.queueContext(new Error("boom"));
    await expect(s.readContext("/repo", "claude-code")).rejects.toThrow("boom");
  });
});

describe("MemoryStorage videos (KTD5, KTD6)", () => {
  const DIR = "collections/c/credentials";
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("adds a queued video under a content-addressed name in the folder, with its extension lowercased", async () => {
    const s = new MemoryStorage();
    s.queueAdd([{ name: "Clip 1.MOV", bytes: movBytes("a") }]);
    const [added] = await s.addFiles(DIR, { kind: "pick" });
    expect(added).toEqual({ name: "Clip 1.MOV", path: expect.stringMatching(/^collections\/c\/credentials\/video-[0-9a-f]{8}\.mov$/), kind: "video", error: null });
    expect(s.video(added.path!)).toEqual(movBytes("a"));
    expect(await s.listFiles("data", "collections/c")).toEqual([added.path]);
    expect(s.writes).toEqual([{ root: "data", path: added.path }]);
    expect(s.adds).toEqual([{ dir: DIR, from: { kind: "pick" } }]);
  });

  it("returns nothing when no add is queued, as a cancelled picker would", async () => {
    const s = new MemoryStorage();
    expect(await s.addFiles(DIR, { kind: "pick" })).toEqual([]);
    s.queueAdd([]);
    expect(await s.addFiles(DIR, { kind: "pick" })).toEqual([]);
  });

  it("reports per file, in order: a video, a refused MKV, a picture and a refusal the native side made", async () => {
    const s = new MemoryStorage();
    s.queueAdd([
      { name: "a.mp4", bytes: mp4Bytes("a") },
      { name: "b.mkv", bytes: mkvBytes() },
      { name: "shot.png", bytes: png },
      { name: "far.mov", error: FILE_NOT_APPROVED },
    ]);
    const from = { kind: "drop" as const, paths: ["/x/a.mp4", "/x/b.mkv", "/x/shot.png", "/x/far.mov"] };
    const results = await s.addFiles(DIR, from);
    expect(results.map((r) => r.name)).toEqual(["a.mp4", "b.mkv", "shot.png", "far.mov"]);
    expect(results[0].path).toMatch(/^collections\/c\/credentials\/video-[0-9a-f]{8}\.mp4$/);
    expect(results[1]).toEqual({ name: "b.mkv", path: null, kind: null, error: ONLY_VIDEOS_AND_IMAGES });
    expect(results[2].path).toMatch(/^collections\/c\/credentials\/image-[0-9a-f]{8}\.png$/);
    expect(await s.readDataUri("data", results[2].path!)).toMatch(/^data:image\/png;base64,/);
    expect(results[3]).toEqual({ name: "far.mov", path: null, kind: null, error: FILE_NOT_APPROVED });
    expect(s.adds).toEqual([{ dir: DIR, from }]);
  });

  it("writes the same bytes once, and gives one path", async () => {
    const s = new MemoryStorage();
    s.queueAdd([{ name: "a.mp4", bytes: mp4Bytes("same") }, { name: "copy of a.mp4", bytes: mp4Bytes("same") }]);
    const [a, b] = await s.addFiles(DIR, { kind: "pick" });
    expect(b.path).toBe(a.path);
    expect(s.writes).toHaveLength(1);
  });

  it("names different bytes differently", async () => {
    const s = new MemoryStorage();
    s.queueAdd([{ name: "a.mp4", bytes: mp4Bytes("one") }, { name: "b.mp4", bytes: mp4Bytes("two") }]);
    const [a, b] = await s.addFiles(DIR, { kind: "pick" });
    expect(a.path).not.toBe(b.path);
  });

  it("refuses a different file already at the name, and leaves it", async () => {
    const s = new MemoryStorage();
    s.queueAdd([{ name: "a.webm", bytes: webmBytes("x") }]);
    const [first] = await s.addFiles(DIR, { kind: "pick" });
    s.seedVideo(first.path!, webmBytes("other"));
    s.queueAdd([{ name: "a.webm", bytes: webmBytes("x") }]);
    const [again] = await s.addFiles(DIR, { kind: "pick" });
    const name = first.path!.slice(DIR.length + 1);
    expect(again).toEqual({ name: "a.webm", path: null, kind: null, error: alreadyNamed(name) });
    expect(s.video(first.path!)).toEqual(webmBytes("other"));
  });

  it("sorts by content: a family that disagrees with the extension, matroska, and junk are refused", async () => {
    const s = new MemoryStorage();
    s.queueAdd([
      { name: "a.mp4", bytes: webmBytes() },
      { name: "b.webm", bytes: mp4Bytes() },
      { name: "c.webm", bytes: mkvBytes() },
      { name: "d.mp4", bytes: new TextEncoder().encode("not a video at all") },
      { name: "e.mov", bytes: new Uint8Array([0, 0, 0]) },
      { name: "f.txt", bytes: mp4Bytes() },
      { name: "g.mp4", bytes: movBytes("", "wide") },
    ]);
    const results = await s.addFiles(DIR, { kind: "pick" });
    expect(results.map((r) => r.error)).toEqual(Array(7).fill(ONLY_VIDEOS_AND_IMAGES));
    expect(s.writes).toEqual([]);
  });

  it("takes every ISO-BMFF extension with ftyp, and QuickTime's bare first atoms only for .mov", async () => {
    const s = new MemoryStorage();
    const atoms = ["moov", "mdat", "wide", "free", "skip", "pnot"];
    s.queueAdd([
      { name: "a.m4v", bytes: mp4Bytes("m4v", "M4V ") },
      { name: "b.mov", bytes: movBytes("qt") },
      { name: "c.mp4", bytes: mp4Bytes("qt", "qt  ") },
      ...atoms.map((atom) => ({ name: `${atom}.mov`, bytes: movBytes(atom, atom) })),
    ]);
    const results = await s.addFiles("", { kind: "pick" });
    expect(results.map((r) => r.error)).toEqual(Array(3 + atoms.length).fill(null));
    expect(results[0].path).toMatch(/^video-[0-9a-f]{8}\.m4v$/);
    expect(results[2].path).toMatch(/^video-[0-9a-f]{8}\.mp4$/);
  });

  it("reads the DocType from a real encoder's EBML header", async () => {
    // The first 40 bytes of the WebM sample under src/shots/: the EBML header and the Segment's ID.
    const real = new Uint8Array([
      0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
      0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x02,
      0x42, 0x85, 0x81, 0x02, 0x18, 0x53, 0x80, 0x67,
    ]);
    const s = new MemoryStorage();
    s.queueAdd([
      { name: "real.webm", bytes: real },
      { name: "cut.webm", bytes: real.subarray(0, 24) },
    ]);
    const [whole, cut] = await s.addFiles("", { kind: "pick" });
    expect(whole.path).toMatch(/^video-[0-9a-f]{8}\.webm$/);
    expect(cut.error).toBe(ONLY_VIDEOS_AND_IMAGES);
  });

  it("refuses a video over 100 MB and a picture over 10 MB, by kind", async () => {
    const s = new MemoryStorage();
    const bigVideo = new Uint8Array(VIDEO_MAX_BYTES + 1);
    bigVideo.set(mp4Bytes());
    const bigImage = new Uint8Array(10 * 1024 * 1024 + 1);
    bigImage.set(png);
    s.queueAdd([{ name: "big.mp4", bytes: bigVideo }, { name: "big.png", bytes: bigImage }]);
    const files = [{ name: "big.mp4", size: bigVideo.length }, { name: "big.png", size: bigImage.length }];
    const results = await s.addFiles(DIR, { kind: "paste", files });
    expect(results.map((r) => r.error)).toEqual([VIDEO_TOO_LARGE, IMAGE_TOO_LARGE]);
    expect(s.writes).toEqual([]);
  });

  it("takes a video at exactly 100 MB", async () => {
    const s = new MemoryStorage();
    const atCap = new Uint8Array(VIDEO_MAX_BYTES);
    atCap.set(mp4Bytes());
    s.queueAdd([{ name: "cap.mp4", bytes: atCap }]);
    const [added] = await s.addFiles("", { kind: "pick" });
    expect(added.error).toBeNull();
  });

  it("rejects the whole call when an Error is queued, as a failed native command would", async () => {
    const s = new MemoryStorage();
    s.queueAdd(new Error("The data folder is not set."));
    await expect(s.addFiles(DIR, { kind: "pick" })).rejects.toThrow("The data folder is not set.");
  });

  it("copies a video across roots, landing only in the target root", async () => {
    const s = new MemoryStorage();
    s.seedVideo("collections/c/credentials/clip.mov", movBytes("c"));
    const to = await s.copyVideo("collections/c/credentials/clip.mov", "export", "c/101/assets");
    expect(to).toMatch(/^c\/101\/assets\/video-[0-9a-f]{8}\.mov$/);
    expect(s.video(to, "export")).toEqual(movBytes("c"));
    expect(s.video(to, "data")).toBeUndefined();
    expect(await s.listFiles("export", "c/101")).toEqual([to]);
    expect(s.writes).toEqual([{ root: "export", path: to }]);
  });

  it("copies within the data root once, and names the copy by content", async () => {
    const s = new MemoryStorage();
    s.queueAdd([{ name: "a.mp4", bytes: mp4Bytes("r") }]);
    const [added] = await s.addFiles("assessments/old", { kind: "pick" });
    const a = await s.copyVideo(added.path!, "data", "assessments/new");
    const b = await s.copyVideo(added.path!, "data", "assessments/new");
    expect(a).toBe(`assessments/new/${added.path!.slice("assessments/old/".length)}`);
    expect(b).toBe(a);
    expect(s.video(added.path!)).toEqual(mp4Bytes("r"));
    expect(s.writes.map((w) => w.path)).toEqual([added.path, a]);
  });

  it("refuses to copy a missing video, a video only in the export root, and a file that is not a video", async () => {
    const s = new MemoryStorage({ "notes.md": "hi" });
    s.seedVideo("only-export.mp4", mp4Bytes(), "export");
    s.seedVideo("fake.mp4", webmBytes());
    await expect(s.copyVideo("missing.mp4", "export", "x")).rejects.toThrow();
    await expect(s.copyVideo("only-export.mp4", "export", "x")).rejects.toThrow();
    await expect(s.copyVideo("notes.md", "export", "x")).rejects.toThrow();
    await expect(s.copyVideo("fake.mp4", "export", "x")).rejects.toThrow(ONLY_VIDEOS_AND_IMAGES);
    expect(s.writes).toEqual([]);
  });

  it("gives a blob URL for a stored data video, counts its releases, and null otherwise", async () => {
    const s = new MemoryStorage({ "notes.md": "hi" });
    s.seedVideo("agents/clip.mp4", mp4Bytes());
    s.seedVideo("export-only.mp4", mp4Bytes(), "export");
    const a = await s.videoUrl("agents/clip.mp4");
    const b = await s.videoUrl("agents/clip.mp4");
    expect(a?.url).toBe("blob:memory/agents/clip.mp4");
    expect(s.videoUrls).toEqual([{ path: "agents/clip.mp4", releases: 0 }, { path: "agents/clip.mp4", releases: 0 }]);
    a!.release();
    expect(s.openVideoUrls()).toEqual(["agents/clip.mp4"]);
    b!.release();
    b!.release();
    expect(s.videoUrls.map((u) => u.releases)).toEqual([1, 2]);
    expect(s.openVideoUrls()).toEqual([]);
    expect(await s.videoUrl("missing.mp4")).toBeNull();
    expect(await s.videoUrl("export-only.mp4")).toBeNull();
    expect(await s.videoUrl("notes.md")).toBeNull();
    expect(s.videoUrls).toHaveLength(2);
  });

  it("gives no URL where the scheme would answer 404: a name the rule refuses, or content that disagrees", async () => {
    const s = new MemoryStorage();
    s.seedVideo("agents/clip.mkv", mkvBytes());
    s.seedVideo("agents/.hidden.mp4", mp4Bytes());
    s.seedVideo("agents/junk.mp4", new Uint8Array([1, 2, 3]));
    s.seedVideo("agents/webm.mp4", webmBytes());
    for (const path of ["agents/clip.mkv", "agents/.hidden.mp4", "agents/junk.mp4", "agents/webm.mp4"]) {
      expect(await s.videoUrl(path), path).toBeNull();
    }
    expect(s.videoUrls).toEqual([]);
  });

  it("lists, moves and removes videos with the other files, and never reads one as an image", async () => {
    const s = new MemoryStorage({ "agents/a.json": "{}" });
    s.seedVideo("agents/clip.mp4", mp4Bytes());
    expect(await s.listFiles("data", "agents")).toEqual(["agents/a.json", "agents/clip.mp4"]);
    await expect(s.readDataUri("data", "agents/clip.mp4")).rejects.toThrow();
    await expect(s.moveFile("data", "agents/a.json", "agents/clip.mp4")).rejects.toThrow();
    await s.moveFile("data", "agents/clip.mp4", "trash/clip.mp4");
    expect(s.video("trash/clip.mp4")).toEqual(mp4Bytes());
    expect(s.video("agents/clip.mp4")).toBeUndefined();
    s.remove("trash/clip.mp4");
    expect(await s.listFiles("data", "")).toEqual(["agents/a.json"]);
  });
});

describe("MemoryStorage reply item files (reply artifacts U2)", () => {
  const DIR = "assessments/a/c/k";
  const text = (t: string) => new TextEncoder().encode(t);
  const PDF = text("%PDF-1.7\n%%EOF\n");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("copies any file into files/ under its hash with its extension lowercased, keeping the original name", async () => {
    const s = new MemoryStorage();
    s.queueAdd([
      { name: "Report Final.PDF", bytes: PDF },
      { name: "notes.md", bytes: text("# Notes") },
      { name: "bundle.zip", bytes: text("PK\u0003\u0004") },
      { name: "Makefile", bytes: text("all:") },
      { name: ".bashrc", bytes: text("export A=1") },
    ]);
    const results = await s.addFiles(DIR, { kind: "pick", item: "file" }, "any");
    expect(results.map((r) => [r.name, r.kind, r.error])).toEqual([
      ["Report Final.PDF", "file", null],
      ["notes.md", "file", null],
      ["bundle.zip", "file", null],
      ["Makefile", "file", null],
      [".bashrc", "file", null],
    ]);
    expect(results.map((r) => r.path!.replace(/[0-9a-f]{8}/, "H"))).toEqual([
      `${DIR}/files/file-H.pdf`,
      `${DIR}/files/file-H.md`,
      `${DIR}/files/file-H.zip`,
      `${DIR}/files/file-H`,
      `${DIR}/files/file-H`,
    ]);
    for (const r of results) expect(isFileItemName(r.path!.slice(r.path!.lastIndexOf("/") + 1))).toBe(true);
    expect(s.itemFile(results[0].path!)).toEqual(PDF);
    expect(await s.listFiles("data", `${DIR}/files`)).toHaveLength(5);
    expect(s.adds).toEqual([{ dir: DIR, from: { kind: "pick", item: "file" }, accept: "any" }]);
  });

  it("writes the same bytes once and refuses a different file at the name", async () => {
    const s = new MemoryStorage();
    s.queueAdd([{ name: "a.pdf", bytes: PDF }, { name: "b.pdf", bytes: PDF }]);
    const [a, b] = await s.addFiles(DIR, { kind: "pick", item: "file" }, "any");
    expect(b.path).toBe(a.path);
    expect(s.writes).toHaveLength(1);
    s.seedItemFile(a.path!, text("other bytes"));
    s.queueAdd([{ name: "c.pdf", bytes: PDF }]);
    const [c] = await s.addFiles(DIR, { kind: "pick", item: "file" }, "any");
    expect(c).toEqual({ name: "c.pdf", path: null, kind: null, error: alreadyNamed(a.path!.slice(a.path!.lastIndexOf("/") + 1)) });
  });

  it("refuses a file over 100 MB with its own refusal, and takes one at exactly 100 MB", async () => {
    expect(FILE_MAX_BYTES).toBe(100 * 1024 * 1024);
    const s = new MemoryStorage();
    s.queueAdd([
      { name: "big.zip", bytes: new Uint8Array(FILE_MAX_BYTES + 1) },
      { name: "cap.zip", bytes: new Uint8Array(FILE_MAX_BYTES) },
    ]);
    const [big, cap] = await s.addFiles(DIR, { kind: "pick", item: "file" }, "any");
    expect(big.error).toBe(FILE_TOO_LARGE);
    expect(cap.kind).toBe("file");
  });

  it("sorts by content whichever key added it: a PNG is an image, a video a video, the rest files", async () => {
    const s = new MemoryStorage();
    s.queueAdd([
      { name: "shot.dat", bytes: png },
      { name: "Clip.MOV", bytes: movBytes("k") },
      { name: "fake.mp4", bytes: text("not a video") },
      { name: "anim.gif", bytes: text("GIF89a") },
    ]);
    const results = await s.addFiles(DIR, { kind: "drop", paths: ["/a", "/b", "/c", "/d"] }, "any");
    expect(results.map((r) => r.kind)).toEqual(["image", "video", "file", "file"]);
    expect(results[0].path).toMatch(/^assessments\/a\/c\/k\/image-[0-9a-f]{8}\.png$/);
    expect(results[1].path).toMatch(/^assessments\/a\/c\/k\/video-[0-9a-f]{8}\.mov$/);
    expect(results[2].path).toMatch(/^assessments\/a\/c\/k\/files\/file-[0-9a-f]{8}\.mp4$/);
    expect(results[3].path).toMatch(/\/files\/file-[0-9a-f]{8}\.gif$/);
  });

  it("with media, the default, a PDF is still refused as a rich box refuses it today", async () => {
    const s = new MemoryStorage();
    s.queueAdd([{ name: "spec.pdf", bytes: PDF }, { name: "shot.png", bytes: png }]);
    const [pdf, shot] = await s.addFiles(DIR, { kind: "paste", files: [] });
    expect(pdf).toEqual({ name: "spec.pdf", path: null, kind: null, error: ONLY_VIDEOS_AND_IMAGES });
    expect(shot.kind).toBe("image");
    s.queueAdd([{ name: "spec.pdf", bytes: PDF }]);
    const [again] = await s.addFiles(DIR, { kind: "drop", paths: ["/d/spec.pdf"] }, "media");
    expect(again.error).toBe(ONLY_VIDEOS_AND_IMAGES);
    // A default add records no accept, so a rich box's record reads as it always has.
    expect(s.adds[0]).toEqual({ dir: DIR, from: { kind: "paste", files: [] } });
  });

  it("reads item text up to 1 MiB, and mirrors the cap, the UTF-8 check and the folder check", async () => {
    expect(ITEM_TEXT_MAX_BYTES).toBe(1024 * 1024);
    const s = new MemoryStorage({ "r/notes.md": "# Seeded text" });
    s.seedItemFile("r/files/file-00000001.md", text("a".repeat(ITEM_TEXT_MAX_BYTES)));
    s.seedItemFile("r/files/file-00000002.md", text("a".repeat(ITEM_TEXT_MAX_BYTES + 1)));
    s.seedItemFile("r/files/file-00000003.txt", new Uint8Array([0x61, 0xff, 0xfe]));
    expect(await s.readItemText("r/files/file-00000001.md")).toHaveLength(ITEM_TEXT_MAX_BYTES);
    await expect(s.readItemText("r/files/file-00000002.md")).rejects.toThrow(ITEM_TEXT_TOO_LARGE);
    await expect(s.readItemText("r/files/file-00000003.txt")).rejects.toThrow(NOT_TEXT);
    expect(await s.readItemText("r/notes.md")).toBe("# Seeded text");
    expect(await s.readItemText("r/files/missing.md")).toBeNull();
    for (const bad of ["../x.md", "r/../../x.md", "/etc/hosts"]) await expect(s.readItemText(bad)).rejects.toThrow(NOT_IN_FOLDER);
    // readText stays uncapped.
    s.seed({ "r/big.md": "r".repeat(2 * 1024 * 1024) });
    expect(await s.readText("data", "r/big.md")).toHaveLength(2 * 1024 * 1024);
  });

  it("records what it opens, and refuses climbs, absolute paths and missing files", async () => {
    const s = new MemoryStorage();
    s.seedItemFile("r/files/file-00000001.pdf", PDF);
    await s.openItem("r/files/file-00000001.pdf");
    expect(s.opened).toEqual(["r/files/file-00000001.pdf"]);
    for (const bad of ["../out.pdf", "r/files/../files/file-00000001.pdf", "/r/files/file-00000001.pdf"]) {
      await expect(s.openItem(bad)).rejects.toThrow(NOT_IN_FOLDER);
    }
    await expect(s.openItem("r/files/missing.pdf")).rejects.toThrow(ITEM_MISSING);
    expect(s.opened).toHaveLength(1);
  });

  it("gives a file URL only for a real PDF item under files/, counting releases", async () => {
    const s = new MemoryStorage();
    s.seedItemFile("r/files/file-1a2b3c4d.pdf", PDF);
    s.seedItemFile("r/files/file-00000002.pdf", text("text named .pdf"));
    s.seedItemFile("r/files/file-00000003.md", text("%PDF- but markdown"));
    s.seedItemFile("r/other/file-00000004.pdf", PDF);
    s.seedItemFile("r/files/report.pdf", PDF);
    const got = await s.fileUrl("r/files/file-1a2b3c4d.pdf");
    expect(got?.url).toBe("blob:memory/r/files/file-1a2b3c4d.pdf");
    got!.release();
    expect(s.fileUrls).toEqual([{ path: "r/files/file-1a2b3c4d.pdf", releases: 1 }]);
    for (const path of ["r/files/file-00000002.pdf", "r/files/file-00000003.md", "r/other/file-00000004.pdf", "r/files/report.pdf", "missing.pdf"]) {
      expect(await s.fileUrl(path), path).toBeNull();
    }
  });

  it("carries a file item into another credential's files/ folder, and still carries videos", async () => {
    const s = new MemoryStorage({ "r/credential.md": "# C" });
    s.queueAdd([{ name: "spec.pdf", bytes: PDF }, { name: "a.mp4", bytes: mp4Bytes("carry") }]);
    const [pdf, video] = await s.addFiles("old", { kind: "pick", item: "file" }, "any");
    const to = await s.copyItem(pdf.path!, "data", "new");
    expect(to).toBe(`new/files/${pdf.path!.slice("old/files/".length)}`);
    expect(await s.copyItem(pdf.path!, "data", "new")).toBe(to);
    expect(s.itemFile(to)).toEqual(PDF);
    expect(s.itemFile(pdf.path!)).toEqual(PDF);
    expect(await s.copyItem(video.path!, "export", "x")).toMatch(/^x\/video-[0-9a-f]{8}\.mp4$/);
    for (const bad of ["r/credential.md", "missing/files/file-00000000.pdf"]) await expect(s.copyItem(bad, "data", "e")).rejects.toThrow(NOT_AN_ITEM);
  });

  it("lists, moves and removes item files with the other files", async () => {
    const s = new MemoryStorage({ "r/a.md": "a" });
    s.seedItemFile("r/files/file-00000001.pdf", PDF);
    expect(await s.listFiles("data", "r")).toEqual(["r/a.md", "r/files/file-00000001.pdf"]);
    await s.moveFile("data", "r/files/file-00000001.pdf", "trash/r/files/file-00000001.pdf");
    expect(s.itemFile("trash/r/files/file-00000001.pdf")).toEqual(PDF);
    await expect(s.readDataUri("data", "trash/r/files/file-00000001.pdf")).rejects.toThrow();
    s.remove("trash/r/files/file-00000001.pdf");
    expect(await s.listFiles("data", "")).toEqual(["r/a.md"]);
  });
});
