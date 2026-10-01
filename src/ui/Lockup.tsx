// The Andamio lockup, hand-inked like the cast: a scaffold drawn as an A (andamio is
// scaffold), then the name lettered in the same line. Orange stays in the logo, on the
// scaffold's brace. Drawn light only, so one variant. Needs InkDefs mounted, as the
// shell and the first-run gate both do.

import { INK } from "../cast/InkDefs";

/** A bowl as a pen draws it: one loop that runs a little past where it started. */
function loop(cx: number, cy: number, r: number): string {
  return `M${cx + r * 0.2} ${cy - r}A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.1}A${r} ${r} 0 0 0 ${cx - r * 0.1} ${cy - r * 1.02}`;
}

/** A shoulder from a stem at x to a stem at x + w, as n and m draw it. */
function arch(x: number, w: number): string {
  return `M${x} 30C${x} 23 ${x + w * 0.25} 20.5 ${x + w / 2} 20.5C${x + w * 0.78} 20.5 ${x + w} 23 ${x + w} 30V40.6`;
}

// The letters sit on a baseline at y 40 with an x-height of 20.
const NAME = [
  loop(66, 30.5, 9.5), "M76 20.4V40.6", // a
  "M84 20.4V40.6", arch(84, 18), // n
  loop(118, 30.5, 9.5), "M128 7.6V40.6", // d
  loop(144, 30.5, 9.5), "M154 20.4V40.6", // a
  "M162 20.4V40.6", arch(162, 15), arch(177, 15), // m
  "M200 20.4V40.6", // i
  loop(216, 30.5, 9.5), // o
].join("");

// The scaffold: two standards leaning into a peak, two ledgers that run past them the
// way scaffold tubes do, and a base plank.
const FRAME = "M5 43.5L22.6 5.2M39.5 43.2L21.4 5.6M7.5 31.2L37 30.6M13.2 18.6L31.4 18.2M1.5 44.2L43 43.6";
/** The brace across the lower bay, in orange. */
const BRACE = "M10.6 41.5L29.4 31.6";

export function Lockup({ className }: { className?: string }) {
  return (
    <svg
      className={`lockup ${className ?? ""}`.trim()}
      viewBox="-2 0 232 48"
      role="img"
      aria-label="Andamio"
      focusable="false"
    >
      <g filter={INK} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="lockup-ink" d={FRAME} strokeWidth={3.4} />
        <path className="lockup-brace" d={BRACE} strokeWidth={3.4} />
        <path className="lockup-ink" d={NAME} strokeWidth={3.6} />
        <circle className="lockup-dot" cx={200} cy={12} r={2.6} />
      </g>
    </svg>
  );
}
