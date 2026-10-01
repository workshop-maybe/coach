// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MARKER_PATH } from "../domain/folder";
import type { Collection } from "../domain/types";
import { MemoryStorage } from "../storage/memory";
import { FolderProvider } from "../ui/useFolderState";
import { HandoffBox } from "./HandoffBox";
import { handoffKeys, openingChoice } from "./mappings";

afterEach(cleanup);

const collection: Collection = { slug: "eng", name: "Engineering", description: "", order: ["review"], codes: { review: 1 } };
const badge = { collection, credential: { slug: "review", name: "Code review" } };
const keys = handoffKeys(["2026-09-01-first", "2026-09-02-second"]);

function inFolder(node: ReactNode) {
  return render(
    <FolderProvider storage={new MemoryStorage({ [MARKER_PATH]: '{ "format": 1 }\n' })} folder="/data">
      {node}
    </FolderProvider>,
  );
}

const drawnKeys = (root: Element) =>
  [...root.querySelectorAll("[data-handoff-key]")].map((k) => [k.querySelector("text")!.textContent, k.getAttribute("data-key-state"), k.getAttribute("data-mark")]);

describe("HandoffBox", () => {
  it("draws one key per handoff plus the skeleton, labeled in creation order, with the default lit", () => {
    const { container } = inFolder(<HandoffBox badge={badge} keys={keys} lit="2026-09-02-second" screen="" />);
    expect(drawnKeys(container)).toEqual([
      ["S", "off", null],
      ["A", "off", null],
      ["B", "lit", null],
    ]);
    expect(container.querySelector('[data-handoff-key="2026-09-02-second"] .cast-handoff-led')).not.toBeNull();
  });

  it("in the ask state, lights no key and marks the two offered keys", () => {
    const { container } = inFolder(<HandoffBox badge={badge} keys={keys} {...openingChoice("2026-09-02-second", "skeleton")} screen="" />);
    expect(drawnKeys(container)).toEqual([
      ["S", "off", "winner"],
      ["A", "off", null],
      ["B", "off", "default"],
    ]);
    expect(container.querySelector(".cast-handoff-led")).toBeNull();
    expect(container.querySelectorAll(".cast-handoff-mark")).toHaveLength(2);
  });

  it("is decorative, with the filter on its root group and each moving part, and its words outside it", () => {
    const { container } = inFolder(<HandoffBox badge={badge} keys={keys} lit="skeleton" screen={"Hand it over\nline two"} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector(":scope > g[filter]")).not.toBeNull();
    expect(svg.querySelectorAll("[data-handoff-key] > g[filter]")).toHaveLength(3);
    expect(svg.querySelector(".cast-print-motion g[filter]")).not.toBeNull();
    for (const text of svg.querySelectorAll("text")) expect(text.closest("[filter]")).toBeNull();
  });

  it("shows the lit handoff's first lines on its screen", () => {
    const { container } = inFolder(<HandoffBox badge={badge} keys={keys} lit="skeleton" screen={"Hand it over\n\nline two\nthree\nfour"} />);
    expect([...container.querySelectorAll(".cast-handoff-screen text")].map((t) => t.textContent)).toEqual(["Hand it over", "line two", "three"]);
  });

  it("holds the badge's cartridge in its input, the badge art outside the wobble", async () => {
    const { container } = inFolder(<HandoffBox badge={badge} keys={keys} lit="skeleton" screen="" />);
    const label = await waitFor(() => {
      const el = container.querySelector(".cast-handoff-input image.cast-label");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(label.closest("[filter]")).toBeNull();
  });

  it("grows a row of keys when the handoffs outrun one row", () => {
    const one = inFolder(<HandoffBox badge={badge} keys={keys} lit={null} screen="" />).container.querySelector("svg")!;
    const many = handoffKeys(Array.from({ length: 12 }, (_, i) => `h${i}`));
    const two = inFolder(<HandoffBox badge={badge} keys={many} lit={null} screen="" />).container.querySelector("svg")!;
    const height = (svg: Element) => Number(svg.getAttribute("viewBox")!.split(" ")[3]);
    expect(height(two)).toBeGreaterThan(height(one));
  });
});
