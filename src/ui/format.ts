// Display text shared by the matrix and the cell history.

import type { CellStatus } from "../domain/matrix";
import type { AgentSetup } from "../domain/types";

const RESULT_LABELS: Record<CellStatus, string> = { met: "Met", not_met: "Not met", untested: "Untested" };

export function resultLabel(result: CellStatus): string {
  return RESULT_LABELS[result];
}

/** harness · model · effort, with "(none)" for a blank field. */
export function setupLine(setup: AgentSetup): string {
  const parts = [setup.harness, setup.model, setup.effort].map((s) => (s.trim() === "" ? "(none)" : s));
  return parts.join(" · ");
}
