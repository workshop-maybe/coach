// The small pieces a reply's item views share (U3 of
// docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md, R8, KTD6): a file shown by name with
// Open, and the placeholder for an item whose file is gone.

import { useState } from "react";
import type { ItemSource } from "./imageSource";

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
