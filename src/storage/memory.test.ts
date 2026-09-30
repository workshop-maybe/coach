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
