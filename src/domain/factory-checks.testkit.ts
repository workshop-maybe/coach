// The rules every credential the app ships meets, presets and built-in badges alike (KTD10).
// Call checkFactoryCredential inside a describe block, once per credential.

import { expect, it } from "vitest";
import { parseCredentialMd, serializeCredentialMd } from "./credential-md";
import { testPrompt } from "./prompts";
import { rubricParts } from "./secondOpinion";
import { slugify } from "./slug";
import type { Slug } from "./types";

const BRITISH = /\b(?:behaviour|colour|favour|honour|organis|recognis|realis|summaris|licence|centre|analys(?:e|ed|ing)\b|catalogue|artefact)/i;

export function checkFactoryCredential(markdown: string, ids: { slug: Slug; collectionSlug: Slug }): void {
  const credential = parseCredentialMd(markdown, ids);

  it("parses into a credential with a name, targets, task and rubric", () => {
    expect(credential.name).not.toBe("");
    expect(slugify(credential.name)).toBe(ids.slug);
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
    expect(serializeCredentialMd(credential)).toBe(markdown);
    expect(parseCredentialMd(serializeCredentialMd(credential), ids)).toEqual(credential);
  });

  it("follows the copy rules: no em-dash, no heading period, American spelling", () => {
    expect(markdown).not.toContain("—");
    expect(credential.name).not.toMatch(/\.$/);
    expect(markdown).not.toMatch(BRITISH);
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
}
