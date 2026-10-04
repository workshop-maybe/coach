// Test-only stand-in for RichText in flow tests. ProseMirror typing does not run in
// jsdom, so deck tests type into a plain textarea with the same props and name.
// RichText itself is tested for real in RichText.test.tsx.
//
// With `cleanPaste`, a paste (see src/test/paste.ts) goes in with the same fixes and
// reports the same payload, and `replaceAsPaste` writes the same way. The textarea's text
// stands in for the box's Markdown, so the fixed text goes in as it is.
//
// Use: vi.mock("./RichText", () => import("./richTextStub"));

import { useEffect, useImperativeHandle } from "react";
import type { ClipboardEvent } from "react";
import type { RichTextProps } from "./RichText";
import { findJoinCandidates, fixPastedText } from "../domain/pasteText";

export function RichText({ value, onChange, onNormalized, placeholder, autoFocus, cleanPaste = false, onPaste, ref, "aria-label": label }: RichTextProps) {
  useEffect(() => onNormalized?.(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const fix = (text: string) => (cleanPaste ? fixPastedText(text) : { text, terminal: false });

  useImperativeHandle(ref, () => ({
    replaceAsPaste(text) {
      const md = fix(text).text;
      onChange(md);
      return md;
    },
  }));

  function paste(e: ClipboardEvent<HTMLTextAreaElement>) {
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
