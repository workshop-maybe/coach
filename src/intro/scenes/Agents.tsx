// Scene 1, "Your agents answer in seconds": your setup inks itself on, and reply records
// fly out of it faster and faster into a pile nobody has read.

import { ReplyRecord } from "../pieces/ReplyRecord";
import { Setup } from "../pieces/Setup";
import { at, ease, rand, tween } from "../pieces/motion";
import { REPLY_FRAMES } from "../timeline";
import { ANGLES_BEFORE, YOU, scene } from "./stage";

const S = scene("agents");
const REC = { w: 132, h: 96, scale: 1.25 };

/** Where each reply lands in the pile. */
const PILE = REPLY_FRAMES.map((frame, i) => ({
  frame,
  x: 1150 + (i % 4) * 150 + (rand(i * 3) - 0.5) * 80,
  y: 920 - Math.floor(i / 4) * 62 + (rand(i * 7) - 0.5) * 44,
  rot: (rand(i * 11) - 0.5) * 34,
}));

/** The replies leave from the setup's slot. */
const FROM = { x: YOU.agents.x + 234 * YOU.agents.s, y: YOU.agents.y + 18 * YOU.agents.s };

/** The pile of replies. `away` 0-1 clears it off the board. */
export function Pile({ frame, away = 0 }: { frame: number; away?: number }) {
  if (away >= 1) return null;
  return (
    <g opacity={1 - away}>
      {PILE.map((r, i) => {
        const t = tween(frame, S.start + r.frame, S.start + r.frame + 16);
        if (t <= 0) return null;
        const x = FROM.x + (r.x - FROM.x) * t;
        const y = FROM.y + (r.y - FROM.y) * t - Math.sin(t * Math.PI) * 90 + away * away * 240 * (0.6 + rand(i * 5));
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${r.rot * t + away * (rand(i) - 0.5) * 40}) scale(${REC.scale}) translate(${-REC.w / 2} ${-REC.h / 2})`}>
            <ReplyRecord w={REC.w} h={REC.h} seed={i + 1} />
          </g>
        );
      })}
    </g>
  );
}

export function Agents({ frame }: { frame: number }) {
  const f = frame - S.start;
  const draw = tween(f, 6, 52, 0, 1, ease);
  const busy = f > 46 && f < 210 ? 1 : tween(f, 210, 236, 1, 0);
  const name = 1 - tween(f, 214, 238, 0, 1, ease);
  return (
    <g data-scene="agents">
      <Pile frame={frame} />
      <g transform={at(YOU.agents)}>
        <Setup draw={draw} busy={busy} frame={frame} angles={ANGLES_BEFORE} lines={[{ text: "you", data: true, opacity: name }]} />
      </g>
    </g>
  );
}
