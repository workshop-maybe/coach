import { describe, expect, it } from "vitest";
import {
  BASE_TOKENS,
  INTERIOR_TOKENS,
  PALETTES,
  fillDefaults,
  lightInterior,
  mix,
  withCustomRings,
} from "./palettes";

const HEX = /^#[0-9A-F]{6}$/;

describe("PALETTES", () => {
  it("holds the ten credential-badges presets in order, each with a slug, a name and ten base tokens", () => {
    expect(PALETTES).toHaveLength(10);
    expect(PALETTES.map((p) => p.name)).toEqual([
      "Andamio Navy",
      "Cardano Blue",
      "Indigo Violet",
      "Pine Gold",
      "Wine Crimson",
      "Mono Ember",
      "Teal Ice",
      "Plum Sunset",
      "Onyx Emerald",
      "Graphite Electric",
    ]);
    expect(new Set(PALETTES.map((p) => p.slug)).size).toBe(10);
    for (const p of PALETTES) {
      for (const k of BASE_TOKENS) expect(p[k]).toMatch(HEX);
    }
  });

  it("keeps Andamio Navy's values exactly", () => {
    const navy = PALETTES[0];
    expect(navy.slug).toBe("01-andamio-navy");
    expect(navy.prim).toBe("#EE6C3A");
    expect(navy.sec).toBe("#5BB8D4");
    expect(navy.hair).toBe("#2C3858");
  });
});

describe("mix", () => {
  it("blends one hex color toward another", () => {
    expect(mix("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mix("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
    expect(mix("#5FD0E8", "#FFFFFF", 0.4)).toBe("#9FE3F1");
    expect(mix("#123456", "#FFFFFF", 0.4)).toBe("#71859A");
  });

  it("rounds half to even like Python's round", () => {
    expect(mix("#000000", "#010101", 0.5)).toBe("#000000");
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });
});

describe("lightInterior", () => {
  it("matches credential-badges for Andamio Navy", () => {
    const navy = PALETTES[0];
    const t = lightInterior(navy);
    // Values printed by credential-badges colors.light_interior(PALETTES[0]).
    expect(t.core2).toBe("#FEF3EF");
    expect(t.ctitle).toBe("#5D3024");
    expect(t.mtitle).toBe("#284C5B");
    // Same formula, spelled out.
    expect(t.core2).toBe(mix("#FFFFFF", navy.prim, 0.08));
    expect(t.ctitle).toBe(mix(navy.prim, "#0C0F17", 0.64));
    expect(t.mtitle).toBe(mix(navy.sec, "#0C0F17", 0.64));
  });

  it("sets the fixed interior tokens and keeps the field and rings exactly", () => {
    const navy = PALETTES[0];
    const t = lightInterior(navy);
    expect(t.core1).toBe("#FFFFFF");
    expect(t.itext).toBe("#15203A");
    expect(t.imuted).toBe("#5C6680");
    expect(t.iline).toBe("#E5E9F0");
    expect(t.slt_label).toBe(navy.sec);
    expect(t.ev_label).toBe(navy.sec);
    expect(t.extlabel).toBe(navy.slate);
    for (const k of BASE_TOKENS) expect(t[k]).toBe(navy[k]);
    for (const k of INTERIOR_TOKENS) expect(t[k]).toMatch(HEX);
  });
});

describe("fillDefaults", () => {
  it("defaults the interior to the dark field", () => {
    const navy = PALETTES[0];
    const t = fillDefaults(navy);
    expect(t.core1).toBe(navy.raised);
    expect(t.core2).toBe(navy.ink);
    expect(t.itext).toBe(navy.bone);
    expect(t.ctitle).toBe(navy.bone);
    expect(t.slt_label).toBe(navy.prim_lt);
    expect(t.ev_label).toBe(navy.sec_lt);
  });
});

describe("withCustomRings", () => {
  it("sets the ring hues, derives the light variants, and keeps the rest of the preset", () => {
    const pine = PALETTES[3];
    const p = withCustomRings(pine, "#5FD0E8", "#123456");
    expect(p.prim).toBe("#5FD0E8");
    expect(p.sec).toBe("#123456");
    expect(p.prim_lt).toBe("#9FE3F1");
    expect(p.sec_lt).toBe("#71859A");
    expect(p.prim_lt).toBe(mix("#5FD0E8", "#FFFFFF", 0.4));
    expect(p.sec_lt).toBe(mix("#123456", "#FFFFFF", 0.4));
    for (const k of ["deep", "ink", "raised", "bone", "slate", "hair"] as const) {
      expect(p[k]).toBe(pine[k]);
    }
    expect(p.slug).toBe(pine.slug);
    expect(p.name).toBe(pine.name);
    // The source preset is untouched.
    expect(pine.prim).toBe("#E9B23C");
  });

  it("feeds lightInterior so the titles follow the custom hues", () => {
    const t = lightInterior(withCustomRings(PALETTES[0], "#5FD0E8", "#123456"));
    expect(t.ctitle).toBe(mix("#5FD0E8", "#0C0F17", 0.64));
    expect(t.mtitle).toBe(mix("#123456", "#0C0F17", 0.64));
    expect(t.core2).toBe(mix("#FFFFFF", "#5FD0E8", 0.08));
  });
});
