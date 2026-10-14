// The film's Player, loaded lazily by `Film.tsx` with the composition it plays (KTD2). The
// Player is pinned to its settings here: no controls, no click or space to play, and no
// rewind when it ends, so the last frame holds under the arriving sheet.

import { useEffect, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { FilmProps } from "./Film";
import { Intro, INTRO_HEIGHT, INTRO_WIDTH } from "./Intro";
import { FPS, SHARED_AUDIO_TAGS, STILLS, TOTAL_FRAMES } from "./timeline";

export default function FilmPlayer({ reducedMotion, muted, still, onReady, onEnded, onFrame }: FilmProps) {
  const player = useRef<PlayerRef>(null);
  const latest = useRef({ onReady, onEnded, onFrame });
  latest.current = { onReady, onEnded, onFrame };

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const ended = () => latest.current.onEnded();
    const frame = (e: { detail: { frame: number } }) => latest.current.onFrame(e.detail.frame);
    p.addEventListener("ended", ended);
    p.addEventListener("frameupdate", frame);
    latest.current.onReady({
      play: (e) => p.play(e),
      setMuted: (m) => (m ? p.mute() : p.unmute()),
    });
    return () => {
      p.removeEventListener("ended", ended);
      p.removeEventListener("frameupdate", frame);
    };
  }, []);

  // Under reduced motion each scene is a still the newcomer steps through (KTD13).
  useEffect(() => {
    if (!reducedMotion) return;
    const at = STILLS[Math.min(Math.max(still, 0), STILLS.length - 1)];
    if (player.current && player.current.getCurrentFrame() !== at) player.current.seekTo(at);
  }, [reducedMotion, still]);

  return (
    <Player
      ref={player}
      component={Intro}
      durationInFrames={TOTAL_FRAMES}
      compositionWidth={INTRO_WIDTH}
      compositionHeight={INTRO_HEIGHT}
      fps={FPS}
      initialFrame={reducedMotion ? STILLS[0] : 0}
      initiallyMuted={reducedMotion || muted}
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      spaceKeyToPlayOrPause={false}
      moveToBeginningWhenEnded={false}
      numberOfSharedAudioTags={SHARED_AUDIO_TAGS}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
