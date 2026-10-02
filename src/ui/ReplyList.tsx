// One handoff's replies (U2, R6-R11): a row per agent that ran it, Met and Not met alike,
// its latest reply first with its older takes below. A reply opens in place (KTD7). Any
// two takes can be picked and read side by side; picks, open replies and the compare stay
// in this component, and only the lit agent comes from the route (KTD3, KTD4).

import { useEffect, useRef, useState } from "react";
import { Machine } from "../cast/Machine";
import { machineKeys } from "../cast/mappings";
import { contextLine } from "../domain/context";
import { BUILT_IN_HANDOFF } from "../domain/handoffs";
import type { AgentReplies, HandoffRun } from "../domain/handoffResults";
import type { Matrix } from "../domain/matrix";
import type { AgentProfile, Assessment, FolderState, Slug } from "../domain/types";
import { contextText, formatDate, handoffText, resultLabel } from "./format";
import { useNav } from "./nav";

/** A take's identity: file stems can repeat across agents, so the agent comes with it. */
type TakeId = string;
const takeId = (profile: AgentProfile, a: Assessment): TakeId => `${profile.slug}/${a.fileStem}`;

/** The opening lines of a reply, for a closed row. */
const PREVIEW_LINES = 3;
const preview = (text: string) => text.trim().split("\n").slice(0, PREVIEW_LINES).join("\n");

export function ReplyList({
  credentialKey: key,
  run,
  state,
  matrix,
  lit,
}: {
  credentialKey: string;
  run: HandoffRun;
  state: FolderState;
  matrix: Matrix;
  lit?: Slug;
}) {
  const { navigate } = useNav();
  const [open, setOpen] = useState<ReadonlySet<TakeId>>(() => new Set());
  const [picked, setPicked] = useState<TakeId[]>([]);
  const [comparing, setComparing] = useState(false);
  const compareButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const litRow = useRef<HTMLLIElement>(null);

  // The lit row comes into view once, when the list first shows it, not on every render.
  useEffect(() => {
    litRow.current?.scrollIntoView?.({ block: "center" });
  }, [lit]);

  // Escape closes the compare before the item's own Escape can leave the view (KTD3).
  // The capture phase runs ahead of every item's useEscape, which skips handled events.
  useEffect(() => {
    if (!comparing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setComparing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [comparing]);

  // Focus follows the swap: into the compare on open, back to Compare on close.
  const wasComparing = useRef(false);
  useEffect(() => {
    if (comparing) backButton.current?.focus();
    else if (wasComparing.current) compareButton.current?.focus();
    wasComparing.current = comparing;
  }, [comparing]);

  // A folder reload can drop a picked take (its file or agent gone), so picks count only
  // while their take is still in the run.
  const takes = new Map<TakeId, { profile: AgentProfile; result: Assessment }>();
  for (const { profile, latest, older } of run.agents) {
    for (const a of [latest, ...older]) takes.set(takeId(profile, a), { profile, result: a });
  }
  const live = picked.filter((id) => takes.has(id));

  const toggleOpen = (id: TakeId) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // A third pick replaces the oldest one (KTD3).
  const togglePick = (id: TakeId) => setPicked((was) => (was.includes(id) ? was.filter((p) => p !== id) : [...was, id].slice(-2)));

  if (comparing && live.length === 2) {
    return (
      <section className="compare" aria-label="Compare replies">
        <p className="helper">
          <button type="button" className="link" ref={backButton} onClick={() => setComparing(false)}>
            Back to replies
          </button>
        </p>
        <div className="compare-panes">
          {live.map((id) => {
            const { profile, result: a } = takes.get(id)!;
            return (
              <article key={id} className="compare-pane" aria-label={`${profile.name}, ${formatDate(a.recordedAt)}`}>
                <header className="compare-bar">
                  <span className="compare-name">{profile.name}</span>
                  <span>{[a.setup.harness, a.setup.model, a.setup.effort].filter(Boolean).join(" · ")}</span>
                  <span>
                    <Verdict result={a} /> · {formatDate(a.recordedAt)}
                  </span>
                </header>
                <pre className="handback compare-reply">{a.handBack}</pre>
              </article>
            );
          })}
        </div>
      </section>
    );
  }

  const take = (entry: AgentReplies, a: Assessment, latest: boolean) => {
    const id = takeId(entry.profile, a);
    return (
      <Take
        key={id}
        profile={entry.profile}
        result={a}
        latest={latest}
        open={open.has(id)}
        picked={picked.includes(id)}
        onOpen={() => toggleOpen(id)}
        onPick={() => togglePick(id)}
        context={contextText(contextLine(state.assessments, a))}
        ranWith={{ name: handoffText(state, key, a.handoff?.id), text: a.handoff?.text ?? BUILT_IN_HANDOFF }}
        machine={latest ? <Machine mini setup={entry.profile} keys={machineKeys(matrix, entry.profile.slug)} width={56} /> : null}
      />
    );
  };

  return (
    <div className="replies">
      <p className="helper">
        <button type="button" ref={compareButton} disabled={live.length < 2} onClick={() => setComparing(true)}>
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

function Verdict({ result: a }: { result: Assessment }) {
  return <span className={`verdict verdict-${a.result}`}>{resultLabel(a.result)}</span>;
}

function Take({
  profile,
  result: a,
  latest,
  open,
  picked,
  onOpen,
  onPick,
  context,
  ranWith,
  machine,
}: {
  profile: AgentProfile;
  result: Assessment;
  /** The agent's latest take leads its row; an older one is a compact line below it. */
  latest: boolean;
  open: boolean;
  picked: boolean;
  onOpen(): void;
  onPick(): void;
  context: string;
  ranWith: { name: string; text: string };
  machine: React.ReactNode;
}) {
  const date = formatDate(a.recordedAt);
  return (
    <div className={`take${latest ? "" : " take-older"}`}>
      <input type="checkbox" className="take-pick" checked={picked} onChange={onPick} aria-label={`Pick ${profile.name}, ${date}`} />
      <button type="button" className="take-head" aria-expanded={open} onClick={onOpen}>
        {machine}
        {latest && <span className="take-name">{profile.name}</span>}
        <span className="take-meta">
          <Verdict result={a} /> · {date} · {context}
        </span>
        {latest && !open && <span className="take-preview">{preview(a.handBack)}</span>}
      </button>
      {open && (
        <div className="take-body" role="region" aria-label={`${profile.name} reply, ${date}`}>
          {a.note.trim() !== "" && <p>{a.note}</p>}
          <pre className="handback">{a.handBack}</pre>
          <details>
            <summary>{ranWith.name}</summary>
            <pre className="handback">{ranWith.text}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
