// @vitest-environment jsdom
// One reply's items, rendered in place (U3 of the reply artifacts plan, R8, R11, KTD6).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const opener = vi.hoisted(() => ({ openUrl: vi.fn((_url: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);
const pdf = vi.hoisted(() => ({ openPdf: vi.fn() }));
vi.mock("./pdfDocument", () => pdf);

import { ReplyStack } from "./ReplyStack";
import { resultImages } from "./imageSource";
import { MemoryStorage } from "../storage/memory";
import { mp4Bytes } from "../test/videoBytes";
import { ITEM_TEXT_MAX_BYTES } from "../domain/files";
import type { ReplyItem } from "../domain/types";

const DIR = "assessments/opus/eng/review";
const SLUGS = { profileSlug: "opus", collectionSlug: "eng", credentialSlug: "review" };
const SHOT = "data:image/png;base64,iVBORw0KGgo=";
const text = (s: string) => new TextEncoder().encode(s);
const PDF = text("%PDF-1.7\n%%EOF\n");

function fakeDoc() {
  const rendered: number[] = [];
  return {
    rendered,
    doc: {
      numPages: 1,
      getPage: async (n: number) => ({
        width: 600,
        height: 800,
        render: async () => void rendered.push(n),
        cleanup: () => undefined,
      }),
      destroy: () => undefined,
    },
  };
}

class NoObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  opener.openUrl.mockClear();
  pdf.openPdf.mockReset();
  vi.stubGlobal("IntersectionObserver", NoObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stack(items: ReplyItem[], extra: { stored?: boolean; pending?: ReadonlySet<number> } = {}) {
  render(<ReplyStack aria-label="Reply" items={items} source={resultImages(storage, SLUGS)} {...extra} />);
  return screen.getByRole("region", { name: "Reply" });
}

/** The header bar of each rendered item, in order. */
function headers(el: HTMLElement): string[] {
  return [...el.querySelectorAll(".reply-item-bar")].map((h) => h.textContent ?? "");
}

describe("ReplyStack", () => {
  it("renders text, a PDF and a video in that order, each under a header with its name (AE1)", async () => {
    storage.seedItemFile(`${DIR}/files/file-1a2b3c4d.pdf`, PDF);
    storage.seedVideo(`${DIR}/video-0000aaaa.mov`, mp4Bytes());
    const { doc, rendered } = fakeDoc();
    pdf.openPdf.mockResolvedValue(doc);
    const el = stack([
      { kind: "text", text: "## Summary\n\nAll green." },
      { kind: "file", name: "report.pdf", ref: "files/file-1a2b3c4d.pdf" },
      { kind: "video", name: "recording.mov", ref: "video-0000aaaa.mov" },
    ]);
    expect(headers(el)).toEqual(["Text", "Filereport.pdf", "Videorecording.mov"]);
    expect(el.querySelector("h2")?.textContent).toBe("Summary");
    await waitFor(() => expect(rendered).toEqual([1]));
    expect(pdf.openPdf).toHaveBeenCalledWith(`blob:memory/${DIR}/files/file-1a2b3c4d.pdf`);
    await waitFor(() => expect(el.querySelector("video[src]")).not.toBeNull());
    const items = [...el.querySelectorAll(".reply-item")];
    expect(items.map((i) => i.getAttribute("data-kind"))).toEqual(["text", "file", "video"]);
  });

  it("shows a one-text reply as before, with no header", () => {
    const el = stack([{ kind: "text", text: "Just words." }]);
    expect(headers(el)).toEqual([]);
    expect(el.textContent).toContain("Just words.");
  });

  it("shows an image from the result's folder", async () => {
    storage.seedImage(`${DIR}/image-00000001.png`, SHOT);
    const el = stack([
      { kind: "text", text: "Look" },
      { kind: "image", name: "shot.png", ref: "image-00000001.png" },
    ]);
    await waitFor(() => expect(el.querySelector("img")?.getAttribute("src")).toBe(SHOT));
    expect(el.querySelector("img")?.getAttribute("alt")).toBe("shot.png");
  });

  it("renders a Markdown file's headings, and a .txt file in mono", async () => {
    storage.seedItemFile(`${DIR}/files/file-00000001.md`, text("# Notes\n\nBody"));
    storage.seedItemFile(`${DIR}/files/file-00000002.txt`, text("plain *not bold*"));
    const el = stack([
      { kind: "file", name: "notes.md", ref: "files/file-00000001.md" },
      { kind: "file", name: "log.txt", ref: "files/file-00000002.txt" },
    ]);
    await waitFor(() => expect(el.querySelector("h1")?.textContent).toBe("Notes"));
    await waitFor(() => expect(el.querySelector("pre.reply-item-plain")?.textContent).toBe("plain *not bold*"));
    expect(el.querySelector("strong")).toBeNull();
  });

  it("shows a text file over the cap by name with Open, not its contents", async () => {
    storage.seedItemFile(`${DIR}/files/file-00000003.md`, text("# Big\n" + "a".repeat(ITEM_TEXT_MAX_BYTES)));
    const el = stack([{ kind: "file", name: "big.md", ref: "files/file-00000003.md" }]);
    const item = el.querySelector<HTMLElement>(".reply-item")!;
    await waitFor(() => expect(within(item).getByRole("button", { name: "Open" })).toBeTruthy());
    expect(el.querySelector("h1")).toBeNull();
    await userEvent.click(within(item).getByRole("button", { name: "Open" }));
    expect(storage.opened).toEqual([`${DIR}/files/file-00000003.md`]);
  });

  it("opens a link through openUrl, and never makes a javascript: URL a link", async () => {
    const el = stack([
      { kind: "link", url: "https://example.com/pr/1" },
      { kind: "link", url: "javascript:alert(1)" },
    ]);
    const links = el.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("https://example.com/pr/1");
    await userEvent.click(links[0]);
    expect(opener.openUrl).toHaveBeenCalledWith("https://example.com/pr/1");
    expect(el.textContent).toContain("javascript:alert(1)");
  });

  it("shows a .zip by name, and Open hands Rust its root-relative ref (AE3)", async () => {
    storage.seedItemFile(`${DIR}/files/file-0000000a.zip`, new Uint8Array([0x50, 0x4b, 3, 4]));
    const el = stack([{ kind: "file", name: "build.zip", ref: "files/file-0000000a.zip" }]);
    expect(el.textContent).toContain("build.zip");
    await userEvent.click(within(el).getByRole("button", { name: "Open" }));
    expect(storage.opened).toEqual([`${DIR}/files/file-0000000a.zip`]);
  });

  it("shows a placeholder naming an item whose file is missing, and does not throw", async () => {
    const el = stack([
      { kind: "text", text: "x" },
      { kind: "image", name: "lost.png", ref: "image-0000dead.png" },
      { kind: "file", name: "lost.md", ref: "files/file-0000dead.md" },
      { kind: "file", name: "lost.pdf", ref: "files/file-0000beef.pdf" },
      { kind: "video", name: "lost.mov", ref: "video-0000dead.mov" },
    ]);
    await waitFor(() => expect(within(el).getByText("lost.png is missing")).toBeTruthy());
    await waitFor(() => expect(within(el).getByText("lost.md is missing")).toBeTruthy());
    await waitFor(() => expect(within(el).getByText("lost.pdf is missing")).toBeTruthy());
    // A video keeps RichView's own placeholder, which shows its ref, under a header with its name.
    await waitFor(() => expect(el.querySelector(".rich-video-missing")?.textContent).toBe("video-0000dead.mov"));
    expect(headers(el)).toContain("Videolost.mov");
  });

  it("shows Adding for an item still copying", () => {
    const el = stack(
      [
        { kind: "text", text: "x" },
        { kind: "file", name: "big.pdf", ref: "files/file-00000009.pdf" },
      ],
      { pending: new Set([1]) },
    );
    expect(within(el).getByText("Adding")).toBeTruthy();
    expect(pdf.openPdf).not.toHaveBeenCalled();
  });

  it("leaves out a whitespace-only text item", () => {
    const el = stack([
      { kind: "text", text: "  \n " },
      { kind: "link", url: "https://example.com" },
    ]);
    expect(headers(el)).toEqual(["Link"]);
  });

  it("shows text items as stored Markdown, and leaves a PDF item as it was", async () => {
    storage.seedItemFile(`${DIR}/files/file-1a2b3c4d.pdf`, PDF);
    const { doc, rendered } = fakeDoc();
    pdf.openPdf.mockResolvedValue(doc);
    const el = stack(
      [
        { kind: "text", text: "## Summary" },
        { kind: "file", name: "report.pdf", ref: "files/file-1a2b3c4d.pdf" },
      ],
      { stored: true },
    );
    expect(el.querySelector("pre.rich-stored")?.textContent).toBe("## Summary");
    expect(el.querySelector("h2")).toBeNull();
    await waitFor(() => expect(rendered).toEqual([1]));
    expect(el.querySelectorAll("canvas")).toHaveLength(1);
  });
});
