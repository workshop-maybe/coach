// A stored reply, read (U3). Rendered, it is a read-only Tiptap view with the editor's own
// extensions and prose type (R11, KTD5): the stored string is parsed as Markdown, never set
// as HTML, and the schema has no frame or script node, so nothing in a reply runs (R13). Its
// one image node shows only a PNG or JPEG the caller's image source returns for a bare file
// name beside the reply's file, so nothing loads from the network or outside the data folder
// either (KTD2 of the paste-images plan, which supersedes in part this view's "no image
// node"). Its video node holds to the same rule: it plays only a URL the caller's source
// returns for a bare local video name, never autoplays, and decodes nothing of a reply's
// video before play (KTD2 of the video plan). On Linux the source still reads the whole file
// into a Blob when the view mounts, since WebKitGTK plays only blob URLs (KTD4). Stored, it is the exact string the file holds, in the
// record mono (R12, KTD6). The caller owns the switch between the two.
//
// Links leave for the system browser. A click, a middle-click, the context menu and a drag
// on a rendered link are all stopped, since the webview would otherwise follow the link or
// offer its own "Open Link" in the frameless window. Only http, https and mailto addresses
// reach the opener (KTD5). The context menu and a drag are stopped on an image and a video
// too, so the webview offers no "Open Image", "Open Video in New Window" or "Download Video",
// and a drag never carries the image's data URI or the video's URL as text.
//
// The region scrolls on its own, spans its container and holds the prose to a centered
// measure of about 70 characters (R9). It is focusable, so the keyboard can scroll it.

import { useEffect, useRef } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TableAsText, richExtensions } from "./richExtensions";
import { refreshImages, type RichImageSource } from "./richImage";

export interface RichViewProps {
  /** The reply as stored: the editor's Markdown. */
  value: string;
  /** Show the stored string exactly, unrendered. */
  stored?: boolean;
  /** Names the scrolling region. */
  "aria-label": string;
  /** Reads the images and videos beside the reply's file. Without it, they show as placeholders. */
  images?: RichImageSource;
}

const OPENABLE = new Set(["http:", "https:", "mailto:"]);

/** The address to hand the system browser, or null for anything that is not http, https or mailto. */
export function externalHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    // No base: a relative address is refused rather than resolved against the app.
    const url = new URL(raw);
    return OPENABLE.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** The link an event landed on, inside the region. */
function linkOf(e: ReactMouseEvent<HTMLElement> | ReactDragEvent<HTMLElement>): HTMLAnchorElement | null {
  const a = e.target instanceof Element ? e.target.closest("a") : null;
  return a && e.currentTarget.contains(a) ? a : null;
}

/** Whether an event landed on an image or a video inside the region. */
function onMedia(e: ReactMouseEvent<HTMLElement> | ReactDragEvent<HTMLElement>): boolean {
  const media = e.target instanceof Element ? e.target.closest("img, video") : null;
  return !!media && e.currentTarget.contains(media);
}

function open(a: HTMLAnchorElement) {
  const href = externalHref(a.getAttribute("href"));
  if (href) openUrl(href).catch(() => undefined);
}

export function RichView({ value, stored = false, images, "aria-label": label }: RichViewProps) {
  function onClick(e: ReactMouseEvent<HTMLElement>) {
    const a = linkOf(e);
    if (!a) return;
    e.preventDefault();
    open(a);
  }

  function onAuxClick(e: ReactMouseEvent<HTMLElement>) {
    const a = linkOf(e);
    if (!a) return;
    e.preventDefault();
    if (e.button === 1) open(a);
  }

  function onStop(e: ReactMouseEvent<HTMLElement> | ReactDragEvent<HTMLElement>) {
    if (linkOf(e) || onMedia(e)) e.preventDefault();
  }

  return (
    <div
      className="rich-view"
      role="region"
      aria-label={label}
      tabIndex={0}
      onClickCapture={onClick}
      onAuxClickCapture={onAuxClick}
      onContextMenuCapture={onStop}
      onDragStartCapture={onStop}
    >
      <div className="rich-view-measure">{stored ? <pre className="rich-stored">{value}</pre> : <Rendered value={value} images={images} />}</div>
    </div>
  );
}

/** The rendered reply. Mounted only while showing, so the stored text never sits beside a hidden copy. */
function Rendered({ value, images }: { value: string; images?: RichImageSource }) {
  // The Markdown the view last showed, so a value that comes back unchanged is not re-parsed.
  const shown = useRef(value);
  // The image source as it is now: the image and video nodes read it on every render.
  const source = useRef(images);
  const editor = useEditor({
    extensions: [...richExtensions("", () => source.current ?? null), TableAsText],
    content: value,
    contentType: "markdown",
    editable: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      // Tiptap marks its root a textbox; this one is read, not edited, and the region carries the name.
      attributes: { class: "rich-prose", role: "none" },
    },
  });

  useEffect(() => {
    if (!editor || value === shown.current) return;
    shown.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  // A new source (another folder) redraws the images and videos that show.
  useEffect(() => {
    if (source.current === images) return;
    source.current = images;
    if (editor) refreshImages(editor);
  }, [editor, images]);

  return <EditorContent editor={editor} />;
}
