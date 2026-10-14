import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOUND_CUES } from "../timeline";
import { BED_SRC, BED_VOLUME, CUE_SRC, CUE_VOLUME } from "./index";

const here = dirname(fileURLToPath(import.meta.url));

/** The file on disk an imported sound URL points at. */
function onDisk(src: string): string {
  return join(here, basename(src.split("?")[0]));
}

describe("the intro's sound index", () => {
  it("has a file for every kind of cue in the timeline", () => {
    new Set(SOUND_CUES.map((c) => c.kind)).forEach((kind) => {
      const src = CUE_SRC[kind];
      expect(src, kind).toMatch(/\.wav$/);
      expect(existsSync(onDisk(src)), src).toBe(true);
    });
  });

  it("has the score bed", () => {
    expect(BED_SRC).toMatch(/\.mp3$/);
    expect(existsSync(onDisk(BED_SRC))).toBe(true);
  });

  it("plays quietly by default", () => {
    [BED_VOLUME, CUE_VOLUME].forEach((v) => {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(0.6);
    });
  });

  it("keeps the placeholder sounds small", () => {
    const files = [BED_SRC, ...Object.values(CUE_SRC)].map(onDisk);
    const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
    expect(bytes).toBeLessThan(1024 * 1024);
  });
});
