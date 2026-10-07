// @vitest-environment jsdom
// Building a reply as a list of items on "What came back" (U4 of the reply artifacts plan, R1-R4,
// R7, KTD7): one empty text item to start, quiet add keys for each kind, a quiet Remove on each
// item, a link line that takes only what a link may open, and the editor as the one drop box.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const opener = vi.hoisted(() => ({ openUrl: vi.fn((_url: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);
const pdf = vi.hoisted(() => ({ openPdf: vi.fn(() => new Promise(() => undefined)) }));
vi.mock("./pdfDocument", () => pdf);
// ProseMirror typing does not run in jsdom; text items are a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

import { FILE_NOT_APPROVED } from "../domain/videos";
import type { ReplyItem } from "../domain/types";
import { MemoryStorage } from "../storage/memory";
import { firePaste, pngFile } from "../test/paste";
import { mp4Bytes } from "../test/videoBytes";
import { handleDragDrop } from "./dropFiles";
import { imageSource } from "./imageSource";
import { ReplyItemsEditor, replyEntry, type ReplyEntry } from "./ReplyItemsEditor";
import { FolderProvider, useFolder } from "./useFolderState";
import { useRichImages } from "./useRichImages";

const DIR = "assessments/opus/eng/review";
const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");

class NoObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => vi.stubGlobal("IntersectionObserver", NoObserver));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The items the editor last handed back. */
let latest: ReplyItem[] = [];

function Editor({ storage, initial }: { storage: MemoryStorage; initial: ReplyItem[] }) {
  const [entries, setEntries] = useState<ReplyEntry[]>(() => initial.map(replyEntry));
  const items = entries.map((e) => e.item);
  latest = items;
  const { images, addItems } = useRichImages(DIR, "", items);
  const { notice } = useFolder();
  return (
    <>
      <ReplyItemsEditor value={entries} onChange={setEntries} images={images} source={imageSource(storage, DIR)} addItems={addItems} />
      {notice && <p role="note">{notice}</p>}
    </>
  );
}

function renderEditor(initial: ReplyItem[] = [{ kind: "text", text: "" }]) {
  const storage = new MemoryStorage();
  render(
    <FolderProvider storage={storage} folder="/data">
      <Editor storage={storage} initial={initial} />
    </FolderProvider>,
  );
  return storage;
}

const key = (name: "text" | "image" | "video" | "file" | "link") => screen.getByRole("button", { name: `Add ${name}` });
const kinds = () => latest.map((i) => i.kind);

