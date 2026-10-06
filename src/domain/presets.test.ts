import { describe, expect, it } from "vitest";
import { checkFactoryCredential } from "./factory-checks.testkit";
import { PRESETS, presetCredential } from "./presets";
import { testPrompt } from "./prompts";
import { rubricParts } from "./secondOpinion";

describe("PRESETS", () => {
  it("has a small set with distinct ids", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  for (const preset of PRESETS) {
    describe(preset.id, () => {
      checkFactoryCredential(preset.markdown, { slug: preset.id, collectionSlug: "presets" });
    });
  }

  it("Check an answer key has one point per item, each its own call", () => {
    const answerKey = presetCredential(PRESETS.find((p) => p.id === "check-an-answer-key")!, "presets");
    const { points } = rubricParts(answerKey.rubric);
    expect(points).toHaveLength(5);
    expect(new Set(points).size).toBe(5);
    expect(points.filter((p) => p.startsWith("Holds."))).toHaveLength(2);
  });

  it("Say how sure you are has three points, and its answer key reaches each of them as notes", () => {
    const howSure = presetCredential(PRESETS.find((p) => p.id === "say-how-sure-you-are")!, "presets");
    const { points, notes } = rubricParts(howSure.rubric);
    expect(points).toHaveLength(3);
    expect(points[0]).toMatch(/^Questions 2 and 6/);
    for (let q = 1; q <= 6; q++) expect(notes).toContain(`Question ${q}:`);
    expect(notes).toContain("Met when every point holds.");
  });

  it("Tighten a learning target's task holds the flawed targets and its rubric holds coach's fixes", () => {
    const tighten = presetCredential(PRESETS.find((p) => p.id === "tighten-a-learning-target")!, "presets");
    expect(tighten.task).toContain("I can add at least one teacher to a course.");
    expect(tighten.rubric).toContain('"I can add a teacher to a course."');
    expect(testPrompt(tighten)).not.toContain("I can add a teacher to a course.");
  });
});
