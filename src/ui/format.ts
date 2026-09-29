// Display text for a result, a flag, a date and a part's first line.

import type { CellFlag, CellStatus } from "../domain/matrix";

const RESULT_LABELS: Record<CellStatus, string> = { met: "Met", not_met: "Not met", untested: "Untested" };

export function resultLabel(result: CellStatus): string {
  return RESULT_LABELS[result];
}

/** A flag in a few words, for a row that lists it after the result. */
export const FLAG_SHORT: Record<CellFlag, string> = {
  earlier_version: "task changed",
  setup_mismatch: "setup changed",
};

/** A date as the person reads it, or the text itself when it is not a date. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";
