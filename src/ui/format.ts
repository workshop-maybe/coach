// Display text for a result.

import type { CellStatus } from "../domain/matrix";

const RESULT_LABELS: Record<CellStatus, string> = { met: "Met", not_met: "Not met", untested: "Untested" };

export function resultLabel(result: CellStatus): string {
  return RESULT_LABELS[result];
}

