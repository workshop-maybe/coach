// A credential cartridge that inks itself on. While it draws, its strokes follow the
// shell and window from the shared cast; once drawn it is the cast's own CartridgeArt.
// A written line can sit in the label window, revealed a character at a time.

import { CARTRIDGE_W, CartridgeArt, SHELL, WINDOW } from "../../cast/cartridgeArt";
import { INK, INK_FINE, sketchRect } from "../../cast/InkDefs";
import { clamp, inked } from "./motion";

export interface IntroCartridgeProps {
  x?: number;
  y?: number;
  /** Rendered width in the stage's units. */
  w?: number;
  /** 0-1: how much of the shell is inked on. */
  draw?: number;
  fine?: boolean;
  /** A line written on the label, one entry per row. */
  line?: readonly string[];
  /** How many of the line's characters are written so far. Defaults to all. */
  written?: number;
}

const WRITE = { size: 10.5, lh: 15, inset: 7 };

export function IntroCartridge({ x = 0, y = 0, w = CARTRIDGE_W, draw = 1, fine = false, line, written }: IntroCartridgeProps) {
  const k = w / CARTRIDGE_W;
  const win = `M${WINDOW.x} ${WINDOW.y}h${WINDOW.size}v${WINDOW.size}h-${WINDOW.size}Z`;
  let left = written ?? Infinity;
  const rows = (line ?? []).map((row) => {
    const shown = row.slice(0, Math.max(0, left));
    left -= row.length;
    return shown;
  });
  const top = WINDOW.y + (WINDOW.size - rows.length * WRITE.lh) / 2 + WRITE.size;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`} className="cast" data-piece="cartridge">
      {draw >= 1 ? (
        <CartridgeArt src={null} fine={fine} />
      ) : (
        <g filter={fine ? INK_FINE : INK} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d={SHELL} className="cast-paper" stroke="none" opacity={clamp(draw * 3)} />
          <path d={SHELL} strokeWidth={fine ? 1.9 : 2.6} {...inked(draw)} />
          <path d="M13 9H95.5L108.5 22" strokeWidth={(fine ? 1.1 : 1.4) * 0.8} opacity="0.35" {...inked(draw)} />
          <path d="M26 14.5H58M26 19H58M26 23.5H58" strokeWidth={1.4} {...inked(draw)} />
          <path d={win} className="cast-glass" stroke="none" opacity={clamp(draw * 3)} />
          <path d={sketchRect(WINDOW.x, WINDOW.y, WINDOW.size, WINDOW.size, 1.8, 0.4)} strokeWidth={1.7} {...inked(draw)} />
          <path d="M30 124V131M40 124V131M50 124V131M60 124V131M70 124V131M80 124V131M90 124V131" strokeWidth={1.4} {...inked(draw)} />
        </g>
      )}
      {line && draw >= 1 && (
        <g>
          {/* The written label covers the empty label's dashed ring. */}
          <rect x={WINDOW.x + 3} y={WINDOW.y + 3} width={WINDOW.size - 6} height={WINDOW.size - 6} className="cast-glass" />
          <text fontFamily="var(--font-mono)" fontSize={WRITE.size} fill="currentColor">
            {rows.map((row, i) => (
              <tspan key={i} x={WINDOW.x + WRITE.inset} y={top + i * WRITE.lh}>
                {row}
              </tspan>
            ))}
          </text>
        </g>
      )}
    </g>
  );
}
