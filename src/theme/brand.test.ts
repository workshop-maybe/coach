/// <reference types="node" />
// Brand guard: component styles take colors from the token layer and keep square
// corners. src/theme holds the tokens themselves; src/badge draws badge art,
// which follows credential-badges rather than the app's brand. The user guide's
// own styles under site/src hold to the same rules (U2, R16), and the guide never
// takes the app shell's App.css (KTD3).

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { filesUnder } from "../test/files";

const SRC = join(__dirname, "..");
const SITE = join(SRC, "..", "site", "src");
const EXEMPT = ["theme", "badge"];

function cssFiles(root: string, exempt: string[] = []): string[] {
  return filesUnder(root, (name) => name.endsWith(".css"), exempt);
}

/** Lines that break the guard, as "line: text". */
function brandViolations(css: string): string[] {
  const out: string[] = [];
  css.split("\n").forEach((text, i) => {
    const code = text.replace(/\/\*.*?\*\//g, "");
    const colorLiteral = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/.test(code);
    const radius = /border-radius\s*:\s*([^;]+)/.exec(code);
    // Square, round badge discs, and the window's own corners (the one exception).
    const badRadius = radius && !/^(0|50%|var\(--window-radius\))$/.test(radius[1].trim());
    if (colorLiteral || badRadius) out.push(`${i + 1}: ${text.trim()}`);
  });
  return out;
}

/**
 * Lines in a script that break the guard (KTD14). The intro's scenes are SVG and HTML
 * styled inline, which the stylesheet scan never sees: they still take
 * colours from tokens and keep square corners.
 */
function scriptViolations(code: string): string[] {
  const out: string[] = [];
  code.split("\n").forEach((text, i) => {
    const line = text.replace(/\/\/.*$/, "");
    const colorLiteral = /["'`]\s*#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/.test(line);
    const radius = /borderRadius\s*:\s*([^,}]+)/.exec(line);
    const badRadius = radius && !/^(0|["'](?:0|50%)["'])$/.test(radius[1].trim());
    if (colorLiteral || badRadius) out.push(`${i + 1}: ${text.trim()}`);
  });
  return out;
}

const INTRO = join(SRC, "intro");

function introScripts(): string[] {
  return filesUnder(INTRO, (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));
}

/** Every break in the stylesheets under root, as "file:line: text" with the file relative to root. */
function stylesheetViolations(root: string, exempt: string[] = []): string[] {
  return cssFiles(root, exempt).flatMap((file) =>
    brandViolations(readFileSync(file, "utf8")).map((v) => `${relative(root, file)}:${v}`),
  );
}

describe("brandViolations", () => {
  it("flags a hex color literal", () => {
    expect(brandViolations("a { color: #2f5d8a; }")).toHaveLength(1);
  });

  it("flags rgb() and rgba() literals", () => {
    expect(brandViolations("a { color: rgb(0 0 0); }\nb { color: rgba(0,0,0,.5); }")).toHaveLength(2);
  });

  it("flags a rounded corner, including one set through a variable", () => {
    expect(brandViolations("a { border-radius: 6px; }")).toHaveLength(1);
    expect(brandViolations("a { border-radius: var(--radius); }")).toHaveLength(1);
  });

  it("allows square corners, round badge discs and token colors", () => {
    expect(brandViolations("a { border-radius: 0; color: var(--ink); }\nb { border-radius: 50%; }")).toEqual([]);
  });

  it("allows the window's own corners through their token, and no other radius token", () => {
    expect(brandViolations("#root { border-radius: var(--window-radius); }")).toEqual([]);
    expect(brandViolations("a { border-radius: var(--window-radius-xs); }")).toHaveLength(1);
  });

  it("ignores literals inside comments", () => {
    expect(brandViolations("a { color: var(--ink); } /* was #2f5d8a */")).toEqual([]);
  });
});

describe("stylesheetViolations", () => {
  it("names the file and line of each break in a site stylesheet", () => {
    const root = mkdtempSync(join(tmpdir(), "brand-"));
    try {
      mkdirSync(join(root, "styles"));
      writeFileSync(join(root, "styles", "guide.css"), "a {\n  color: #fff;\n  border-radius: 4px;\n}\n");
      writeFileSync(join(root, "styles", "fine.css"), "a { color: var(--ink); border-radius: 0; }\n");
      expect(stylesheetViolations(root)).toEqual([
        "styles/guide.css:2: color: #fff;",
        "styles/guide.css:3: border-radius: 4px;",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("scriptViolations", () => {
  it("flags a hex colour in a string and a rounded corner in an inline style", () => {
    expect(scriptViolations(`<p style={{ color: "#2f6bff" }} />`)).toHaveLength(1);
    expect(scriptViolations(`<div style={{ borderRadius: 6 }} />`)).toHaveLength(1);
    expect(scriptViolations(`<div style={{ background: "rgba(0,0,0,.5)" }} />`)).toHaveLength(1);
  });

  it("allows token colours, square corners and filter references", () => {
    expect(scriptViolations(`<p style={{ color: "var(--ink)", borderRadius: 0 }} />`)).toEqual([]);
    expect(scriptViolations(`<g filter="url(#cast-ink)" />`)).toEqual([]);
  });
});

describe("the intro's scene code", () => {
  it.each(introScripts().map((f) => [relative(SRC, f), f]))("%s stays on the token layer", (_, file) => {
    expect(scriptViolations(readFileSync(file, "utf8"))).toEqual([]);
  });
});

/** The program body's drawing code (U6): it paints a canvas, so its colours must come from tokens read at runtime. */
const DRAWING_SCRIPTS = ["ui/QuinelingBody.tsx", "domain/stipple.ts"];

describe("the program body's drawing code", () => {
  it.each(DRAWING_SCRIPTS)("%s stays on the token layer", (file) => {
    expect(scriptViolations(readFileSync(join(SRC, file), "utf8"))).toEqual([]);
  });
});

describe("component stylesheets", () => {
  it.each(cssFiles(SRC, EXEMPT).map((f) => [relative(SRC, f), f]))("%s stays on the token layer", (_, file) => {
    expect(brandViolations(readFileSync(file, "utf8"))).toEqual([]);
  });
});

describe("the guide site's stylesheets", () => {
  it("scans the site's own stylesheet", () => {
    expect(cssFiles(SITE).map((f) => relative(SITE, f))).toContain("styles/guide.css");
  });

  it("keep to the token layer and square corners", () => {
    expect(stylesheetViolations(SITE)).toEqual([]);
  });

  it("never take the app shell's App.css", () => {
    const sources = filesUnder(SITE, (name) => /\.(astro|mdx?|tsx?|css|mjs)$/.test(name));
    const takesAppCss = /(?:import|@import)\s[^;\n]*App\.css/;
    const takers = sources.filter((f) => takesAppCss.test(readFileSync(f, "utf8"))).map((f) => relative(SITE, f));
    expect(takers).toEqual([]);
  });
});
