// The replay (KTD11, R15, R22): the intro again from Home, watch-only. A full-window overlay
// held in AppShell's state, not a route. The title card with the film paused behind it, then
// the film with Skip and Mute, or the stills under reduced motion. There is no play beat; it
// closes to Home at the end, on Skip, or on Escape, and never touches the folder.

import { useEffect, useRef, useState } from "react";
import { WindowControls } from "../ui/WindowControls";
import { useWindowFrame } from "../ui/windowFrame";
import { Film } from "./Film";
import { IntroStrip, TitleCard } from "./IntroParts";
import { SCENES } from "./timeline";
import { useIntroFilm } from "./useIntroFilm";
import "./intro.css";

export function Replay({ onClose }: { onClose(): void }) {
  const fullscreen = useWindowFrame() === "fullscreen";
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    onClose();
  };
  const filmKeys = useIntroFilm({ listening: !closing, onEnd: close, onSkip: close });
  const { reduced, phase, muted, ready, scene, skip } = filmKeys;
  const begin = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Focus returns to the key that opened the replay.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    if (phase === "title" && ready) begin.current?.focus();
  }, [phase, ready]);

  useEffect(() => {
    if (phase === "film") stage.current?.focus();
  }, [phase]);

  const current = SCENES[Math.min(scene, SCENES.length - 1)];

  return (
    <div className="replay" role="dialog" aria-label="Intro">
      <div className="gate-bar" data-tauri-drag-region={fullscreen ? undefined : true}>
        <WindowControls />
      </div>
      <div className="intro-stage" data-step={phase}>
        <div className="intro-film-layer" ref={stage} tabIndex={-1} data-hidden={phase === "title" ? "" : undefined}>
          <Film reducedMotion={reduced} muted={muted} still={scene} onReady={filmKeys.onReady} onEnded={filmKeys.onEnded} onFrame={filmKeys.onFrame} />
        </div>
        <p className="visually-hidden" aria-live="polite">
          {phase === "film" ? current.rows.join(" ") : ""}
        </p>
        {phase === "title" && <TitleCard ready={ready} begin={begin} onBegin={filmKeys.start} onSkip={skip} />}
        <IntroStrip filming={phase === "film"} reduced={reduced} muted={muted} onAdvance={filmKeys.advance} onSkip={skip} onMute={filmKeys.toggleMute} />
      </div>
    </div>
  );
}
