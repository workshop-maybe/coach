import { describe, expect, it } from "vitest";
import { contextLine } from "./context";
import type { Assessment, TestContext } from "./types";

let stamp = 0;

function result(profileSlug: string, context: Partial<TestContext> | null, credentialSlug = "review"): Assessment {
  stamp += 1;
  const base: Assessment = {
    profileSlug,
    collectionSlug: "eng",
    credentialSlug,
    fileStem: `2026092${stamp}T000000Z`,
    result: "met",
    recordedAt: `2026-09-2${stamp}T09:00:00.000Z`,
    assignmentVersion: "v1",
    setup: { harness: "claude-code", model: "opus", effort: "high" },
    note: "",
    handBack: "done",
  };
  if (context === null) return base;
  return {
    ...base,
    context: {
      machineId: "laptop",
      machine: "James's MacBook Pro",
      memory: "aaaaaaaaaaaa",
      capturedAt: base.recordedAt,
      ...context,
    },
  };
}

describe("contextLine", () => {
  it("is null for a result with no context", () => {
    const a = result("opus", null);
    expect(contextLine([a], a)).toBeNull();
  });

  it("Covers AE1. a different fingerprint on the same machine is memory changed", () => {
    const first = result("opus", { memory: "aaaaaaaaaaaa", capturedAt: "2026-09-20T09:00:00.000Z" });
    const second = result("opus", { memory: "bbbbbbbbbbbb", capturedAt: "2026-09-21T09:00:00.000Z" });
    expect(contextLine([first, second], second)).toEqual({ machine: "James's MacBook Pro", memory: "changed" });
    expect(contextLine([first, second], first)).toEqual({ machine: "James's MacBook Pro", memory: "unchanged" });
  });

  it("the same fingerprint on the same machine is unchanged", () => {
    const first = result("opus", { capturedAt: "2026-09-20T09:00:00.000Z" });
    const second = result("opus", { capturedAt: "2026-09-21T09:00:00.000Z" });
    expect(contextLine([first, second], second)?.memory).toBe("unchanged");
  });

  it("Covers AE5. an earlier result only on another machine gives no marker", () => {
    const studio = result("opus", { machineId: "studio", machine: "Studio", memory: "cccccccccccc", capturedAt: "2026-09-20T09:00:00.000Z" });
    const laptop = result("opus", { memory: "aaaaaaaaaaaa", capturedAt: "2026-09-21T09:00:00.000Z" });
    expect(contextLine([studio, laptop], laptop)).toEqual({ machine: "James's MacBook Pro", memory: "unchanged" });
  });

  it("skips earlier results with no fingerprint to the latest one that has one", () => {
    const old = result("opus", { memory: "aaaaaaaaaaaa", capturedAt: "2026-09-20T09:00:00.000Z" });
    const unknown = result("opus", null);
    const notRead = result("opus", { memory: "not-read", capturedAt: "2026-09-21T09:00:00.000Z" });
    const now = result("opus", { memory: "bbbbbbbbbbbb", capturedAt: "2026-09-22T09:00:00.000Z" });
    expect(contextLine([old, unknown, notRead, now], now)?.memory).toBe("changed");
  });

  it("an earlier result on another credential still counts", () => {
    const other = result("opus", { memory: "aaaaaaaaaaaa", capturedAt: "2026-09-20T09:00:00.000Z" }, "ship");
    const here = result("opus", { memory: "bbbbbbbbbbbb", capturedAt: "2026-09-21T09:00:00.000Z" });
    expect(contextLine([other, here], here)?.memory).toBe("changed");
  });

  it("compares by capture time, not by when the result was recorded", () => {
    const later = { ...result("opus", { memory: "bbbbbbbbbbbb", capturedAt: "2026-09-21T09:00:00.000Z" }), recordedAt: "2026-09-21T10:00:00.000Z" };
    const earlier = { ...result("opus", { memory: "aaaaaaaaaaaa", capturedAt: "2026-09-20T09:00:00.000Z" }), recordedAt: "2026-09-22T10:00:00.000Z" };
    expect(contextLine([later, earlier], later)?.memory).toBe("changed");
    expect(contextLine([later, earlier], earlier)?.memory).toBe("unchanged");
  });

  it("another agent's results are never the baseline, including the agent it was copied from", () => {
    const source = result("opus", { memory: "aaaaaaaaaaaa", capturedAt: "2026-09-20T09:00:00.000Z" });
    const copy = result("opus-2", { memory: "bbbbbbbbbbbb", capturedAt: "2026-09-21T09:00:00.000Z" });
    expect(contextLine([source, copy], copy)?.memory).toBe("unchanged");
  });

  it("Covers AE4. a result whose memory was not read says so", () => {
    const first = result("opus", { memory: "aaaaaaaaaaaa", capturedAt: "2026-09-20T09:00:00.000Z" });
    const codex = result("opus", { memory: "not-read", capturedAt: "2026-09-21T09:00:00.000Z" });
    expect(contextLine([first, codex], codex)).toEqual({ machine: "James's MacBook Pro", memory: "not-read" });
  });
});
