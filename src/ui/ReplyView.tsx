// One take, opened (U5, R11, R12, R15): a past reply as its own full-window item, beside a
// badge, an agent and a handoff. The route names the take by its badge, agent and file stem
// (KTD7), and the view finds it in the folder on every render, without waiting for the
// matrix, so it claims the window, or says the take is gone, from its first render. A focus
// reload can take the take or its agent away while the view is open, so nothing here holds
// on to what it found.
//
// The take is a record: a mono header bar with the agent, its setup, the verdict, the date
// and the note, then the reply rendered at a readable measure with a switch to the text as
// stored, then Jev's saved reading and the handoff text that ran, each collapsed. Close and
// Escape go back by the rule in replyRoute.ts, worked out when the view closes: the page
// that holds the take, its row lit and focused, the list's picks kept (R16).

import { useState } from "react";
import { BUILT_IN_HANDOFF } from "../domain/handoffs";
import { credentialKey, type JevReading } from "../domain/types";
import { formatDate, handoffText } from "./format";
import { JevReadingPanel } from "./JevReading";
import { useNav } from "./nav";
import { usePane } from "./pane";
import { backFromReply, takeOf } from "./replyRoute";
import { RichView } from "./RichView";
import type { TakeRef } from "./routes";
import { Missing, StoredSwitch, TakeBar, useEscape } from "./shared";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

/**
 * Jev's reading saved on a result, collapsed, read-only (U7, R14, KTD12). It shows the
 * points as Jev read them, whatever the rubric says now, and whether or not Jev Mode is on.
 * The summary gives the overall reading and, for one seen after the verdict, whether the
 * verdict changed after it. The compare shows one in each take's record.
 */
export function SavedReading({ reading }: { reading: JevReading }) {
  const changed = reading.seen === "after" && reading.verdictChanged === true;
  const summary = `Jev's reading, ${Math.round(reading.overall * 100)}% overall${changed ? " · verdict changed after it" : ""}`;
  return (
    <details className="reply-ran">
      <summary>{summary}</summary>
      <div className="handback">
        <JevReadingPanel reading={reading} readOnly />
      </div>
    </details>
  );
}

export function ReplyView({ credentialKey: key, take, picks }: { credentialKey: string; take: TakeRef; picks?: TakeRef[] }) {
  const { state } = useFolder();
  const { navigate } = useNav();
  const matrix = useMatrix(state);
  const [asStored, setAsStored] = useState(false);

  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const found = state && credential ? takeOf(state, key, take) : null;
  usePane(found !== null);

  // With the badge gone there is no page to go back to but home.
  const close = () => {
    if (state) navigate(credential ? backFromReply(matrix, state, key, take, picks) : { view: "home" });
  };
  useEscape(close);

  if (!state) return null;
  if (!credential) return <Missing onHome={close} />;
  if (!found) return <Missing onHome={close} label="Back to the badge" />;

  const { profile, result: a } = found;
  const date = formatDate(a.recordedAt);
  const note = a.note.trim();
  return (
    <section className="pane reply-view" aria-label={`${profile.name}, ${date}`}>
      <button type="button" className="deck-close ghost" aria-label="Close" onClick={close}>
        ×
      </button>
      <article className="reply-record">
        <TakeBar name={profile.name} result={a} focus>
          <StoredSwitch asStored={asStored} onToggle={() => setAsStored((s) => !s)} />
          {note !== "" && <p className="reply-note">{note}</p>}
        </TakeBar>
        <RichView aria-label="Reply" value={a.handBack} stored={asStored} />
      </article>
      {a.jev && <SavedReading reading={a.jev} />}
      <details className="reply-ran">
        <summary>{handoffText(state, key, a.handoff?.id)}</summary>
        <pre className="handback">{a.handoff?.text ?? BUILT_IN_HANDOFF}</pre>
      </details>
    </section>
  );
}
