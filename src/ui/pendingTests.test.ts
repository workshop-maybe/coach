// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { addPending, pendingStorageKey, readPending, removePending, type PendingTest } from "./pendingTests";

const entry: PendingTest = {
  profileSlug: "opus",
  credentialKey: "eng/review",
  copiedAt: "2026-09-29T10:00:00.000Z",
  assignmentVersion: "abc123",
  setup: { harness: "claude-code", model: "opus", effort: "high" },
};

beforeEach(() => localStorage.clear());

describe("pendingTests", () => {
  it("reads nothing for a folder with no waiting tests", () => {
    expect(readPending("/data")).toEqual([]);
  });

  it("keeps each folder's waiting tests apart", () => {
    addPending("/data", entry);
    expect(readPending("/data")).toEqual([entry]);
    expect(readPending("/other")).toEqual([]);
    expect(localStorage.getItem(pendingStorageKey("/data"))).toContain("eng/review");
  });

  it("a second copy of the same test replaces the first", () => {
    addPending("/data", entry);
    addPending("/data", { ...entry, copiedAt: "2026-09-29T11:00:00.000Z" });
    expect(readPending("/data")).toEqual([{ ...entry, copiedAt: "2026-09-29T11:00:00.000Z" }]);
  });

  it("lists newest first", () => {
    addPending("/data", entry);
    addPending("/data", { ...entry, profileSlug: "codex", copiedAt: "2026-09-29T12:00:00.000Z" });
    expect(readPending("/data").map((p) => p.profileSlug)).toEqual(["codex", "opus"]);
  });

  it("removing one leaves the rest", () => {
    addPending("/data", entry);
    addPending("/data", { ...entry, profileSlug: "codex" });
    removePending("/data", "opus", "eng/review");
    expect(readPending("/data").map((p) => p.profileSlug)).toEqual(["codex"]);
  });

  it("reads unreadable or malformed storage as empty", () => {
    localStorage.setItem(pendingStorageKey("/data"), "{not json");
    expect(readPending("/data")).toEqual([]);
    localStorage.setItem(pendingStorageKey("/data"), JSON.stringify([{ profileSlug: 3 }, entry]));
    expect(readPending("/data")).toEqual([entry]);
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    } as unknown as globalThis.Storage;
    expect(readPending("/data", broken)).toEqual([]);
    expect(() => addPending("/data", entry, broken)).not.toThrow();
  });

  const context = { machineId: "m1", machine: "Studio Mac", memory: "0123456789ab", capturedAt: "2026-09-29T10:00:00.000Z" };

  it("keeps the context a test was copied with", () => {
    addPending("/data", { ...entry, context });
    expect(readPending("/data")).toEqual([{ ...entry, context }]);
  });

  it("two waiting tests for one agent keep separate snapshots", () => {
    addPending("/data", { ...entry, context });
    const other = { ...entry, credentialKey: "eng/ship", copiedAt: "2026-09-29T11:00:00.000Z", context: { ...context, memory: "ffffffffffff" } };
    addPending("/data", other);
    const byKey = Object.fromEntries(readPending("/data").map((p) => [p.credentialKey, p.context?.memory]));
    expect(byKey).toEqual({ "eng/review": "0123456789ab", "eng/ship": "ffffffffffff" });
  });

  it("a waiting test saved before context existed still loads", () => {
    localStorage.setItem(pendingStorageKey("/data"), JSON.stringify([entry]));
    expect(readPending("/data")).toEqual([entry]);
  });

  it("a malformed context is dropped, and the waiting test kept", () => {
    localStorage.setItem(pendingStorageKey("/data"), JSON.stringify([{ ...entry, context: { machine: 3 } }]));
    expect(readPending("/data")).toEqual([entry]);
  });
});
