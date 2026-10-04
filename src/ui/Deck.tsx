// One card at a time (KTD2). Every flow is a list of beats handed to this deck: the
// current card asks one thing and offers one forward action named for what happens
// next, Back is quiet, and answers already given settle above the card as plain text.
// Leaving (Escape, the corner control, Back on the first beat) discards the answers.
// Nothing is written until the last beat's forward action runs `onFinish`, except an image
// pasted into a rich box, which is saved beside the box's file the moment it is pasted so the
// box can show it (KTD6 of the paste-images plan). An abandoned deck leaves that file behind.
//
// A beat can be a pane (R7, KTD3): it claims the window, its card fills the height with
// the actions in view, and the answers above it keep to one line. Escape follows KTD8
// (R19, R20): in a text field or editor on a pane it only steps out of the field, on a
// pane it goes back a card, and while the deck holds unsaved work it never closes the
// deck. The corner control and Back still leave on a click. A beat can also send first
// focus into its body (R21), so a paste lands in the reply box.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ChangedOnDiskError } from "../storage/storage";
import { usePane } from "./pane";
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
  /** The beat claims the window as a pane (R7): its card fills the height and Escape steps back rather than out (KTD8). */
  pane?: boolean;
  /** Arriving puts focus on the body's first text field or editor instead of the heading (R21). */
  focusBody?: boolean;
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
  /** The deck holds work that leaving would lose, such as a pasted reply or changed text. Escape never closes it then (R20). */
  unsaved?: boolean;
}

type Trouble = { kind: "none" } | { kind: "error"; message: string } | { kind: "conflict" };

/** Input types that take no typing, so Escape on them is not Escape out of a field. */
const NOT_TEXT = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** An editor: ProseMirror renders its editor as contenteditable. */
const EDITOR = '[contenteditable]:not([contenteditable="false"])';

/** Whether `t` is in a text field or editor, where typing happens. */
function inField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLInputElement) return !NOT_TEXT.has(t.type);
  return t instanceof HTMLTextAreaElement || t.closest(EDITOR) !== null;
}

/** The first enabled text field or editor in `body`, for a beat that takes focus there. */
function firstField(body: HTMLElement | null): HTMLElement | undefined {
  const all = body ? Array.from(body.querySelectorAll<HTMLElement>(`input, textarea, ${EDITOR}`)) : [];
  return all.find((el) => inField(el) && !(el as { disabled?: boolean }).disabled);
}

export function Deck({ label, beats, startAt = 0, onClose, onFinish, onUseTheirs, unsaved = false }: DeckProps) {
  const [index, setIndex] = useState(() => Math.min(startAt, beats.length - 1));
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<Trouble>({ kind: "none" });
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const forwardButton = useRef<HTMLButtonElement>(null);
  const beat = beats[Math.min(index, beats.length - 1)];
  const last = index >= beats.length - 1;
  const conflict = trouble.kind === "conflict";
  const pane = beat.pane === true && !conflict;

  usePane(pane);

  // Focus follows the card, so a keyboard or screen reader lands on the new question, or
  // in its field when the beat asks for that.
  useEffect(() => {
    const wantsField = !conflict && beat.focusBody === true;
    const field = wantsField ? firstField(body.current) : undefined;
    (field ?? heading.current)?.focus();
    if (!wantsField) return;
    // In development, StrictMode mounts a newly shown editor twice after this effect, and
    // Tiptap moves its DOM out and back, which drops the focus (R21, U6). Once that has
    // settled, a field that lost focus to nothing takes it back; focus the person has moved
    // elsewhere is left alone.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      firstField(body.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [index, conflict]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape is the quiet way out, unless it would lose work (KTD8). Every Escape the deck
  // keeps for itself is marked handled, so nothing behind the deck acts on it.
  useEscape((e) => {
    if (pane && inField(e.target)) {
      e.preventDefault();
      const go = forwardButton.current;
      (go && !go.disabled ? go : heading.current)?.focus();
    } else if (pane && index > 0) {
      e.preventDefault();
      back();
    } else if (unsaved) {
      e.preventDefault();
    } else onClose();
  });

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

  // Set before the first await, so a second press while onForward runs does nothing.
  const running = useRef(false);

  async function forward() {
    if (running.current || busy || beat.valid === false) return;
    running.current = true;
    setTrouble({ kind: "none" });
    try {
      if (beat.onForward) {
        setBusy(true);
        try {
          await beat.onForward();
        } catch (e) {
          setTrouble({ kind: "error", message: describeError(e) });
          return;
        } finally {
          setBusy(false);
        }
      }
      if (last) await finish(false);
      else setIndex((i) => i + 1);
    } finally {
      running.current = false;
    }
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
    <section className={pane ? "deck pane" : "deck"} aria-label={label}>
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
          <div className="deck-body" ref={body}>
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
              <button
                type="button"
                className="primary"
                ref={forwardButton}
                onClick={() => void forward()}
                disabled={busy || beat.valid === false}
              >
                {beat.forward}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
