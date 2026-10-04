// A compare (U9, R11, R12, R17; hold-and-compare R7-R11, KTD10, KTD11): its own full-window
// item, like the reply view. The route names every take in it, in strip order, and carries
// the list's picks. A strip above the panes names each take by its agent, its setup, its
// state (Held, Met or Not met) and when it came back, and two of them are open side by side
// below it, the first two to start with. Choosing a closed take in the strip opens it on the
// right while the left holds; choosing the one open on the right swaps the two sides; the
// one on the left stays. The strip's membership is the route's and the open pair is this
// view's own state, since a route change remounts the view.
//
// The view finds every take in the folder on every render, without waiting for the matrix:
// a focus reload can take a take or its agent away while it is open, and an open take that
// goes is replaced by the next one in the strip. With fewer than two left it says so.
//
// Each open take is a record: a mono bar with the agent, its setup, its state and the date
// over the reply rendered, which scrolls on its own, Jev's saved reading, collapsed, then its
// actions at the foot: Met and Not yet on a held reply, recording at once, and the quiet
// Make go-to on a Met one, or Go-to when the badge's go-to mark names it. One write at a
// time (takeActions.tsx). One switch above them shows both as stored. Below the stacking
// width the records stack, each still scrolling on its own. Close and Escape go back by the
// rule in replyRoute.ts, worked out when the view closes: the page that lists the takes,
// still picked, Compare focused.

import { useEffect, useId, useRef, useState } from "react";
import { goToOf } from "../domain/goTo";
import { isHeld, type Take } from "../domain/handoffResults";
import { credentialKey, type AgentProfile } from "../domain/types";
import { setupText, takeWhen } from "./format";
import { resultImages } from "./imageSource";
import { useNav } from "./nav";
import { usePane } from "./pane";
import { backFromCompare, takeIdOf, takeOf } from "./replyRoute";
import { RichView } from "./RichView";
import { SavedReading } from "./JevReading";
import type { TakeRef } from "./routes";
import { Missing, StoredSwitch, TakeBar, Verdict, useEscape } from "./shared";
import { TakeActions, useTakeWrites, type GoToOffer } from "./takeActions";
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

  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const strip: Entry[] = [];
  if (state && credential) {
    for (const ref of takes) {
      const id = takeIdOf(ref);
      const found = strip.some((e) => e.id === id) ? null : takeOf(state, key, ref);
      if (found) strip.push({ id, ...found });
    }
  }
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
  const choose = (id: string) => {
    if (id === right) setChosen([right, left]);
    else if (id !== left) setChosen([left, id]);
  };
  const all = strip.map((e) => e.take);
  const goTo = goToOf(state, key);
  const offer = ({ profile, take }: Entry): GoToOffer => {
    if (isHeld(take) || take.result !== "met") return null;
    return goTo && goTo.profile.slug === profile.slug && goTo.result.fileStem === take.fileStem ? "is" : "offer";
  };
  const open = pair.map((id) => strip.find((e) => e.id === id)!);

  return (
    <section className="pane compare-view" aria-label="Compare replies">
      <div className="compare-top">
        <StoredSwitch asStored={asStored} onToggle={() => setAsStored((s) => !s)} />
        <button type="button" className="deck-close ghost" aria-label="Close" disabled={writes.saving} onClick={close}>
          ×
        </button>
      </div>
      <ol className="compare-strip" aria-label="Replies">
        {strip.map((e) => (
          <li key={e.id}>
            <button type="button" className="compare-chip" aria-pressed={pair.includes(e.id)} disabled={writes.saving} onClick={() => choose(e.id)}>
              <span className="compare-chip-name">{e.profile.name}</span>
              <span className="compare-chip-meta">{setupText(e.take.setup)}</span>
              <span className="compare-chip-meta">
                <Verdict take={e.take} /> · {takeWhen(e.take, all)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {writes.error && (
        <p className="deck-error compare-error" role="alert">
          {writes.error}
        </p>
      )}
      <div className="compare-panes">
        {open.map((e) => {
          const { profile, take: a } = e;
          const when = takeWhen(a, all);
          return (
            <article key={e.id} className="reply-record" aria-label={`${profile.name}, ${when}`}>
              <TakeBar name={profile.name} take={a} id={headingOf(e.id)} when={when} />
              <RichView aria-label="Reply" value={a.handBack} stored={asStored} images={resultImages(storage, a)} />
              {a.jev && <SavedReading reading={a.jev} />}
              <TakeActions
                take={a}
                goTo={offer(e)}
                saving={writes.saving}
                describedBy={headingOf(e.id)}
                onJudge={(r) => void writes.judge(a, r)}
                onMark={() => void writes.mark(a)}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
