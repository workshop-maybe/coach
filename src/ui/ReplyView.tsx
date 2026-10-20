// One take, opened (U5, R11, R12, R15): a past reply as its own full-window item, beside a
// badge, an agent and a handoff. The route names the take by its badge, agent and file stem
// (KTD7), and the view finds it in the folder on every render, without waiting for the
// matrix, so it claims the window, or says the take is gone, from its first render. A focus
// reload can take the take or its agent away while the view is open, so nothing here holds
// on to what it found.
//
// The take is a record: a mono header bar with the agent, its setup, the verdict, the date
// and the note, then the reply's items as one stack (ReplyStack.tsx) at a readable measure,
// with a switch to its text as stored, then Jev's saved reading and the handoff text that
// ran, each collapsed. Close and Escape go back by the rule in replyRoute.ts, worked out when
// the view closes: the page that holds the take, its row lit and focused, the list's picks
// kept (R16).
//
// A held reply opens the same way, marked Held, with Met and Not yet under it (hold-and-compare
// R6, KTD3), and the reading it shows is the one chosen for the badge's current version, as
// compare shows it (jev-in-compare KTD3). A result offers its other verdict as a quiet link
// and says what it was once judged again. The shared take actions and the verdict step judge
// and re-judge here as in compare (jev-in-compare KTD10, KTD11): a verdict that goes against
// the reply's reading opens the step under it, any other records at once, and the same take
// reference then finds that result. With a step open, Escape is the step's. Its images are
// read from the agent's results folder for the badge, where the result it becomes sits.

import { useId, useState } from "react";
import { handoffTextOf, isHeld, readingOfTake, takeTime } from "../domain/handoffResults";
import { programBadge } from "../domain/programBadge";
import { rubricParts } from "../domain/secondOpinion";
import { replyItems } from "../domain/replyItems";
import { credentialKey } from "../domain/types";
import { formatDate, handoffText } from "./format";
import { resultImages } from "./imageSource";
import { SavedReading } from "./JevReading";
import { JudgeStep, useVerdictStep } from "./JudgeStep";
import { useNav } from "./nav";
import { usePane } from "./pane";
import { QuinelingView } from "./QuinelingView";
import { backFromReply, takeIdOf, takeOf } from "./replyRoute";
import { ReplyStack } from "./ReplyStack";
import type { TakeRef } from "./routes";
import { Missing, StoredSwitch, TakeBar, useEscape } from "./shared";
import { TakeActions, useTakeWrites } from "./takeActions";
import { useAssignmentVersion } from "./useAssignmentVersion";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

/**
 * The reply route (bounded programs KTD4): a reply to a program badge opens straight into the
 * Quineling view, any other into the reply view. Decided again on every render, from the
 * badge's slug and its collection's `from`, so a rename keeps the view.
 */
export function ReplyView(props: { credentialKey: string; take: TakeRef; picks?: TakeRef[] }) {
  const { state } = useFolder();
  const credential = state?.credentials.find((c) => credentialKey(c) === props.credentialKey);
  const collection = credential && state?.collections.find((c) => c.slug === credential.collectionSlug);
  const jobId = credential && collection ? programBadge(credential, collection) : null;
  return jobId ? <QuinelingView {...props} jobId={jobId} /> : <TakeReplyView {...props} />;
}

function TakeReplyView({ credentialKey: key, take, picks }: { credentialKey: string; take: TakeRef; picks?: TakeRef[] }) {
  const { state, storage } = useFolder();
  const { navigate } = useNav();
  const matrix = useMatrix(state);
  const [asStored, setAsStored] = useState(false);

  const headingId = useId();
  // A judgment saved: its buttons are gone, so the take's heading takes the focus (KTD11).
  const writes = useTakeWrites(() => document.getElementById(headingId)?.focus());
  const verdicts = useVerdictStep(writes);

  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const version = useAssignmentVersion(credential);
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
  const id = takeIdOf(take);
  const date = formatDate(takeTime(a));
  const note = isHeld(a) ? "" : a.note.trim();
  const reading = readingOfTake(state, a, version);
  const step = verdicts.stepOf(id, a);
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
        <ReplyStack aria-label="Reply" items={replyItems(a)} stored={asStored} source={resultImages(storage, a)} />
        {step ? (
          <JudgeStep
            key={`${step.id} ${step.verdict}`}
            step={step}
            points={rubricParts(credential.rubric).points}
            saving={writes.saving}
            describedBy={headingId}
            onBack={() => verdicts.back(step)}
            onSave={(extras) => void verdicts.finish(step, a, extras)}
          />
        ) : (
          <TakeActions
            take={a}
            saving={writes.saving}
            describedBy={headingId}
            focus={verdicts.backTo(id)}
            onVerdict={(r) => verdicts.verdict(id, a, key, version, r)}
          />
        )}
      </article>
      {writes.error && (
        <p className="deck-error" role="alert">
          {writes.error}
        </p>
      )}
      {reading && <SavedReading reading={reading} credentialKey={key} hasVerdict={!isHeld(a)} />}
      <details className="reply-ran">
        <summary>{handoffText(state, key, a.handoff?.id)}</summary>
        <pre className="handback">{handoffTextOf(a)}</pre>
      </details>
    </section>
  );
}
