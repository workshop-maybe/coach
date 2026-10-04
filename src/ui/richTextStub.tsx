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
// Use: vi.mock("./RichText", () => import("./richTextStub"));

import { useEffect, useImperativeHandle, useRef } from "react";
import type { ClipboardEvent } from "react";
import type { RichTextProps } from "./RichText";
import { findJoinCandidates, fixPastedText } from "../domain/pasteText";
import { imagePaste } from "./pasteImages";

export function RichText({ value, onChange, onNormalized, placeholder, autoFocus, cleanPaste = false, onPaste, images, ref, "aria-label": label }: RichTextProps) {
  useEffect(() => onNormalized?.(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  // The text as it is now, for an image that lands after a save.
  const current = useRef(value);
  current.current = value;
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

  return (
    <textarea aria-label={label} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} onPaste={paste} />
  );
}
