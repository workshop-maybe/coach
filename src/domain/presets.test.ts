import { describe, expect, it } from "vitest";
import { parseCredentialMd, serializeCredentialMd } from "./credential-md";
import { PRESETS, presetCredential } from "./presets";
import { testPrompt } from "./prompts";
import { rubricParts } from "./secondOpinion";
import { slugify } from "./slug";

const BRITISH = /\b(?:behaviour|colour|favour|honour|organis|recognis|realis|summaris|licence|centre|analys(?:e|ed|ing)\b|catalogue|artefact)/i;

describe("PRESETS", () => {
  it("has a small set with distinct ids", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  for (const preset of PRESETS) {
    describe(preset.id, () => {
      const credential = presetCredential(preset, "presets");

      it("parses into a credential with a name, targets, task and rubric", () => {
        expect(credential.name).not.toBe("");
        expect(slugify(credential.name)).toBe(preset.id);
        expect(credential.learningTargets.length).toBeGreaterThan(0);
        for (const t of credential.learningTargets) expect(t).toMatch(/^I can /);
        expect(credential.task).not.toBe("");
        expect(credential.rubric).not.toBe("");
      });

      it("names where it came from: a coach file, or written for the app", () => {
        const source = credential.extraSections.find((e) => e.heading === "Source");
        expect(source?.body).toMatch(/^(?:Ported from coach, \S+\.(?:ya?ml|md)|Written for Andamio Desktop)/);
      });

      it("is saved exactly as written", () => {
        expect(serializeCredentialMd(credential)).toBe(preset.markdown);
        expect(parseCredentialMd(serializeCredentialMd(credential), { slug: preset.id, collectionSlug: "presets" })).toEqual(credential);
      });

      it("follows the copy rules: no em-dash, no heading period, American spelling", () => {
        expect(preset.markdown).not.toContain("—");
        expect(credential.name).not.toMatch(/\.$/);
        expect(preset.markdown).not.toMatch(BRITISH);
      });

      it("has rubric points with distinct texts", () => {
        const { points } = rubricParts(credential.rubric);
        expect(points.length).toBeGreaterThan(0);
        // A repeat would be counted once, so the raw list items must already differ.
        const items = credential.rubric.split("\n").filter((l) => /^(?:[-*+]|\d{1,9}[.)])\s/.test(l));
        expect(new Set(items.map((l) => l.replace(/^(?:[-*+]|\d{1,9}[.)])\s+/, ""))).size).toBe(items.length);
      });

      it("keeps the rubric and source out of the test prompt", () => {
        const prompt = testPrompt(credential);
        for (const line of credential.rubric.split("\n").filter((l) => l.trim() !== "")) expect(prompt).not.toContain(line);
        const source = credential.extraSections.find((e) => e.heading === "Source");
        expect(prompt).not.toContain(source!.body.trim());
      });
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
