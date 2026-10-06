import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_INS } from "./builtins";
import { checkFactoryCredential } from "./factory-checks.testkit";
import { serializeCollection } from "./folder";
import { localRefNames } from "./images";

const ROOT = join(__dirname, "..", "collections");

describe("BUILT_INS", () => {
  it("loads the three built-ins in order, with five, five and two badges", () => {
    expect(BUILT_INS.map((b) => [b.slug, b.collection.name, Object.keys(b.credentials).length])).toEqual([
      ["cardano-dev-skills", "Cardano Dev Skills", 5],
      ["course-authoring", "Course authoring", 5],
      ["nostr-relays", "Nostr relays", 2],
    ]);
  });

  for (const builtIn of BUILT_INS) {
    describe(builtIn.slug, () => {
      const { collection, credentials } = builtIn;

      it("keeps collection.json in the data folder's own format", () => {
        const text = readFileSync(join(ROOT, builtIn.slug, "collection.json"), "utf8");
        expect(serializeCollection(collection)).toBe(text);
        expect(collection.description).not.toBe("");
      });

      it("orders exactly its credential files, each with a distinct positive code", () => {
        expect([...collection.order].sort()).toEqual(Object.keys(credentials).sort());
        expect(new Set(collection.order).size).toBe(collection.order.length);
        expect(Object.keys(collection.codes).sort()).toEqual([...collection.order].sort());
        const codes = Object.values(collection.codes);
        expect(new Set(codes).size).toBe(codes.length);
        for (const code of codes) expect(Number.isInteger(code) && code > 0).toBe(true);
      });

      for (const [slug, markdown] of Object.entries(credentials)) {
        describe(slug, () => {
          checkFactoryCredential(markdown, { slug, collectionSlug: builtIn.slug });

          it("refers to no picture or video, and no heading ends in a period", () => {
            expect(localRefNames(markdown, () => true)).toEqual([]);
            expect(markdown).not.toMatch(/^#{1,6}\s.*\.\s*$/m);
          });
        });
      }
    });
  }
});
