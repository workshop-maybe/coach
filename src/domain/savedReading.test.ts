// jev-in-compare U1, KTD14: the reading as a held reply keeps it and as a result keeps it.
import { describe, expect, it } from "vitest";
import { readingBeforeVerdict, savedReading, type SavedReadingInput } from "./savedReading";

const parts = {
  overall: 0.82,
  points: [
    { text: "Names the rollback", probability: 0.9 },
    { text: "Cites the log", probability: 0.4 },
  ],
  targets: [{ text: "Plan a release", probability: 0.75 }],
};

const input: SavedReadingInput = {
  parts,
  model: "claude-opus-4",
  assignmentVersion: "v1abc",
  askedAt: "2026-10-04T10:00:00.000Z",
  examplesSent: 2,
  verdictWhenSeen: null,
};

describe("readingBeforeVerdict", () => {
  it("keeps the reading seen before, with the targets read and the examples sent", () => {
    expect(readingBeforeVerdict(input)).toStrictEqual({
      model: "claude-opus-4",
      assignmentVersion: "v1abc",
      askedAt: "2026-10-04T10:00:00.000Z",
      overall: 0.82,
      points: parts.points,
      targets: parts.targets,
      examplesSent: 2,
      seen: "before",
    });
  });

  it("leaves the targets out when none were read", () => {
    const reading = readingBeforeVerdict({ ...input, parts: { ...parts, targets: [] } });
    expect("targets" in reading).toBe(false);
    expect(reading.seen).toBe("before");
  });

  it("keeps examplesSent even at zero", () => {
    const reading = readingBeforeVerdict({ ...input, examplesSent: 0 });
    expect("examplesSent" in reading).toBe(true);
    expect(reading.examplesSent).toBe(0);
  });

  it("is seen before even when a pick came first, since a held reply has no verdict", () => {
    const pickedFirst: SavedReadingInput = { ...input, verdictWhenSeen: "met" };
    expect(readingBeforeVerdict(pickedFirst)).toStrictEqual(readingBeforeVerdict(input));
  });

  it("writes its fields in the order the test deck always wrote them", () => {
    expect(Object.keys(readingBeforeVerdict(input))).toEqual([
      "model",
      "assignmentVersion",
      "askedAt",
      "overall",
      "points",
      "targets",
      "examplesSent",
      "seen",
    ]);
  });
});

describe("savedReading", () => {
  it("saves a reading that came before any pick as seen before", () => {
    const reading = savedReading(input, "met");
    expect(reading).toStrictEqual(readingBeforeVerdict(input));
    expect("verdictWhenSeen" in reading).toBe(false);
    expect("verdictChanged" in reading).toBe(false);
  });

  it("saves a reading picked before it arrived as seen after, changed when the saved verdict differs", () => {
    expect(savedReading({ ...input, verdictWhenSeen: "met" }, "not_met")).toStrictEqual({
      model: "claude-opus-4",
      assignmentVersion: "v1abc",
      askedAt: "2026-10-04T10:00:00.000Z",
      overall: 0.82,
      points: parts.points,
      targets: parts.targets,
      examplesSent: 2,
      seen: "after",
      verdictWhenSeen: "met",
      verdictChanged: true,
    });
  });

  it("says unchanged when the saved verdict is the one picked when it arrived", () => {
    const reading = savedReading({ ...input, verdictWhenSeen: "not_met" }, "not_met");
    expect(reading.seen).toBe("after");
    expect(reading.verdictWhenSeen).toBe("not_met");
    expect(reading.verdictChanged).toBe(false);
  });

  it("leaves the targets out of a result's reading when none were read, and keeps zero examples", () => {
    const reading = savedReading({ ...input, parts: { ...parts, targets: [] }, examplesSent: 0, verdictWhenSeen: "met" }, "met");
    expect("targets" in reading).toBe(false);
    expect(reading.examplesSent).toBe(0);
    expect(Object.keys(reading)).toEqual(["model", "assignmentVersion", "askedAt", "overall", "points", "examplesSent", "seen", "verdictWhenSeen", "verdictChanged"]);
  });
});
