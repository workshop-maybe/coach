// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { badgeFingerprints, defaultPaletteIndex } from "../badge/fingerprint";
import { PALETTES } from "../badge/palettes";
import type { Collection } from "../domain/types";
import { MARKER_PATH } from "../domain/folder";
import { MemoryStorage } from "../storage/memory";
import { FolderProvider } from "../ui/useFolderState";
import { Machine } from "./Machine";
import { replyScreen, type MachineKey } from "./mappings";

afterEach(cleanup);

const collection: Collection = { slug: "eng", name: "Engineering", description: "", order: ["review"], codes: { review: 1 } };
const opusHigh = { harness: "claude-code", model: "opus", effort: "high" };
const codexLow = { harness: "codex", model: "gpt-5", effort: "low" };

function key(slug: string, halfRaised = false): MachineKey {
  return { id: `eng/${slug}`, collectionSlug: "eng", credentialSlug: slug, earnedAt: "2026-09-01T00:00:00Z", halfRaised, collection, name: slug };
}

const angles = (root: Element) => [...root.querySelectorAll("[data-dial]")].map((e) => e.getAttribute("data-angle"));

describe("Machine", () => {
  it("is decorative, with the filter on its root group and each moving part", () => {
    const { container } = render(<Machine setup={opusHigh} keys={[key("review")]} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll("[data-dial] > g[filter]")).toHaveLength(3);
    expect(svg.querySelectorAll("g.cast-key[filter]")).toHaveLength(16);
    // Screen content stays outside every filter.
    expect(svg.querySelector(".cast-screen")!.closest("[filter]")).toBeNull();
  });

  it("turns its encoders to the setup, so two setups look different (Covers AE1.)", () => {
    const a = render(<Machine setup={opusHigh} />).container;
    const b = render(<Machine setup={codexLow} />).container;
    const [ha, ma, ea] = angles(a);
    const [hb, mb, eb] = angles(b);
    expect([ha !== hb, ma !== mb, ea !== eb]).toEqual([true, true, true]);
  });

  it("reports a click on an encoder as a step, backwards with Shift", () => {
    const onStep = vi.fn();
    const { container } = render(<Machine setup={opusHigh} onStep={onStep} />);
    const model = container.querySelector('[data-dial="model"]')!;
    fireEvent.click(model);
    fireEvent.click(model, { shiftKey: true });
    expect(onStep.mock.calls).toEqual([
      ["model", 1],
      ["model", -1],
    ]);
  });

  it("draws each screen state, and at most three reply lines", () => {
    for (const kind of ["idle", "sending", "waiting"] as const) {
      const { container } = render(<Machine setup={opusHigh} screen={{ kind }} />);
      expect(container.querySelector(`.cast-screen-${kind}`)).not.toBeNull();
      cleanup();
    }
    const { container } = render(<Machine setup={opusHigh} screen={replyScreen("one\ntwo\nthree\nfour\nfive")} />);
    const lines = [...container.querySelectorAll(".cast-screen-reply text")].map((t) => t.textContent);
    expect(lines).toEqual(["one", "two", "three"]);
  });

  it("pages its keys: a seventeenth key shows on page two, and the indicator shows two pages (Covers AE2.)", () => {
    const keys = Array.from({ length: 17 }, (_, i) => key(`k${i}`));
    const { container } = render(<Machine setup={opusHigh} keys={keys} page={1} />);
    expect(container.querySelector(".cast-pages")!.getAttribute("data-pages")).toBe("2");
    const lit = container.querySelectorAll('[data-key="lit"]');
    expect(lit).toHaveLength(1);
    expect(lit[0].getAttribute("data-credential")).toBe("eng/k16");
  });

  it("shows only the first sixteen keys on a mini machine, without encoders or paging", () => {
    const keys = Array.from({ length: 17 }, (_, i) => key(`k${i}`));
    const { container } = render(<Machine mini setup={opusHigh} keys={keys} />);
    expect(container.querySelectorAll("[data-dial]")).toHaveLength(0);
    expect(container.querySelector(".cast-pages")).toBeNull();
    expect(container.querySelectorAll('[data-key="lit"]')).toHaveLength(16);
  });

  it("half raises a key that needs a re-test", () => {
    const { container } = render(<Machine setup={opusHigh} keys={[key("a"), key("b", true)]} />);
    expect(container.querySelector('[data-credential="eng/b"]')!.getAttribute("data-key")).toBe("raised");
    expect(container.querySelector('[data-credential="eng/a"]')!.getAttribute("data-key")).toBe("lit");
  });

  it("lights a default-palette key in its fingerprint palette's ring color, ink until then", async () => {
    const { outerHex } = await badgeFingerprints("eng", "review");
    const ring = PALETTES[defaultPaletteIndex(outerHex)].prim;
    const { container } = render(<Machine setup={opusHigh} keys={[key("review")]} />);
    const face = () => container.querySelector('[data-credential="eng/review"] rect')!;
    expect(["ink", ring]).toContain(face().getAttribute("data-fill"));
    await waitFor(() => expect(face().getAttribute("fill")).toBe(ring));
  });

  it("holds a loaded cartridge in its slot, with room above the case", async () => {
    const { container } = render(
      <FolderProvider storage={new MemoryStorage({ [MARKER_PATH]: '{ "format": 1 }\n' })} folder="/data">
        <Machine setup={opusHigh} loaded={{ collection, credential: { slug: "review", name: "Code review" } }} />
      </FolderProvider>,
    );
    expect(container.querySelector("svg")!.getAttribute("viewBox")!.startsWith("0 -")).toBe(true);
    await waitFor(() => expect(container.querySelector(".cast-loaded image.cast-label")).not.toBeNull());
  });
});
