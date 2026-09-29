/// <reference types="node" />
// Brand guard: component styles take colors from the token layer and keep square
// corners. src/theme holds the tokens themselves; src/badge draws badge art,
// which follows credential-badges rather than the app's brand.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const EXEMPT = ["theme", "badge"];

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return EXEMPT.includes(relative(SRC, path)) ? [] : cssFiles(path);
    return e.name.endsWith(".css") ? [path] : [];
  });
}

/** Lines that break the guard, as "line: text". */
function brandViolations(css: string): string[] {
  const out: string[] = [];
  css.split("\n").forEach((text, i) => {
    const code = text.replace(/\/\*.*?\*\//g, "");
    const colorLiteral = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/.test(code);
    const radius = /border-radius\s*:\s*([^;]+)/.exec(code);
    const badRadius = radius && !/^(0|50%)$/.test(radius[1].trim());
    if (colorLiteral || badRadius) out.push(`${i + 1}: ${text.trim()}`);
  });
  return out;
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

  it("ignores literals inside comments", () => {
    expect(brandViolations("a { color: var(--ink); } /* was #2f5d8a */")).toEqual([]);
  });
});

describe("component stylesheets", () => {
  it.each(cssFiles(SRC).map((f) => [relative(SRC, f), f]))("%s stays on the token layer", (_, file) => {
    expect(brandViolations(readFileSync(file, "utf8"))).toEqual([]);
  });
});
