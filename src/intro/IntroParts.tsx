// The pieces the first run and the replay share: the film's stage, the title card and the
// Skip/Mute strip.

import type { ReactNode, Ref } from "react";
import { Lockup } from "../ui/Lockup";
import { Film, type FilmProps } from "./Film";
import { SCENES } from "./timeline";

export interface FilmStageProps {
  stage: Ref<HTMLDivElement>;
  /** The title card shows, so the film waits hidden behind it. */
  hidden: boolean;
  /** The film is playing, so each scene's line is read out. */
  filming: boolean;
  film: FilmProps;
  /** Names the board as a region. */
  label?: string;
}

/** The board the film plays on, and each scene's line, read out as the scene arrives. */
export function FilmStage({ stage, hidden, filming, film, label }: FilmStageProps) {
  const current = SCENES[Math.min(film.still, SCENES.length - 1)];
  return (
    <>
      <div
        className="intro-film-layer"
        ref={stage}
        tabIndex={-1}
        aria-label={label}
        role={label === undefined ? undefined : "region"}
        data-hidden={hidden ? "" : undefined}
      >
        <Film {...film} />
      </div>
      <p className="visually-hidden" aria-live="polite">
        {filming ? current.rows.join(" ") : ""}
      </p>
    </>
  );
}

export function TitleCard({ ready, begin, onBegin, onSkip }: { ready: boolean; begin: Ref<HTMLButtonElement>; onBegin(): void; onSkip(): void }) {
  return (
    <main className="intro-title">
      <Lockup className="intro-lockup" />
      <h1 className="visually-hidden">Coach</h1>
      <div className="intro-title-keys">
        <button type="button" className="primary" ref={begin} disabled={!ready} onClick={onBegin}>
          Begin
        </button>
        <button type="button" className="ghost" onClick={onSkip}>
          Skip
        </button>
      </div>
    </main>
  );
}

export interface StripProps {
  /** The film is playing, so Skip shows (the title card has its own). */
  filming: boolean;
  reduced: boolean;
  muted: boolean;
  onAdvance(): void;
  onSkip(): void;
  onMute(): void;
}

export function IntroStrip({ filming, reduced, muted, onAdvance, onSkip, onMute }: StripProps): ReactNode {
  return (
    <div className="intro-strip">
      {filming && reduced && (
        <button type="button" className="primary" onClick={onAdvance}>
          Next
        </button>
      )}
      {filming && (
        <button type="button" className="ghost" onClick={onSkip}>
          Skip
        </button>
      )}
      {!reduced && (
        <button type="button" className="ghost" onClick={onMute}>
          {muted ? "Unmute" : "Mute"}
        </button>
      )}
    </div>
  );
}
