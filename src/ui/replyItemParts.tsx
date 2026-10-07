// The small pieces a reply's item views share (U3 of
// docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md, R8, KTD6): a file shown by name with
// Open, an item's header bar, and the placeholder for an item whose file is gone.

import { useState } from "react";
import type { ReactNode } from "react";
import type { ReplyItem } from "../domain/types";
import type { ItemSource } from "./imageSource";

/** Each kind as its header bar names it. */
export const KIND_LABEL: Record<ReplyItem["kind"], string> = {
  text: "Text",
  image: "Image",
  video: "Video",
  file: "File",
  link: "Link",
};

/** An item's header bar: its kind and, for a picture, video or file, its name, then anything passed in. */
export function ItemBar({ item, children }: { item: ReplyItem; children?: ReactNode }) {
  return (
    <header className="reply-item-bar">
      <span className="reply-item-kind">{KIND_LABEL[item.kind]}</span>
      {item.kind !== "text" && item.kind !== "link" && <span className="reply-item-label">{item.name}</span>}
      {children}
    </header>
  );
}

/** An item file by name, with Open. Rust opens it in its default app or shows it in its folder (KTD4). */
export function FileByName({ name, fileRef, source, note }: { name: string; fileRef: string; source: ItemSource; note?: string }) {
  const [error, setError] = useState<string | null>(null);
  function open() {
    setError(null);
    source.open(fileRef).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }
  return (
    <div className="reply-item-file">
      {note && <p className="reply-item-note">{note}</p>}
      <span className="reply-item-name">{name}</span>
      <button type="button" onClick={open}>
        Open
      </button>
      {error && (
        <p className="reply-item-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** What shows for an item whose file is no longer in the data folder. */
export function ItemMissing({ name }: { name: string }) {
  return <p className="reply-item-missing">{`${name} is missing`}</p>;
}

/** What shows while an item's file is still being read or copied. */
export function ItemWaiting({ label }: { label: "Loading" | "Adding" }) {
  return (
    <p className="reply-item-waiting" aria-busy="true">
      {label}
    </p>
  );
}
