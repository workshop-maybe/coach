// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MARKER_PATH } from "../domain/folder";
import type { Collection } from "../domain/types";
import { MemoryStorage } from "../storage/memory";
import { FolderProvider } from "../ui/useFolderState";
import { Cartridge } from "./Cartridge";
import { Outline } from "./Outline";

afterEach(cleanup);

const collection: Collection = { slug: "eng", name: "Engineering", description: "", order: ["review"], codes: { review: 1 } };

describe("Cartridge", () => {
  it("shows the whole badge in its label, leaving the alt text to the text around it", async () => {
    const { container } = render(
      <FolderProvider storage={new MemoryStorage({ [MARKER_PATH]: '{ "format": 1 }\n' })} folder="/data">
        <p>Code review</p>
        <Cartridge collection={collection} credential={{ slug: "review", name: "Code review" }} />
      </FolderProvider>,
    );
    const svg = container.querySelector("svg.cast-cartridge")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    const label = await waitFor(() => {
      const el = svg.querySelector("image.cast-label");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(label.getAttribute("href")!.startsWith("data:image/svg+xml")).toBe(true);
    expect(label.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    // The badge art is never under the wobble.
    expect(label.closest("[filter]")).toBeNull();
    expect(container.querySelector('[alt], [role="img"]')).toBeNull();
  });
});

describe("Outline", () => {
  it.each(["machine", "cartridge"] as const)("draws an empty %s dashed, with no badge", (kind) => {
    const { container } = render(<Outline kind={kind} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("[stroke-dasharray]")).not.toBeNull();
    expect(svg.querySelector("image")).toBeNull();
  });
});
