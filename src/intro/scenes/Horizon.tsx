// Scene 5, "Other people are out there testing too": the camera pulls back from your
// setups to other people's, each inking on, taking a badge, linking up with the others
// and earning checks. The film holds its last frame as the sheet arrives.

import { Setup } from "../pieces/Setup";
import { drop, ease, inked, rand, tween } from "../pieces/motion";
import { Trio } from "./Badges";
import { scene } from "./stage";

const S = scene("horizon");
const BADGES = scene("badges");

/** The camera pulls back around your setups' centre, from the full shot to a small group. */
const CENTRE = { x: 960, y: 680 };
const PULL = { from: 10, to: 82, scale: 0.3 };
const SMALL = 0.42;

// Other people's setups, by their centres on the board.
const OTHERS = [
  [190, 430], [470, 410], [760, 440], [1160, 430], [1450, 410], [1740, 440],
  [180, 670], [460, 690], [1470, 690], [1750, 670],
  [300, 905], [620, 920], [960, 900], [1300, 920], [1620, 905],
].map(([x, y], i) => ({
  x,
  y,
  at: 20 + i * 7 + Math.round(rand(i * 5) * 10),
  passes: rand(i * 13) > 0.4,
  angles: [rand(i) * 200 - 100, rand(i + 9) * 200 - 100, rand(i + 4) * 200 - 100],
}));

/** -1 is your group in the middle. */
const LINKS: readonly [number, number][] = [
  [0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [8, 9], [10, 11], [11, 12], [12, 13], [13, 14],
  [0, 6], [5, 9], [7, 11], [8, 13], [2, -1], [3, -1], [7, -1], [8, -1], [12, -1],
];

const point = (i: number) => (i < 0 ? CENTRE : OTHERS[i]);

export function Horizon({ frame }: { frame: number }) {
  const f = frame - S.start;
  const pull = tween(f, PULL.from, PULL.to, 0, 1, ease);
  const scale = 1 - pull * (1 - PULL.scale);
  return (
    <g data-scene="horizon">
      {LINKS.map(([a, b], i) => {
        const A = point(a);
        const B = point(b);
        const d = tween(f, 100 + i * 5, 142 + i * 5, 0, 1, ease);
        if (d <= 0) return null;
        return <path key={i} d={`M${A.x} ${A.y}L${A.x + (B.x - A.x) * d} ${A.y + (B.y - A.y) * d}`} stroke="var(--ink-muted)" strokeWidth={1.6} strokeDasharray="6 8" fill="none" />;
      })}
      {OTHERS.map((o, i) => {
        const d = tween(f, o.at, o.at + 40, 0, 1, ease);
        if (d <= 0) return null;
        const seat = f > o.at + 40 ? tween(f, o.at + 46, o.at + 70, 0, 1, drop) : -1;
        const pass = o.passes ? tween(f, 160 + i * 4, 180 + i * 4) : 0;
        return (
          <g key={i} transform={`translate(${o.x - 160 * SMALL} ${o.y - 100 * SMALL}) scale(${SMALL})`}>
            <Setup draw={d} fine angles={o.angles} seat={seat} seatDraw={Math.min(1, Math.max(0, seat) * 2.5)} lit={Math.round(pass * 5)} />
            {pass > 0 && <path d="M118 -40l14 14 26 -30" stroke="var(--good)" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" {...inked(pass)} />}
          </g>
        );
      })}
      <g transform={`translate(${CENTRE.x} ${CENTRE.y}) scale(${scale}) translate(${-CENTRE.x} ${-CENTRE.y})`}>
        <Trio f={BADGES.length - 1} choice={1 - tween(f, 0, 24, 0, 1, ease)} />
      </g>
    </g>
  );
}
