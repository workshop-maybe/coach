// One handoff's replies (U2, R6-R11): a row per agent that ran it, Met and Not met alike,
// its latest reply first with its older takes below. Opening a take goes to its reply view,
// a full-window item of its own, carrying the list's picks (U5, R15, KTD7). Any two takes
// can be picked, and Compare opens the two side by side as another full-window item
// carrying the picks (U9, R17, KTD10). Each comes back with the picks to restore (R16),
// the reply with its take to light and focus, the compare with Compare focused. Picks are
// resolved against the run on every render, since a focus reload can take a take away.

import { useEffect, useRef, useState } from "react";
import { Machine } from "../cast/Machine";
import { machineKeys } from "../cast/mappings";
import { contextLine } from "../domain/context";
import type { AgentReplies, HandoffRun } from "../domain/handoffResults";
import type { Matrix } from "../domain/matrix";
import type { AgentProfile, Assessment, FolderState } from "../domain/types";
import { contextText, formatDate } from "./format";
import { useNav } from "./nav";
import type { ReplyListState, TakeRef } from "./routes";
import { Verdict } from "./shared";

/** A take's identity: file stems can repeat across agents, so the agent comes with it. */
type TakeId = string;
const idOf = (take: TakeRef): TakeId => `${take.profileSlug}/${take.fileStem}`;
const refOf = (profile: AgentProfile, a: Assessment): TakeRef => ({ profileSlug: profile.slug, fileStem: a.fileStem });

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
  const [picked, setPicked] = useState<TakeId[]>(() => (picks ?? []).map(idOf));
  const compareButton = useRef<HTMLButtonElement>(null);
  const litRow = useRef<HTMLLIElement>(null);
  const litHead = useRef<HTMLButtonElement>(null);

  // The lit row comes into view once, when the list first shows it, not on every render.
  // Back from a reply, that take's button gets the focus (R16); back from the compare,
  // Compare does, while both its takes are still here to compare (R17).
  useEffect(() => {
    litRow.current?.scrollIntoView?.({ block: "center" });
    litHead.current?.focus();
    if (focusCompare && compareButton.current && !compareButton.current.disabled) compareButton.current.focus();
  }, [lit, litTake, focusCompare]);

  // A folder reload can drop a picked take (its file or agent gone), so picks count only
  // while their take is still in the run.
  const takes = new Map<TakeId, { profile: AgentProfile; result: Assessment }>();
  for (const { profile, latest, older } of run.agents) {
    for (const a of [latest, ...older]) takes.set(idOf(refOf(profile, a)), { profile, result: a });
  }
  const live = picked.filter((id) => takes.has(id));

  // A third pick replaces the oldest one (KTD3).
  const togglePick = (id: TakeId) => setPicked((was) => (was.includes(id) ? was.filter((p) => p !== id) : [...was, id].slice(-2)));

  // The picks go with an opened take or the compare, so its way back can keep them (R16).
  const pickedRefs = live.flatMap((id) => {
    const t = takes.get(id);
    return t ? [refOf(t.profile, t.result)] : [];
  });
  const kept = pickedRefs.length > 0 ? { picks: pickedRefs } : {};
  const openTake = (ref: TakeRef) => navigate({ view: "item", item: "reply", credentialKey: key, take: ref, ...kept });
  // Compare is enabled only with two picks, so both takes are there.
  const compare = () => navigate({ view: "item", item: "compare", credentialKey: key, takes: [pickedRefs[0], pickedRefs[1]], ...kept });

  const take = (entry: AgentReplies, a: Assessment, latest: boolean) => {
    const ref = refOf(entry.profile, a);
    const id = idOf(ref);
    const isLitTake = entry.profile.slug === lit && a.fileStem === litTake;
    return (
      <Take
        key={id}
        profile={entry.profile}
        result={a}
        latest={latest}
        picked={picked.includes(id)}
        onOpen={() => openTake(ref)}
        onPick={() => togglePick(id)}
        headRef={isLitTake ? litHead : undefined}
        context={contextText(contextLine(state.assessments, a))}
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
              {entry.older.length > 0 && <ol className="reply-older">{entry.older.map((a) => <li key={a.fileStem}>{take(entry, a, false)}</li>)}</ol>}
              <p className="helper">
                <button type="button" className="link" onClick={() => navigate({ view: "deck", deck: "test", profileSlug: entry.profile.slug, credentialKey: key })}>
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

function Take({
  profile,
  result: a,
  latest,
  picked,
  onOpen,
  onPick,
  headRef,
  context,
  machine,
}: {
  profile: AgentProfile;
  result: Assessment;
  /** The agent's latest take leads its row; an older one is a compact line below it. */
  latest: boolean;
  picked: boolean;
  onOpen(): void;
  onPick(): void;
  headRef?: React.Ref<HTMLButtonElement>;
  context: string;
  machine: React.ReactNode;
}) {
  const date = formatDate(a.recordedAt);
  return (
    <div className={`take${latest ? "" : " take-older"}`}>
      <input type="checkbox" className="take-pick" checked={picked} onChange={onPick} aria-label={`Pick ${profile.name}, ${date}`} />
      <button type="button" className="take-head" ref={headRef} onClick={onOpen}>
        {machine}
        {latest && <span className="take-name">{profile.name}</span>}
        <span className="take-meta">
          <Verdict result={a} /> · {date} · {context}
        </span>
        {latest && <span className="take-preview">{preview(a.handBack)}</span>}
      </button>
    </div>
  );
}
