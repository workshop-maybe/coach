// The intro as one Remotion composition (KTD1, KTD3): five scenes on the board, read from
// the timeline. Authored once, it plays live in the app through the Player and renders to
// video for the trailer. It brings its own ink filters, fonts, tokens and cast fills, so
// it draws the same outside the app shell. The score and cue sounds play inside it, so the
// trailer carries them too (KTD8).

import "@fontsource-variable/inter";
import "@fontsource/fragment-mono";
import "../theme/tokens.css";
import "../theme/app-tokens.css";
import "./intro.css";
import { memo } from "react";
import type { ComponentType } from "react";
import { AbsoluteFill, Html5Audio, Sequence, useCurrentFrame } from "remotion";
import { InkDefs } from "../cast/InkDefs";
import { Rise } from "./pieces/Rise";
import { tween } from "./pieces/motion";
import { Agents } from "./scenes/Agents";
import { Badges } from "./scenes/Badges";
import { Good } from "./scenes/Good";
import { Horizon } from "./scenes/Horizon";
import { Judgment } from "./scenes/Judgment";
import { INTRO_HEIGHT, INTRO_WIDTH, TEXT } from "./scenes/stage";
import { BED_SRC, BED_VOLUME, CUE_SRC, CUE_VOLUME } from "./sound";
import { CUE_FRAMES, SCENES, SOUND_CUES, TOTAL_FRAMES, type SceneId, wordFrames } from "./timeline";

export { INTRO_HEIGHT, INTRO_WIDTH } from "./scenes/stage";

const DRAWN: Record<SceneId, ComponentType<{ frame: number }>> = {
  agents: Agents,
  judgment: Judgment,
  good: Good,
  badges: Badges,
  horizon: Horizon,
};

/** Words lit in data blue, by scene: [row, word]. */
const STRONG: Partial<Record<SceneId, readonly (readonly [number, number])[]>> = {
  agents: [[1, 2]],
};

/** Each scene's strong words per row, by scene index, built once so each row's props hold still. */
const STRONG_ROWS: readonly (readonly (readonly number[])[])[] = SCENES.map((s) =>
  s.rows.map((_, r) => (STRONG[s.id] ?? []).filter(([at]) => at === r).map(([, word]) => word)),
);

/** Frames a scene's text takes to fade before the next scene's rises. */
const FADE = 16;

export function Intro() {
  const frame = useCurrentFrame();
  const last = SCENES.length - 1;
  const boardIn = tween(frame, 0, 14);
  return (
    <AbsoluteFill className="intro-film" style={{ background: "var(--board)" }}>
      <AbsoluteFill style={{ background: "var(--ink)", opacity: 1 - boardIn }} />
      <InkDefs />
      <svg
        viewBox={`0 0 ${INTRO_WIDTH} ${INTRO_HEIGHT}`}
        width={INTRO_WIDTH}
        height={INTRO_HEIGHT}
        style={{ position: "absolute", inset: 0, color: "var(--ink)", overflow: "visible" }}
        aria-hidden="true"
      >
        {SCENES.map((s, i) => {
          const playing = frame >= s.start && (i === last || frame < s.start + s.length);
          const Drawn = DRAWN[s.id];
          return playing ? <Drawn key={s.id} frame={frame} /> : null;
        })}
      </svg>
      {SCENES.map((s, i) => {
        const end = s.start + s.length;
        if (frame < s.start || (i < last && frame >= end)) return null;
        // The last scene's text holds on the final frame, where the sheet arrives.
        const fade = i < last ? ([Math.max(s.start + s.still + 1, end - FADE), end - 1] as const) : undefined;
        return s.rows.map((row, r) => (
          <Rise
            key={`${s.id}-${r}`}
            text={row}
            frames={wordFrames(s, r)}
            frame={frame}
            x={TEXT.x}
            y={TEXT.rows[r]}
            size={TEXT.size}
            fade={fade}
            strong={STRONG_ROWS[i][r]}
          />
        ));
      })}
      <Sounds />
    </AbsoluteFill>
  );
}

/** The score and the cues (KTD8). The Player's mute and volume sit over all of them. */
const Sounds = memo(function Sounds() {
  return (
    <>
      <Sequence name="score" from={0} durationInFrames={TOTAL_FRAMES} layout="none">
        <Html5Audio src={BED_SRC} volume={BED_VOLUME} />
      </Sequence>
      {SOUND_CUES.map((cue) => (
        <Sequence
          key={`${cue.kind}-${cue.frame}`}
          name={cue.kind}
          from={cue.frame}
          durationInFrames={CUE_FRAMES[cue.kind]}
          layout="none"
        >
          <Html5Audio src={CUE_SRC[cue.kind]} volume={CUE_VOLUME} />
        </Sequence>
      ))}
    </>
  );
});
