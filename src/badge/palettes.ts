// Badge palettes, ported from credential-badges generator/colors.py (PALETTES, _mix,
// light_interior) and generator/gen.py (BASE, INT, fill_defaults).
// credential-badges is licensed under Apache-2.0. See NOTICE.

/** Field and ring tokens: deep/ink/raised field, prim/sec ring hues with light variants, text and hairlines. */
export const BASE_TOKENS = [
  "deep",
  "ink",
  "raised",
  "prim",
  "prim_lt",
  "sec",
  "sec_lt",
  "bone",
  "slate",
  "hair",
] as const;

/** Interior (core plate) tokens. */
export const INTERIOR_TOKENS = [
  "core1",
  "core2",
  "itext",
  "imuted",
  "iline",
  "extlabel",
  "slt_label",
  "ev_label",
  "ctitle",
  "mtitle",
] as const;

export const ALL_TOKENS = [...BASE_TOKENS, ...INTERIOR_TOKENS] as const;

export type BaseTokenName = (typeof BASE_TOKENS)[number];
export type InteriorTokenName = (typeof INTERIOR_TOKENS)[number];
export type BadgeTokenName = (typeof ALL_TOKENS)[number];

export type BaseTokens = Record<BaseTokenName, string>;
/** Every token the renderer reads, fully resolved. */
export type BadgeTokens = Record<BadgeTokenName, string>;

export type Palette = BaseTokens & { slug: string; name: string };

// deep=outer field · ink=mid · raised=inner · prim=outer ring · sec=inner ring
export const PALETTES: readonly Palette[] = [
  { slug: "01-andamio-navy", name: "Andamio Navy", deep: "#0C1325", ink: "#121A2D", raised: "#1B2540",
    prim: "#EE6C3A", prim_lt: "#F6A07A", sec: "#5BB8D4", sec_lt: "#9ED8E8", bone: "#EAE6DD", slate: "#6E7A98", hair: "#2C3858" },
  { slug: "02-cardano-blue", name: "Cardano Blue", deep: "#091022", ink: "#0F1A33", raised: "#172742",
    prim: "#3B82F0", prim_lt: "#86B4F7", sec: "#33D6C4", sec_lt: "#8FE9DF", bone: "#E9EDF5", slate: "#6E7E9C", hair: "#26324E" },
  { slug: "03-indigo-violet", name: "Indigo Violet", deep: "#0E0A1F", ink: "#15112B", raised: "#201A3C",
    prim: "#8B6CF0", prim_lt: "#B9A6F7", sec: "#E86CA8", sec_lt: "#F2A6CC", bone: "#ECE7F2", slate: "#7A7196", hair: "#2E2A4A" },
  { slug: "04-pine-gold", name: "Pine Gold", deep: "#08140F", ink: "#0E1E18", raised: "#163026",
    prim: "#E9B23C", prim_lt: "#F3CE80", sec: "#46D6A0", sec_lt: "#92E8C6", bone: "#E7EDE6", slate: "#6E8478", hair: "#244236" },
  { slug: "05-wine-crimson", name: "Wine Crimson", deep: "#170A12", ink: "#22101B", raised: "#341A29",
    prim: "#F0524D", prim_lt: "#F59390", sec: "#F2A0B5", sec_lt: "#F7C4D2", bone: "#F2E7EA", slate: "#9A7E86", hair: "#3A2230" },
  { slug: "06-mono-ember", name: "Mono Ember", deep: "#0C1020", ink: "#121826", raised: "#1B2334",
    prim: "#EE6C3A", prim_lt: "#F6A07A", sec: "#F0A24A", sec_lt: "#F7C98A", bone: "#EAE6DD", slate: "#7A8092", hair: "#2C3344" },
  { slug: "07-teal-ice", name: "Teal Ice", deep: "#08151C", ink: "#0E2029", raised: "#163039",
    prim: "#5FD0E8", prim_lt: "#A6E6F2", sec: "#7FA8C8", sec_lt: "#B4CBE0", bone: "#E6EEF0", slate: "#6E8490", hair: "#23404A" },
  { slug: "08-plum-sunset", name: "Plum Sunset", deep: "#14091C", ink: "#1E1029", raised: "#2E1A3C",
    prim: "#F58A3C", prim_lt: "#F8B580", sec: "#C56CE0", sec_lt: "#DEA6EE", bone: "#F0E8F2", slate: "#86749A", hair: "#3A2A4A" },
  { slug: "09-onyx-emerald", name: "Onyx Emerald", deep: "#0A0D0B", ink: "#101310", raised: "#1A201A",
    prim: "#E7C24A", prim_lt: "#F1D98A", sec: "#3FB985", sec_lt: "#86D6B4", bone: "#ECEAE0", slate: "#7E8478", hair: "#2A332A" },
  { slug: "10-graphite-electric", name: "Graphite Electric", deep: "#0C0E12", ink: "#14171C", raised: "#1E232A",
    prim: "#FF6B4A", prim_lt: "#FF9E86", sec: "#34E0D0", sec_lt: "#86EFE4", bone: "#ECEEF0", slate: "#7A828E", hair: "#2A2F38" },
];

