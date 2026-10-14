// The first run (KTD5 of the first-run intro plan): a title card, the film on the board,
// the play beat on the sheet, then the folder gate. It sits in `FolderGate`'s branch for a
// folder never remembered, below the gate bar, so the window moves and closes through the
// whole intro. The newcomer's line is held in local storage from the play beat until the
// badge is saved in the folder they choose (KTD6, R20).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, CSSProperties, ReactNode, SyntheticEvent } from "react";
import { Deck } from "../ui/Deck";
import { Lockup } from "../ui/Lockup";
import { Sheet } from "../ui/Sheet";
import { badgeName, LINE_MAX, normalizeLine } from "./badgeName";
import { Film, type FilmApi } from "./Film";
import { clearHeldLine, writeHeldLine } from "./heldLine";
import { readMuted, writeMuted } from "./mute";
import { INTRO_HEIGHT, INTRO_WIDTH, TEXT } from "./scenes/stage";
import { sceneAt, SCENES } from "./timeline";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "./intro.css";

type Step = "title" | "film" | "play" | "gate";

export interface FirstRunProps {
  /** Today's ask for a folder. `held` is true when a line waits to be saved as a badge there. */
  gate(held: boolean): ReactNode;
}

const ADVANCE_KEYS = new Set(["Enter", " ", "ArrowRight"]);

/** Where the film's text ends, so the play beat's sheet stops below the last scene's line. */
const FILM_GEOMETRY = {
  "--film-w": INTRO_WIDTH,
  "--film-h": INTRO_HEIGHT,
  "--film-text-end": TEXT.rows[TEXT.rows.length - 1] + TEXT.size * 1.6,
} as CSSProperties;

export function FirstRun({ gate }: FirstRunProps) {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState<Step>("title");
  const [muted, setMuted] = useState(readMuted);
  const [ready, setReady] = useState(false);
  const [scene, setScene] = useState(0);
  const [line, setLine] = useState("");
  const [held, setHeld] = useState(false);
  const film = useRef<FilmApi | null>(null);
  const begun = useRef(false);
  const begin = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // With no folder remembered, a held line can only be from a run quit before a folder was
  // chosen, and R20 plays that run again from the start.
  useEffect(() => clearHeldLine(), []);

  // Focus lands on Begin once the film can play.
  useEffect(() => {
    if (step === "title" && ready) begin.current?.focus();
  }, [step, ready]);

  useEffect(() => {
    if (step === "film") stage.current?.focus();
  }, [step]);

  const onReady = useCallback((api: FilmApi) => {
    film.current = api;
    setReady(true);
  }, []);


  // Keys can land faster than a render, so the handlers read the scene and mute from refs.
  const sceneNow = useRef(0);
  const mutedNow = useRef(muted);

  // Under reduced motion the newcomer steps the scenes, and the Player's own events (a seek
  // reports its frame late, and a seek to the last still reports the end) are not theirs.
  const stepping = useRef(reduced);
  stepping.current = reduced;

  const onFrame = useCallback((frame: number) => {
    if (stepping.current) return;
    sceneNow.current = SCENES.indexOf(sceneAt(frame));
    setScene(sceneNow.current);
  }, []);

  const onEnded = useCallback(() => {
    if (!stepping.current) setStep((s) => (s === "film" ? "play" : s));
  }, []);

  function start(e: SyntheticEvent) {
    if (!film.current || begun.current) return;
    begun.current = true;
    // Called with the key's own event, before anything else, so the gesture reaches the audio.
    if (!reduced) film.current.play(e);
    setStep("film");
  }

  const skip = useCallback(() => {
    setLine("");
    setStep("gate");
  }, []);

  const toggleMute = useCallback(() => {
    const next = !mutedNow.current;
    mutedNow.current = next;
    setMuted(next);
    writeMuted(next);
    film.current?.setMuted(next);
  }, []);

  // Under reduced motion: the next still, and past the last one the play beat, with no slide.
  const advance = useCallback(() => {
    if (sceneNow.current < SCENES.length - 1) {
      sceneNow.current += 1;
      setScene(sceneNow.current);
    } else setStep("play");
  }, []);

  // The title card's and the scenes' keys (KTD12). Capture phase, so the intro takes them
  // first. Detached on the play beat, where the deck owns Escape.
  useEffect(() => {
    if (step !== "title" && step !== "film") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!reduced && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        toggleMute();
        return;
      }
      // A focused key presses itself on Enter or Space; only the board advances a still.
      if (reduced && step === "film" && ADVANCE_KEYS.has(e.key) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, reduced, skip, toggleMute, advance]);

  if (step === "gate") return <>{gate(held)}</>;

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    e.preventDefault();
    const el = e.currentTarget;
    const from = el.selectionStart ?? line.length;
    const to = el.selectionEnd ?? from;
    setLine((line.slice(0, from) + text.replace(/\s+/g, " ") + line.slice(to)).slice(0, LINE_MAX));
  }

  async function makeBadge() {
    const kept = normalizeLine(line);
    setHeld(writeHeldLine({ line: kept, name: badgeName(kept) }));
    setLine("");
    setStep("gate");
  }

  function closeCard() {
    clearHeldLine();
    setHeld(false);
    setLine("");
    setStep("gate");
  }

  const playing = step === "title" || step === "film";
  const current = SCENES[Math.min(scene, SCENES.length - 1)];

  return (
    <div className="intro-stage" data-step={step} style={FILM_GEOMETRY}>
      <div
        className="intro-film-layer"
        ref={stage}
        tabIndex={-1}
        aria-label="Intro"
        role="region"
        data-hidden={step === "title" ? "" : undefined}
      >
        <Film reducedMotion={reduced} muted={muted} still={scene} onReady={onReady} onEnded={onEnded} onFrame={onFrame} />
      </div>

      {/* Each scene's line, read out as the scene arrives. */}
      <p className="visually-hidden" aria-live="polite">
        {step === "film" ? current.rows.join(" ") : ""}
      </p>

      {step === "title" && (
        <main className="intro-title">
          <Lockup className="intro-lockup" />
          <h1 className="visually-hidden">Andamio Desktop</h1>
          <div className="intro-title-keys">
            <button type="button" className="primary" ref={begin} disabled={!ready} onClick={start}>
              Begin
            </button>
            <button type="button" className="ghost" onClick={skip}>
              Skip
            </button>
          </div>
        </main>
      )}

      {step === "play" && (
        <div className="intro-sheet">
          <Sheet>
            <Deck
              label="Your first badge"
              beats={[
                {
                  id: "line",
                  title: "What would a good result look like",
                  body: (
                    <>
                      <p className="muted">Pick one thing you hand to an agent. Say what it has to do for you to call it good.</p>
                      <input
                        type="text"
                        aria-label="What good looks like"
                        placeholder="It finds the bug and names the line that causes it"
                        maxLength={LINE_MAX}
                        value={line}
                        onChange={(e) => setLine(e.target.value)}
                        onPaste={onPaste}
                      />
                    </>
                  ),
                  forward: "Make it a badge",
                  valid: normalizeLine(line) !== "",
                  focusBody: true,
                },
              ]}
              onClose={closeCard}
              onFinish={makeBadge}
            />
          </Sheet>
        </div>
      )}

      {playing && (
        <div className="intro-strip">
          {step === "film" && reduced && (
            <button type="button" className="primary" onClick={advance}>
              Next
            </button>
          )}
          {step === "film" && (
            <button type="button" className="ghost" onClick={skip}>
              Skip
            </button>
          )}
          {!reduced && (
            <button type="button" className="ghost" onClick={toggleMute}>
              {muted ? "Unmute" : "Mute"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
