// @vitest-environment jsdom
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Intro } from "./Intro";
import { SCENES, STILLS } from "./timeline";

afterEach(cleanup);

function renderAt(f: number) {
  return render(<Intro frame={f} />);
}

/** Each row on screen, with its words' opacities. */
function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[data-text]")].map((row) => ({
    text: row.dataset.text!,
    opacities: [...row.querySelectorAll<HTMLElement>("[data-word]")].map((w) => Number(w.style.opacity)),
  }));
}

describe("the intro composition", () => {
  it.each(SCENES.map((s, i) => [s.id, i] as const))("shows the %s scene's line at its still, and no other scene's", (_, i) => {
    const { container } = renderAt(STILLS[i]);
    const shown = rows(container);
    for (const row of SCENES[i].rows) {
      const found = shown.find((r) => r.text === row);
      expect(found, row).toBeDefined();
      expect(found!.opacities.every((o) => o === 1)).toBe(true);
    }
    const others = SCENES.flatMap((s, j) => (j === i ? [] : s.rows));
    for (const row of shown.filter((r) => others.includes(r.text))) {
      expect(row.opacities.every((o) => o === 0), row.text).toBe(true);
    }
  });

  it("writes each row's words in order, so the row reads as its line", () => {
    const { container } = renderAt(STILLS[0]);
    const row = container.querySelector<HTMLElement>(`[data-text="${SCENES[0].rows[0]}"]`)!;
    expect(row.textContent!.replace(/\s+/g, " ").trim()).toBe(SCENES[0].rows[0]);
  });

  it("shows none of the scene text at frame 0", () => {
    const { container } = renderAt(0);
    const shown = rows(container);
    expect(shown.length).toBeGreaterThan(0);
    shown.forEach((r) => expect(r.opacities.every((o) => o === 0), r.text).toBe(true));
  });

  it("draws on the board, with its own ink filters", () => {
    const { container } = renderAt(STILLS[2]);
    expect(container.querySelector("#cast-ink")).not.toBeNull();
    expect(container.querySelector("#cast-ink-fine")).not.toBeNull();
    expect(container.querySelector<HTMLElement>(".intro-film")!.style.background).toBe("var(--board)");
  });
});

// The intro is a leaf (KTD1): it runs before a folder exists and is reused outside the app.
describe("the intro's imports", () => {
  const SRC = resolve(__dirname, "..");
  const FROM = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

  function resolveFile(base: string): string | null {
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
      if (existsSync(candidate) && !candidate.endsWith("/") && /\.(tsx?|css)$/.test(candidate)) return candidate;
    }
    return null;
  }

  function graph(entry: string) {
    const seen = new Set<string>();
    const specifiers: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      if (file.endsWith(".css")) return;
      const code = readFileSync(file, "utf8");
      for (const m of code.matchAll(FROM)) {
        const spec = m[1] ?? m[2] ?? m[3];
        specifiers.push(spec);
        if (!spec.startsWith(".")) continue;
        const target = resolveFile(resolve(dirname(file), spec.replace(/\?.*$/, "")));
        if (target) visit(target);
      }
    };
    visit(entry);
    return { files: [...seen].map((f) => relative(SRC, f)), specifiers };
  }

  const { files, specifiers } = graph(join(SRC, "intro", "Intro.tsx"));

  it("follows the composition into its scenes, pieces and the cast", () => {
    expect(files).toContain("intro/timeline.ts");
    expect(files).toContain("cast/cartridgeArt.tsx");
    expect(files).toContain("cast/InkDefs.tsx");
    expect(files.some((f) => f.startsWith("intro/scenes/"))).toBe(true);
    expect(files.some((f) => f.startsWith("intro/pieces/"))).toBe(true);
  });

  it("draws with no video library", () => {
    expect(specifiers.filter((s) => /remotion/.test(s))).toEqual([]);
  });

  it("reaches nothing in the app shell, storage, App.css or a raw import", () => {
    expect(files.filter((f) => f.startsWith("ui/") || f.startsWith("storage/") || f.endsWith("App.css"))).toEqual([]);
    expect(specifiers.filter((s) => s.includes("?raw"))).toEqual([]);
    expect(files).not.toContain("cast/Cartridge.tsx");
    expect(files).not.toContain("cast/Machine.tsx");
  });
});
