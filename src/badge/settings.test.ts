import { describe, expect, it } from "vitest";
import type { Collection } from "../domain/types";
import { parseBadgeSettings, resolveBadgeSettings, resolvedTitles, type BadgeSettings } from "./settings";

function coll(badge?: BadgeSettings, badgeOverrides?: Record<string, BadgeSettings>): Collection {
  return {
    slug: "eng",
    name: "Engineering",
    description: "",
    order: ["a", "b"],
    codes: { a: 1, b: 2 },
    ...(badge ? { badge } : {}),
    ...(badgeOverrides ? { badgeOverrides } : {}),
  };
}

describe("parseBadgeSettings", () => {
  it("accepts every field", () => {
    const raw = {
      palette: "pine-gold",
      colors: { ring: "#112233", innerRing: "#AABBCC" },
      art: "collections/eng/badge/art-1234abcd.png",
      title: { main: "Main", eyebrow: "Eyebrow" },
    };
    expect(parseBadgeSettings(raw)).toEqual({ settings: raw });
  });

  it("accepts an empty object, partial titles and an explicit null art", () => {
    expect(parseBadgeSettings({})).toEqual({ settings: {} });
    expect(parseBadgeSettings({ title: { main: "M" } })).toEqual({ settings: { title: { main: "M" } } });
    expect(parseBadgeSettings({ art: null })).toEqual({ settings: { art: null } });
  });

  it.each([
    ["a string", "pine-gold"],
    ["null", null],
    ["an array", []],
    ["a numeric palette", { palette: 3 }],
    ["colors without innerRing", { colors: { ring: "#112233" } }],
    ["a non-hex color", { colors: { ring: "red", innerRing: "#112233" } }],
    ["a numeric art", { art: 5 }],
    ["an absolute art path", { art: "/etc/passwd" }],
    ["an art path that climbs out", { art: "../outside.png" }],
    ["a string title", { title: "Main" }],
    ["a numeric title field", { title: { main: 1 } }],
    ["an unknown field", { palette: "pine-gold", sparkle: true }],
  ])("rejects %s", (_label, raw) => {
    const result = parseBadgeSettings(raw);
    expect(result).toMatchObject({ invalid: true });
    expect((result as { message: string }).message).not.toBe("");
  });
});

describe("resolveBadgeSettings", () => {
  it("defaults everything when a collection has no badge settings", () => {
    expect(resolveBadgeSettings(coll(), "a")).toEqual({ palette: null, colors: null, art: null, title: {} });
  });

  it("Covers AE2. The collection preset applies, an override wins, and a collection change leaves the override in place", () => {
    const before = coll({ palette: "pine-gold" }, { b: { palette: "teal-ice" } });
    expect(resolveBadgeSettings(before, "a").palette).toBe("pine-gold");
    expect(resolveBadgeSettings(before, "b").palette).toBe("teal-ice");

    const after = { ...before, badge: { palette: "wine-crimson" } };
    expect(resolveBadgeSettings(after, "a").palette).toBe("wine-crimson");
    expect(resolveBadgeSettings(after, "b").palette).toBe("teal-ice");
  });

  it("Covers AE3. Clearing the override falls back to the collection", () => {
    const withOverride = coll({ palette: "wine-crimson" }, { b: { palette: "teal-ice" } });
    const cleared = { ...withOverride, badgeOverrides: {} };
    expect(resolveBadgeSettings(cleared, "b").palette).toBe("wine-crimson");
    const { badgeOverrides: _gone, ...noMap } = withOverride;
    expect(resolveBadgeSettings(noMap, "b").palette).toBe("wine-crimson");
  });

  it("does not let a palette-only override inherit the collection's custom colors", () => {
    const c = coll({ palette: "pine-gold", colors: { ring: "#112233", innerRing: "#445566" } }, { b: { palette: "teal-ice" } });
    expect(resolveBadgeSettings(c, "a")).toMatchObject({ palette: "pine-gold", colors: { ring: "#112233", innerRing: "#445566" } });
    expect(resolveBadgeSettings(c, "b")).toMatchObject({ palette: "teal-ice", colors: null });
  });

  it("resolves a colors-only override with the default palette, not the collection's", () => {
    const c = coll({ palette: "pine-gold" }, { b: { colors: { ring: "#010203", innerRing: "#040506" } } });
    expect(resolveBadgeSettings(c, "b")).toMatchObject({ palette: null, colors: { ring: "#010203", innerRing: "#040506" } });
  });

  it("merges art and title field by field, and an explicit null art means no art", () => {
    const c = coll(
      { palette: "pine-gold", art: "collections/eng/badge/art-00000000.png", title: { eyebrow: "ENG" } },
      { a: { title: { main: "Reviewer" } }, b: { art: null, title: { main: "", eyebrow: "" } } },
    );
    expect(resolveBadgeSettings(c, "a")).toEqual({
      palette: "pine-gold",
      colors: null,
      art: "collections/eng/badge/art-00000000.png",
      title: { main: "Reviewer", eyebrow: "ENG" },
    });
    expect(resolveBadgeSettings(c, "b")).toEqual({ palette: "pine-gold", colors: null, art: null, title: { eyebrow: "ENG" } });
  });
});

describe("resolvedTitles", () => {
  it("defaults to the credential name and the collection name, and the title override wins", () => {
    const none = resolveBadgeSettings(coll(), "a");
    expect(resolvedTitles("Code review", "Engineering", none)).toEqual({ main: "Code review", eyebrow: "Engineering" });
    const set = resolveBadgeSettings(coll({ title: { eyebrow: "ENG" } }, { a: { title: { main: "Reviewer" } } }), "a");
    expect(resolvedTitles("Code review", "Engineering", set)).toEqual({ main: "Reviewer", eyebrow: "ENG" });
  });
});
