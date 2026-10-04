import { describe, expect, it } from "vitest";
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
