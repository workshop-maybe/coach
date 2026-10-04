/// <reference types="node" />
// Privacy guard for the user guide site (U2, R17, AE5): no page loads anything from a
// host other than the site's own. Fonts are bundled from @fontsource and search is
// Pagefind's own output, so nothing in the site's source or its Astro config may point a
// script, stylesheet, image, @import or url() at an absolute http(s) or protocol-relative
// address. Links a reader follows (<a href>) are not requests and stay allowed.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SITE = join(__dirname, "..");
const TEXT = /\.(astro|mdx?|tsx?|jsx?|mjs|cjs|css|html|json)$/;

/** An absolute address on another host: http(s):// or protocol-relative //. */
const ADDRESS = String.raw`((?:https?:)?\/\/[^"'\`\s)>,;]+)`;

/** What makes a page fetch something, each capturing the address it would fetch. */
const LOADERS: [string, RegExp][] = [
  ["src", new RegExp(String.raw`\bsrc\s*=\s*\{?\s*["'\`]\s*` + ADDRESS, "gi")],
  ["srcset", new RegExp(String.raw`\bsrcset\s*=\s*\{?\s*["'\`][^"'\`]*?` + ADDRESS, "gi")],
  ["link href", new RegExp(String.raw`<link\b[^>]*?\bhref\s*=\s*\{?\s*["'\`]\s*` + ADDRESS, "gi")],
  ["@import", new RegExp(String.raw`@import\s+(?:url\(\s*)?["']?\s*` + ADDRESS, "gi")],
  ["url()", new RegExp(String.raw`\burl\(\s*["']?\s*` + ADDRESS, "gi")],
  ["module import", new RegExp(String.raw`(?:\bfrom|\bimport\s*\(?)\s*["'\`]` + ADDRESS, "gi")],
  ["fetch", new RegExp(String.raw`\bfetch\(\s*["'\`]` + ADDRESS, "gi")],
  ["markdown image", new RegExp(String.raw`!\[[^\]]*\]\(\s*<?` + ADDRESS, "gi")],
];

/** Every off-site load in one source text, as "line: kind address". */
function offsiteLoads(text: string): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const [kind, pattern] of LOADERS) {
      for (const match of line.matchAll(pattern)) out.push(`${i + 1}: ${kind} ${match[1]}`);
    }
  });
  return out;
}

/** The site's source files: everything under src/, and the Astro config. */
function siteSources(site: string): string[] {
  const walk = (dir: string): string[] =>
    !existsSync(dir)
      ? []
      : readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const path = join(dir, e.name);
          if (e.isDirectory()) return walk(path);
          return TEXT.test(e.name) ? [path] : [];
        });
  const config = join(site, "astro.config.mjs");
  return [...(existsSync(config) ? [config] : []), ...walk(join(site, "src"))];
}

describe("offsiteLoads", () => {
  it("flags a stylesheet fetched from Google Fonts", () => {
    const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap" />`;
    expect(offsiteLoads(html)).toEqual(["1: link href https://fonts.googleapis.com/css2?family=Inter&display=swap"]);
  });

  it("flags a font @import and a url() in a stylesheet", () => {
    const css = `@import url("https://fonts.googleapis.com/css2?family=Inter");\na { background: url(//cdn.example.com/x.png); }`;
    expect(offsiteLoads(css)).toEqual([
      "1: @import https://fonts.googleapis.com/css2?family=Inter",
      "1: url() https://fonts.googleapis.com/css2?family=Inter",
      "2: url() //cdn.example.com/x.png",
    ]);
  });

  it("flags scripts, images and modules from another host", () => {
    expect(offsiteLoads(`<script src="https://cdn.example.com/a.js"></script>`)).toHaveLength(1);
    expect(offsiteLoads(`<img src='//img.example.com/a.png'>`)).toHaveLength(1);
    expect(offsiteLoads(`<img srcset="/a.png 1x, https://img.example.com/a@2x.png 2x">`)).toHaveLength(1);
    expect(offsiteLoads(`import x from "https://esm.example.com/x.js";`)).toHaveLength(1);
    expect(offsiteLoads(`fetch("https://analytics.example.com/hit")`)).toHaveLength(1);
    expect(offsiteLoads(`![Home](https://img.example.com/home.png)`)).toHaveLength(1);
  });

  it("allows links a reader follows and loads from the site itself", () => {
    expect(offsiteLoads(`<a href="https://github.com/">GitHub</a>`)).toEqual([]);
    expect(offsiteLoads(`[the app](https://andamio.io)`)).toEqual([]);
    expect(offsiteLoads(`<script src="/pagefind/pagefind-component-ui.js"></script>`)).toEqual([]);
    expect(offsiteLoads(`<link rel="stylesheet" href="/pagefind/pagefind-component-ui.css">`)).toEqual([]);
    expect(offsiteLoads(`import "@fontsource-variable/inter";`)).toEqual([]);
  });
});

describe("the guide site's source", () => {
  const files = siteSources(SITE);

  it("covers the Astro config and the layout", () => {
    const names = files.map((f) => relative(SITE, f));
    expect(names).toContain("astro.config.mjs");
    expect(names).toContain("src/layouts/Guide.astro");
  });

  it("loads nothing from another host", () => {
    const loads = files.flatMap((f) => offsiteLoads(readFileSync(f, "utf8")).map((l) => `${relative(SITE, f)}:${l}`));
    expect(loads).toEqual([]);
  });
});
