// Badge renderer, ported from credential-badges generator/gen.py (ring_ticks, esc,
// fit_title, _wrap2, lay_title, _plate_art, render_svg).
// credential-badges is licensed under Apache-2.0. See NOTICE.
//
// Differences from the source: no OB3 <metadata> or openbadges:credential blocks,
// no ASCII title sanitizer (titles keep every character, and glyphs outside the
// embedded font subset fall back to the system font), and the plate labels read
// COLLECTION and CREDENTIAL where the source reads COURSE/COURSE_ID and MODULE/SLT_HASH.

import fontFace from "./fonts.css?raw";
import { ALL_TOKENS, type BadgeTokenName, type BadgeTokens } from "./palettes";

export type BadgeRenderInput = {
  /** Credential name, the large title. */
  mainTitle: string;
  /** Collection name, the smaller title above it. */
  eyebrowTitle: string;
  /** Outer ring fingerprint: 28 bytes as 56 hex characters. */
  outerHex: string;
  /** Inner ring fingerprint: 32 bytes as 64 hex characters. */
  innerHex: string;
  /** Fully resolved palette tokens, interior included (see lightInterior). */
  tokens: BadgeTokens;
  /** Optional plate art as a data URI. */
  artDataUri?: string;
};

const CX = 512;
const CY = 512;
const R_OUT = 472;
const R_IN = 440;

