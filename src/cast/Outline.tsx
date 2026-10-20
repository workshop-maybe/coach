// The empty things (R12): a dashed outline of what a door makes, an empty machine, an
// empty cartridge or an empty handoff card. Hand-inked like the rest of the cast, never with a badge.
// A program reply with no body to draw shows the outline of a missing body (bounded programs R17).

import { CARTRIDGE_H, CARTRIDGE_W, SHELL, WINDOW } from "./Cartridge";
import { CARD, CARD_H, CARD_W } from "./HandoffBox";
import { INK, sketchRect } from "./InkDefs";
import { MINI } from "./Machine";

export interface OutlineProps {
  kind: "machine" | "cartridge" | "handoff" | "body";
  /** Rendered width in pixels. The height follows the drawing. */
  width?: number;
  className?: string;
}

const DASH = "7 6";

const SIZES = { machine: [MINI.w, MINI.h], cartridge: [CARTRIDGE_W, CARTRIDGE_H], handoff: [CARD_W, CARD_H], body: [160, 150] } as const;

/** A soft, lopsided body: a closed outline with a fold across it, drawn once by hand. */
const BODY = "M82 14C112 12 140 34 146 66C152 98 134 130 100 138C70 145 34 136 20 108C6 80 14 46 38 28C50 19 64 15 82 14Z";
const FOLD = "M44 70C60 60 78 62 92 72C104 80 118 80 128 72";

// Drawn from the pieces' own geometry, so an outline always matches what its door makes.
const c = MINI.case;
const s = MINI.slot;
const b = MINI.bezel;
const k = MINI.keys;

export function Outline({ kind, width, className }: OutlineProps) {
  const [vw, vh] = SIZES[kind];
  const w = width ?? (kind === "machine" ? 120 : kind === "cartridge" ? 72 : kind === "body" ? 160 : 64);
  return (
    <svg
      className={`cast cast-outline cast-outline-${kind}${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${vw} ${vh}`}
      width={w}
      height={(w * vh) / vw}
      aria-hidden="true"
      focusable="false"
      data-outline={kind}
    >
      <g filter={INK} fill="none" stroke="currentColor" strokeWidth={2.2} strokeDasharray={DASH} strokeLinecap="round" strokeLinejoin="round">
        {kind === "machine" ? (
          <>
            <path d={sketchRect(c.x, c.y, c.w, c.h, 2)} />
            <path d={`M${s.x} ${s.y + s.h + 0.5}V${s.y}H${s.x + s.w}V${s.y + s.h + 0.5}`} />
            <path d={sketchRect(b.x, b.y, b.w, b.h, 1.4)} />
            <path d={sketchRect(130, 32, 18, 18, 0.8, 0.3)} strokeDasharray="4 4" />
            <path d={sketchRect(158, 32, 18, 18, 0.8, 0.3)} strokeDasharray="4 4" />
            <path d={`M${k.x} ${Math.round(k.y + k.h / 2)}H${k.x + k.span}`} strokeDasharray="8 3.2" strokeWidth={6} opacity="0.5" />
          </>
        ) : kind === "body" ? (
          <>
            <path d={BODY} />
            <path d={FOLD} strokeDasharray="4 5" opacity="0.6" />
          </>
        ) : kind === "handoff" ? (
          <>
            <path d={sketchRect(CARD.x, CARD.y, CARD.w, CARD.h, 1.4, 0.3)} />
            <path d={`M${CARD.x} ${CARD.y + CARD.bar}H${CARD.x + CARD.w}`} />
          </>
        ) : (
          <>
            <path d={SHELL} />
            <path d="M26 16H58M26 22H58" />
            <path d={sketchRect(WINDOW.x, WINDOW.y, WINDOW.size, WINDOW.size, 1.8, 0.4)} />
          </>
        )}
      </g>
    </svg>
  );
}
