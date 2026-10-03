// A handoff, opened (U3, R12): one of a badge's handoffs once two or more have run. Its
// name and text, then every agent's reply to it, each opening as its own view and coming
// back here with its take lit and the picks kept (U5, R16). Close and Escape go back to its
// badge.

import { handoffRuns } from "../domain/handoffResults";
import { SKELETON_ID, handoffsFor, skeletonOf } from "../domain/handoffs";
import { credentialKey } from "../domain/types";
import { handoffText } from "./format";
import { useNav } from "./nav";
import { ReplyList } from "./ReplyList";
import type { ReplyListState } from "./routes";
import { Missing, focusOnMount, useEscape } from "./shared";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

export function HandoffDetail({ credentialKey: key, handoffId, lit, litTake, picks, focusCompare }: { credentialKey: string; handoffId: string } & ReplyListState) {
  const { state } = useFolder();
  const { navigate } = useNav();
  const matrix = useMatrix(state);
  const toBadge = () => navigate({ view: "item", item: "badge", credentialKey: key });
  useEscape(toBadge);

  if (!state) return null;
  const credential = state.credentials.find((c) => credentialKey(c) === key);
  if (!credential) return <Missing onHome={() => navigate({ view: "home" })} />;
  if (!matrix) return null;
  // No code path opens a handoff with no results here; a stale route is simply not found (KTD6).
  const run = handoffRuns(matrix, state, key).runs.find((r) => r.id === handoffId);
  if (!run) return <Missing onHome={toBadge} />;

  const skeleton = handoffId === SKELETON_ID;
  const text = skeleton ? skeletonOf(state).text : (handoffsFor(state, key).find((h) => h.id === handoffId)?.text ?? run.agents[0].latest.handoff?.text ?? "");
  const name = handoffText(state, key, handoffId);

  return (
    <section className="detail" aria-label={`${credential.name}, ${name}`}>
      <button type="button" className="deck-close ghost" aria-label="Close" onClick={toBadge}>
        ×
      </button>
      <div className="detail-head">
        <h2 tabIndex={-1} ref={focusOnMount}>
          {name}
        </h2>
        <p className="muted">{credential.name}</p>
        <button type="button" className="primary" onClick={() => navigate({ view: "deck", deck: "test", credentialKey: key, handoffId })}>
          Test it on an agent
        </button>
      </div>

      <details className="handoff-text">
        {/* The skeleton never locks, so a reply may have run an earlier one; each reply keeps its own text. */}
        <summary>{skeleton ? "The current skeleton" : "Its text"}</summary>
        <pre className="handback">{text}</pre>
      </details>

      <section className="detail-section" aria-labelledby="handoff-replies">
        <h3 id="handoff-replies">Replies</h3>
        <ReplyList credentialKey={key} run={run} state={state} matrix={matrix} lit={lit} litTake={litTake} picks={picks} focusCompare={focusCompare} />
      </section>
    </section>
  );
}