// Plate art sits under a scrim so the text stays legible. Same opacity as the source.
const PLATE_SCRIM_OPACITY = "0.78";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Python prints a float with at least one decimal ("440.0"), so y values match the source.
function pyFloat(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

function ringTicks(R: number, hex: string, color: string, hair: string): { lit: string[]; dim: string[] } {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  const gs = 360 / bytes.length;
  const lead = (gs - 8) / 2;
  const lit: string[] = [];
  const dim: string[] = [];
  bytes.forEach((bv, bi) => {
    const g0 = -90 + bi * gs;
    for (let k = 0; k < 8; k++) {
      const bit = (bv >> (7 - k)) & 1;
      const msb = k === 0;
      const a = ((g0 + lead + (k + 0.5)) * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const L = bit ? (msb ? 18 : 13) : msb ? 8 : 5;
      const r0 = R - L / 2;
      const r1 = R + L / 2;
      const xy =
        `x1="${(CX + r0 * c).toFixed(2)}" y1="${(CY + r0 * s).toFixed(2)}" ` +
        `x2="${(CX + r1 * c).toFixed(2)}" y2="${(CY + r1 * s).toFixed(2)}"`;
      if (bit) {
        const w = msb ? 3.4 : 2.6;
        lit.push(`<line ${xy} stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`);
      } else {
        dim.push(`<line ${xy} stroke="${hair}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>`);
      }
    }
  });
  return { lit, dim };
}

/** Split into at most 2 lines at the space nearest the middle. Works on code points. */
function wrap2(chars: string[]): string[] {
  const mid = Math.floor(chars.length / 2);
  const l = mid > 0 ? chars.lastIndexOf(" ", mid - 1) : -1;
  const r = chars.indexOf(" ", mid);
  if (l < 0 && r < 0) return [chars.join("")];
  const cut = l < 0 ? r : r < 0 ? l : mid - l <= r - mid ? l : r;
  return [chars.slice(0, cut).join("").trim(), chars.slice(cut).join("").trim()];
}

/**
 * Lay a title as 1 line at the largest size up to `base`. If that drops below
 * `minOne`, wrap to 2 lines sized by the longer line. Never below `floor`.
 */
export function layTitle(
  text: string,
  base: number,
  maxw: number,
  factor: number,
  minOne: number,
  floor = 15,
): { lines: string[]; size: number } {
  const chars = Array.from(text);
  const n = Math.max(chars.length, 1);
  const one = Math.min(base, Math.trunc(maxw / (factor * n)));
  if (one >= minOne || !text.includes(" ")) return { lines: [text], size: Math.max(one, floor) };
  const lines = wrap2(chars);
  if (lines.length === 1) return { lines, size: Math.max(one, floor) };
  const longest = Math.max(...lines.map((ln) => Array.from(ln).length));
  return { lines, size: Math.max(Math.min(base, Math.trunc(maxw / (factor * longest))), floor) };
}

function checkHex(label: string, hex: string, nbytes: number): void {
  if (!new RegExp(`^[0-9a-fA-F]{${nbytes * 2}}$`).test(hex)) {
    throw new Error(`${label} must be ${nbytes * 2} hex characters`);
  }
}

/** Render a badge SVG. Pure and synchronous: the same input always gives the same string. */
export function renderBadgeSvg(input: BadgeRenderInput): string {
  const { mainTitle, eyebrowTitle, outerHex, innerHex, tokens: P, artDataUri } = input;
  checkHex("outerHex", outerHex, 28);
  checkHex("innerHex", innerHex, 32);

  const c = (k: BadgeTokenName) => `var(--${k}, ${P[k]})`;
  const outer = ringTicks(R_OUT, outerHex, c("prim"), c("hair"));
  const inner = ringTicks(R_IN, innerHex, c("sec"), c("hair"));

  // Palette vars live in a per-element style attribute, not a global rule, so
  // many badges can share a page without their colors colliding.
  const varStyle = ALL_TOKENS.map((k) => `--${k}:${P[k]};`).join("");
  const p: string[] = [];
  p.push(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'viewBox="0 0 1024 1024" width="1024" height="1024" role="img" ' +
      `style="${varStyle}" ` +
      `aria-label="Andamio credential · ${esc(mainTitle)} (${esc(eyebrowTitle)})">`,
  );
  p.push(
    "<defs>" +
      "<style>" +
      fontFace +
      '.sans{font-family:"Archivo",sans-serif;}.mono{font-family:"Spline Sans Mono",monospace;}' +
      "</style>" +
      `<radialGradient id="field" cx="50%" cy="44%" r="62%"><stop offset="0%" stop-color="${c("raised")}"/><stop offset="70%" stop-color="${c("ink")}"/><stop offset="100%" stop-color="${c("deep")}"/></radialGradient>` +
      `<linearGradient id="core" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c("core1")}"/><stop offset="100%" stop-color="${c("core2")}"/></linearGradient>` +
      '<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      "</defs>",
  );

  p.push(`<circle cx="${CX}" cy="${CY}" r="500" fill="url(#field)" stroke="${c("hair")}" stroke-width="2"/>`);
  p.push(`<circle cx="${CX}" cy="${CY}" r="488" fill="none" stroke="${c("hair")}" stroke-width="1.25" opacity="0.7"/>`);
  p.push(`<circle cx="${CX}" cy="${CY}" r="${R_IN}" fill="none" stroke="${c("sec")}" stroke-width="1" opacity="0.16"/>`);
  p.push("<g>" + outer.dim.join("") + inner.dim.join("") + "</g>");
  p.push('<g filter="url(#glow)">' + inner.lit.join("") + outer.lit.join("") + "</g>");
  // Start marker at 12 o'clock, where byte 0 begins.
  p.push(`<path d="M ${CX} ${CY - R_OUT - 19} l 6 -11 l -12 0 z" fill="${c("prim")}" opacity="0.85"/>`);

  p.push(`<circle cx="${CX}" cy="${CY}" r="424" fill="none" stroke="${c("hair")}" stroke-width="1.25" opacity="0.55"/>`);
  p.push(`<circle cx="${CX}" cy="${CY}" r="412" fill="url(#core)" stroke="${c("hair")}" stroke-width="1.5"/>`);
  if (artDataUri) {
    p.push(
      `<defs><clipPath id="plate-art"><circle cx="${CX}" cy="${CY}" r="411"/></clipPath></defs>` +
        `<image href="${esc(artDataUri)}" x="${CX - 412}" y="${CY - 412}" width="824" height="824" ` +
        'preserveAspectRatio="xMidYMid slice" clip-path="url(#plate-art)"/>' +
        `<circle cx="${CX}" cy="${CY}" r="411" fill="${c("core1")}" fill-opacity="${PLATE_SCRIM_OPACITY}"/>`,
    );
  }

  const T = (y: string, s: string, size: number, fill: string, cls: string, w?: number, ls?: number) => {
    let a = `<text class="${cls}" x="${CX}" y="${y}" text-anchor="middle" font-size="${size}" fill="${fill}"`;
    if (w) a += ` font-weight="${w}"`;
    if (ls !== undefined) a += ` letter-spacing="${ls}"`;
    return a + `>${s}</text>`;
  };

  // Centre content: titles are the heroes, fingerprints sit below the divider.
  // The whole block is measured and centred, with the maker's mark at the bottom.
  const items: Array<[number, (y: number) => void]> = [];
  let cur = 0;
  const emit = (fn: (y: number) => void, advance: number) => {
    items.push([cur, fn]);
    cur += advance;
  };
  const text =
    (s: string, size: number, fill: string, cls: string, w?: number, ls?: number) => (y: number) =>
      p.push(T(pyFloat(y), s, size, fill, cls, w, ls));

  const eyebrow = layTitle(eyebrowTitle, 34, 500, 0.54, 24);
  const main = layTitle(mainTitle, 60, 520, 0.58, 40);
  const EG = 18; // gap from an eyebrow label's baseline to the title's cap-top

  emit(text("COLLECTION", 11, c("imuted"), "mono", undefined, 4), Math.trunc(EG + eyebrow.size * 0.72));
  for (const ln of eyebrow.lines) emit(text(esc(ln), eyebrow.size, c("ctitle"), "sans", 600), Math.trunc(eyebrow.size * 1.12));
  cur += 22;
  emit(text("CREDENTIAL", 11, c("imuted"), "mono", undefined, 4), Math.trunc(EG + main.size * 0.72));
  for (const ln of main.lines) emit(text(esc(ln), main.size, c("mtitle"), "sans", 800), Math.trunc(main.size * 1.06));
  cur += 40;
  const divRel = cur;
  cur += 54;
  emit(text("COLLECTION", 11, c("ctitle"), "mono", undefined, 3), 24); // outer-ring hue
  emit(text(outerHex, 15, c("itext"), "mono", undefined, 0), 42);
  emit(text("CREDENTIAL", 11, c("mtitle"), "mono", undefined, 3), 24); // inner-ring hue
  emit(text(innerHex, 13, c("itext"), "mono", undefined, 0), 0);

  const start = 532 - cur / 2;
  for (const [rel, fn] of items) fn(start + rel);
  const dy = (start + divRel).toFixed(1);
  p.push(`<line x1="${CX - 150}" y1="${dy}" x2="${CX + 150}" y2="${dy}" stroke="${c("iline")}" stroke-width="1.25"/>`);
  p.push(T("884", "ANDAMIO", 9, c("imuted"), "sans", 600, 6));
  p.push("</svg>");
  return p.join("");
}

/** SVG as a data URI for an <img>. Uses encodeURIComponent, which handles non-ASCII (btoa would throw). */
export function badgeDataUri(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
