// The film's playback and keys, shared by the first run and the replay (KTD5, KTD11, KTD12):
// the title card then the film, mute kept in local storage, the reduced-motion stills, and the
// capture-phase keys, and focus on Begin then on the board. What happens when the film ends
// or is skipped is the caller's.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FilmApi, FilmProps } from "./Film";
import type { StripProps } from "./IntroParts";
import { readMuted, writeMuted } from "./mute";
import { sceneAt, SCENES } from "./timeline";
import { usePrefersReducedMotion } from "../ui/usePrefersReducedMotion";

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
  const begin = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  const latest = useRef({ onEnd, onSkip });
  latest.current = { onEnd, onSkip };

  const onReady = useCallback((api: FilmApi) => {
    film.current = api;
    setReady(true);
  }, []);

  // Keys can land faster than a render, so the handlers read the scene and mute from refs.
  const sceneNow = useRef(0);
  const mutedNow = useRef(muted);

  // Under reduced motion the newcomer steps the scenes, so the film's own frame and end are not
  // theirs (the film never plays then; this holds if the setting changes while it shows).
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

  function start() {
    if (!film.current || begun.current) return;
    begun.current = true;
    // Before anything else, while still inside the key's gesture, so the sound may start.
    if (!reduced) film.current.play();
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
      if (e.defaultPrevented || e.repeat) return;
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

  // Focus lands on Begin once the film can play, then on the board once it does.
  useEffect(() => {
    if (phase === "title" && ready) begin.current?.focus();
  }, [phase, ready]);

  useEffect(() => {
    if (phase === "film") stage.current?.focus();
  }, [phase]);

  /** Spread onto the Film. */
  const filmProps: FilmProps = { reducedMotion: reduced, muted, still: scene, onReady, onEnded, onFrame, onFailed: skip };
  /** Spread onto the IntroStrip, with the caller's own `filming`. */
  const stripProps: Omit<StripProps, "filming"> = { reduced, muted, onAdvance: advance, onSkip: skip, onMute: toggleMute };

  return { reduced, phase, muted, ready, scene, begin, stage, filmProps, stripProps, start, skip };
}
