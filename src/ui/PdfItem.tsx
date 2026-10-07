// A PDF item, read page by page in place (U3 of
// docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md, R8, KTD5, KTD6). pdf.js, behind
// pdfDocument.ts and loaded only when a PDF first shows, draws each page to a canvas inside a
// bounded scroll area of about 70vh, so the next item in the stack stays reachable. A page
// draws only while it is near view and gives its pixels back once it scrolls far away. The area
// says Loading until the first page is drawn. A PDF pdf.js can't read shows its name and Open,
// and one whose file is gone shows a placeholder naming it. Nothing here is a frame: RichView
// keeps its "no frame node" rule.

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ItemSource } from "./imageSource";
import type { PdfDocument } from "./pdfDocument";
import { FileByName, ItemMissing, ItemWaiting } from "./replyItemParts";

/** The widest a page's canvas is drawn, in device pixels, however wide the window or dense the screen. */
const MAX_CANVAS_WIDTH = 4096;
/** How far beyond the area's edges a page counts as near and draws. */
const NEAR_MARGIN = "100% 0px";

// pdf.js loads once and every PDF on screen shares the load, so two panes opening at once
// never start two imports.
let pdfModule: Promise<typeof import("./pdfDocument")> | null = null;
const loadPdf = () => (pdfModule ??= import("./pdfDocument"));

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed" }
  | { status: "ready"; doc: PdfDocument; width: number; height: number };

export interface PdfItemProps {
  /** The file's original name. */
  name: string;
  /** The file's ref in the result's folder, such as `files/file-1a2b3c4d.pdf`. */
  fileRef: string;
  source: ItemSource;
}

export function PdfItem({ name, fileRef, source }: PdfItemProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [firstDrawn, setFirstDrawn] = useState(false);
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    let doc: PdfDocument | null = null;
    setState({ status: "loading" });
    setFirstDrawn(false);
    (async () => {
      const url = await source.file(fileRef);
      if (!live) return url?.release();
      if (!url) return setState({ status: "missing" });
      try {
        const { openPdf } = await loadPdf();
        doc = await openPdf(url.url).finally(() => url.release());
        if (!live) return doc.destroy();
        const first = await doc.getPage(1);
        if (!live) return;
        setState({ status: "ready", doc, width: first.width, height: first.height });
      } catch {
        if (live) setState({ status: "failed" });
      }
    })();
    return () => {
      live = false;
      doc?.destroy();
    };
  }, [fileRef, source]);

  if (state.status === "missing") return <ItemMissing name={name} />;
  if (state.status === "failed") return <FileByName name={name} fileRef={fileRef} source={source} note="Can't show this PDF" />;

  return (
    <div ref={area} className="reply-item-bounded reply-item-pdf" role="region" aria-label={name} tabIndex={0}>
      {!firstDrawn && <ItemWaiting label="Loading" />}
      {state.status === "ready" &&
        Array.from({ length: state.doc.numPages }, (_, i) => (
          <PdfPageView
            key={i}
            doc={state.doc}
            n={i + 1}
            aspect={`${state.width} / ${state.height}`}
            area={area}
            onDrawn={i === 0 ? () => setFirstDrawn(true) : undefined}
            onFailed={i === 0 ? () => setState({ status: "failed" }) : undefined}
          />
        ))}
    </div>
  );
}

interface PageProps {
  doc: PdfDocument;
  n: number;
  /** The first page's aspect, which holds each page's place before it draws. */
  aspect: string;
  area: RefObject<HTMLDivElement | null>;
  onDrawn?: () => void;
  onFailed?: () => void;
}

function PdfPageView({ doc, n, aspect, area, onDrawn, onFailed }: PageProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The first page draws at once; every other page waits until it is near view.
  const [isNear, setNear] = useState(n === 1);

  useEffect(() => {
    const el = box.current;
    if (!el || n === 1) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.target === el) setNear(entry.isIntersecting);
    }, { root: area.current, rootMargin: NEAR_MARGIN });
    observer.observe(el);
    return () => observer.disconnect();
  }, [n, area]);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    if (!isNear) {
      // Far from view: give the pixels back and keep the page's place.
      target.width = 0;
      target.height = 0;
      return;
    }
    let live = true;
    (async () => {
      try {
        const page = await doc.getPage(n);
        if (!live) return;
        const cssWidth = box.current?.clientWidth || page.width;
        const dpr = window.devicePixelRatio || 1;
        const scale = Math.min((cssWidth / page.width) * dpr, MAX_CANVAS_WIDTH / page.width);
        await page.render(target, scale);
        page.cleanup();
        if (live) onDrawn?.();
      } catch {
        if (live) onFailed?.();
      }
    })();
    return () => {
      live = false;
    };
    // The callbacks are fresh each render; drawing again for them would waste the page.
  }, [doc, n, isNear]);

  return (
    <div ref={box} className="pdf-page" style={{ aspectRatio: aspect }}>
      <canvas ref={canvas} aria-label={`Page ${n}`} />
    </div>
  );
}
