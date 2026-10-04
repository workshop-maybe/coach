// Test-only stand-in for RichText in flow tests. ProseMirror typing does not run in
// jsdom, so deck tests type into a plain textarea with the same props and name.
// RichText itself is tested for real in RichText.test.tsx.
//
// With `cleanPaste`, a paste (see src/test/paste.ts) goes in with the same fixes and
// reports the same payload, and `replaceAsPaste` writes the same way. The textarea's text
// stands in for the box's Markdown, so the fixed text goes in as it is.
//
// With `images`, an image paste the real box would take (src/ui/pasteImages.ts) is saved
// through `images.save`, and each saved name goes in as `![](name)` at the selection, so a
// flow test can check which folder a deck saves its pictures in.
//
// With `images.add`, a Video button stands in for the box's Video key: it awaits
// `add({ kind: "pick" })` and splices `![](name)` in at the selection for each name, only if
// the stub is still mounted when the add lands, as the real box inserts nothing once closed.
// The stub also registers with the window's drop listener as the real box does, so a flow
// test feeds a drop through `handleDragDrop` from src/ui/dropFiles.ts: it awaits
// `add({ kind: "drop", paths })` and splices the refs in at the end of the text, where the
// real box puts a drop that lands off its text (in jsdom every drop does). A video paste the
// real box would take (`videoPaste`) awaits `add({ kind: "paste", files })` and splices the
// refs in at the selection, ahead of the image paste.
//
// Use: vi.mock("./RichText", () => import("./richTextStub"));

import { useEffect, useImperativeHandle, useRef } from "react";
import type { ClipboardEvent } from "react";
import type { AddFrom } from "../storage/storage";
import type { RichImages, RichTextProps } from "./RichText";
import { findJoinCandidates, fixPastedText } from "../domain/pasteText";
import { registerDropBox } from "./dropFiles";
import { imagePaste, videoPaste } from "./pasteImages";

export function RichText({ value, onChange, onNormalized, placeholder, autoFocus, cleanPaste = false, onPaste, images, ref, "aria-label": label }: RichTextProps) {
  useEffect(() => onNormalized?.(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  // The text as it is now, for an image that lands after a save.
  const current = useRef(value);
  current.current = value;
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  const area = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fix = (text: string) => (cleanPaste ? fixPastedText(text) : { text, terminal: false });

  useImperativeHandle(ref, () => ({
    replaceAsPaste(text) {
      const md = fix(text).text;
      onChange(md);
      return md;
    },
  }));

  async function pasteImages(files: File[], from: number, to: number, save: (file: File) => Promise<string>) {
    const saved = await Promise.allSettled(files.map((file) => save(file)));
    const refs = saved.flatMap((r) => (r.status === "fulfilled" ? [`![](${r.value})`] : [])).join("");
    if (refs === "") return;
    const text = current.current;
    onChange(text.slice(0, from) + refs + text.slice(to));
  }

  function paste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const videos = images?.add ? videoPaste(e.clipboardData) : [];
    if (images?.add && videos.length > 0) {
      e.preventDefault();
      void addThenSplice(images.add, { kind: "paste", files: videos }, e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
      return;
    }
    const files = images?.save ? imagePaste(e.clipboardData) : [];
    if (files.length > 0) {
      e.preventDefault();
      void pasteImages(files, e.currentTarget.selectionStart, e.currentTarget.selectionEnd, images!.save!);
      return;
    }
    if (!cleanPaste) return;
    e.preventDefault();
    const raw = e.clipboardData?.getData("text/plain") ?? "";
    const { selectionStart: from, selectionEnd: to } = e.currentTarget;
    const fixed = fix(raw);
    const markdown = value.slice(0, from) + fixed.text + value.slice(to);
    const whole = (value.slice(0, from) + value.slice(to)).trim() === "";
    onPaste?.({ raw, fixed: fixed.text, markdown, whole, candidates: findJoinCandidates(fixed.text).length > 0, terminal: fixed.terminal });
    onChange(markdown);
  }

  /** Runs one add and splices a ref for each name it returns over `from`–`to`, if still mounted. */
  async function addThenSplice(add: NonNullable<RichImages["add"]>, source: AddFrom, from: number, to: number) {
    let names: string[];
    try {
      names = await add(source);
    } catch {
      return;
    }
    if (names.length === 0 || !mounted.current) return;
    const text = current.current;
    latestChange.current(text.slice(0, from) + names.map((name) => `![](${name})`).join("") + text.slice(to));
  }

  function pickFile(add: NonNullable<RichImages["add"]>) {
    const from = area.current?.selectionStart ?? current.current.length;
    const to = area.current?.selectionEnd ?? from;
    return addThenSplice(add, { kind: "pick" }, from, to);
  }

  const add = images?.add;
  const canAdd = !!add;
  const latestAdd = useRef(add);
  latestAdd.current = add;
  useEffect(() => {
    const element = area.current;
    if (!canAdd || !element) return;
    return registerDropBox({
      element,
      drop: (paths) => {
        const now = latestAdd.current;
        const end = current.current.length;
        if (now) void addThenSplice(now, { kind: "drop", paths }, end, end);
      },
    });
  }, [canAdd]);

  return (
    <>
      <textarea ref={area} aria-label={label} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} onPaste={paste} />
      {add && (
        <button type="button" aria-label="Video" onClick={() => void pickFile(add)}>
          Video
        </button>
      )}
    </>
  );
}
