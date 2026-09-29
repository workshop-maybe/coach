import { describe, expect, it } from "vitest";
import { PALETTES, lightInterior } from "./palettes";
import { badgeDataUri, layTitle, renderBadgeSvg, type BadgeRenderInput } from "./render";

const CX = 512;
const CY = 512;

// Sample fingerprints from credential-badges gen.py (28 and 32 bytes).
const OUTER = "6348bba0f9b7d7e0353715ece5946f3b61de433d314e84dad313a677";
const INNER = "a891203913065a08e2c87ea57b808bb0f6efa4e57f36bc1412f7c2cdd846a045";

function input(over: Partial<BadgeRenderInput> = {}): BadgeRenderInput {
  return {
    mainTitle: "Transactions",
    eyebrowTitle: "Andamio for Developers",
    outerHex: OUTER,
    innerHex: INNER,
    tokens: lightInterior(PALETTES[0]),
    ...over,
  };
}

type Tick = { r: number; angle: number; stroke: string };

function ticks(svg: string): Tick[] {
  const re = /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="([^"]+)"/g;
  const out: Tick[] = [];
  for (const m of svg.matchAll(re)) {
    const mx = (Number(m[1]) + Number(m[3])) / 2;
    const my = (Number(m[2]) + Number(m[4])) / 2;
    const r = Math.hypot(mx - CX, my - CY);
    const angle = (((Math.atan2(my - CY, mx - CX) * 180) / Math.PI + 90) % 360 + 360) % 360;
    out.push({ r, angle, stroke: m[5] });
  }
  return out;
}

function inBand(all: Tick[], lo: number, hi: number): Tick[] {
  return all.filter((t) => t.r >= lo && t.r <= hi);
}

