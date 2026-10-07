// A Markdown or plain-text file item, shown in place (U3 of
// docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md, R8, KTD4, KTD6). Its text comes
// through Rust under a 1 MiB cap. A Markdown file renders through RichView with no image source,
// so its picture refs stay placeholders and nothing loads from beside it; a plain-text file shows
// in the record mono. Either sits in a bounded area of about 70vh. A file over the cap, or one
// that is not UTF-8 text, shows its name and Open instead, and a file that is gone shows a
// placeholder naming it.

import { useEffect, useState } from "react";
import type { ItemSource } from "./imageSource";
import { RichView } from "./RichView";
import { FileByName, ItemMissing, ItemWaiting } from "./replyItemParts";

type State = { status: "loading" } | { status: "missing" } | { status: "unshown" } | { status: "ready"; text: string };

export interface TextFileItemProps {
  name: string;
  fileRef: string;
  source: ItemSource;
  /** Markdown renders; plain text shows as it is. */
  format: "markdown" | "plain";
}

export function TextFileItem({ name, fileRef, source, format }: TextFileItemProps) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    source.text(fileRef).then(
      (text) => live && setState(text === null ? { status: "missing" } : { status: "ready", text }),
      () => live && setState({ status: "unshown" }),
    );
    return () => {
      live = false;
    };
  }, [fileRef, source]);

  switch (state.status) {
    case "loading":
      return <ItemWaiting label="Loading" />;
    case "missing":
      return <ItemMissing name={name} />;
    case "unshown":
      return <FileByName name={name} fileRef={fileRef} source={source} />;
    case "ready":
      return format === "markdown" ? (
        <div className="reply-item-bounded">
          <RichView aria-label={name} value={state.text} />
        </div>
      ) : (
        <div className="reply-item-bounded" role="region" aria-label={name} tabIndex={0}>
          <pre className="reply-item-plain">{state.text}</pre>
        </div>
      );
  }
}
