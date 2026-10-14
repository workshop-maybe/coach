// Scene 4, "Your agents earn badges": two more of your setups ink on beside yours, each
// takes the badge, and their keys light as they earn. Two pass. Then a job comes in and
// the one to reach for is lit in data blue.

import { memo } from "react";
import { INK, sketchRect } from "../../cast/InkDefs";
import { ReplyRecord } from "../pieces/ReplyRecord";
import { Setup } from "../pieces/Setup";
import { at, between, clamp, drop, ease, inked, tween } from "../pieces/motion";
import { judgmentAngles } from "./Judgment";
import { LINE, SETTINGS_LINES, TRIO, YOU, scene } from "./stage";

const S = scene("badges");

/** Each setup: when it inks on, its dials, its badge's drop, how many keys it earns, and whether it passes. */
const CAST = [
  { draw: 12, angles: [60, -40, 20], seat: 66, lit: 1, pass: false },
  { draw: -1, angles: judgmentAngles(Infinity), seat: -1, lit: 3, pass: true },
  { draw: 22, angles: [-100, 120, -30], seat: 76, lit: 5, pass: true },
];
/** The one to reach for. */
const CHOSEN = 2;
/** When keys start lighting, and the first pass (the check cue). */
const LIGHT = 90;
const PASS = 110;
const JOB = { at: 136, w: 230, h: 52, s: 1.4, x: 1360, y: 356 };
const LINK = { at: 152, x: 1440 };
const LIGHT_UP = 160;

/** Your three setups as this scene leaves them at relative frame `f`. `choice` fades the job and its blue. */
export const Trio = memo(function Trio({ f, choice = 1 }: { f: number; choice?: number }) {
  const chosen = TRIO[CHOSEN];
  const top = chosen.y + 14 * chosen.s;
  const linkFrom = JOB.y + JOB.h * JOB.s + 4;
  return (
    <g>
      {CAST.map((c, i) => {
        const pose = i === 1 ? between(YOU.good, YOU.badges, tween(f, 0, 44, 0, 1, ease)) : TRIO[i];
        const draw = c.draw < 0 ? 1 : tween(f, c.draw, c.draw + 46, 0, 1, ease);
        if (draw <= 0) return null;
        const seat = c.seat < 0 ? 1 : f >= c.seat ? tween(f, c.seat, c.seat + 20, 0, 1, drop) : -1;
        const lit = f < LIGHT ? 0 : Math.min(c.lit, Math.floor((f - LIGHT - i * 4) / 6) + 1);
        const check = c.pass ? tween(f, PASS + (i - 1) * 8, PASS + (i - 1) * 8 + 16) : 0;
        return (
          <g key={i} transform={at(pose)}>
            <Setup
              draw={draw}
              angles={c.angles}
              seat={seat}
              seatDraw={c.seat < 0 ? 1 : clamp(seat * 2.5)}
              label={LINE}
              lit={Math.max(0, lit)}
              lines={i === 1 ? SETTINGS_LINES : undefined}
            />
            {check > 0 && (
              <path d="M128 -18l12 12 26 -30" stroke="var(--good)" strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" {...inked(check)} />
            )}
          </g>
        );
      })}
      {choice > 0 && f >= JOB.at && (
        <g opacity={choice}>
          <g transform={`translate(${JOB.x} ${JOB.y + (1 - tween(f, JOB.at, JOB.at + 18)) * 24}) scale(${JOB.s})`} opacity={tween(f, JOB.at, JOB.at + 12)}>
            <ReplyRecord w={JOB.w} h={JOB.h} title="job" text={["review a schema migration"]} />
          </g>
          <path
            d={`M${LINK.x} ${linkFrom}V${linkFrom + (top - 10 - linkFrom) * tween(f, LINK.at, LINK.at + 14, 0, 1, ease)}`}
            stroke="var(--data)"
            strokeWidth={2.4}
            strokeDasharray="6 8"
            fill="none"
            opacity={f >= LINK.at ? 1 : 0}
          />
          <g transform={at(chosen)} filter={INK} fill="none" stroke="var(--data)" strokeLinecap="round">
            <path d={sketchRect(-4, 14, 328, 176, 4, 0.8)} strokeWidth={2.2} {...inked(tween(f, LIGHT_UP, LIGHT_UP + 30, 0, 1, ease))} />
          </g>
        </g>
      )}
    </g>
  );
});

export function Badges({ frame }: { frame: number }) {
  return (
    <g data-scene="badges">
      <Trio f={frame - S.start} />
    </g>
  );
}
