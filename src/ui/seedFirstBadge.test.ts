// @vitest-environment jsdom
// The first badge saved from the held line (U5, KTD6): once, under its derived name, with the
// line as its one learning target, landing where any new badge lands.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectionPath, loadFolder, serializeCollection } from "../domain/folder";
import type { Collection } from "../domain/types";
import { HELD_LINE_KEY, readHeldLine, writeHeldLine } from "../intro/heldLine";
import { seedFirstBadge, type SeedResult } from "./seedFirstBadge";
import { review, storageWith } from "./testFolder";

beforeEach(() => localStorage.clear());

const held = { line: "It finds the bug and names the line that causes it", name: "It finds the bug and names" };

describe("seedFirstBadge", () => {
  it("with no held line saves nothing", async () => {
    const storage = storageWith();
    expect(seedFirstBadge(storage, await loadFolder(storage))).toBeNull();
    expect((await loadFolder(storage)).credentials).toEqual([]);
  });

  it("saves the line as the badge's only learning target, under the derived name, with no task", async () => {
    writeHeldLine(held);
    const storage = storageWith();
    const result = (await seedFirstBadge(storage, await loadFolder(storage))) as SeedResult & { ok: true };
    expect(result.ok).toBe(true);
    const badge = result.state.credentials.find((c) => `${c.collectionSlug}/${c.slug}` === result.key);
    expect(badge).toMatchObject({ name: held.name, learningTargets: [held.line], task: "", rubric: "", extraSections: [] });
    expect(result.state.collections.map((c) => c.name)).toEqual(["My credentials"]);
  });

  it("Covers AE8. Run twice, as StrictMode does, it saves one badge and both runs get its key", async () => {
    writeHeldLine(held);
    const storage = storageWith();
    const state = await loadFolder(storage);
    const first = seedFirstBadge(storage, state);
    const second = seedFirstBadge(storage, state);
    expect(second).toBe(first);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a?.ok).toBe(true);
    expect((await loadFolder(storage)).credentials).toHaveLength(1);
    // Once it settled, there is nothing left to save.
    expect(seedFirstBadge(storage, await loadFolder(storage))).toBeNull();
  });

  it("Covers AE9. A line held from an earlier launch is saved when a folder loads, and let go", async () => {
    localStorage.setItem(HELD_LINE_KEY, JSON.stringify(held));
    const storage = storageWith();
    const run = seedFirstBadge(storage, await loadFolder(storage));
    // Taken before the first await, so a second mount finds nothing to read.
    expect(localStorage.getItem(HELD_LINE_KEY)).toBeNull();
    expect((await run)?.ok).toBe(true);
    expect(readHeldLine()).toBeNull();
    expect((await loadFolder(storage)).credentials.map((c) => c.name)).toEqual([held.name]);
  });

  it("a badge already named that way gets the new one a -2 slug", async () => {
    writeHeldLine(held);
    const storage = storageWith({ credentials: [{ ...review, slug: "it-finds-the-bug-and-names", name: held.name }] });
    const result = await seedFirstBadge(storage, await loadFolder(storage));
    expect(result).toMatchObject({ ok: true, key: "eng/it-finds-the-bug-and-names-2" });
    expect((await loadFolder(storage)).credentials).toHaveLength(2);
  });

  it("a folder with two collections of the user's own lands it in a new My credentials", async () => {
    writeHeldLine(held);
    const storage = storageWith();
    const own = (slug: string, name: string): Collection => ({ slug, name, description: "", order: [], codes: {} });
    storage.seed({
      [collectionPath("work")]: serializeCollection(own("work", "Work")),
      [collectionPath("client")]: serializeCollection(own("client", "Client work")),
    });
    const result = await seedFirstBadge(storage, await loadFolder(storage));
    expect(result).toMatchObject({ ok: true, key: "my-credentials/it-finds-the-bug-and-names" });
    expect((await loadFolder(storage)).collections.map((c) => c.name).sort()).toEqual(["Client work", "My credentials", "Work"]);
  });

  it("a save that throws puts the held line back and says why", async () => {
    writeHeldLine(held);
    const storage = storageWith();
    vi.spyOn(storage, "writeText").mockRejectedValue(new Error("disk full"));
    const result = await seedFirstBadge(storage, await loadFolder(storage));
    expect(result).toEqual({ ok: false, message: expect.stringContaining("disk full") });
    expect(readHeldLine()).toEqual(held);
  });
});
