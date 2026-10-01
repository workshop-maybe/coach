import { describe, expect, it } from "vitest";
import { SKELETON_ID } from "../domain/handoffs";
import {
  BOX_KEYS_PER_ROW,
  KEYS_PER_PAGE,
  OTHER_ARC,
  boxKeyPlace,
  boxKeys,
  boxRows,
  boxScreen,
  cutLine,
  encoderAngle,
  handoffKeys,
  handoffLetter,
  openingChoice,
  replyScreen,
  trigKeys,
  trigPages,
  type EarnedCell,
} from "./mappings";

const opusHigh = { harness: "claude-code", model: "opus", effort: "high" };
const codexLow = { harness: "codex", model: "gpt-5", effort: "low" };

function met(slug: string, recordedAt: string, flags: string[] = []): EarnedCell {
  return {
    credentialKey: `eng/${slug}`,
    status: "met",
    flags,
    history: [{ result: "met", recordedAt, collectionSlug: "eng", credentialSlug: slug }],
  };
}

describe("encoderAngle", () => {
  it("a pinned version points the model encoder where its model points", () => {
    expect(encoderAngle("model", { ...opusHigh, model: "opus-5.5" })).toBe(encoderAngle("model", opusHigh));
  });

  it("points every encoder differently for two different setups (Covers AE1.)", () => {
    for (const dial of ["harness", "model", "effort"] as const) {
      expect(encoderAngle(dial, opusHigh)).not.toBe(encoderAngle(dial, codexLow));
    }
  });

  it("spreads listed values across -135 to 135", () => {
    expect(encoderAngle("effort", { ...opusHigh, effort: "low" })).toBe(-135);
    expect(encoderAngle("effort", { ...opusHigh, effort: "max" })).toBe(135);
    expect(encoderAngle("harness", opusHigh)).toBe(-135);
    expect(encoderAngle("harness", { ...opusHigh, harness: "cursor" })).toBe(135);
  });

  it("points two typed models differently, both inside the Other arc", () => {
    const a = encoderAngle("model", { ...opusHigh, model: "my-model" });
    const b = encoderAngle("model", { ...opusHigh, model: "another-model" });
    expect(a).not.toBe(b);
    for (const angle of [a, b]) {
      expect(angle).toBeGreaterThan(OTHER_ARC.from);
      expect(angle).toBeLessThan(OTHER_ARC.to);
    }
    expect(encoderAngle("model", { ...opusHigh, model: "my-model" })).toBe(a);
  });

  it("places a custom effort and a typed harness in the Other arc too", () => {
    const effort = encoderAngle("effort", { ...opusHigh, effort: "ultra" });
    const harness = encoderAngle("harness", { ...opusHigh, harness: "aider" });
    for (const angle of [effort, harness]) expect(angle > OTHER_ARC.from && angle < OTHER_ARC.to).toBe(true);
  });
});

