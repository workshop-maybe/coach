// An agent setup that inks itself on: the cast's case with its screen, three encoders, a
// slot on top and a strip of keys, in the same 320x186 drawing space as the full
// machine in src/cast (its numbers copied here so the intro stays a leaf, KTD1).

import { INK, INK_FINE, sketchRect } from "../../cast/InkDefs";
import { IntroCartridge } from "./IntroCartridge";
import { clamp, inked, part } from "./motion";

export const SETUP_W = 320;
export const SETUP_H = 186;

const CASE = { x: 10, y: 26, w: 300, h: 150 };
/** The encoders' centres. */
export const ENCODERS = [194, 238, 282].map((cx) => ({ cx, cy: 64 }));
const KNOB = 16;
const KEYS = 16;
const keyX = (i: number) => 22 + i * ((276 - 14) / 15);

/** Where a seated cartridge sits, in the setup's space: dropped from `y` 0 to 1. */
export const SEAT = { x: 204, y: -70, drop: 66, w: 60 };

export interface ScreenLine {
  text: string;
  /** 0-1. */
  opacity?: number;
  /** Lit in data blue, as the value the view is about. */
  data?: boolean;
}

export interface SetupProps {
  /** 0-1: how much of the case is inked on. */
  draw?: number;
  /** 0-1: the screen's sending dots. */
  busy?: number;
  /** The three encoders' angles, in degrees from twelve o'clock. */
  angles?: readonly number[];
  /** How many keys are lit. */
  lit?: number;
  /** 0-1: a cartridge dropping into the slot. Below 0, the slot is empty. */
  seat?: number;
  /** The seated cartridge's written line. */
  label?: readonly string[];
  /** 0-1: how much of the seated cartridge is inked on. */
  seatDraw?: number;
  lines?: readonly ScreenLine[];
  fine?: boolean;
  /** The film's frame, for the sending dots. */
  frame?: number;
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [cx + Math.sin(t) * r, cy - Math.cos(t) * r];
}

function tick(cx: number, cy: number, r1: number, r2: number, deg: number): string {
  const [x1, y1] = polar(cx, cy, r1, deg);
  const [x2, y2] = polar(cx, cy, r2, deg);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** An arc around an encoder from one angle to another, as a hand turning it leaves. */
export function turnArc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function Setup({ draw = 1, busy = 0, angles = [-60, 20, 90], lit = 0, seat = -1, label, seatDraw = 1, lines = [], fine = false, frame = 0 }: SetupProps) {
  const ink = fine ? INK_FINE : INK;
  const s = fine ? 1.4 : 1;
  const c = CASE;
  return (
    <g className="cast" data-piece="setup">
      {seat >= 0 && <IntroCartridge x={SEAT.x} y={SEAT.y + seat * SEAT.drop} w={SEAT.w} draw={seatDraw} fine line={label} />}
      <g filter={ink} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <rect x={c.x} y={c.y} width={c.w} height={c.h} className="cast-paper" stroke="none" opacity={part(draw, 0, 4)} />
        <path d={sketchRect(c.x, c.y, c.w, c.h, 3)} strokeWidth={2.5 * s} {...inked(part(draw, 0, 4))} />
        <path d={sketchRect(c.x + 1.2, c.y + 0.8, c.w - 1.6, c.h - 1.2, 0, 0.8)} strokeWidth={1} opacity="0.3" {...inked(part(draw, 1, 4))} />
        <path d={`M${c.x + 6} ${c.y + c.h + 4}H${c.x + c.w - 6}`} strokeWidth={1.4 * s} {...inked(part(draw, 1, 4))} />
        {/* The slot. */}
        <rect x={184} y={16} width={100} height={11} className="cast-paper" stroke="none" opacity={clamp(draw * 3)} />
        <path d="M184 26.5V16H284V26.5" strokeWidth={2.25 * s} {...inked(part(draw, 1, 4))} />
        <path d="M191 21.5H277" strokeWidth={3.4} {...inked(part(draw, 2, 4))} />
        {/* The screen. */}
        <path d={sketchRect(24, 40, 136, 70, 2)} strokeWidth={2.25 * s} {...inked(part(draw, 2, 4))} />
        <rect x={31} y={47} width={122} height={56} className="cast-glass" strokeWidth={1.4} fillOpacity={part(draw, 2, 4)} {...inked(part(draw, 2, 4))} />
        {/* Run and stop. */}
        <path d={sketchRect(180, 94, 18, 16, 1.2, 0.4) + "M186.5 98.5L193 102L186.5 105.5Z"} strokeWidth={1.6 * s} {...inked(part(draw, 3, 4))} />
        <path d={sketchRect(206, 94, 18, 16, 1.2, 0.4) + "M211.5 98.5h7v7h-7Z"} strokeWidth={1.6 * s} {...inked(part(draw, 3, 4))} />
        <path d="M22 126H298" strokeWidth={1.1} opacity="0.5" {...inked(part(draw, 3, 4))} />
        {Array.from({ length: KEYS }, (_, i) => (
          <g key={i} opacity={clamp(part(draw, 3, 4) * 2 - i / KEYS)}>
            <path d={sketchRect(keyX(i), 142, 14, 18, 0.8, 0.3)} strokeWidth={1.4 * s} />
            {i < lit && <rect x={keyX(i) + 3} y={145} width={8} height={3} fill="var(--good)" stroke="none" data-lit="" />}
          </g>
        ))}
      </g>
      {ENCODERS.map(({ cx, cy }, i) => {
        const d = part(draw, 2 + i * 0.4, 4);
        return (
          <g key={cx} transform={`rotate(${(angles[i] ?? 0) * d} ${cx} ${cy})`} filter={ink} fill="none" stroke="currentColor" strokeLinecap="round" opacity={d > 0 ? 1 : 0}>
            <circle cx={cx} cy={cy} r={KNOB} className="cast-paper" strokeWidth={2.5 * s} {...inked(d)} />
            <path d={Array.from({ length: 24 }, (_, k) => tick(cx, cy, 13.4, KNOB, (k / 24) * 360)).join("")} strokeWidth={1.1} opacity={d} />
            <circle cx={cx} cy={cy} r={9.5} strokeWidth={1.4} {...inked(d)} />
            <path d={`M${cx} ${cy - 2}V${cy - 13}`} strokeWidth={2.8} {...inked(d)} />
          </g>
        );
      })}
      <g fontFamily="var(--font-mono)" fontSize="9" fill="currentColor" opacity={clamp(draw * 2 - 1)}>
        {lines.map((l, i) => (
          <text key={i} x={37} y={62 + i * 14} opacity={l.opacity ?? 1} fill={l.data ? "var(--data)" : undefined} xmlSpace="preserve">
            {l.text}
          </text>
        ))}
        {busy > 0 &&
          [0, 1, 2].map((k) => (
            <circle key={k} cx={40 + k * 9} cy={92} r={2.6} opacity={0.25 + 0.75 * (Math.sin(frame / 4 - k) * 0.5 + 0.5) * busy} />
          ))}
      </g>
    </g>
  );
}