/** Python's round(): half to even. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Blend `hex` toward `toward` by fraction t (0..1). Port of colors._mix. Returns uppercase #RRGGBB. */
export function mix(hex: string, toward: string, t: number): string {
  const a = channels(hex);
  const b = channels(toward);
  return (
    "#" +
    a
      .map((v, i) => roundHalfEven(v + (b[i] - v) * t).toString(16).toUpperCase().padStart(2, "0"))
      .join("")
  );
}

function pickBase(p: BaseTokens): BaseTokens {
  const out = {} as BaseTokens;
  for (const k of BASE_TOKENS) out[k] = p[k];
  return out;
}

/** Interior tokens default to the dark field. Port of gen.fill_defaults. */
export function fillDefaults(p: BaseTokens & Partial<Record<InteriorTokenName, string>>): BadgeTokens {
  const core1 = p.core1 ?? p.raised;
  const itext = p.itext ?? p.bone;
  return {
    ...pickBase(p),
    core1,
    core2: p.core2 ?? p.ink,
    itext,
    imuted: p.imuted ?? p.slate,
    iline: p.iline ?? p.hair,
    extlabel: p.extlabel ?? p.slate,
    slt_label: p.slt_label ?? p.prim_lt,
    ev_label: p.ev_label ?? p.sec_lt,
    ctitle: p.ctitle ?? itext,
    mtitle: p.mtitle ?? itext,
  };
}

/**
 * The canonical interior: near-white plate with a faint primary tinge, dark text,
 * titles in dark shades of their ring hue. Field and rings stay exactly as given.
 * Port of colors.light_interior, followed by fill_defaults as render_svg does.
 */
export function lightInterior(p: BaseTokens): BadgeTokens {
  return fillDefaults({
    ...pickBase(p),
    core1: "#FFFFFF",
    core2: mix("#FFFFFF", p.prim, 0.08),
    itext: "#15203A",
    imuted: "#5C6680",
    iline: "#E5E9F0",
    ctitle: mix(p.prim, "#0C0F17", 0.64),
    mtitle: mix(p.sec, "#0C0F17", 0.64),
    slt_label: p.sec,
    ev_label: p.sec,
  });
}

/**
 * Custom colors set the two ring hues. The light variants are derived from them,
 * and the rest of the palette comes from `palette` (KTD7).
 */
export function withCustomRings(palette: Palette, ring: string, innerRing: string): Palette {
  return {
    ...palette,
    prim: ring,
    prim_lt: mix(ring, "#FFFFFF", 0.4),
    sec: innerRing,
    sec_lt: mix(innerRing, "#FFFFFF", 0.4),
  };
}
