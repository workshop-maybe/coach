// The handoff box (R9, R10, KTD9): the third piece of the cast, between the badge and
// the agent. A hand-inked box with an input on top that holds the badge's cartridge, a
// small screen showing the lit handoff's first lines, a row of lettered pattern keys (the
// skeleton's, then one per handoff) and a print slot that prints the handoff as a record
// card. Decorative to assistive tech: the real choice is made with buttons beside it.

import type { Collection, Credential } from "../domain/types";
import { useBadgeSrc } from "../ui/Badge";
import { CARTRIDGE_H, CARTRIDGE_W, CartridgeArt } from "./Cartridge";
import { INK, INK_FINE, sketchRect } from "./InkDefs";
import { boxKeyPlace, boxKeys, boxRows, boxScreen, type BoxAsk, type BoxKey, type HandoffKey } from "./mappings";

/** The handoff card's drawing space: a square record card with a header bar. */
export const CARD_W = 64;
export const CARD_H = 48;
/** The card's edge and its header bar, inside its drawing space. */
export const CARD = { x: 3, y: 3, w: 58, h: 42, bar: 11 };

/** The printed handoff as SVG content, for the box's print slot or an agent's slot. */
export function HandoffCardArt({ label, fine = false }: { label?: string; fine?: boolean }) {
  const c = CARD;
  const stroke = fine ? 1.6 : 2;
  const detail = fine ? 1 : 1.3;
  return (
    <g className="cast-card-art">
      <g filter={fine ? INK_FINE : INK} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <rect x={c.x} y={c.y} width={c.w} height={c.h} className="cast-paper" stroke="none" />
        {/* The header bar, in ink, as the app's record cards wear it. */}
        <rect x={c.x} y={c.y} width={c.w} height={c.bar} fill="currentColor" stroke="none" />
        <path d={sketchRect(c.x, c.y, c.w, c.h, 1.4, 0.3)} strokeWidth={stroke} />
        {/* Lines of the handoff, too small to read. */}
        <path d={`M${c.x + 7} ${c.y + 19}H${c.x + c.w - 9}M${c.x + 7} ${c.y + 26}H${c.x + c.w - 15}M${c.x + 7} ${c.y + 33}H${c.x + c.w - 22}`} strokeWidth={detail} opacity="0.6" />
      </g>
      {label && (
        <text x={c.x + 6} y={c.y + c.bar / 2} fontSize={8} dominantBaseline="central" className="cast-card-label">
          {label}
        </text>
      )}
    </g>
  );
}

export interface HandoffBoxProps {
  /** The badge plugged into the box's input. */
  badge: { collection: Collection; credential: Pick<Credential, "slug" | "name"> } | null;
  /** The box's keys, the skeleton's first (`handoffKeys` in mappings.ts). */
  keys: readonly HandoffKey[];
  /** The id of the lit key, or null while the box asks or nothing is picked. */
  lit: string | null;
  /** The two keys the test offers when an agent's winner is not the badge default (R11). */
  ask?: BoxAsk | null;
  /** The lit handoff's text. The screen shows its first lines. */
  screen: string;
  /** Rendered width in pixels. The height follows the drawing. */
  width?: number;
  className?: string;
}

/** The box's drawing, in viewBox units. The case grows a row at a time with the keys. */
export const BOX = {
  w: 300,
  headroom: 52,
  stroke: 2.5,
  detail: 1.4,
  case: { x: 10, y: 20, w: 280, top: 92 },
  input: { x: 32, y: 10, w: 80, h: 10 },
  print: { x: 186, y: 12, w: 88, h: 8 },
  bezel: { x: 24, y: 34, w: 150, h: 56 },
  glass: { x: 30, y: 40, w: 138, h: 44 },
  text: { x: 36, y: 54, lh: 12, size: 8 },
  rollers: [214, 246].map((cx) => ({ cx, cy: 50, r: 9 })),
  keys: { x: 24, y: 104, size: 22, pitch: 32, row: 36 },
  /** The cartridge's scale in the input, and the printed card's in the print slot. */
  cartridge: 0.56,
  card: 1,
};

/** The case's height for `rows` rows of keys. */
function caseHeight(rows: number): number {
  return BOX.case.top + rows * BOX.keys.row;
}

export function HandoffBox({ badge, keys, lit, ask = null, screen, width = 280, className }: HandoffBoxProps) {
  const drawn = boxKeys(keys, { lit, ask });
  const ch = caseHeight(boxRows(keys.length));
  const h = BOX.case.y + ch + 6;
  const room = BOX.headroom;
  const label = drawn.find((k) => k.state === "lit")?.label;

  return (
    <svg
      className={`cast cast-handoff-box${className ? ` ${className}` : ""}`}
      viewBox={`0 ${-room} ${BOX.w} ${h + room}`}
      width={width}
      height={(width * (h + room)) / BOX.w}
      aria-hidden="true"
      focusable="false"
    >
      {/* Drawn under the case, so what sits in the input and the print slot goes into it. */}
      {badge && <Input collection={badge.collection} credential={badge.credential} />}
      <Printed label={label} />

      <g filter={INK} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <Body caseH={ch} />
      </g>

      <g className="cast-handoff-keys">
        {drawn.map((k, i) => (
          <Key key={k.id} k={k} index={i} />
        ))}
      </g>

      <Screen lines={boxScreen(screen)} />
    </svg>
  );
}