describe("trigKeys and trigPages", () => {
  it("orders keys by the first met result, oldest first", () => {
    const cell: EarnedCell = {
      ...met("b", "2026-09-05T00:00:00Z"),
      history: [
        { result: "met", recordedAt: "2026-09-05T00:00:00Z", collectionSlug: "eng", credentialSlug: "b" },
        { result: "met", recordedAt: "2026-08-01T00:00:00Z", collectionSlug: "eng", credentialSlug: "b" },
      ],
    };
    const keys = trigKeys([met("a", "2026-09-01T00:00:00Z"), cell]);
    expect(keys.map((k) => k.id)).toEqual(["eng/b", "eng/a"]);
    expect(keys[0].earnedAt).toBe("2026-08-01T00:00:00Z");
  });

  it("lights nothing for untested or not met cells", () => {
    const notMet: EarnedCell = { ...met("a", "2026-09-01T00:00:00Z"), status: "not_met" };
    expect(trigKeys([notMet, { credentialKey: "eng/b", status: "untested", flags: [], history: [] }])).toEqual([]);
  });

  it("puts a seventeenth key on page two, even for a credential that sorts first (Covers AE2.)", () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => met(`k${String(i).padStart(2, "0")}`, `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
    expect(trigPages(trigKeys(sixteen))).toHaveLength(1);
    const pages = trigPages(trigKeys([met("aaa-first", "2026-09-20T00:00:00Z"), ...sixteen]));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(KEYS_PER_PAGE);
    expect(pages[1].map((k) => k.id)).toEqual(["eng/aaa-first"]);
  });

  it("half raises a flagged result", () => {
    const [flagged, clean] = trigKeys([met("a", "2026-09-01T00:00:00Z", ["earlier_version"]), met("b", "2026-09-02T00:00:00Z")]);
    expect(flagged.halfRaised).toBe(true);
    expect(clean.halfRaised).toBe(false);
  });

  it("always has one page, even with no keys", () => {
    expect(trigPages([])).toEqual([[]]);
  });
});

describe("replyScreen", () => {
  it("shows at most three non-blank lines, each cut with an ellipsis", () => {
    const screen = replyScreen("First line that is much too long for the screen\n\nsecond\nthird\nfourth", 20);
    expect(screen).toEqual({ kind: "reply", lines: ["First line that is…", "second", "third"] });
    if (screen.kind === "reply") for (const l of screen.lines) expect([...l].length).toBeLessThanOrEqual(20);
  });

  it("shows the idle screen for an empty reply", () => {
    expect(replyScreen("  \n\n")).toEqual({ kind: "idle" });
  });

  it("leaves a line that fits alone", () => {
    expect(cutLine("short", 20)).toBe("short");
  });
});

describe("handoff box keys", () => {
  it("letters a badge's handoffs A, B, C in creation order, after the skeleton's own key", () => {
    expect(handoffKeys(["2026-09-01-a", "2026-09-02-b", "2026-09-03-c"])).toEqual([
      { id: SKELETON_ID, label: "S" },
      { id: "2026-09-01-a", label: "A" },
      { id: "2026-09-02-b", label: "B" },
      { id: "2026-09-03-c", label: "C" },
    ]);
    expect(handoffKeys([])).toEqual([{ id: "skeleton", label: "S" }]);
  });

  it("keeps lettering past Z", () => {
    expect([0, 25, 26, 27, 51, 52].map(handoffLetter)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA"]);
  });

  it("lights the default when the agent has no winner, or its winner is the default", () => {
    expect(openingChoice("b", null)).toEqual({ lit: "b", ask: null });
    expect(openingChoice("b", "b")).toEqual({ lit: "b", ask: null });
  });

  it("asks when the agent's winner differs from the default, lighting nothing (R11)", () => {
    expect(openingChoice("b", "a")).toEqual({ lit: null, ask: { winner: "a", default: "b" } });
  });

  it("draws the lit key lit and every other key off", () => {
    const keys = handoffKeys(["a", "b"]);
    expect(boxKeys(keys, { lit: "b", ask: null }).map((k) => [k.label, k.state, k.mark])).toEqual([
      ["S", "off", null],
      ["A", "off", null],
      ["B", "lit", null],
    ]);
  });

  it("in the ask state, lights no key and marks the winner and the default", () => {
    const keys = handoffKeys(["a", "b"]);
    const drawn = boxKeys(keys, openingChoice("b", SKELETON_ID));
    expect(drawn.map((k) => [k.label, k.state, k.mark])).toEqual([
      ["S", "off", "winner"],
      ["A", "off", null],
      ["B", "off", "default"],
    ]);
  });

  it("keeps the marks once a key is picked in the ask state", () => {
    const keys = handoffKeys(["a", "b"]);
    const drawn = boxKeys(keys, { lit: "b", ask: { winner: "a", default: "b" } });
    expect(drawn.map((k) => [k.state, k.mark])).toEqual([
      ["off", null],
      ["off", "winner"],
      ["lit", "default"],
    ]);
  });

  it("sets keys in rows, left to right, and grows a row at a time", () => {
    expect(boxKeyPlace(0)).toEqual({ row: 0, col: 0 });
    expect(boxKeyPlace(BOX_KEYS_PER_ROW - 1)).toEqual({ row: 0, col: BOX_KEYS_PER_ROW - 1 });
    expect(boxKeyPlace(BOX_KEYS_PER_ROW)).toEqual({ row: 1, col: 0 });
    expect(boxRows(1)).toBe(1);
    expect(boxRows(BOX_KEYS_PER_ROW)).toBe(1);
    expect(boxRows(BOX_KEYS_PER_ROW + 1)).toBe(2);
  });

  it("shows the handoff's first non-blank lines on the box's screen, each cut", () => {
    expect(boxScreen("# Hand it over\n\nThis is a test. Do it and I'll review what you hand back.\nthree\nfour", 20)).toEqual([
      "# Hand it over",
      "This is a test. Do…",
      "three",
    ]);
    expect(boxScreen("  \n")).toEqual([]);
  });
});
