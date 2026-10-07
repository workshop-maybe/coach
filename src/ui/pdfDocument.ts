// pdf.js behind a small seam (U3 of docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md,
// KTD5). WebKitGTK shows nothing for a PDF in a frame, so a PDF item renders with the bundled
// pdf.js on every platform. Its worker is an asset Vite emits beside the app, so nothing comes
// from a CDN. The PDF's bytes are fetched from its data-folder URL into memory, as the Linux
// video path already reads a whole file, and pdf.js never fetches anything itself.
//
// Only PdfItem imports this module, and only on demand, so pdf.js loads when a reply first
// shows a PDF. Tests mock this module: jsdom has no canvas.

import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** One page, sized at scale 1 in CSS pixels. */
export interface PdfPage {
  width: number;
  height: number;
  /** Draws the page onto `canvas` at `scale` device pixels per CSS pixel of its scale-1 size. */
  render(canvas: HTMLCanvasElement, scale: number): Promise<void>;
  /** Frees what the page holds once its canvas is drawn. */
  cleanup(): void;
}

export interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): void;
}

/** Opens the PDF at `url`, a URL from the storage port's `fileUrl`. Rejects what pdf.js can't read. */
export async function openPdf(url: string): Promise<PdfDocument> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PDF fetch failed: ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  // The scripting sandbox is never loaded, so no script in the PDF runs.
  const task = getDocument({ data });
  const doc = await task.promise;
  return {
    numPages: doc.numPages,
    async getPage(n) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      return {
        width: base.width,
        height: base.height,
        async render(canvas, scale) {
          const viewport = page.getViewport({ scale });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          await page.render({ canvas, viewport }).promise;
        },
        cleanup: () => void page.cleanup(),
      };
    },
    // Ends the worker's side of the document too.
    destroy: () => void task.destroy(),
  };
}