describe("ReplyItemsEditor", () => {
  it("opens as one text box named Reply, with no bar or Remove, and a row of quiet add keys", () => {
    renderEditor();
    expect(screen.getByRole("textbox", { name: "Reply" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    const row = screen.getByRole("group", { name: "Add to the reply" });
    expect(within(row).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-label")])).toEqual([
      ["Text", "Add text"],
      ["Image", "Add image"],
      ["Video", "Add video"],
      ["File", "Add file"],
      ["Link", "Add link"],
    ]);
    expect(row.querySelector("button.primary")).toBeNull();
  });

  it("Covers AE1. A summary, a PDF from File and a recording from Video stack in the order added", async () => {
    const storage = renderEditor();
    await userEvent.type(screen.getByRole("textbox", { name: "Reply" }), "The summary");
    storage.queueAdd([{ name: "report.pdf", bytes: PDF }]);
    await userEvent.click(key("file"));
    await waitFor(() => expect(kinds()).toEqual(["text", "file"]));
    storage.queueAdd([{ name: "demo.mp4", bytes: mp4Bytes() }]);
    await userEvent.click(key("video"));
    await waitFor(() => expect(kinds()).toEqual(["text", "file", "video"]));
    expect(storage.adds.map((a) => [a.from, a.accept])).toEqual([
      [{ kind: "pick", item: "file" }, "any"],
      [{ kind: "pick", item: "video" }, "any"],
    ]);
    expect(latest).toEqual([
      { kind: "text", text: "The summary" },
      { kind: "file", name: "report.pdf", ref: expect.stringMatching(/^files\/file-[0-9a-f]{8}\.pdf$/) },
      { kind: "video", name: "demo.mp4", ref: expect.stringMatching(/^video-[0-9a-f]{8}\.mp4$/) },
    ]);
    // Each item now has a bar naming it and a Remove that says which.
    expect(screen.getByRole("button", { name: "Remove text 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove file report.pdf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove video demo.mp4" })).toBeTruthy();
  });

  it("the content decides the kind: a PNG picked with File becomes an image item", async () => {
    const storage = renderEditor();
    storage.queueAdd([{ name: "shot.png", bytes: new Uint8Array(await pngFile().arrayBuffer()) }]);
    await userEvent.click(key("file"));
    await waitFor(() => expect(kinds()).toEqual(["text", "image"]));
    expect(latest[1]).toMatchObject({ name: "shot.png" });
  });

  it("says Adding while a copy runs", async () => {
    const storage = renderEditor();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const addFiles = storage.addFiles.bind(storage);
    storage.addFiles = async (...args) => {
      await gate;
      return addFiles(...args);
    };
    storage.queueAdd([{ name: "report.pdf", bytes: PDF }]);
    await userEvent.click(key("file"));
    expect(await screen.findByText("Adding")).toBeTruthy();
    await act(async () => release());
    await waitFor(() => expect(screen.queryByText("Adding")).toBeNull());
    expect(kinds()).toEqual(["text", "file"]);
  });

  it("a cancelled picker adds nothing and hands focus back to its key", async () => {
    renderEditor();
    await userEvent.click(key("image"));
    await waitFor(() => expect(document.activeElement).toBe(key("image")));
    expect(kinds()).toEqual(["text"]);
  });

  it("Text adds a text item that takes focus", async () => {
    renderEditor();
    await userEvent.click(key("text"));
    const second = screen.getByRole("textbox", { name: "Reply text 2" });
    await waitFor(() => expect(document.activeElement).toBe(second));
    await userEvent.type(second, "More");
    expect(latest).toEqual([
      { kind: "text", text: "" },
      { kind: "text", text: "More" },
    ]);
  });

  it("Remove deletes an item, keeps the order of the rest, and focuses the item before it", async () => {
    renderEditor([
      { kind: "text", text: "First" },
      { kind: "link", url: "https://example.com/a" },
      { kind: "text", text: "Last" },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Remove link https://example.com/a" }));
    expect(latest).toEqual([
      { kind: "text", text: "First" },
      { kind: "text", text: "Last" },
    ]);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Reply" }));
    // With nothing before it, focus goes to the first add key.
    await userEvent.click(screen.getByRole("button", { name: "Remove text 1" }));
    expect(latest).toEqual([{ kind: "text", text: "Last" }]);
    expect(document.activeElement).toBe(key("text"));
  });

  it("a link line refuses ftp and javascript with one line under it, and Enter commits a web link", async () => {
    renderEditor();
    await userEvent.click(key("link"));
    const line = screen.getByRole("textbox", { name: "Link" });
    expect(document.activeElement).toBe(line);
    await userEvent.type(line, "ftp://x{Enter}");
    expect(screen.getByText("Only http, https and mailto links can be added")).toBeTruthy();
    expect(kinds()).toEqual(["text"]);
    await userEvent.clear(line);
    await userEvent.type(line, "javascript:alert(1)");
    await userEvent.tab();
    expect(screen.getByRole("textbox", { name: "Link" })).toBeTruthy();
    expect(kinds()).toEqual(["text"]);
    await userEvent.clear(line);
    await userEvent.type(line, " https://example.com/run {Enter}");
    expect(latest).toEqual([
      { kind: "text", text: "" },
      { kind: "link", url: "https://example.com/run" },
    ]);
    expect(screen.queryByRole("textbox", { name: "Link" })).toBeNull();
    expect(screen.queryByText("Only http, https and mailto links can be added")).toBeNull();
    expect(screen.getByRole("link", { name: "https://example.com/run" })).toBeTruthy();
  });

  it("leaving a link line commits it", async () => {
    renderEditor();
    await userEvent.click(key("link"));
    await userEvent.type(screen.getByRole("textbox", { name: "Link" }), "mailto:me@example.com");
    await userEvent.tab();
    expect(latest[1]).toEqual({ kind: "link", url: "mailto:me@example.com" });
  });

  it("a PNG pasted into a text item lands inline in it, as today", async () => {
    const storage = renderEditor();
    const box = screen.getByRole("textbox", { name: "Reply" });
    firePaste(box, {}, [pngFile()]);
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toMatch(/^!\[\]\(image-[0-9a-f]{8}\.png\)$/));
    expect(kinds()).toEqual(["text"]);
    expect(storage.adds).toEqual([]);
  });

  it("a PDF pasted into a text item becomes a file item", async () => {
    const storage = renderEditor();
    const file = new File([PDF], "report.pdf", { type: "application/pdf" });
    storage.queueAdd([{ name: "report.pdf", bytes: PDF }]);
    firePaste(screen.getByRole("textbox", { name: "Reply" }), {}, [file]);
    await waitFor(() => expect(kinds()).toEqual(["text", "file"]));
    expect(storage.adds).toEqual([{ dir: DIR, from: { kind: "paste", files: [{ name: "report.pdf", size: PDF.length }] }, accept: "any" }]);
    expect((screen.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("a PDF dropped over a text item becomes a file item, not an inline ref", async () => {
    const storage = renderEditor();
    const box = screen.getByRole("textbox", { name: "Reply" });
    document.elementFromPoint = () => box;
    storage.queueAdd([{ name: "report.pdf", bytes: PDF }]);
    act(() => handleDragDrop({ type: "drop", paths: ["/Users/me/report.pdf"], position: { x: 5, y: 5 } }));
    await waitFor(() => expect(kinds()).toEqual(["text", "file"]));
    expect(storage.adds).toEqual([{ dir: DIR, from: { kind: "drop", paths: ["/Users/me/report.pdf"] }, accept: "any" }]);
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("a drop outside approval adds nothing and says why", async () => {
    const storage = renderEditor();
    document.elementFromPoint = () => null;
    storage.queueAdd([{ name: "secret.pdf", error: FILE_NOT_APPROVED }]);
    act(() => handleDragDrop({ type: "drop", paths: ["/etc/secret.pdf"], position: { x: 5, y: 5 } }));
    expect(await screen.findByText(`secret.pdf: ${FILE_NOT_APPROVED}`)).toBeTruthy();
    expect(kinds()).toEqual(["text"]);
  });
});
