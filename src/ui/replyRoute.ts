// Where an agent's reply on a badge lives (KTD2, R4, R14): the badge page while one handoff
// has run, or the handoff item of the agent's latest result once two or more have.

import { handoffRuns, latestRunId } from "../domain/handoffResults";
import type { Matrix } from "../domain/matrix";
import type { FolderState, Slug } from "../domain/types";
import type { ItemRoute } from "./routes";

export function replyRoute(matrix: Matrix, state: FolderState, key: string, profileSlug: Slug): ItemRoute {
  const runId = latestRunId(matrix, profileSlug, key);
  if (runId === null || handoffRuns(matrix, state, key).mode === "single") {
    return { view: "item", item: "badge", credentialKey: key, lit: profileSlug };
  }
  return { view: "item", item: "handoff", credentialKey: key, handoffId: runId, lit: profileSlug };
}
