// Dev only, until the first run (U4) mounts the film: open the dev app at #intro, or
// #intro=<frame> to start on a frame, to watch the composition in the real window.

import { Player } from "@remotion/player";
import { Intro, INTRO_HEIGHT, INTRO_WIDTH } from "./Intro";
import { FPS, TOTAL_FRAMES } from "./timeline";

export default function DevPreview() {
  const start = Number(/^#intro=(\d+)$/.exec(location.hash)?.[1] ?? 0);
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--board)" }}>
      <Player
        component={Intro}
        durationInFrames={TOTAL_FRAMES}
        compositionWidth={INTRO_WIDTH}
        compositionHeight={INTRO_HEIGHT}
        fps={FPS}
        initialFrame={Math.min(start, TOTAL_FRAMES - 1)}
        controls
        moveToBeginningWhenEnded={false}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
