// The Coach lockup: the mark, then the name lettered by hand like the cast. The mark is an
// agent's machine in a ring, drawn in clean lines: a clipboard clip on top, a prompt on the
// screen, two encoders and a strip of keys with one lit. Orange stays in the logo, on the
// clip, the prompt and the lit key. src-tauri/icons/icon.svg draws the same mark. Drawn
// light only, so one variant. Needs InkDefs mounted, as the shell and the first-run gate
// both do.
import { INK } from "../cast/InkDefs";

/** A bowl as a pen draws it: one loop that runs a little past where it started. */
function loop(cx: number, cy: number, r: number): string {
  return `M${cx + r * 0.2} ${cy - r}A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.1}A${r} ${r} 0 0 0 ${cx - r * 0.1} ${cy - r * 1.02}`;
}

/** An open bowl, a c: the loop's stroke stopped short of closing on the right. */
function cup(cx: number, cy: number, r: number): string {
  return `M${cx + r * 0.75} ${cy - r * 0.62}A${r} ${r} 0 1 0 ${cx + r * 0.78} ${cy + r * 0.6}`;
}

/** A shoulder from a stem at x to a stem at x + w, as n and m draw it. */
function arch(x: number, w: number): string {
  return `M${x} 30C${x} 23 ${x + w * 0.25} 20.5 ${x + w / 2} 20.5C${x + w * 0.78} 20.5 ${x + w} 23 ${x + w} 30V40.6`;
}

// The letters sit on a baseline at y 40 with an x-height of 20.
const NAME = [
  cup(66, 30.5, 9.5), // c
  loop(89, 30.5, 9.5), // o
  loop(114.5, 30.5, 9.5), "M124.5 20.4V40.6", // a
  cup(141, 30.5, 9.5), // c
  "M156 7.6V40.6", arch(156, 17), // h
].join("");

/** The mark's ink and orange, on a 100 × 100 grid. `w` and `d` are the ring's and the details' stroke. */
export function markPaths(w: number, d: number): { ink: [string, number][]; accent: [string, number][] } {
  const knob = (cx: number, deg: number) => {
    const t = (deg * Math.PI) / 180;
    const r = 4.6;
    return `M${cx - r} 50.5a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0M${cx} 50.5L${(cx + Math.sin(t) * 3.4).toFixed(2)} ${(50.5 - Math.cos(t) * 3.4).toFixed(2)}`;
  };
  const key = (i: number) => `M${26 + i * 8.6} 62H${30.2 + i * 8.6}`;
  return {
    ink: [
      ["M5 50a45 45 0 1 0 90 0a45 45 0 1 0 -90 0", w],
      ["M20 38H80V68H20Z", w],
      ["M26 44H50V57H26Z", d],
      [knob(62, -40) + knob(73.5, 35), d],
      [[0, 1, 2, 3, 5].map(key).join(""), d],
    ],
    accent: [
      ["M41 38V32.5H59V38", w],
      ["M45 32.5V29H55V32.5", d],
      ["M30.5 47L35 50.5L30.5 54M38 54H45", d],
      [key(4), w],
    ],
  };
}

/** The mark at lockup weight, a little heavier than the icon's since it shows at about 22px. */
const MARK = markPaths(4.8, 3.4);

export function Lockup({ className }: { className?: string }) {
  return (
    <svg
      className={`lockup ${className ?? ""}`.trim()}
      viewBox="-1 0 178 48"
      role="img"
      aria-label="Coach"
      focusable="false"
    >
      <g className="lockup-mark" transform="scale(0.48)" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle className="lockup-disk" cx={50} cy={50} r={45} />
        {MARK.ink.map(([d, w]) => <path key={d} className="lockup-ink" d={d} strokeWidth={w} />)}
        {MARK.accent.map(([d, w]) => <path key={d} className="lockup-accent" d={d} strokeWidth={w} />)}
      </g>
      <g filter={INK} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="lockup-ink" d={NAME} strokeWidth={3.6} />
      </g>
    </svg>
  );
}