/** The still parts: case, input, print slot, screen bezel and the print rollers. */
function Body({ caseH }: { caseH: number }) {
  const c = BOX.case;
  return (
    <>
      <rect x={c.x} y={c.y} width={c.w} height={caseH} className="cast-paper" stroke="none" />
      <path d={sketchRect(c.x, c.y, c.w, caseH, 3)} strokeWidth={BOX.stroke} />
      <path d={sketchRect(c.x + 1.2, c.y + 0.8, c.w - 1.6, caseH - 1.2, 0, 0.8)} strokeWidth={BOX.detail * 0.7} opacity="0.3" />
      <path d={`M${c.x + 6} ${c.y + caseH + BOX.stroke + 1.5}H${c.x + c.w - 6}`} strokeWidth={BOX.detail} />

      {[BOX.input, BOX.print].map((s) => (
        <g key={s.x}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h + 1} className="cast-paper" stroke="none" />
          <path d={`M${s.x} ${s.y + s.h + 0.5}V${s.y}H${s.x + s.w}V${s.y + s.h + 0.5}`} strokeWidth={BOX.stroke * 0.9} />
          <path d={`M${s.x + 7} ${s.y + s.h / 2 + 0.5}H${s.x + s.w - 7}`} strokeWidth={3.4} />
        </g>
      ))}

      <path d={sketchRect(BOX.bezel.x, BOX.bezel.y, BOX.bezel.w, BOX.bezel.h, 2)} strokeWidth={BOX.stroke * 0.9} />
      <rect x={BOX.glass.x} y={BOX.glass.y} width={BOX.glass.w} height={BOX.glass.h} className="cast-glass" strokeWidth={BOX.detail} />

      {/* The rollers under the print slot, and the paper path between them. */}
      {BOX.rollers.map(({ cx, cy, r }) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r={r} className="cast-paper" strokeWidth={BOX.stroke * 0.8} />
          <circle cx={cx} cy={cy} r={2} fill="currentColor" stroke="none" />
        </g>
      ))}
      <path d={`M${BOX.rollers[0].cx} ${BOX.rollers[0].cy - BOX.rollers[0].r - 4}H${BOX.rollers[1].cx}`} strokeWidth={BOX.detail} opacity="0.5" />

      {/* The rail over the keys. */}
      <path d={`M${c.x + 12} ${BOX.keys.y - 10}H${c.x + c.w - 12}`} strokeWidth={BOX.detail * 0.8} opacity="0.5" />
    </>
  );
}

/** One lettered pattern key: lit in ink with its light on, or marked when the test asks. */
function Key({ k, index }: { k: BoxKey; index: number }) {
  const { row, col } = boxKeyPlace(index);
  const s = BOX.keys.size;
  const x = BOX.keys.x + col * BOX.keys.pitch;
  const y = BOX.keys.y + row * BOX.keys.row;
  const lit = k.state === "lit";
  const cx = x + s / 2;
  const below = y + s + 4;
  return (
    <g data-handoff-key={k.id} data-key-state={k.state} data-mark={k.mark ?? undefined}>
      <g className={`cast-handoff-key cast-handoff-key-${k.state}`} filter={INK} stroke="currentColor" strokeLinejoin="round" strokeLinecap="round">
        <rect x={x} y={y} width={s} height={s} className={lit ? undefined : "cast-paper"} fill={lit ? "currentColor" : undefined} strokeWidth={BOX.stroke * 0.8} />
        {lit && <rect className="cast-handoff-led" x={cx - 5} y={y - 6} width={10} height={3} stroke="none" />}
        {k.mark === "winner" && <path className="cast-handoff-mark" d={`M${cx} ${below}l4 6h-8Z`} fill="currentColor" strokeWidth={1} />}
        {k.mark === "default" && <rect className="cast-handoff-mark" x={cx - 6} y={below + 2} width={12} height={2.4} fill="currentColor" stroke="none" />}
      </g>
      <text x={cx} y={y + s / 2} fontSize={11} textAnchor="middle" dominantBaseline="central" className={`cast-handoff-label${lit ? " cast-handoff-label-lit" : ""}`}>
        {k.label}
      </text>
    </g>
  );
}

/** The screen's lines. Outside every filter, so they stay legible. */
function Screen({ lines }: { lines: string[] }) {
  const { x, y, lh, size } = BOX.text;
  return (
    <g className="cast-handoff-screen" fill="currentColor">
      {lines.map((line, i) => (
        <text key={i} x={x} y={y + i * lh} fontSize={size} className="cast-screen-text">
          {line}
        </text>
      ))}
    </g>
  );
}

/** The badge's cartridge in the input, its contacts hidden inside the case. */
function Input({ collection, credential }: { collection: Collection; credential: Pick<Credential, "slug" | "name"> }) {
  const src = useBadgeSrc(collection, credential);
  const scale = BOX.cartridge;
  const s = BOX.input;
  const x = s.x + s.w / 2 - (CARTRIDGE_W * scale) / 2;
  const y = BOX.case.y + 10 - CARTRIDGE_H * scale;
  return (
    <g className="cast-handoff-input">
      <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale})`}>
        <CartridgeArt src={src} />
      </g>
    </g>
  );
}

/**
 * The printed card, standing out of the print slot. Hidden until the box prints
 * (`.cast-printing`); the outer group carries the motion, the inner one its place.
 */
function Printed({ label }: { label?: string }) {
  const s = BOX.print;
  const scale = BOX.card;
  const x = s.x + s.w / 2 - (CARD_W * scale) / 2;
  const y = BOX.case.y + 8 - CARD_H * scale;
  return (
    <g className="cast-print-motion">
      <g className="cast-print-card" transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale})`}>
        <HandoffCardArt label={label} />
      </g>
    </g>
  );
}
