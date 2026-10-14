// The replay (KTD11, R15, R22): the intro again from Home, watch-only. A full-window overlay
// held in AppShell's state, not a route. The title card with the film paused behind it, then
// the film with Skip and Mute, or the stills under reduced motion. There is no play beat; it
// closes to Home at the end, on Skip, or on Escape, and never touches the folder.

import { useEffect, useState } from "react";
import { WindowControls } from "../ui/WindowControls";
import { useWindowFrame } from "../ui/windowFrame";
import { FilmStage, IntroStrip, TitleCard } from "./IntroParts";
import { useIntroFilm } from "./useIntroFilm";
import "./intro.css";

export function Replay({ onClose }: { onClose(): void }) {
  const fullscreen = useWindowFrame() === "fullscreen";
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    onClose();
  };
  const { phase, ready, begin, stage, filmProps, stripProps, start, skip } = useIntroFilm({ listening: !closing, onEnd: close, onSkip: close });

  // Focus returns to the key that opened the replay.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => opener?.focus();
  }, []);

  return (
    <div className="replay" role="dialog" aria-label="Intro">
      <div className="gate-bar" data-tauri-drag-region={fullscreen ? undefined : true}>
        <WindowControls />
      </div>
      <div className="intro-stage" data-step={phase}>
        <FilmStage stage={stage} hidden={phase === "title"} filming={phase === "film"} film={filmProps} />
        {phase === "title" && <TitleCard ready={ready} begin={begin} onBegin={start} onSkip={skip} />}
        <IntroStrip filming={phase === "film"} {...stripProps} />
      </div>
    </div>
  );
}
