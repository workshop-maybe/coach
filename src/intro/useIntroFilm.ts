// The film's playback and keys, shared by the first run and the replay (KTD5, KTD11, KTD12):
// the title card then the film, mute kept in local storage, the reduced-motion stills, and the
// capture-phase keys. What happens when the film ends or is skipped is the caller's.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import type { FilmApi } from "./Film";
import { readMuted, writeMuted } from "./mute";
import { sceneAt, SCENES } from "./timeline";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

const ADVANCE_KEYS = new Set(["Enter", " ", "ArrowRight"]);

export interface IntroFilmOptions {
  /** The film reached its end, or the last still was advanced past. */
  onEnd(): void;
  /** Escape or a Skip key. */
  onSkip(): void;
  /** While false, the intro's keys are detached (the play beat, where the deck owns Escape). */
  listening: boolean;
}

export function useIntroFilm({ onEnd, onSkip, listening }: IntroFilmOptions) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<"title" | "film">("title");
  const [muted, setMuted] = useState(readMuted);
  const [ready, setReady] = useState(false);
  const [scene, setScene] = useState(0);
  const film = useRef<FilmApi | null>(null);
  const begun = useRef(false);

  const latest = useRef({ onEnd, onSkip });
  latest.current = { onEnd, onSkip };

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
    if (!stepping.current) latest.current.onEnd();
  }, []);

  function start(e: SyntheticEvent) {
    if (!film.current || begun.current) return;
    begun.current = true;
    // Called with the key's own event, before anything else, so the gesture reaches the audio.
    if (!reduced) film.current.play(e);
    setPhase("film");
  }

  const skip = useCallback(() => latest.current.onSkip(), []);

  const toggleMute = useCallback(() => {
    const next = !mutedNow.current;
    mutedNow.current = next;
    setMuted(next);
    writeMuted(next);
    film.current?.setMuted(next);
  }, []);

  // Under reduced motion: the next still, and past the last one the end, with no slide.
  const advance = useCallback(() => {
    if (sceneNow.current < SCENES.length - 1) {
      sceneNow.current += 1;
      setScene(sceneNow.current);
    } else latest.current.onEnd();
  }, []);

  // The title card's and the scenes' keys (KTD12). Capture phase, so the intro takes them first.
  useEffect(() => {
    if (!listening) return;
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
      if (reduced && phase === "film" && ADVANCE_KEYS.has(e.key) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, phase, reduced, skip, toggleMute, advance]);

  return { reduced, phase, muted, ready, scene, onReady, onFrame, onEnded, start, skip, toggleMute, advance };
}
