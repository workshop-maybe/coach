// Two takes, side by side (U9, R11, R12, R17): the compare as its own full-window item,
// like the reply view. The route names both takes the way the reply route names one and
// carries the list's picks (KTD10). The view finds both in the folder on every render,
// without waiting for the matrix, so it claims the window, or says a take is gone, from its
// first render; a focus reload can take either take or its agent away while it is open.
//
// Each take is a record: a mono bar with the agent, its setup, the verdict and the date
// over the reply rendered, which scrolls on its own. One switch above them shows both as
// stored. Below the stacking width the two records stack, each still scrolling on its own.
// Close and Escape go back by the rule in replyRoute.ts, worked out when the view closes:
// the page that lists the takes, both still picked, Compare focused.

import { useState } from "react";
import { credentialKey } from "../domain/types";
import { formatDate } from "./format";
import { useNav } from "./nav";
import { usePane } from "./pane";
import { backFromCompare, takeOf } from "./replyRoute";
import { RichView } from "./RichView";
import type { TakeRef } from "./routes";
import { Missing, StoredSwitch, TakeBar, useEscape } from "./shared";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

export function CompareView({ credentialKey: key, takes, picks }: { credentialKey: string; takes: [TakeRef, TakeRef]; picks?: TakeRef[] }) {
  const { state } = useFolder();
  const { navigate } = useNav();
  const matrix = useMatrix(state);
  const [asStored, setAsStored] = useState(false);

  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const found = state && credential ? takes.flatMap((t) => takeOf(state, key, t) ?? []) : [];
  const both = found.length === 2;
  usePane(both);

  // With the badge gone there is no page to go back to but home.
  const close = () => {
    if (state) navigate(credential ? backFromCompare(matrix, state, key, takes, picks) : { view: "home" });
  };
  useEscape(close);

  if (!state) return null;
  if (!credential) return <Missing onHome={close} />;
  if (!both) {
    const page = backFromCompare(matrix, state, key, takes, picks).item === "handoff" ? "Back to the handoff" : "Back to the badge";
    return <Missing onHome={close} label={page} />;
  }

  return (
    <section className="pane compare-view" aria-label="Compare replies">
      <div className="compare-top">
        <StoredSwitch asStored={asStored} onToggle={() => setAsStored((s) => !s)} />
        <button type="button" className="deck-close ghost" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <div className="compare-panes">
        {found.map(({ profile, result: a }, i) => {
          const date = formatDate(a.recordedAt);
          return (
            <article key={i} className="reply-record" aria-label={`${profile.name}, ${date}`}>
              <TakeBar name={profile.name} result={a} focus={i === 0} />
              <RichView aria-label="Reply" value={a.handBack} stored={asStored} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
