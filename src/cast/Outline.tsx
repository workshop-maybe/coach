// The empty things (R12): a dashed outline of what a door makes, an empty machine or
// an empty cartridge. Hand-inked like the rest of the cast, never with a badge.

import { INK, sketchRect } from "./InkDefs";

export interface OutlineProps {
  kind: "machine" | "cartridge";
  /** Rendered width in pixels. The height follows the drawing. */
  width?: number;
  className?: string;
}

const DASH = "7 6";

export function Outline({ kind, width, className }: OutlineProps) {
  const machine = kind === "machine";
  const [vw, vh] = machine ? [200, 112] : [120, 140];
  const w = width ?? (machine ? 120 : 72);
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
        {machine ? (
          <>
            <path d={sketchRect(6, 16, 188, 90, 2)} />
            <path d="M120 16.5V9H180V16.5" />
            <path d={sketchRect(16, 26, 100, 46, 1.4)} />
            <path d={sketchRect(130, 32, 18, 18, 0.8, 0.3)} strokeDasharray="4 4" />
            <path d={sketchRect(158, 32, 18, 18, 0.8, 0.3)} strokeDasharray="4 4" />
            <path d="M16 90H184" strokeDasharray="8 3.2" strokeWidth={6} opacity="0.5" />
          </>
        ) : (
          <>
            <path d="M10 6H97L112 21V134H10V112H15V100H10Z" />
            <path d="M26 16H58M26 22H58" />
            <path d={sketchRect(19, 30, 82, 82, 1.8, 0.4)} />
          </>
        )}
      </g>
    </svg>
  );
}
