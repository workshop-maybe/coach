import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/memory";
import { PALETTES, lightInterior, withCustomRings } from "./palettes";
import { badgeFingerprints, defaultPaletteIndex } from "./fingerprint";
import { buildBadgeInput, clearArtCache, renderBadgeFor, tokensFor } from "./resolve";
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

describe("art cache", () => {
  const path = "collections/eng/badge/art-00000000.png";
  const withArt = { ...collection, badge: { art: path } };

  function counting() {
    const storage = new MemoryStorage({});
    storage.seedImage(path, "data:image/png;base64,AAAA");
    let reads = 0;
    const read = storage.readDataUri.bind(storage);
    storage.readDataUri = (root, p) => {
      reads++;
      return read(root, p);
    };
    return { storage, reads: () => reads };
  }

  it("reads shared art once across badges, and clearArtCache forces a re-read", async () => {
    const { storage, reads } = counting();
    await buildBadgeInput(storage, withArt, credential);
    await buildBadgeInput(storage, withArt, { slug: "other", name: "Other" });
    expect(reads()).toBe(1);
    clearArtCache(storage);
    await buildBadgeInput(storage, withArt, credential);
    expect(reads()).toBe(2);
  });

  it("does not cache a missing file, so it is read again once it appears", async () => {
    const storage = new MemoryStorage({});
    const missing = { ...collection, badge: { art: "collections/eng/badge/later.png" } };
    expect((await buildBadgeInput(storage, missing, credential)).artMissing).toBe(true);
    storage.seedImage("collections/eng/badge/later.png", "data:image/png;base64,BBBB");
    expect((await buildBadgeInput(storage, missing, credential)).input.artDataUri).toBe("data:image/png;base64,BBBB");
  });

  it("renderBadgeFor reads art fresh and reports art it could not read", async () => {
    const { storage, reads } = counting();
    await buildBadgeInput(storage, withArt, credential); // warms the cache
    const before = reads();
    const saved = await renderBadgeFor(storage, withArt, credential);
    expect(reads()).toBe(before + 1);
    expect(saved.artMissing).toBe(false);
    expect(saved.svg).toContain("data:image/png;base64,AAAA");
    const gone = await renderBadgeFor(storage, { ...collection, badge: { art: "collections/eng/badge/gone.png" } }, credential);
    expect(gone.artMissing).toBe(true);
  });
});
