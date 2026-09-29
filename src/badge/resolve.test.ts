import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory";
import { PALETTES, lightInterior, withCustomRings } from "./palettes";
import { badgeFingerprints, defaultPaletteIndex } from "./fingerprint";
import { buildBadgeInput, tokensFor } from "./resolve";
import type { Collection } from "../domain/types";

const collection: Collection = { slug: "eng", name: "Engineering", description: "", order: ["review"], codes: { review: 1 } };
const credential = { slug: "review", name: "Code review" };

describe("tokensFor", () => {
  it("uses the fingerprint default when no preset is chosen", async () => {
    const { outerHex } = await badgeFingerprints("eng", "review");
    expect(tokensFor({ palette: null, colors: null }, outerHex)).toEqual(lightInterior(PALETTES[defaultPaletteIndex(outerHex)]));
  });

  it("uses the chosen preset, with custom rings on top", async () => {
    const { outerHex } = await badgeFingerprints("eng", "review");
    const teal = PALETTES.find((p) => p.slug === "07-teal-ice")!;
    expect(tokensFor({ palette: teal.slug, colors: null }, outerHex)).toEqual(lightInterior(teal));
    const colors = { ring: "#112233", innerRing: "#445566" };
    expect(tokensFor({ palette: teal.slug, colors }, outerHex)).toEqual(lightInterior(withCustomRings(teal, colors.ring, colors.innerRing)));
  });
});

describe("buildBadgeInput", () => {
  it("defaults titles to the credential and collection names", async () => {
    const { input, artMissing } = await buildBadgeInput(new MemoryStorage({}), collection, credential);
    expect(input.mainTitle).toBe("Code review");
    expect(input.eyebrowTitle).toBe("Engineering");
    expect(input.artDataUri).toBeUndefined();
    expect(artMissing).toBe(false);
  });

  it("reads art through storage, and reports a missing art file", async () => {
    const storage = new MemoryStorage({});
    storage.seedImage("collections/eng/badge/art-00000000.png", "data:image/png;base64,AAAA");
    const withArt = { ...collection, badge: { art: "collections/eng/badge/art-00000000.png" } };
    expect((await buildBadgeInput(storage, withArt, credential)).input.artDataUri).toBe("data:image/png;base64,AAAA");
    const missing = { ...collection, badge: { art: "collections/eng/badge/gone.png" } };
    const result = await buildBadgeInput(storage, missing, credential);
    expect(result.artMissing).toBe(true);
    expect(result.input.artDataUri).toBeUndefined();
  });
});
