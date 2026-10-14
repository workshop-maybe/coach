// Scene 2, "This app has no AI inside": the board clears to your one setup, only its
// dials and keys, and the dials turn by hand, one after another, as you set them.

import { INK } from "../../cast/InkDefs";
import { ENCODERS, Setup, turnArc } from "../pieces/Setup";
import { at, between, ease, tween } from "../pieces/motion";
import { Pile } from "./Agents";
import { ANGLES_BEFORE, ANGLES_SET, SETTINGS, YOU, scene } from "./stage";

const S = scene("judgment");

/** When each dial turns, relative to the scene. */
const TURN = ENCODERS.map((_, i) => ({ from: 70 + i * 30, to: 70 + i * 30 + 28 }));
const REACH = 25;

/** The dials' angles at a frame of this scene, as the next scene finds them at its end. */
export function judgmentAngles(f: number): number[] {
  return ENCODERS.map((_, i) => ANGLES_BEFORE[i] + (ANGLES_SET[i] - ANGLES_BEFORE[i]) * tween(f, TURN[i].from, TURN[i].to, 0, 1, ease));
}

export function Judgment({ frame }: { frame: number }) {
  const f = frame - S.start;
  const angles = judgmentAngles(f);
  const pose = between(YOU.agents, YOU.judgment, tween(f, 8, 62, 0, 1, ease));
  return (
    <g data-scene="judgment">
      <Pile frame={frame} away={tween(f, 0, 40, 0, 1, ease)} />
      <g transform={at(pose)}>
        <Setup angles={angles} lines={SETTINGS.map((text, i) => ({ text, opacity: tween(f, TURN[i].from + 10, TURN[i].to + 4) }))} />
        {/* The hand's trace: an arc around each dial as it turns, and a fingertip on the arc. */}
        {ENCODERS.map(({ cx, cy }, i) => {
          const t = tween(f, TURN[i].from, TURN[i].to, 0, 1, ease);
          const lift = 1 - tween(f, TURN[i].to + 8, TURN[i].to + 34);
          if (t <= 0 || lift <= 0) return null;
          const tip = (angles[i] * Math.PI) / 180;
          return (
            <g key={cx} filter={INK} fill="none" stroke="var(--ink-muted)" strokeLinecap="round" opacity={lift}>
              <path d={turnArc(cx, cy, REACH, ANGLES_BEFORE[i], angles[i])} strokeWidth={1.6} />
              <circle cx={cx + Math.sin(tip) * REACH} cy={cy - Math.cos(tip) * REACH} r={3.4} strokeWidth={1.6} stroke="var(--ink)" className="cast-paper" />
            </g>
          );
        })}
      </g>
    </g>
  );
}
