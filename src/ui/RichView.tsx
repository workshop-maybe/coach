// A stored reply, read (U3). Rendered, it is a read-only Tiptap view with the editor's own
// extensions and prose type (R11, KTD5): the stored string is parsed as Markdown, never set
// as HTML, and the schema has no image, frame or script node, so nothing in a reply runs or
// loads (R13). Stored, it is the exact string the file holds, in the record mono (R12, KTD6).
// The caller owns the switch between the two.
//
// Links leave for the system browser. A click, a middle-click, the context menu and a drag
// on a rendered link are all stopped, since the webview would otherwise follow the link or
// offer its own "Open Link" in the frameless window. Only http, https and mailto addresses
// reach the opener (KTD5).
//
// The region scrolls on its own, spans its container and holds the prose to a centered
// measure of about 70 characters (R9). It is focusable, so the keyboard can scroll it.

import { useEffect, useRef } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TableAsText, richExtensions } from "./richExtensions";

export interface RichViewProps {
  /** The reply as stored: the editor's Markdown. */
  value: string;
  /** Show the stored string exactly, unrendered. */
  stored?: boolean;
  /** Names the scrolling region. */
  "aria-label": string;
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

function open(a: HTMLAnchorElement) {
  const href = externalHref(a.getAttribute("href"));
  if (href) openUrl(href).catch(() => undefined);
}

export function RichView({ value, stored = false, "aria-label": label }: RichViewProps) {
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
    if (linkOf(e)) e.preventDefault();
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
      <div className="rich-view-measure">{stored ? <pre className="rich-stored">{value}</pre> : <Rendered value={value} />}</div>
    </div>
  );
}

/** The rendered reply. Mounted only while showing, so the stored text never sits beside a hidden copy. */
function Rendered({ value }: { value: string }) {
  // The Markdown the view last showed, so a value that comes back unchanged is not re-parsed.
  const shown = useRef(value);
  const editor = useEditor({
    extensions: [...richExtensions(), TableAsText],
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

  return <EditorContent editor={editor} />;
}
