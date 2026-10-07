// Building a reply on "What came back" (U4 of docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md,
// R1-R4, R7, KTD7): the reply is a list of items, not a form. It opens as one text box, named
// Reply, with no bar, so pasting works as it always has. Under the stack sits one row of quiet
// add keys, Text, Image, Video, File and Link, and once the reply is more than one text item each
// item carries a bar naming it and a quiet Remove, which asks nothing, since nothing is saved
// until the reply is recorded or held.
//
// Image, Video and File pick through Rust with any file accepted (KTD3), so the content, not the
// key, decides what each file becomes. A link is one URL line: Enter or leaving it commits what
// `externalHref` would open (http, https, mailto), and anything else stays open with one line
// under it. A new text or link item takes focus, a cancelled picker hands focus back to its key,
// and Remove moves focus to the item before, or to the first add key.
//
// The editor is the beat's one drop box. Its text items register none, so a file dropped over
// one becomes an item. A paste into a text item of files that are not all PNG, JPEG or video
// comes here through `onFiles` and becomes items too; a PNG, JPEG or video pasted there stays
// inline, as today (R7). Every other item shows through the stack's own bodies (R11). While a
// copy runs the stack ends in an item that says Adding.

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import type { AddedKind, AddFrom } from "../storage/storage";
import type { ReplyItem } from "../domain/types";
import { registerDropBox } from "./dropFiles";
import type { ItemSource } from "./imageSource";
import { ItemBar, ItemWaiting, KIND_LABEL } from "./replyItemParts";
import { ItemBody } from "./ReplyStack";
import { RichText } from "./RichText";
import type { PastePayload, RichImages, RichTextHandle } from "./RichText";
import { externalHref } from "./RichView";
import type { AddItems } from "./useRichImages";

/** One item of a reply being built, with an id that outlives the item's place in the list. */
export interface ReplyEntry {
  id: number;
  item: ReplyItem;
}

let nextId = 1;

/** A new entry for `item`. */
export function replyEntry(item: ReplyItem): ReplyEntry {
  return { id: nextId++, item };
}

/** The refusal under a link line that would not open (KTD7). */
export const LINK_REFUSED = "Only http, https and mailto links can be added";

export interface ReplyItemsEditorHandle {
  /** Writes `text` into the text item `id` the way a paste would (KTD18 of the paste plan), returning its Markdown, or null when it is gone. */
  replaceAsPaste(id: number, text: string): string | null;
}

export interface ReplyItemsEditorProps {
  value: readonly ReplyEntry[];
  onChange(next: ReplyEntry[]): void;
  /** The text items' images and videos, saved beside the result as a reply's always were. */
  images: RichImages;
  /** The result folder's files, to show every other item. */
  source: ItemSource;
  /** Adds files as items. Without it (no folder yet) the file keys and drops add nothing. */
  addItems?: AddItems;
  /** A paste into text item `id`, with the reply box's fixes in. */
  onPaste?(id: number, paste: PastePayload): void;
  ref?: Ref<ReplyItemsEditorHandle>;
}

const KEYS: { kind: ReplyItem["kind"]; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "image", label: "Image" },
  { kind: "video", label: "Video" },
  { kind: "file", label: "File" },
  { kind: "link", label: "Link" },
];

/** What an item is called on its Remove: its kind, then its file name, its URL or, for text, its place among the text items. */
function removeName(item: ReplyItem, textPlace: number): string {
  switch (item.kind) {
    case "text":
      return `Remove text ${textPlace}`;
    case "link":
      return `Remove link ${item.url}`;
    default:
      return `Remove ${item.kind} ${item.name}`;
  }
}

