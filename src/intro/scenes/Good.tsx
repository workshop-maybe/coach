// Scene 3, "Slow down. Say what good looks like": the pace drops, a cartridge inks itself
// on, one line is written on its label, and the cartridge seats into your setup's slot.

import { IntroCartridge } from "../pieces/IntroCartridge";
import { SEAT, Setup } from "../pieces/Setup";
import { at, between, drop, ease, tween } from "../pieces/motion";
import { judgmentAngles } from "./Judgment";
import { LINE, LINE_LENGTH, SETTINGS, YOU, scene } from "./stage";

const S = scene("good");

/** The cartridge, large on the board while its line is written. */
const WRITING = { x: 400, y: 420, s: 270 / 120 };
/** The cartridge held above your setup's slot, before it drops in. */
const HOVER = { x: YOU.good.x + SEAT.x * YOU.good.s, y: YOU.good.y + SEAT.y * YOU.good.s, s: (SEAT.w / 120) * YOU.good.s };

export const GOOD = {
  draw: [34, 100],
  write: [104, 152],
  fly: [184, 204],
  seat: [204, 220],
} as const;

const SET = judgmentAngles(Infinity);

export function Good({ frame }: { frame: number }) {
  const f = frame - S.start;
  const pose = between(YOU.judgment, YOU.good, tween(f, 4, 74, 0, 1, ease));
  const draw = tween(f, GOOD.draw[0], GOOD.draw[1], 0, 1, ease);
  const written = Math.round(LINE_LENGTH * tween(f, GOOD.write[0], GOOD.write[1], 0, 1, (t) => t));
  const fly = tween(f, GOOD.fly[0], GOOD.fly[1], 0, 1, ease);
  const seated = f >= GOOD.fly[1];
  const seat = seated ? tween(f, GOOD.seat[0], GOOD.seat[1], 0, 1, drop) : -1;
  const card = between(WRITING, HOVER, fly);
  return (
    <g data-scene="good">
      {!seated && draw > 0 && <IntroCartridge x={card.x} y={card.y} w={120 * card.s} draw={draw} fine={fly > 0.5} line={LINE} written={written} />}
      <g transform={at(pose)}>
        <Setup angles={SET} lines={SETTINGS.map((text) => ({ text }))} seat={seat} label={LINE} />
      </g>
    </g>
  );
}
