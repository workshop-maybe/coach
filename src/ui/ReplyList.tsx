// One handoff's replies (U2, R6-R11): a row per agent that ran it, Met, Not met and Held
// alike, its latest take first with its older takes below. A held take is a reply saved
// without a verdict, marked Held (hold-and-compare R4). Opening a take goes to its reply
// view, a full-window item of its own, carrying the list's picks (U5, R15, KTD7). Any number
// of takes can be picked, and Compare opens them under a strip, two side by side, as another
// full-window item carrying the picks in the order they were picked (R8, KTD10). Each comes
// back with the picks to restore (R16), the reply with its take to light and focus, the
// compare with Compare focused. Picks are resolved against the run on every render, since
// a focus reload can take a take away.

import { useEffect, useRef, useState } from "react";
import { Machine } from "../cast/Machine";
import { machineKeys } from "../cast/mappings";
import { contextLine } from "../domain/context";
import type { AgentReplies, HandoffRun, Take } from "../domain/handoffResults";
import type { Matrix } from "../domain/matrix";
import type { AgentProfile, FolderState } from "../domain/types";
import { contextText, takeWhen } from "./format";
import { useNav } from "./nav";
import { takeIdOf } from "./replyRoute";
import type { ReplyListState, TakeRef } from "./routes";
import { Verdict } from "./shared";

/** A take's identity: file stems can repeat across agents, so the agent comes with it. */
type TakeId = string;
const refOf = (profile: AgentProfile, t: Take): TakeRef => ({ profileSlug: profile.slug, fileStem: t.fileStem });

/** The opening lines of a reply, for its row. */
const PREVIEW_LINES = 3;
const preview = (text: string) => text.trim().split("\n").slice(0, PREVIEW_LINES).join("\n");

export function ReplyList({
  credentialKey: key,
  run,
  state,
  matrix,
  lit,
  litTake,
  picks,
  focusCompare,
}: {
  credentialKey: string;
  run: HandoffRun;
  state: FolderState;
  matrix: Matrix;
} & ReplyListState) {
  const { navigate } = useNav();
  const [picked, setPicked] = useState<TakeId[]>(() => (picks ?? []).map(takeIdOf));
  const compareButton = useRef<HTMLButtonElement>(null);
  const litRow = useRef<HTMLLIElement>(null);
  const litHead = useRef<HTMLButtonElement>(null);

  // The lit row comes into view once, when the list first shows it, not on every render.
  // Back from a reply, that take's button gets the focus (R16); back from the compare,
  // Compare does, while at least two of its takes are still here to compare (R17).
  useEffect(() => {
    litRow.current?.scrollIntoView?.({ block: "center" });
    litHead.current?.focus();
    if (focusCompare && compareButton.current && !compareButton.current.disabled) compareButton.current.focus();
  }, [lit, litTake, focusCompare]);

  // A folder reload can drop a picked take (its file or agent gone), so picks count only
  // while their take is still in the run.
  const takes = new Map<TakeId, { profile: AgentProfile; take: Take }>();
  for (const { profile, latest, older } of run.agents) {
    for (const t of [latest, ...older]) takes.set(takeIdOf(refOf(profile, t)), { profile, take: t });
  }
  const live = picked.filter((id) => takes.has(id));
  const all = [...takes.values()].map((t) => t.take);

  // Picks keep the order they were made in; the compare's strip follows it (KTD10).
  const togglePick = (id: TakeId) => setPicked((was) => (was.includes(id) ? was.filter((p) => p !== id) : [...was, id]));

  // The picks go with an opened take or the compare, so its way back can keep them (R16).
  const pickedRefs = live.flatMap((id) => {
    const t = takes.get(id);
    return t ? [refOf(t.profile, t.take)] : [];
  });
  const kept = pickedRefs.length > 0 ? { picks: pickedRefs } : {};
  const openTake = (ref: TakeRef) => navigate({ view: "item", item: "reply", credentialKey: key, take: ref, ...kept });
  // Compare is enabled only with two or more picks, all of them still here.
  const compare = () => navigate({ view: "item", item: "compare", credentialKey: key, takes: pickedRefs, ...kept });

  const take = (entry: AgentReplies, t: Take, latest: boolean) => {
    const ref = refOf(entry.profile, t);
    const id = takeIdOf(ref);
    const isLitTake = entry.profile.slug === lit && t.fileStem === litTake;
    return (
      <TakeRow
        key={id}
        profile={entry.profile}
        take={t}
        when={takeWhen(t, all)}
        latest={latest}
        picked={picked.includes(id)}
        onOpen={() => openTake(ref)}
        onPick={() => togglePick(id)}
        headRef={isLitTake ? litHead : undefined}
        context={contextText(contextLine(state.assessments, t))}
        machine={latest ? <Machine mini setup={entry.profile} keys={machineKeys(matrix, entry.profile.slug)} width={56} /> : null}
      />
    );
  };

  return (
    <div className="replies">
      <p className="helper">
        <button type="button" ref={compareButton} disabled={live.length < 2} onClick={compare}>
          {live.length < 2 ? "Pick two to compare" : "Compare"}
        </button>
      </p>
      <ol className="reply-list">
        {run.agents.map((entry) => {
          const isLit = entry.profile.slug === lit;
          return (
            <li
              key={entry.profile.slug}
              className={`reply${isLit ? " lit" : ""}`}
              aria-label={entry.profile.name}
              aria-current={isLit || undefined}
              ref={isLit ? litRow : undefined}
            >
              {take(entry, entry.latest, true)}
              {entry.older.length > 0 && <ol className="reply-older">{entry.older.map((t) => <li key={t.fileStem}>{take(entry, t, false)}</li>)}</ol>}
              <p className="helper">
                {/* Again on the same handoff, so one agent can be re-run in a bake-off (hold-and-compare AE6). */}
                <button
                  type="button"
                  className="link"
                  onClick={() => navigate({ view: "deck", deck: "test", profileSlug: entry.profile.slug, credentialKey: key, handoffId: run.id })}
                >
                  Test again
                </button>
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TakeRow({
  profile,
  take: t,
  when,
  latest,
  picked,
  onOpen,
  onPick,
  headRef,
  context,
  machine,
}: {
  profile: AgentProfile;
  take: Take;
  /** Its date, with the time when another of the agent's takes shares the date. */
  when: string;
  /** The agent's latest take leads its row; an older one is a compact line below it. */
  latest: boolean;
  picked: boolean;
  onOpen(): void;
  onPick(): void;
  headRef?: React.Ref<HTMLButtonElement>;
  context: string;
  machine: React.ReactNode;
}) {
  return (
    <div className={`take${latest ? "" : " take-older"}`}>
      <input type="checkbox" className="take-pick" checked={picked} onChange={onPick} aria-label={`Pick ${profile.name}, ${when}`} />
      <button type="button" className="take-head" ref={headRef} onClick={onOpen}>
        {machine}
        {latest && <span className="take-name">{profile.name}</span>}
        <span className="take-meta">
          <Verdict take={t} /> · {when} · {context}
        </span>
        {latest && <span className="take-preview">{preview(t.handBack)}</span>}
      </button>
    </div>
  );
}
