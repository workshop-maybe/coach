// One card at a time (KTD2). Every flow is a list of beats handed to this deck: the
// current card asks one thing and offers one forward action named for what happens
// next, Back is quiet, and answers already given settle above the card as plain text.
// Leaving (Escape, the corner control, Back on the first beat) discards the answers.
// Nothing is written until the last beat's forward action runs `onFinish`.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ChangedOnDiskError } from "../storage/storage";
import { useEscape } from "./shared";
import { describeError } from "./useFolderState";

export interface BeatContext {
  /** Moves on as the forward action would, for a card whose answer is one tap. */
  advance(): void;
}

export interface Beat {
  id: string;
  /** The card's heading. No trailing period (R3). */
  title: string;
  /** The card's one thing to answer. */
  body: ReactNode | ((ctx: BeatContext) => ReactNode);
  /** The forward action's name, such as "Make the badge". Leave out when the body advances itself. */
  forward?: string;
  /** False keeps the forward action disabled. Defaults to true. */
  valid?: boolean;
  /** The answer as plain text, shown above later cards. */
  settled?: ReactNode;
  /** A side effect of moving on from this beat (never a write to the data folder). */
  onForward?(): void | Promise<void>;
}

export interface DeckProps {
  /** Names the deck for assistive tech, such as "Create a credential". */
  label: string;
  beats: Beat[];
  /** The beat to open on, for a flow that resumes. */
  startAt?: number;
  onClose(): void;
  /** The final forward action. `keepMine` is set when the person chose to overwrite a file changed on disk. */
  onFinish(opts: { keepMine: boolean }): Promise<void>;
  /** The person chose the file on disk over their answers. Defaults to closing. */
  onUseTheirs?(): void;
}

type Trouble = { kind: "none" } | { kind: "error"; message: string } | { kind: "conflict" };

export function Deck({ label, beats, startAt = 0, onClose, onFinish, onUseTheirs }: DeckProps) {
  const [index, setIndex] = useState(() => Math.min(startAt, beats.length - 1));
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<Trouble>({ kind: "none" });
  const heading = useRef<HTMLHeadingElement>(null);
  const beat = beats[Math.min(index, beats.length - 1)];
  const last = index >= beats.length - 1;
  const conflict = trouble.kind === "conflict";

  // Focus follows the card, so a keyboard or screen reader lands on the new question.
  useEffect(() => {
    heading.current?.focus();
  }, [index, conflict]);

  // Escape is the quiet way out from anywhere in the deck.
  useEscape(onClose);

  async function finish(keepMine: boolean) {
    setBusy(true);
    try {
      await onFinish({ keepMine });
      setTrouble({ kind: "none" });
    } catch (e) {
      setTrouble(e instanceof ChangedOnDiskError ? { kind: "conflict" } : { kind: "error", message: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function forward() {
    if (busy || beat.valid === false) return;
    setTrouble({ kind: "none" });
    if (beat.onForward) {
      try {
        await beat.onForward();
      } catch (e) {
        setTrouble({ kind: "error", message: describeError(e) });
        return;
      }
    }
    if (last) await finish(false);
    else setIndex((i) => i + 1);
  }

  function back() {
    setTrouble({ kind: "none" });
    if (index === 0) onClose();
    else setIndex((i) => i - 1);
  }

  // Enter in a one-line answer moves on, as a tap on the forward action would.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (e.key !== "Enter" || e.defaultPrevented || !(t instanceof HTMLInputElement) || !beat.forward) return;
    e.preventDefault();
    void forward();
  }

  const settled = beats.slice(0, index).filter((b) => b.settled !== undefined && b.settled !== "");

  return (
    <section className="deck" aria-label={label}>
      <button type="button" className="deck-close ghost" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {settled.length > 0 && (
        <ol className="deck-settled" aria-label="Answered">
          {settled.map((b) => (
            <li key={b.id}>{b.settled}</li>
          ))}
        </ol>
      )}
      {conflict ? (
        <div className="deck-card" key="conflict">
          <h2 ref={heading} tabIndex={-1}>
            Changed on disk
          </h2>
          <p className="muted">This file changed since the card opened.</p>
          <div className="deck-actions">
            <button type="button" className="ghost" onClick={() => (onUseTheirs ?? onClose)()} disabled={busy}>
              Use theirs
            </button>
            <button type="button" className="primary" onClick={() => void finish(true)} disabled={busy}>
              Keep mine
            </button>
          </div>
        </div>
      ) : (
        <div className="deck-card" key={beat.id} onKeyDown={onKeyDown}>
          <h2 ref={heading} tabIndex={-1}>
            {beat.title}
          </h2>
          <div className="deck-body">
            {typeof beat.body === "function" ? beat.body({ advance: () => void forward() }) : beat.body}
          </div>
          {trouble.kind === "error" && (
            <p className="deck-error" role="alert">
              {trouble.message}
            </p>
          )}
          <div className="deck-actions">
            <button type="button" className="ghost deck-back" onClick={back}>
              Back
            </button>
            {beat.forward && (
              <button type="button" className="primary" onClick={() => void forward()} disabled={busy || beat.valid === false}>
                {beat.forward}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
