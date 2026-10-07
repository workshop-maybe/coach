// @vitest-environment jsdom
// A PDF item, read page by page (U3 of the reply artifacts plan, KTD5). pdf.js is mocked: jsdom
// has no canvas, and the wrapper in pdfDocument.ts is the only place that touches it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pdf = vi.hoisted(() => ({ openPdf: vi.fn() }));
vi.mock("./pdfDocument", () => pdf);

import { PdfItem } from "./PdfItem";
import type { PdfDocument } from "./pdfDocument";
import type { ItemSource } from "./imageSource";

/** A fake IntersectionObserver the test drives: `near(el)` reports an element scrolled near. */
const observed = new Map<Element, (entries: IntersectionObserverEntry[]) => void>();
class FakeObserver {
  constructor(private readonly callback: (entries: IntersectionObserverEntry[]) => void) {}
  observe(el: Element) {
    observed.set(el, this.callback);
  }
  unobserve(el: Element) {
    observed.delete(el);
  }
  disconnect() {
    for (const [el, cb] of observed) if (cb === this.callback) observed.delete(el);
  }
}
function near(el: Element, isIntersecting = true) {
  const cb = observed.get(el);
  if (!cb) throw new Error("not observed");
  act(() => cb([{ target: el, isIntersecting } as unknown as IntersectionObserverEntry]));
}

function fakeDoc(pages: number) {
  const rendered: number[] = [];
  const doc: PdfDocument = {
    numPages: pages,
    getPage: vi.fn(async (n: number) => ({
      width: 600,
      height: 800,
      render: vi.fn(async (canvas: HTMLCanvasElement) => {
        canvas.dataset.page = String(n);
        rendered.push(n);
      }),
      cleanup: vi.fn(),
    })),
    destroy: vi.fn(),
  };
  return { doc, rendered };
}

function source(over: Partial<ItemSource> = {}): ItemSource & { released: number } {
  const s = {
    released: 0,
    load: async () => null,
    file: vi.fn(async (ref: string) => ({ url: `blob:test/${ref}`, release: () => void s.released++ })),
    text: async () => null,
    open: vi.fn(async () => undefined),
    ...over,
  };
  return s as ItemSource & { released: number };
}

beforeEach(() => {
  observed.clear();
  pdf.openPdf.mockReset();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PdfItem", () => {
  it("asks pdf.js for the document from the file URL and renders its first page", async () => {
    const { doc, rendered } = fakeDoc(3);
    pdf.openPdf.mockResolvedValue(doc);
    const s = source();
    render(<PdfItem name="report.pdf" fileRef="files/file-1a2b3c4d.pdf" source={s} />);
    expect(screen.getByText("Loading")).toBeTruthy();
    await waitFor(() => expect(rendered).toEqual([1]));
    expect(s.file).toHaveBeenCalledWith("files/file-1a2b3c4d.pdf");
    expect(pdf.openPdf).toHaveBeenCalledWith("blob:test/files/file-1a2b3c4d.pdf");
    expect(screen.queryByText("Loading")).toBeNull();
    expect(document.querySelectorAll("canvas")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "report.pdf" })).toBeTruthy();
    // The URL is let go once the bytes are in.
    expect(s.released).toBe(1);
  });

  it("renders a later page only once it is scrolled near", async () => {
    const { doc, rendered } = fakeDoc(3);
    pdf.openPdf.mockResolvedValue(doc);
    render(<PdfItem name="report.pdf" fileRef="files/file-1a2b3c4d.pdf" source={source()} />);
    await waitFor(() => expect(rendered).toEqual([1]));
    const third = document.querySelectorAll(".pdf-page")[2];
    near(third);
    await waitFor(() => expect(rendered).toEqual([1, 3]));
    expect(document.querySelector('canvas[data-page="2"]')).toBeNull();
  });

  it("shows Can't show this PDF with its name and Open when pdf.js rejects it", async () => {
    pdf.openPdf.mockRejectedValue(new Error("Invalid PDF structure"));
    const s = source();
    render(<PdfItem name="broken.pdf" fileRef="files/file-00000001.pdf" source={s} />);
    expect(await screen.findByText("Can't show this PDF")).toBeTruthy();
    expect(screen.getByText("broken.pdf")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(s.open).toHaveBeenCalledWith("files/file-00000001.pdf");
  });

  it("shows a placeholder naming the item when its file is missing", async () => {
    const s = source({ file: vi.fn(async () => null) });
    render(<PdfItem name="gone.pdf" fileRef="files/file-00000002.pdf" source={s} />);
    expect(await screen.findByText("gone.pdf is missing")).toBeTruthy();
    expect(pdf.openPdf).not.toHaveBeenCalled();
  });

  it("destroys the document when it unmounts", async () => {
    const { doc, rendered } = fakeDoc(1);
    pdf.openPdf.mockResolvedValue(doc);
    const { unmount } = render(<PdfItem name="r.pdf" fileRef="files/file-00000003.pdf" source={source()} />);
    await waitFor(() => expect(rendered).toEqual([1]));
    unmount();
    expect(doc.destroy).toHaveBeenCalled();
  });
});
