// A compare (U9, R11, R12, R17; hold-and-compare R7-R11, KTD10, KTD11; jev-in-compare R1-R15):
// its own full-window item, like the reply view. The route names every take in it, in strip
// order, and carries the list's picks. Above the panes, a strip names each take by its agent,
// its setup, its state (Held, Met or Not met) and when it came back, and two of them are open
// side by side below it, the first two to start with. Choosing a closed take in the strip
// opens it on the right while the left holds; choosing the one open on the right swaps the
// two sides; the one on the left stays. The strip's membership is the route's and the open
// pair is this view's own state, since a route change remounts the view.
//
// Once Jev has anything current to show for the badge, a reading of a take or a head-to-head
// of two, the grid takes the strip's place, its column headers the strip's chips with the same
// press rules (CompareGrid.tsx). The view works out the badge's current version once per task
// and rubric, and until it has, the strip or grid and Jev's block above it render nothing,
// so a compare with Jev's data never shows the strip first; the panes show at once. When the
// first saved answer turns the strip into the grid, a focused chip hands the focus to the
// same take's column header, and when a run ends and its action leaves, the focus goes to the
// first column header.
//
// Jev's block sits between the top row and the strip or grid, a polite live region: the quiet
// Compare with Jev, shown while Jev Mode is on and something is missing, with the line saying
// how many requests it sends, the line saying readings quote earlier replies, a line for each
// item too long for Jev, and the line for a failure that stopped a run (useCompareJev.ts).
// While a run asks, the action says how far it has got, and Met, Not yet and the change links
// wait; Close and Escape still leave, dropping the rest, except while a save is in progress.
//
// The view finds every take in the folder on every render, without waiting for the matrix:
// a focus reload can take a take or its agent away while it is open, and an open take that
// goes is replaced by the next one in the strip. With fewer than two left it says so.
//
// Each open take is a record: a mono bar with the agent, its setup, its state and the date
// over the reply rendered, which scrolls on its own, then Jev's reading of it folded (a held
// reply's as chosen for the badge's current version, a result's own, with Jev's track record
// only on a result), the handoff text it answered folded, then its actions at the foot (the
// shared take actions). When the takes answered more than one text of their handoff, each
// fold numbers its text and a line under the strip or grid says so. A verdict that goes
// against the reply's own reading opens the verdict step under it in place of its actions
// (JudgeStep.tsx); any other verdict saves at once. One step at a time: opening one closes
// the other's, a one-click verdict on the other reply leaves it alone, and the pane holding
// it stays put, so a chosen take opens on the other side. Escape goes to an open step first.
// One write at a time (takeActions.tsx). One switch above them shows both as stored. Below
// the stacking width the records stack, each still scrolling on its own. Close and Escape go
// back by the rule in replyRoute.ts, worked out when the view closes: the page that lists the
// takes, still picked, Compare focused.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { goToOf } from "../domain/goTo";
import { handoffTextOf, isHeld, readingOfTake, runIdOf, type Take } from "../domain/handoffResults";
import { SKELETON_ID } from "../domain/handoffs";
import { rubricParts } from "../domain/secondOpinion";
import { credentialKey, type AgentProfile } from "../domain/types";
import { CompareGrid, CompareStrip, columnsOf, compareGridOf, type CompareColumn } from "./CompareGrid";
import { handoffText } from "./format";
import { resultImages } from "./imageSource";
import { JudgeStep, useVerdictStep } from "./JudgeStep";
import { useNav } from "./nav";
import { usePane } from "./pane";
import { backFromCompare, takeIdOf, takeOf } from "./replyRoute";
import { RichView } from "./RichView";
import { SavedReading } from "./JevReading";
import type { TakeRef } from "./routes";
import { Missing, StoredSwitch, TakeBar, useEscape } from "./shared";
import { TakeActions, useTakeWrites, type GoToOffer } from "./takeActions";
import { useAssignmentVersion } from "./useAssignmentVersion";
import { useCompareJev } from "./useCompareJev";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

interface Entry {
  id: string;
  profile: AgentProfile;
  take: Take;
}

/** The open pair: the chosen takes still in the strip, each gap filled by the next strip take not open. */
function openPair(chosen: readonly (string | null)[], strip: readonly Entry[]): string[] {
  const live = new Set(strip.map((e) => e.id));
  const pair: string[] = [];
  for (const id of chosen) if (id !== null && live.has(id) && !pair.includes(id)) pair.push(id);
  for (const e of strip) if (pair.length < 2 && !pair.includes(e.id)) pair.push(e.id);
  return pair.slice(0, 2);
}

