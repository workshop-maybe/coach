// Test-only stand-in for RichText in flow tests. ProseMirror typing does not run in
// jsdom, so deck tests type into a plain textarea with the same props and name.
// RichText itself is tested for real in RichText.test.tsx.
//
// Use: vi.mock("./RichText", () => import("./richTextStub"));

import { useEffect } from "react";
import type { RichTextProps } from "./RichText";

export function RichText({ value, onChange, onNormalized, placeholder, autoFocus, "aria-label": label }: RichTextProps) {
  useEffect(() => onNormalized?.(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  return <textarea aria-label={label} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />;
}
