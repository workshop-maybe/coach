// The intro's picture (KTD1, KTD3): five scenes on the board, drawn at one frame of the
// timeline. It is a pure function of the frame, so it plays live in the app under
// FilmPlayer's clock and renders frame by frame to video for the trailer
// (scripts/intro-render.mjs). It brings its own ink filters, fonts, tokens and cast fills,
// so it draws the same outside the app shell. Its sound is the timeline's SOUND_PLAYS, which
// the app and the trailer each play their own way (KTD8).

import "@fontsource-variable/inter";
import "@fontsource/fragment-mono";
import "../theme/tokens.css";
import "../theme/app-tokens.css";
import "./intro.css";
import type { ComponentType, CSSProperties } from "react";
import { InkDefs } from "../cast/InkDefs";
import { Rise } from "./pieces/Rise";
import { tween } from "./pieces/motion";
import { Agents } from "./scenes/Agents";
import { Badges } from "./scenes/Badges";
import { Good } from "./scenes/Good";
import { Horizon } from "./scenes/Horizon";
import { Judgment } from "./scenes/Judgment";
import { INTRO_HEIGHT, INTRO_WIDTH, TEXT } from "./scenes/stage";
import { SCENES, type SceneId, wordFrames } from "./timeline";

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

/** A layer that fills the film's frame. */
const FILL: CSSProperties = { position: "absolute", inset: 0 };

/** The film at `frame`, drawn at INTRO_WIDTH × INTRO_HEIGHT. */
export function Intro({ frame }: { frame: number }) {
  const last = SCENES.length - 1;
  const boardIn = tween(frame, 0, 14);
  return (
    <div className="intro-film" style={{ ...FILL, width: INTRO_WIDTH, height: INTRO_HEIGHT, background: "var(--board)" }}>
      <div style={{ ...FILL, background: "var(--ink)", opacity: 1 - boardIn }} />
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
    </div>
  );
}
