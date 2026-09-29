import { describe, expect, it } from "vitest";
import { KEYS_PER_PAGE, OTHER_ARC, cutLine, encoderAngle, replyScreen, trigKeys, trigPages, type EarnedCell } from "./mappings";

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