export function ReplyItemsEditor({ value, onChange, images, source, addItems, onPaste, ref }: ReplyItemsEditorProps) {
  // The list as last handed out, so adds that land one after another each append to the last.
  const current = useRef(value);
  current.current = value;
  const latest = useRef({ onChange, addItems });
  latest.current = { onChange, addItems };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [adding, setAdding] = useState(0);
  // The link line being typed, before it is an item, and its refusal. The ref is the line as
  // it is now, so a blur that follows Enter's commit finds it gone and commits nothing more.
  const [link, setLinkState] = useState<string | null>(null);
  const linkNow = useRef<string | null>(null);
  const setLink = (next: string | null) => {
    linkNow.current = next;
    setLinkState(next);
  };
  const [linkError, setLinkError] = useState<string | null>(null);
  /** Closes the link line and its refusal. */
  const closeLink = () => {
    setLink(null);
    setLinkError(null);
  };
  // The text item just added, which takes focus as it mounts.
  const [focusNew, setFocusNew] = useState<number | null>(null);
  // Where focus goes once a Remove has rendered: an entry's id, or the first add key.
  const focusAfter = useRef<number | "keys" | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<number, RichTextHandle>());
  const keyRefs = useRef(new Map<ReplyItem["kind"], HTMLButtonElement>());

  function change(next: ReplyEntry[]) {
    current.current = next;
    latest.current.onChange(next);
  }

  useImperativeHandle(ref, () => ({
    replaceAsPaste(id, text) {
      return boxes.current.get(id)?.replaceAsPaste(text) ?? null;
    },
  }));

  /** Runs one add and appends what it added, in order. Resolves to how many went in. */
  async function add(from: AddFrom): Promise<number> {
    const run = latest.current.addItems;
    if (!run) return 0;
    setAdding((n) => n + 1);
    try {
      const added = await run(from);
      if (!mounted.current || added.length === 0) return 0;
      change([...current.current, ...added.map(replyEntry)]);
      return added.length;
    } catch {
      // The add has already told the person why.
      return 0;
    } finally {
      if (mounted.current) setAdding((n) => n - 1);
    }
  }

  async function pick(kind: AddedKind) {
    const added = await add({ kind: "pick", item: kind });
    if (added === 0 && mounted.current) keyRefs.current.get(kind)?.focus();
  }

  function addText() {
    const entry = replyEntry({ kind: "text", text: "" });
    setFocusNew(entry.id);
    change([...current.current, entry]);
  }

  function openLink() {
    setLinkError(null);
    if (linkNow.current === null) setLink("");
  }

  function press(kind: ReplyItem["kind"]) {
    if (kind === "text") addText();
    else if (kind === "link") openLink();
    else void pick(kind);
  }

  /** Commits the link line: a URL a link may open becomes an item, an empty line closes, anything else is refused. */
  function commitLink() {
    if (linkNow.current === null) return;
    const url = linkNow.current.trim();
    if (url === "") {
      closeLink();
      return;
    }
    if (externalHref(url) === null) {
      setLinkError(LINK_REFUSED);
      return;
    }
    closeLink();
    const entry = replyEntry({ kind: "link", url });
    focusAfter.current = entry.id;
    change([...current.current, entry]);
  }

  function onLinkKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    // Handled here, so the deck neither moves on (Enter) nor steps back (Escape).
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Enter") commitLink();
    else {
      closeLink();
      keyRefs.current.get("link")?.focus();
    }
  }

  function remove(id: number) {
    const at = current.current.findIndex((e) => e.id === id);
    if (at === -1) return;
    focusAfter.current = at > 0 ? current.current[at - 1].id : "keys";
    boxes.current.delete(id);
    change(current.current.filter((e) => e.id !== id));
  }

  // Focus after a Remove or a committed link lands once the list has rendered.
  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    if (target === "keys") return keyRefs.current.get("text")?.focus();
    const section = root.current?.querySelector<HTMLElement>(`[data-entry="${target}"]`);
    const field = section?.querySelector<HTMLElement>('[role="textbox"], textarea, input');
    (field ?? section)?.focus();
  }, [value]);

  // The editor is the beat's one drop box (KTD7). Its class name stays fixed, since the drop
  // listener puts its outline class on this element directly.
  const canAdd = !!addItems;
  useEffect(() => {
    const element = root.current;
    if (!canAdd || !element) return;
    return registerDropBox({ element, drop: (paths) => void add({ kind: "drop", paths }) });
  }, [canAdd]); // eslint-disable-line react-hooks/exhaustive-deps

  const bare = value.length === 1 && value[0].item.kind === "text" && link === null && adding === 0;
  let textPlace = 0;

  return (
    <div ref={root} className="reply-edit">
      <div className={bare ? "reply-stack reply-stack-bare reply-edit-stack" : "reply-stack reply-edit-stack"}>
        {value.map(({ id, item }) => {
          const place = item.kind === "text" ? ++textPlace : 0;
          return (
            <section key={id} className="reply-item" data-kind={item.kind} data-entry={id} tabIndex={-1}>
              {!bare && (
                <ItemBar item={item}>
                  <button type="button" className="ghost reply-item-remove" aria-label={removeName(item, place)} onClick={() => remove(id)}>
                    Remove
                  </button>
                </ItemBar>
              )}
              <div className="reply-item-body">
                {item.kind === "text" ? (
                  <RichText
                    ref={(handle) => {
                      if (handle) boxes.current.set(id, handle);
                    }}
                    aria-label={place === 1 ? "Reply" : `Reply text ${place}`}
                    value={item.text}
                    onChange={(text) => change(current.current.map((e) => (e.id === id ? { id, item: { kind: "text", text } } : e)))}
                    placeholder={place === 1 ? "Paste the reply" : undefined}
                    autoFocus={focusNew === id}
                    cleanPaste
                    onPaste={(paste) => onPaste?.(id, paste)}
                    images={images}
                    onFiles={(files) => void add({ kind: "paste", files })}
                    dropBox={false}
                  />
                ) : (
                  <ItemBody item={item} source={source} stored={false} />
                )}
              </div>
            </section>
          );
        })}
        {link !== null && (
          <section className="reply-item" data-kind="link">
            <header className="reply-item-bar">
              <span className="reply-item-kind">{KIND_LABEL.link}</span>
            </header>
            <div className="reply-item-body reply-edit-link">
              <input
                aria-label="Link"
                value={link}
                placeholder="https://"
                autoFocus
                aria-invalid={linkError !== null}
                aria-describedby={linkError !== null ? "reply-link-error" : undefined}
                onChange={(e) => {
                  setLink(e.target.value);
                  setLinkError(null);
                }}
                onKeyDown={onLinkKey}
                onBlur={commitLink}
              />
              {linkError && (
                <p id="reply-link-error" className="reply-item-error">
                  {linkError}
                </p>
              )}
            </div>
          </section>
        )}
        {adding > 0 && (
          <section className="reply-item" role="status">
            <div className="reply-item-body">
              <ItemWaiting label="Adding" />
            </div>
          </section>
        )}
      </div>
      <div className="reply-edit-keys" role="group" aria-label="Add to the reply">
        {KEYS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className="ghost reply-edit-key"
            aria-label={`Add ${kind}`}
            ref={(el) => {
              if (el) keyRefs.current.set(kind, el);
              else keyRefs.current.delete(kind);
            }}
            disabled={kind !== "text" && kind !== "link" && !canAdd}
            onClick={() => press(kind)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
