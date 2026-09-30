import { describe, expect, it } from "vitest";
import { parseCredentialMd, serializeCredentialMd } from "./credential-md";
import { PRESETS, presetCredential } from "./presets";
import { testPrompt } from "./prompts";
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

      it("names the coach file it came from", () => {
        const source = credential.extraSections.find((e) => e.heading === "Source");
        expect(source?.body).toMatch(/^Ported from coach, \S+\.(?:ya?ml|md)/);
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

      it("keeps the rubric and source out of the test prompt", () => {
        const prompt = testPrompt(credential);
        for (const line of credential.rubric.split("\n").filter((l) => l.trim() !== "")) expect(prompt).not.toContain(line);
        expect(prompt).not.toContain("Ported from coach");
      });
    });
  }

  it("Tighten a learning target's task holds the flawed targets and its rubric holds coach's fixes", () => {
    const tighten = presetCredential(PRESETS.find((p) => p.id === "tighten-a-learning-target")!, "presets");
    expect(tighten.task).toContain("I can add at least one teacher to a course.");
    expect(tighten.rubric).toContain('"I can add a teacher to a course."');
    expect(testPrompt(tighten)).not.toContain("I can add a teacher to a course.");
  });
});