// Port of credential-badges decode.py decode_ring: geometry and stroke token only.
function decodeRing(svg: string, token: string, lo: number, hi: number, nbytes: number): string {
  const gs = 360 / nbytes;
  const off = (gs - 8) / 2 + 0.5;
  const bits = new Map<number, Map<number, number>>();
  for (const t of inBand(ticks(svg), lo, hi)) {
    const bi = Math.floor(t.angle / gs);
    const k = Math.round(t.angle - bi * gs - off);
    if (k < 0 || k > 7 || bi < 0 || bi >= nbytes) continue;
    if (!bits.has(bi)) bits.set(bi, new Map());
    bits.get(bi)!.set(k, t.stroke.includes(token) ? 1 : 0);
  }
  let hex = "";
  for (let bi = 0; bi < nbytes; bi++) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | (bits.get(bi)?.get(k) ?? 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

type TextEl = { cls: string; y: number; size: number; weight?: string; body: string };

function texts(svg: string): TextEl[] {
  const re =
    /<text class="(sans|mono)" x="512" y="([\d.]+)" text-anchor="middle" font-size="(\d+)" fill="[^"]+"(?: font-weight="(\d+)")?(?: letter-spacing="[^"]+")?>([^<]*)<\/text>/g;
  return [...svg.matchAll(re)].map((m) => ({
    cls: m[1],
    y: Number(m[2]),
    size: Number(m[3]),
    weight: m[4],
    body: m[5],
  }));
}

const mainLines = (svg: string) => texts(svg).filter((t) => t.weight === "800");
const eyebrowLines = (svg: string) => texts(svg).filter((t) => t.weight === "600" && t.body !== "ANDAMIO");

describe("renderBadgeSvg", () => {
  it("is deterministic", () => {
    expect(renderBadgeSvg(input())).toBe(renderBadgeSvg(input()));
  });

  it("draws a 1024 disc with role img, the start marker and the core plate", () => {
    const svg = renderBadgeSvg(input());
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('viewBox="0 0 1024 1024" width="1024" height="1024" role="img"');
    expect(svg).toContain(`<path d="M 512 21 l 6 -11 l -12 0 z"`);
    expect(svg).toContain('<circle cx="512" cy="512" r="412" fill="url(#core)"');
    expect(svg).toContain('<filter id="glow"');
    expect(svg).toContain('<feGaussianBlur stdDeviation="2.4"');
    expect(svg).not.toContain("<metadata");
    expect(svg).not.toContain("openbadges");
  });

  it("embeds the fonts and the palette as var() tokens with literal fallbacks", () => {
    const svg = renderBadgeSvg(input());
    expect(svg).toContain("@font-face{font-family:'Archivo'");
    expect(svg).toContain("Spline Sans Mono");
    expect(svg).toContain("--prim:#EE6C3A;");
    expect(svg).toContain("--core2:#FEF3EF;");
    expect(svg).toContain('stroke="var(--prim, #EE6C3A)"');
    expect(svg).toContain('stroke="var(--sec, #5BB8D4)"');
  });

  it("has 224 outer and 256 inner ticks", () => {
    const all = ticks(renderBadgeSvg(input()));
    expect(inBand(all, 456, 486)).toHaveLength(224);
    expect(inBand(all, 424, 456)).toHaveLength(256);
  });

  it("decodes back to the outer and inner hex from tick geometry alone", () => {
    const svg = renderBadgeSvg(input());
    expect(decodeRing(svg, "--prim", 456, 486, 28)).toBe(OUTER);
    expect(decodeRing(svg, "--sec", 424, 456, 32)).toBe(INNER);
  });

  it("decodes other fingerprints too, including all zeros and all ones", () => {
    const outer = "00".repeat(14) + "ff".repeat(14);
    const inner = "0123456789abcdef".repeat(4);
    const svg = renderBadgeSvg(input({ outerHex: outer, innerHex: inner }));
    expect(decodeRing(svg, "--prim", 456, 486, 28)).toBe(outer);
    expect(decodeRing(svg, "--sec", 424, 456, 32)).toBe(inner);
  });

  it("rejects fingerprints of the wrong length or alphabet", () => {
    expect(() => renderBadgeSvg(input({ outerHex: OUTER.slice(2) }))).toThrow();
    expect(() => renderBadgeSvg(input({ innerHex: INNER + "00" }))).toThrow();
    expect(() => renderBadgeSvg(input({ innerHex: "zz" + INNER.slice(2) }))).toThrow();
  });

  it("shows both fingerprints under the COLLECTION and CREDENTIAL labels", () => {
    const t = texts(renderBadgeSvg(input())).map((e) => e.body);
    expect(t).toEqual([
      "COLLECTION",
      "Andamio for Developers",
      "CREDENTIAL",
      "Transactions",
      "COLLECTION",
      OUTER,
      "CREDENTIAL",
      INNER,
      "ANDAMIO",
    ]);
  });

  it("escapes titles in the text and the aria-label", () => {
    const main = `A<B & "C" 'D'`;
    const eyebrow = "X>Y & Z";
    const svg = renderBadgeSvg(input({ mainTitle: main, eyebrowTitle: eyebrow }));
    const escMain = "A&lt;B &amp; &quot;C&quot; &#39;D&#39;";
    const escEyebrow = "X&gt;Y &amp; Z";
    expect(mainLines(svg).map((t) => t.body)).toEqual([escMain]);
    expect(eyebrowLines(svg).map((t) => t.body)).toEqual([escEyebrow]);
    expect(svg).toContain(`aria-label="Andamio credential · ${escMain} (${escEyebrow})"`);
    expect(svg).not.toContain("A<B");
    expect(svg).not.toContain(`"C"`);
  });

  it("wraps an 80-character non-ASCII title to two lines at no less than the floor, keeping every letter (Covers AE5.)", () => {
    const title = "Évaluation des systèmes distribués à grande échelle: théorie, pratique, ûtilités";
    expect(Array.from(title)).toHaveLength(80);
    const lines = mainLines(renderBadgeSvg(input({ mainTitle: title })));
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.size).toBeGreaterThanOrEqual(15);
    expect(lines[0].size).toBe(lines[1].size);
    expect(lines.map((l) => l.body).join(" ")).toBe(title);
    // Wrapped lines stack downward.
    expect(lines[1].y).toBeGreaterThan(lines[0].y);
  });

  it("keeps non-Latin scripts and emoji unchanged", () => {
    const title = "東京 Ωmega 🚀";
    const svg = renderBadgeSvg(input({ mainTitle: title, eyebrowTitle: "Ünïcödé" }));
    expect(mainLines(svg).map((t) => t.body).join(" ")).toBe(title);
    expect(eyebrowLines(svg)[0].body).toBe("Ünïcödé");
  });

  it("draws the art image, clip and scrim only when art is given", () => {
    const art = "data:image/png;base64,iVBORw0KGgo=";
    const withArt = renderBadgeSvg(input({ artDataUri: art }));
    expect(withArt).toContain('<clipPath id="plate-art"><circle cx="512" cy="512" r="411"/></clipPath>');
    expect(withArt).toContain(
      `<image href="${art}" x="100" y="100" width="824" height="824" preserveAspectRatio="xMidYMid slice" clip-path="url(#plate-art)"/>`,
    );
    expect(withArt).toContain('r="411" fill="var(--core1, #FFFFFF)" fill-opacity="0.78"/>');
    // Art sits after the plate and before the text.
    const plate = withArt.indexOf('r="412" fill="url(#core)"');
    const image = withArt.indexOf("<image ");
    const firstText = withArt.indexOf("<text ");
    expect(plate).toBeLessThan(image);
    expect(image).toBeLessThan(firstText);

    const without = renderBadgeSvg(input());
    expect(without).not.toContain("plate-art");
    expect(without).not.toContain("<image");
    expect(without).not.toContain("fill-opacity=");
  });
});

describe("layTitle", () => {
  it("keeps short titles on one line at the base size", () => {
    expect(layTitle("Transactions", 60, 520, 0.58, 40)).toEqual({ lines: ["Transactions"], size: 60 });
  });

  it("shrinks a spaceless title to the floor on one line, like credential-badges", () => {
    expect(layTitle("x".repeat(80), 60, 520, 0.58, 40)).toEqual({ lines: ["x".repeat(80)], size: 15 });
  });

  it("counts code points, not UTF-16 units", () => {
    const astral = "🚀".repeat(10);
    // 20 UTF-16 units would shrink it to 44; 10 code points keep 60.
    expect(layTitle(astral, 60, 520, 0.58, 40).size).toBe(layTitle("x".repeat(10), 60, 520, 0.58, 40).size);
    expect(layTitle(astral, 60, 520, 0.58, 40).size).toBe(60);
  });
});

describe("badgeDataUri", () => {
  it("encodes with encodeURIComponent and round-trips non-ASCII", () => {
    const svg = renderBadgeSvg(input({ mainTitle: "Évaluation 東京 🚀" }));
    const uri = badgeDataUri(svg);
    const prefix = "data:image/svg+xml;charset=utf-8,";
    expect(uri.startsWith(prefix)).toBe(true);
    expect(decodeURIComponent(uri.slice(prefix.length))).toBe(svg);
  });
});
