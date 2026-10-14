// A credential cartridge's drawing, with no data behind it (KTD1): the shell, its label
// window and the badge art passed in as a data URI. It imports only the ink, so the intro
// and any render outside the app shell can draw a cartridge without a folder.

import { INK, INK_FINE, sketchRect } from "./InkDefs";

/** The cartridge's drawing space. */
export const CARTRIDGE_W = 120;
export const CARTRIDGE_H = 140;

// The shell, chamfered at the top right, with a key notch in the left side.
export const SHELL = "M10 6H97L112 21V134H10V112H15V100H10Z";
export const WINDOW = { x: 19, y: 30, size: 82 };

/** The cartridge as SVG content, for its own svg or for a machine's slot. `src` is the badge data URI. */
export function CartridgeArt({ src, fine = false }: { src: string | null; fine?: boolean }) {
  const stroke = fine ? 1.9 : 2.6;
  const detail = fine ? 1.1 : 1.4;
  const inset = 3;
  return (
    <g className="cast-cartridge-art">
      <g filter={fine ? INK_FINE : INK} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d={SHELL} className="cast-paper" stroke="none" />
        <path d={SHELL} strokeWidth={stroke} />
        <path d="M13 9H95.5L108.5 22" strokeWidth={detail * 0.8} opacity="0.35" />
        {/* Grip ridges. */}
        <path d="M26 14.5H58M26 19H58M26 23.5H58" strokeWidth={detail} />
        {/* The label window. */}
        <path d={`M${WINDOW.x} ${WINDOW.y}h${WINDOW.size}v${WINDOW.size}h-${WINDOW.size}Z`} className="cast-glass" stroke="none" />
        <path d={sketchRect(WINDOW.x, WINDOW.y, WINDOW.size, WINDOW.size, 1.8, 0.4)} strokeWidth={detail + 0.3} />
        {/* Contacts, on the edge that goes into the slot. */}
        <path d="M30 124V131M40 124V131M50 124V131M60 124V131M70 124V131M80 124V131M90 124V131" strokeWidth={detail} />
      </g>
      {src ? (
        <image
          className="cast-label"
          href={src}
          x={WINDOW.x + inset}
          y={WINDOW.y + inset}
          width={WINDOW.size - inset * 2}
          height={WINDOW.size - inset * 2}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <circle className="cast-label-empty" cx={WINDOW.x + WINDOW.size / 2} cy={WINDOW.y + WINDOW.size / 2} r={WINDOW.size / 2 - inset * 2} fill="none" stroke="currentColor" strokeWidth={detail} strokeDasharray="2 4" opacity="0.4" />
      )}
    </g>
  );
}