/** The handoff text a take answered, exactly as saved: the filled text, or the built-in skeleton before handoffs. */

export function CompareView({ credentialKey: key, takes, picks }: { credentialKey: string; takes: TakeRef[]; picks?: TakeRef[] }) {
  const { state, storage } = useFolder();
  const { navigate } = useNav();
  const matrix = useMatrix(state);
  const [asStored, setAsStored] = useState(false);
  // The take open on the left and on the right, as last chosen; resolved against the strip on every render.
  const [chosen, setChosen] = useState<(string | null)[]>([null, null]);
  const ids = useId();
  const headingOf = (id: string) => `${ids}-${id}`;
  // A saved judgment or mark: the pressed button is gone, so the take's heading takes the focus (KTD11).
  const writes = useTakeWrites((t) => document.getElementById(headingOf(takeIdOf(t)))?.focus());
  const verdicts = useVerdictStep(writes);
  const view = useRef<HTMLElement>(null);

  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const version = useAssignmentVersion(credential);
  const strip: Entry[] = [];
  if (state && credential) {
    for (const ref of takes) {
      const id = takeIdOf(ref);
      const found = strip.some((e) => e.id === id) ? null : takeOf(state, key, ref);
      if (found) strip.push({ id, ...found });
    }
  }
  const columns: CompareColumn[] = columnsOf(strip);
  const jev = useCompareJev({ key, credential, version, takes: columns, exclusive: writes.exclusive });
  const pair = openPair(chosen, strip);
  const ready = pair.length === 2;
  usePane(ready);

  // The left take's heading has the focus when the view opens, and only then: a swap later
  // keeps it on the strip button that was pressed.
  const focused = useRef(false);
  useEffect(() => {
    if (!ready || focused.current) return;
    focused.current = true;
    document.getElementById(headingOf(pair[0]))?.focus();
  });

  /** The chip for a take in the grid's header row, or the strip's, or the first one with no take named. */
  const chipOf = (id?: string) =>
    [...(view.current?.querySelectorAll<HTMLElement>(".compare-grid [data-take], .compare-strip [data-take]") ?? [])].find((el) => id === undefined || el.dataset.take === id);

  // The strip turned into the grid while one of its chips had the focus: the same take's
  // column header takes it.
  const handoff = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = handoff.current;
    handoff.current = null;
    if (id !== null && view.current?.querySelector(".compare-grid")) chipOf(id)?.focus();
  });

  // A run ended and its action left with the focus: the first column header takes it.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !jev.running && !jev.canAsk) {
      const active = document.activeElement;
      if (active === null || active === document.body || !active.isConnected) chipOf()?.focus();
    }
    wasRunning.current = jev.running;
  });

  // With the badge gone there is no page to go back to but home.
  const close = () => {
    if (state) navigate(credential ? backFromCompare(matrix, state, key, takes, picks) : { view: "home" });
  };
  useEscape(() => {
    if (!writes.savingNow.current) close();
  });

  if (!state) return null;
  if (!credential) return <Missing onHome={close} />;
  if (!ready) {
    const page = backFromCompare(matrix, state, key, takes, picks).item === "handoff" ? "Back to the handoff" : "Back to the badge";
    return <Missing onHome={close} label={page} />;
  }

  const [left, right] = pair;
  const open = pair.flatMap((id) => columns.filter((c) => c.id === id));
  // The pane holding an open step stays put: a chosen take opens on the other side, and an open one stays where it is.
  const stepped = open.findIndex((c) => verdicts.stepOf(c.id, c.take) !== null);
  const choose = (id: string) => {
    if (stepped !== -1) {
      if (pair.includes(id)) return;
      const next = [...pair];
      next[1 - stepped] = id;
      setChosen(next);
    } else if (id === right) setChosen([right, left]);
    else if (id !== left) setChosen([left, id]);
  };

  const goTo = goToOf(state, key);
  const offer = ({ profile, take }: Entry): GoToOffer => {
    if (isHeld(take) || take.result !== "met") return null;
    return goTo && goTo.profile.slug === profile.slug && goTo.result.fileStem === take.fileStem ? "is" : "offer";
  };
  const grid = version !== null ? compareGridOf(state, key, credential, version, columns) : null;
  const points = rubricParts(credential.rubric).points;
  // Verdicts wait for a write and for a run; the chips wait for a verdict or a mark saving,
  // and stay usable through a run, whose saves are Jev's (KTD9).
  const asking = writes.saving || jev.running;
  const chipsWait = writes.saving && !jev.running;

  // The handoff texts the takes answered, numbered in strip order of first appearance (KTD12).
  const texts = [...new Set(strip.map((e) => handoffTextOf(e.take)))];
  const foldName = (t: Take) => {
    const name = handoffText(state, key, t.handoff?.id);
    return texts.length > 1 ? `${name}, text ${texts.indexOf(handoffTextOf(t)) + 1} of ${texts.length}` : name;
  };
  const run = runIdOf(strip[0].take);
  const differ =
    texts.length < 2
      ? null
      : run === SKELETON_ID
        ? "These replies answered different texts of the skeleton"
        : `These replies answered different texts of ${handoffText(state, key, run)}`;

  return (
    <section ref={view} className="pane compare-view" aria-label="Compare replies">
      <div className="compare-top">
        <StoredSwitch asStored={asStored} onToggle={() => setAsStored((s) => !s)} />
        <button type="button" className="deck-close ghost" aria-label="Close" disabled={writes.saving} onClick={close}>
          ×
        </button>
      </div>
      <div className="compare-jev" aria-live="polite">
        {version !== null && (
          <>
            {(jev.canAsk || jev.running) && (
              <p className="helper">
                <button type="button" className="link" disabled={jev.running || writes.saving} onClick={() => void jev.run()}>
                  {jev.running && jev.progress ? `Asking Jev, ${jev.progress.done + 1} of ${jev.progress.total}…` : "Compare with Jev"}
                </button>
              </p>
            )}
            {!jev.running && jev.countLine && <p className="jev-note">{jev.countLine}</p>}
            {!jev.running && jev.examplesLine && <p className="jev-note">{jev.examplesLine}</p>}
            {jev.tooLongLines.map((line) => (
              <p key={line} className="jev-note">
                {line}
              </p>
            ))}
            {jev.failure && <p className="deck-error">{jev.failure}</p>}
          </>
        )}
      </div>
      {version !== null &&
        (grid ? (
          <CompareGrid grid={grid} columns={columns} open={pair} disabled={chipsWait} onChoose={choose} />
        ) : (
          <CompareStrip columns={columns} open={pair} disabled={chipsWait} onChoose={choose} onLeave={(id) => (handoff.current = id)} />
        ))}
      {version !== null && differ && <p className="muted compare-texts">{differ}</p>}
      {writes.error && (
        <p className="deck-error compare-error" role="alert">
          {writes.error}
        </p>
      )}
      <div className="compare-panes">
        {open.map((e) => {
          const { profile, take: a } = e;
          const reading = readingOfTake(state, a, version);
          const step = verdicts.stepOf(e.id, a);
          return (
            <article key={e.id} className="reply-record" aria-label={`${profile.name}, ${e.when}`}>
              <TakeBar name={profile.name} take={a} id={headingOf(e.id)} when={e.when} />
              <RichView aria-label="Reply" value={a.handBack} stored={asStored} images={resultImages(storage, a)} />
              {/* While the step is open its cards carry Jev's calls and line, so the folds give the reply their room. */}
              {!step && reading && <SavedReading reading={reading} credentialKey={key} hasVerdict={!isHeld(a)} />}
              {!step && (
                <details className="reply-ran">
                  <summary>{foldName(a)}</summary>
                  <pre className="handback">{handoffTextOf(a)}</pre>
                </details>
              )}
              {step ? (
                <JudgeStep
                  key={`${step.id} ${step.verdict}`}
                  step={step}
                  points={points}
                  saving={writes.saving}
                  waiting={jev.running}
                  describedBy={headingOf(e.id)}
                  onBack={() => verdicts.back(step)}
                  onSave={(extras) => void verdicts.finish(step, a, extras)}
                />
              ) : (
                <TakeActions
                  take={a}
                  goTo={offer(e)}
                  saving={asking}
                  describedBy={headingOf(e.id)}
                  focus={verdicts.backTo(e.id)}
                  onVerdict={(r) => verdicts.verdict(e.id, a, key, version, r)}
                  onMark={() => void writes.mark(a)}
                />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
