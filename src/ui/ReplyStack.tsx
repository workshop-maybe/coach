// One reply, rendered in place as a stack of its items (U3 of
// docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md, R8, R11, KTD5, KTD6). Every place
// that shows a reply uses this one component, so an item shows the same way everywhere (R11).
//
// Each item sits under a mono header bar naming its kind and, for a file, its name. Text renders
// through RichView with the result folder's images and videos, or shows as stored. A picture
// shows from the folder; a video plays through RichView's own video node, so it keeps that
// node's rules (KTD2 of the video plan). A PDF reads page by page (PdfItem), a Markdown or
// plain-text file shows its contents (TextFileItem), and any other file shows its name and Open.
// A link shows its URL and opens in the system browser only when RichView's `externalHref`
// allows it, so a `javascript:` URL is never a link. An item whose file is gone shows a
// placeholder naming it, an item still copying says Adding, and a text item with nothing in it
// is left out. A reply that is exactly one text item has no header, so a reply saved before
// items shows as it always did (R12).
//
// The stack is the scroller. A PDF and a long text file sit in bounded areas inside it.

import { useEffect, useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isImageDataUri, isLocalImageName } from "../domain/images";
import { itemExtension } from "../domain/files";
import { isItemRef, isOneText } from "../domain/replyItems";
import type { ReplyItem } from "../domain/types";
import type { ItemSource } from "./imageSource";
import { PdfItem } from "./PdfItem";
import { imageMarkdown } from "./richImage";
import { RichView, externalHref } from "./RichView";
import { TextFileItem } from "./TextFileItem";
import { FileByName, ItemMissing, ItemWaiting } from "./replyItemParts";

export interface ReplyStackProps {
  /** The reply's items, in order. `replyItems(record)` gives them for any saved reply. */
  items: readonly ReplyItem[];
  /** The result folder's images, videos and item files: `resultImages(storage, assessment)`. */
  source: ItemSource;
  /** Show text items as the Markdown they store. Other items show as they are. */
  stored?: boolean;
  /** Indexes into `items` of the items whose files are still being copied. */
  pending?: ReadonlySet<number>;
  /** Names the scrolling region. */
  "aria-label": string;
}

/** Each kind as its header bar names it. */
export const KIND_LABEL: Record<ReplyItem["kind"], string> = {
  text: "Text",
  image: "Image",
  video: "Video",
  file: "File",
  link: "Link",
};

export function ReplyStack({ items, source, stored = false, pending, "aria-label": label }: ReplyStackProps) {
  const bare = isOneText(items);
  return (
    <div className={bare ? "reply-stack reply-stack-bare" : "reply-stack"} role="region" aria-label={label} tabIndex={0}>
      {items.map((item, i) => {
        if (item.kind === "text" && item.text.trim() === "" && !bare) return null;
        return (
          <section key={i} className="reply-item" data-kind={item.kind}>
            {!bare && (
              <header className="reply-item-bar">
                <span className="reply-item-kind">{KIND_LABEL[item.kind]}</span>
                {item.kind !== "text" && item.kind !== "link" && <span className="reply-item-label">{item.name}</span>}
              </header>
            )}
            <div className="reply-item-body">
              {pending?.has(i) ? <ItemWaiting label="Adding" /> : <ItemBody item={item} source={source} stored={stored} />}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One item's body as the stack shows it. The reply editor shows its items through it too (R11). */
export function ItemBody({ item, source, stored }: { item: ReplyItem; source: ItemSource; stored: boolean }) {
  switch (item.kind) {
    case "text":
      return <RichView aria-label="Text" value={item.text} stored={stored} images={source} />;
    case "image":
      return <ImageBody name={item.name} imageRef={item.ref} source={source} />;
    case "video":
      return <RichView aria-label={item.name} value={imageMarkdown({ src: item.ref, alt: item.name })} images={source} />;
    case "link":
      return <LinkBody url={item.url} />;
    case "file":
      return <FileBody name={item.name} fileRef={item.ref} source={source} />;
  }
}

function FileBody({ name, fileRef, source }: { name: string; fileRef: string; source: ItemSource }) {
  if (!isItemRef("file", fileRef)) return <ItemMissing name={name} />;
  switch (itemExtension(fileRef)) {
    case "pdf":
      return <PdfItem name={name} fileRef={fileRef} source={source} />;
    case "md":
    case "markdown":
      return <TextFileItem name={name} fileRef={fileRef} source={source} format="markdown" />;
    case "txt":
      return <TextFileItem name={name} fileRef={fileRef} source={source} format="plain" />;
    default:
      return <FileByName name={name} fileRef={fileRef} source={source} />;
  }
}

/** Stops the webview's own menu and drag on a picture or link, as RichView does. */
function stop(e: ReactMouseEvent | ReactDragEvent) {
  e.preventDefault();
}

type ImageState = { status: "loading" } | { status: "missing" } | { status: "ready"; uri: string };

/** A picture from the result's folder, by its bare name. Only a PNG or JPEG data URI ever becomes a `src`. */
function ImageBody({ name, imageRef, source }: { name: string; imageRef: string; source: ItemSource }) {
  const [state, setState] = useState<ImageState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    if (!isLocalImageName(imageRef)) {
      setState({ status: "missing" });
      return;
    }
    setState({ status: "loading" });
    source.load(imageRef).then(
      (uri) => live && setState(uri !== null && isImageDataUri(uri) ? { status: "ready", uri } : { status: "missing" }),
      () => live && setState({ status: "missing" }),
    );
    return () => {
      live = false;
    };
  }, [imageRef, source]);

  if (state.status === "missing") return <ItemMissing name={name} />;
  if (state.status === "loading") return <ItemWaiting label="Loading" />;
  return <img className="reply-item-image" src={state.uri} alt={name} draggable={false} onContextMenu={stop} onDragStart={stop} />;
}

/** A link's URL, opened in the system browser when it is http, https or mailto, and plain text otherwise. */
function LinkBody({ url }: { url: string }) {
  const href = externalHref(url);
  if (!href) return <p className="reply-item-url">{url}</p>;
  const open = () => void openUrl(href).catch(() => undefined);
  return (
    <p className="reply-item-url">
      <a
        href={href}
        draggable={false}
        onClick={(e) => {
          e.preventDefault();
          open();
        }}
        onAuxClick={(e) => {
          e.preventDefault();
          if (e.button === 1) open();
        }}
        onContextMenu={stop}
        onDragStart={stop}
      >
        {url}
      </a>
    </p>
  );
}
