// The pieces the first run and the replay share: the title card and the Skip/Mute strip.

import type { ReactNode, Ref, SyntheticEvent } from "react";
import { Lockup } from "../ui/Lockup";

export function TitleCard({ ready, begin, onBegin, onSkip }: { ready: boolean; begin: Ref<HTMLButtonElement>; onBegin(e: SyntheticEvent): void; onSkip(): void }) {
  return (
    <main className="intro-title">
      <Lockup className="intro-lockup" />
      <h1 className="visually-hidden">Andamio Desktop</h1>
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
