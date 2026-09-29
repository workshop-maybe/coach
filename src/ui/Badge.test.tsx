// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FolderProvider } from "./useFolderState";
import { Badge } from "./Badge";
import { MemoryStorage } from "../storage/memory";
import { MARKER_PATH } from "../domain/folder";
import type { Collection } from "../domain/types";

afterEach(cleanup);

const collection: Collection = { slug: "eng", name: "Engineering", description: "", order: ["review"], codes: { review: 1 } };

describe("Badge", () => {
  it("renders an img whose src decodes back to the SVG, for a non-ASCII name (Covers AE5.)", async () => {
    const name = "Révision de code: ã, ñ, ü, 日本語, and a long enough title to wrap";
    render(
      <FolderProvider storage={new MemoryStorage({ [MARKER_PATH]: '{ "format": 1 }\n' })} folder="/data">
        <Badge collection={collection} credential={{ slug: "review", name }} size={128} />
      </FolderProvider>,
    );
    const img = await waitFor(() => {
      const el = screen.getByRole("img", { name: `Badge for ${name}` });
      expect(el.tagName).toBe("IMG");
      return el as HTMLImageElement;
    });
    const prefix = "data:image/svg+xml;charset=utf-8,";
    expect(img.getAttribute("src")!.startsWith(prefix)).toBe(true);
    const svg = decodeURIComponent(img.getAttribute("src")!.slice(prefix.length));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("日本語");
  });

  it("re-reads art replaced in place when the folder reloads", async () => {
    const path = "collections/eng/badge/art-00000000.png";
    const storage = new MemoryStorage({ [MARKER_PATH]: '{ "format": 1 }\n' });
    storage.seedImage(path, "data:image/png;base64,AAAA");
    const withArt = { ...collection, badge: { art: path } };
    render(
      <FolderProvider storage={storage} folder="/data">
        <Badge collection={withArt} credential={{ slug: "review", name: "Code review" }} size={64} />
      </FolderProvider>,
    );
    const src = () => decodeURIComponent(screen.getByRole("img", { name: "Badge for Code review" }).getAttribute("src") ?? "");
    await waitFor(() => expect(src()).toContain("AAAA"));
    storage.seedImage(path, "data:image/png;base64,BBBB");
    fireEvent.focus(window);
    await waitFor(() => expect(src()).toContain("BBBB"));
  });
});
