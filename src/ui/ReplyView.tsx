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
//
// A held reply opens the same way, marked Held, with Met and Not yet under it; a click
// records the result at once, and the same take reference then finds that result
// (hold-and-compare R6, KTD3). Its images are read from the agent's results folder for the
// badge, where the result it becomes sits.

import { useId, useState } from "react";
import { isHeld, takeTime } from "../domain/handoffResults";
import { BUILT_IN_HANDOFF } from "../domain/handoffs";
import { credentialKey } from "../domain/types";
import { formatDate, handoffText } from "./format";
import { resultImages } from "./imageSource";
import { SavedReading } from "./JevReading";
import { useNav } from "./nav";
import { usePane } from "./pane";
import { backFromReply, takeOf } from "./replyRoute";
import { RichView } from "./RichView";
import type { TakeRef } from "./routes";
import { Missing, StoredSwitch, TakeBar, useEscape } from "./shared";
import { TakeActions, useTakeWrites } from "./takeActions";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

export function ReplyView({ credentialKey: key, take, picks }: { credentialKey: string; take: TakeRef; picks?: TakeRef[] }) {
  const { state, storage } = useFolder();
  const { navigate } = useNav();
  const matrix = useMatrix(state);
  const [asStored, setAsStored] = useState(false);

  const headingId = useId();
  // A judgment saved: its buttons are gone, so the take's heading takes the focus (KTD11).
  const writes = useTakeWrites(() => document.getElementById(headingId)?.focus());

  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const found = state && credential ? takeOf(state, key, take) : null;
  usePane(found !== null);

  // With the badge gone there is no page to go back to but home.
  const close = () => {
    if (state) navigate(credential ? backFromReply(matrix, state, key, take, picks) : { view: "home" });
  };
  useEscape(() => {
    if (!writes.savingNow.current) close();
  });

  if (!state) return null;
  if (!credential) return <Missing onHome={close} />;
  if (!found) return <Missing onHome={close} label="Back to the badge" />;

  const { profile, take: a } = found;
  const date = formatDate(takeTime(a));
  const note = isHeld(a) ? "" : a.note.trim();
  return (
    <section className="pane reply-view" aria-label={`${profile.name}, ${date}`}>
      <button type="button" className="deck-close ghost" aria-label="Close" disabled={writes.saving} onClick={close}>
        ×
      </button>
      <article className="reply-record">
        <TakeBar name={profile.name} take={a} id={headingId} focus>
          <StoredSwitch asStored={asStored} onToggle={() => setAsStored((s) => !s)} />
          {note !== "" && <p className="reply-note">{note}</p>}
        </TakeBar>
        <RichView aria-label="Reply" value={a.handBack} stored={asStored} images={resultImages(storage, a)} />
        <TakeActions take={a} saving={writes.saving} describedBy={headingId} onJudge={(r) => void writes.judge(a, r)} />
      </article>
      {writes.error && (
        <p className="deck-error" role="alert">
          {writes.error}
        </p>
      )}
      {a.jev && <SavedReading reading={a.jev} credentialKey={key} hasVerdict={!isHeld(a)} />}
      <details className="reply-ran">
        <summary>{handoffText(state, key, a.handoff?.id)}</summary>
        <pre className="handback">{a.handoff?.text ?? BUILT_IN_HANDOFF}</pre>
      </details>
    </section>
  );
}
