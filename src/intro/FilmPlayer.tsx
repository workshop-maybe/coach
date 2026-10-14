// The film's player, loaded lazily by `Film.tsx` with the composition it draws (KTD2). Its
// clock counts frames from the moment `play` is called, at the timeline's FPS, and draws
// `Intro` at each one. It plays once: at the last frame it reports the end and holds there,
// so the play beat's sheet arrives over the final picture. Under reduced motion it never
// plays and makes no sound; it draws the still the newcomer has stepped to.
//
// The composition is drawn at its own size, INTRO_WIDTH × INTRO_HEIGHT, and scaled to fit
// the board without cropping, centred.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FilmProps } from "./Film";
import { Intro, INTRO_HEIGHT, INTRO_WIDTH } from "./Intro";
import { createFilmSound } from "./sound/filmSound";
import { FPS, STILLS, TOTAL_FRAMES } from "./timeline";

/** The frame `ms` milliseconds after the film started, held at the last. */
export function frameAt(ms: number): number {
  return Math.min(TOTAL_FRAMES - 1, Math.max(0, Math.floor((ms * FPS) / 1000)));
}

export default function FilmPlayer({ reducedMotion, muted, still, onReady, onEnded, onFrame }: FilmProps) {
  const [frame, setFrame] = useState(0);
  const latest = useRef({ onReady, onEnded, onFrame });
  latest.current = { onReady, onEnded, onFrame };
  // Read once, when the film loads, as the remembered mute and the motion setting were before.
  const initial = useRef({ reducedMotion, muted });

  useEffect(() => {
    const sound = initial.current.reducedMotion ? null : createFilmSound(initial.current.muted);
    let raf = 0;
    let begun: number | null = null;
    let shown = -1;
    let over = false;

    const tick = () => {
      if (begun === null) return;
      const f = frameAt(performance.now() - begun);
      if (f !== shown) {
        shown = f;
        setFrame(f);
        latest.current.onFrame(f);
      }
      if (f >= TOTAL_FRAMES - 1) {
        if (!over) {
          over = true;
          latest.current.onEnded();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    latest.current.onReady({
      play() {
        if (begun !== null) return;
        // Sound first, while this call is still inside the key's gesture.
        sound?.start();
        begun = performance.now();
        raf = requestAnimationFrame(tick);
      },
      setMuted: (m) => sound?.setMuted(m),
    });

    return () => {
      cancelAnimationFrame(raf);
      begun = null;
      sound?.close();
    };
  }, []);

  // Scale the composition to fit the board, as large as fits without cropping.
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / INTRO_WIDTH, el.clientHeight / INTRO_HEIGHT));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const drawn = reducedMotion ? STILLS[Math.min(Math.max(still, 0), STILLS.length - 1)] : frame;

  return (
    <div ref={box} className="intro-film-fit" data-frame={drawn}>
      <div
        className="intro-film-scaled"
        style={{ width: INTRO_WIDTH, height: INTRO_HEIGHT, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <Intro frame={drawn} />
      </div>
    </div>
  );
}
