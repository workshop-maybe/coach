import { useState } from "react";

/**
 * A Markdown draft for a RichText box. `changed` is true only after a real edit: the
 * text differs both from what opened and from the editor's own form of it, so a box
 * that only reformats (a `*` list read back as `-`) never counts as a change.
 */
export function useRichDraft(initial: string) {
  const [value, setValue] = useState(initial);
  const [normalized, setNormalized] = useState(initial);
  const changed = value.trim() !== initial.trim() && value.trim() !== normalized.trim();
  return { value, setValue, changed, onNormalized: setNormalized };
}
