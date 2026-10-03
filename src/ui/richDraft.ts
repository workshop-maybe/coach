import { useCallback, useState } from "react";

/**
 * A Markdown draft for a RichText box. `changed` is true only after a real edit: the
 * text differs both from what opened and from the editor's own form of it, so a box
 * that only reformats (a `*` list read back as `-`) never counts as a change.
 *
 * Only the box's first report is the form of what opened. A box mounted again later, as
 * on Back to its card, reports its form of the edited text, which must not erase the
 * change, since the deck's unsaved-work signal reads it (U6, R20).
 */
export function useRichDraft(initial: string) {
  const [value, setValue] = useState(initial);
  const [normalized, setNormalized] = useState<string | null>(null);
  const onNormalized = useCallback((md: string) => setNormalized((n) => n ?? md), []);
  const changed = value.trim() !== initial.trim() && value.trim() !== (normalized ?? initial).trim();
  return { value, setValue, changed, onNormalized };
}
