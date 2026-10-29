import { describe, expect, it } from "vitest";
import { badgeFingerprints, collectionFingerprint, defaultPaletteIndex } from "./fingerprint";

// Reference digests from `printf %s '<input>' | shasum -a 256`.
const SHA: Record<string, string> = {
  "coach/collection:eng": "26300ecb6cffdafec38577fbe8e8b6f23454dcd0672338af922e3f3a867d461e",
  "coach/credential:eng/review": "f8cdb84ad00e8612ec06461dc5b826b432f2538b46b047902c84c2bef0907a09",
  "coach/credential:équipe/revue": "34bce34f3020eb153200b56acff42e864a6e41bd67627cd45fb7495cc5280133",
};
const sha = (s: string) => SHA[s];

describe("badge fingerprints", () => {
  it("are 56 and 64 hex characters from the namespaced slugs (KTD2)", async () => {
    const fp = await badgeFingerprints("eng", "review");
    expect(fp.outerHex).toMatch(/^[0-9a-f]{56}$/);
    expect(fp.innerHex).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.outerHex).toBe(sha("coach/collection:eng").slice(0, 56));
    expect(fp.innerHex).toBe(sha("coach/credential:eng/review"));
    expect(await collectionFingerprint("eng")).toBe(fp.outerHex);
  });

  it("are stable across calls and differ for different slugs", async () => {
    const a = await badgeFingerprints("eng", "review");
    expect(await badgeFingerprints("eng", "review")).toEqual(a);
    const b = await badgeFingerprints("eng", "testing");
    expect(b.outerHex).toBe(a.outerHex);
    expect(b.innerHex).not.toBe(a.innerHex);
    const c = await badgeFingerprints("ops", "review");
    expect(c.outerHex).not.toBe(a.outerHex);
    expect(c.innerHex).not.toBe(a.innerHex);
  });

  it("handles non-ASCII slugs as UTF-8", async () => {
    const fp = await badgeFingerprints("équipe", "revue");
    expect(fp.innerHex).toBe(sha("coach/credential:équipe/revue"));
  });

  it("Covers AE1. Editing a credential's name, task or rubric leaves its fingerprints unchanged", async () => {
    // Fingerprints take only slugs, so no credential content can reach them.
    const credential = { slug: "review", collectionSlug: "eng", name: "Review", task: "Do it.", rubric: "Good." };
    const before = await badgeFingerprints(credential.collectionSlug, credential.slug);
    const edited = { ...credential, name: "Deep review", task: "Do it twice.", rubric: "Great." };
    expect(await badgeFingerprints(edited.collectionSlug, edited.slug)).toEqual(before);
  });
});

describe("defaultPaletteIndex", () => {
  it("follows the outer fingerprint like palette_for: first 8 hex mod 10", async () => {
    expect(defaultPaletteIndex("00000000" + "0".repeat(48))).toBe(0);
    expect(defaultPaletteIndex("0000000b" + "f".repeat(48))).toBe(1);
    expect(defaultPaletteIndex("ffffffff" + "0".repeat(48))).toBe(0xffffffff % 10);
    const outer = await collectionFingerprint("eng");
    const i = defaultPaletteIndex(outer);
    expect(i).toBe(parseInt(outer.slice(0, 8), 16) % 10);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(10);
  });
});
