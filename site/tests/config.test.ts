/// <reference types="node" />
// The guide's Astro config (fix plan KTD4): fenced code renders as plain <pre><code> under
// the guide's own token-only styles, as the deep dive's excerpts do. Shiki, Astro's default
// highlighter, writes a dark theme's colors inline on every block, where no stylesheet check
// can see them, so it stays off.

import { describe, expect, it } from "vitest";
import config from "../astro.config.mjs";

describe("the guide's Astro config", () => {
  it("turns syntax highlighting off, so fenced code takes the guide's light styles", () => {
    expect(config.markdown?.syntaxHighlight).toBe(false);
  });
});
