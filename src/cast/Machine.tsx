// An agent, drawn as a machine (R1, R2, KTD2): a compact hand-inked case with a small
// screen top left, three knurled encoders set by the agent's setup, a slot on top and a
// strip of trig keys along the bottom lit by what the agent earned. The `mini` variant
// drops the encoders and shows only the first sixteen keys. Decorative to assistive
// tech: the agent's name, setup and results stay in the text around it.

import type { MouseEvent } from "react";
import type { AgentSetup, Collection, Credential } from "../domain/types";
import { useBadgeSrc } from "../ui/Badge";
import { CARTRIDGE_H, CARTRIDGE_W, CartridgeArt } from "./Cartridge";
import { INK, INK_FINE, sketchRect } from "./InkDefs";
import { useKeyColors } from "./keyColors";
import { ENCODER_DIALS, KEYS_PER_PAGE, LISTED_ARC, encoderAngle, trigPages, type EncoderDial, type MachineKey, type ScreenState } from "./mappings";

export interface MachineProps {
  setup: AgentSetup;
  screen?: ScreenState;
  /** Earned keys, oldest first (`machineKeys` in mappings.ts). */
  keys?: readonly MachineKey[];
  /** The page of keys to show, from zero. Mini machines always show the first. */
  page?: number;
  /** Small, without encoders or paging, for rows and lists. */
  mini?: boolean;
  /** A credential loaded into the slot while a test runs (R5). */
  loaded?: { collection: Collection; credential: Pick<Credential, "slug" | "name"> } | null;
  /** Keep room above the case for a cartridge, so loading one does not move the layout. */
  headroom?: boolean;
  /** The id of a key that just lit, which plays its seating motion (R7). */
  seated?: string;
  /** Clicking an encoder turns it: +1, or -1 with Shift or Alt (R3). */
  onStep?(dial: EncoderDial, by: 1 | -1): void;
  /** Rendered width in pixels. The height follows the drawing. */
  width?: number;
  className?: string;
}

/** The full machine's drawing: case, screen, encoders, keys and slot, in viewBox units. */
const FULL = {
  w: 320,
  h: 186,
  headroom: 76,
  stroke: 2.5,
  detail: 1.4,
  case: { x: 10, y: 26, w: 300, h: 150 },
  slot: { x: 184, y: 16, w: 100, h: 10 },
  bezel: { x: 24, y: 40, w: 136, h: 70 },
  glass: { x: 31, y: 47, w: 122, h: 56 },
  text: { x: 37, y: 62, lh: 14, size: 9 },
  encoders: [194, 238, 282].map((cx) => ({ cx, cy: 64 })),
  knob: 16,
  keys: { x: 22, y: 142, w: 14, h: 18, span: 276 },
};

const MINI = {
  w: 200,
  h: 112,
  stroke: 1.8,
  detail: 1.1,
  case: { x: 6, y: 16, w: 188, h: 90 },
  slot: { x: 120, y: 9, w: 60, h: 7 },
  bezel: { x: 16, y: 26, w: 100, h: 46 },
  glass: { x: 21, y: 31, w: 90, h: 36 },
  text: { x: 25, y: 42, lh: 10, size: 7 },
  keys: { x: 16, y: 84, w: 8, h: 11, span: 168 },
};

type Geometry = typeof MINI;

/**
 * Where the full machine's key at `index` sits, in fractions of the drawing (no headroom),
 * with room above for a half-raised cap. Lets a view lay real controls over the keys.
 */
export function keyBox(index: number): { left: number; top: number; width: number; height: number } {
  const k = FULL.keys;
  const pitch = (k.span - k.w) / (KEYS_PER_PAGE - 1);
  const lift = Math.round(k.h * 0.3);
  return { left: (k.x + index * pitch) / FULL.w, top: (k.y - lift) / FULL.h, width: k.w / FULL.w, height: (k.h + lift) / FULL.h };
}

export function Machine({ setup, screen = { kind: "idle" }, keys = [], page = 0, mini = false, loaded = null, headroom = false, seated, onStep, width, className }: MachineProps) {
  const g: Geometry = mini ? MINI : FULL;
  const ink = mini ? INK_FINE : INK;
  const pages = trigPages(keys);
  const at = mini ? 0 : Math.min(Math.max(0, page), pages.length - 1);
  const shown = mini ? keys.slice(0, KEYS_PER_PAGE) : pages[at];
  const room = !mini && (headroom || !!loaded) ? FULL.headroom : 0;
  const w = width ?? (mini ? 120 : 320);

  return (
    <svg
      className={`cast cast-machine${mini ? " cast-machine-mini" : ""}${className ? ` ${className}` : ""}`}
      viewBox={`0 ${-room} ${g.w} ${g.h + room}`}
      width={w}
      height={(w * (g.h + room)) / g.w}
      aria-hidden="true"
      focusable="false"
      data-screen={screen.kind}
    >
      {!mini && loaded && <LoadedCartridge collection={loaded.collection} credential={loaded.credential} />}

      <g filter={ink} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <Body g={g} mini={mini} />
      </g>

      {!mini &&
        ENCODER_DIALS.map((dial, i) => (
          <Encoder key={dial} dial={dial} angle={encoderAngle(dial, setup)} {...FULL.encoders[i]} onStep={onStep} />
        ))}

      {!mini && <PageIndicator count={pages.length} at={at} />}

      <g className="cast-keys" data-page={at}>
        {Array.from({ length: KEYS_PER_PAGE }, (_, i) => (
          <Key key={shown[i]?.id ?? `off-${i}`} index={i} g={g} ink={ink} lit={shown[i]} seated={!!seated && shown[i]?.id === seated} />
        ))}
      </g>

      <Screen state={screen} g={g} />
    </svg>
  );
}

/** The still parts: case, slot, screen bezel, transport keys, the key strip's rails. */
function Body({ g, mini }: { g: Geometry; mini: boolean }) {
  const c = g.case;
  const s = g.slot;
  const k = g.keys;
  const pitch = (k.span - k.w) / (KEYS_PER_PAGE - 1);
  return (
    <>
      <rect x={c.x} y={c.y} width={c.w} height={c.h} className="cast-paper" stroke="none" />
      <path d={sketchRect(c.x, c.y, c.w, c.h, mini ? 1.8 : 3)} strokeWidth={g.stroke} />
      {/* A second, lighter pass, as a pen goes back over a line. */}
      <path d={sketchRect(c.x + 1.2, c.y + 0.8, c.w - 1.6, c.h - 1.2, 0, 0.8)} strokeWidth={g.detail * 0.7} opacity="0.3" />
      {/* The case's thickness, under its front edge. */}
      <path d={`M${c.x + 6} ${c.y + c.h + g.stroke + 1.5}H${c.x + c.w - 6}`} strokeWidth={g.detail} />

      {/* The slot on top, a lip with a dark slit. */}
      <rect x={s.x} y={s.y} width={s.w} height={s.h + 1} className="cast-paper" stroke="none" />
      <path d={`M${s.x} ${s.y + s.h + 0.5}V${s.y}H${s.x + s.w}V${s.y + s.h + 0.5}`} strokeWidth={g.stroke * 0.9} />
      <path d={`M${s.x + 7} ${s.y + s.h / 2 + 0.5}H${s.x + s.w - 7}`} strokeWidth={mini ? 2.2 : 3.4} />

      {/* The screen: a bezel around paper-white glass. */}
      <path d={sketchRect(g.bezel.x, g.bezel.y, g.bezel.w, g.bezel.h, mini ? 1.2 : 2)} strokeWidth={g.stroke * 0.9} />
      <rect x={g.glass.x} y={g.glass.y} width={g.glass.w} height={g.glass.h} className="cast-glass" strokeWidth={g.detail} />

      {/* Play and stop. */}
      {mini ? (
        <>
          <path d={sketchRect(128, 30, 14, 14, 0.8, 0.3)} strokeWidth={g.detail} />
          <path d="M133 33.5L138.5 37L133 40.5Z" strokeWidth={g.detail * 0.9} />
          <path d={sketchRect(150, 30, 14, 14, 0.8, 0.3)} strokeWidth={g.detail} />
          <path d="M154.5 34.5h5v5h-5Z" strokeWidth={g.detail * 0.9} />
        </>
      ) : (
        <>
          <path d={sketchRect(180, 94, 18, 16, 1.2, 0.4)} strokeWidth={g.detail + 0.2} />
          <path d="M186.5 98.5L193 102L186.5 105.5Z" strokeWidth={g.detail} />
          <path d={sketchRect(206, 94, 18, 16, 1.2, 0.4)} strokeWidth={g.detail + 0.2} />
          <path d="M211.5 98.5h7v7h-7Z" strokeWidth={g.detail} />
          {/* The encoders' sweep: an end stop at each side of each one. */}
          {FULL.encoders.map(({ cx, cy }) => (
            <path key={cx} d={sweepTicks(cx, cy)} strokeWidth={g.detail * 0.9} />
          ))}
          {/* The rail over the key strip. */}
          <path d={`M${c.x + 12} 126H${c.x + c.w - 12}`} strokeWidth={g.detail * 0.8} opacity="0.5" />
        </>
      )}

      {/* A tick over every fourth key, as the hardware groups its steps. */}
      <path
        d={[0, 4, 8, 12].map((i) => `M${k.x + i * pitch + k.w / 2} ${k.y - (mini ? 4 : 6)}v${mini ? 1.5 : 2.5}`).join("")}
        strokeWidth={g.detail}
      />
    </>
  );
}

/** End stops and midpoint for one encoder's listed sweep. */
function sweepTicks(cx: number, cy: number): string {
  const r1 = FULL.knob + 3;
  const r2 = FULL.knob + 6;
  return [LISTED_ARC.from, 0, LISTED_ARC.to]
    .map((deg) => {
      const t = (deg * Math.PI) / 180;
      const [sx, sy] = [Math.sin(t), -Math.cos(t)];
      return `M${(cx + sx * r1).toFixed(2)} ${(cy + sy * r1).toFixed(2)}L${(cx + sx * r2).toFixed(2)} ${(cy + sy * r2).toFixed(2)}`;
    })
    .join("");
}

interface EncoderProps {
  dial: EncoderDial;
  angle: number;
  cx: number;
  cy: number;
  onStep?(dial: EncoderDial, by: 1 | -1): void;
}

/** One knurled encoder. The whole knob turns, so it carries its own wobble. */
function Encoder({ dial, angle, cx, cy, onStep }: EncoderProps) {
  const r = FULL.knob;
  const knurl = Array.from({ length: 24 }, (_, i) => {
    const t = (i / 24) * Math.PI * 2;
    return `M${(cx + Math.sin(t) * (r - 2.6)).toFixed(2)} ${(cy - Math.cos(t) * (r - 2.6)).toFixed(2)}L${(cx + Math.sin(t) * r).toFixed(2)} ${(cy - Math.cos(t) * r).toFixed(2)}`;
  }).join("");
  const click = onStep ? (e: MouseEvent) => onStep(dial, e.shiftKey || e.altKey ? -1 : 1) : undefined;
  return (
    <g className={`cast-encoder${onStep ? " cast-encoder-live" : ""}`} data-dial={dial} data-angle={angle.toFixed(2)} onClick={click}>
      <g transform={`rotate(${angle.toFixed(2)} ${cx} ${cy})`} filter={INK} fill="none" stroke="currentColor" strokeLinecap="round">
        <circle cx={cx} cy={cy} r={r} className="cast-paper" strokeWidth={FULL.stroke} />
        <path d={knurl} strokeWidth={1.1} />
        <circle cx={cx} cy={cy} r={r - 6.5} strokeWidth={FULL.detail} />
        <path d={`M${cx} ${cy - 2}V${cy - r + 3}`} strokeWidth={2.8} />
      </g>
    </g>
  );
}

/** Pages of keys, like the hardware's page lights: one mark per page, the shown one filled. */
function PageIndicator({ count, at }: { count: number; at: number }) {
  const x0 = 298 - count * 12;
  return (
    <g className="cast-pages" data-pages={count} data-page={at} stroke="currentColor" strokeWidth={1.2}>
      {Array.from({ length: count }, (_, i) => (
        <rect key={i} x={x0 + i * 12 + 2} y={116} width={9} height={4} fill={i === at ? "currentColor" : "none"} data-current={i === at || undefined} />
      ))}
    </g>
  );
}

/** One trig key. Lit in the badge's ring colors, half raised when it needs a re-test. */
function Key({ index, g, ink, lit, seated }: { index: number; g: Geometry; ink: string; lit?: MachineKey; seated: boolean }) {
  const colors = useKeyColors(lit?.collection ?? null, lit?.credentialSlug ?? "");
  const k = g.keys;
  const pitch = (k.span - k.w) / (KEYS_PER_PAGE - 1);
  const x = k.x + index * pitch;
  const raised = !!lit?.halfRaised;
  const lift = raised ? Math.round(k.h * 0.3) : 0;
  const state = !lit ? "off" : raised ? "raised" : "lit";
  const stroke = g.stroke * 0.8;
  const led = isMini(g) ? 2 : 3;
  return (
    <g className={`cast-key cast-key-${state}${seated ? " cast-key-seated" : ""}`} data-key={state} data-credential={lit?.id} filter={ink} stroke="currentColor" strokeLinejoin="round" strokeLinecap="round">
      {raised && (
        // The key's sides, showing between the raised cap and its seat.
        <path d={`M${x} ${k.y + k.h - lift}V${k.y + k.h}H${x + k.w}V${k.y + k.h - lift}`} fill="none" strokeWidth={stroke * 0.8} />
      )}
      <rect
        x={x}
        y={k.y - lift}
        width={k.w}
        height={k.h}
        className={lit ? undefined : "cast-paper"}
        fill={lit ? (colors?.prim ?? "currentColor") : undefined}
        strokeWidth={stroke}
        data-fill={lit ? (colors?.prim ?? "ink") : undefined}
      />
      {lit && <rect x={x + led} y={k.y - lift + led} width={k.w - led * 2} height={led} fill={colors?.sec ?? "currentColor"} stroke="none" />}
    </g>
  );
}

function isMini(g: Geometry): boolean {
  return g === MINI;
}

/** The screen's content. Outside every filter, so its motion never re-rasterizes the wobble. */
function Screen({ state, g }: { state: ScreenState; g: Geometry }) {
  const { x, y, lh, size } = g.text;
  const gl = g.glass;
  const midY = gl.y + gl.h / 2;
  const sw = g.detail;
  switch (state.kind) {
    case "idle":
      // A flat line with one small beat: ready.
      return (
        <g className="cast-screen cast-screen-idle" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d={`M${gl.x + 8} ${midY}H${gl.x + gl.w * 0.42}l${gl.w * 0.04} ${-gl.h * 0.2}l${gl.w * 0.06} ${gl.h * 0.34}l${gl.w * 0.04} ${-gl.h * 0.14}H${gl.x + gl.w - 8}`} />
        </g>
      );
    case "sending":
      return (
        <g className="cast-screen cast-screen-sending" fill="currentColor">
          {[0, 1, 2].map((i) => (
            <circle key={i} className="cast-dot" style={{ animationDelay: `${i * 160}ms` }} cx={gl.x + gl.w * (0.36 + i * 0.14)} cy={midY} r={isMini(g) ? 1.8 : 2.6} />
          ))}
        </g>
      );
    case "waiting":
      return (
        <g className="cast-screen cast-screen-waiting" fill="currentColor">
          <text x={x} y={y} fontSize={size} className="cast-screen-text">
            &gt;
          </text>
          <rect className="cast-cursor" x={x + size * 0.9} y={y - size * 0.82} width={size * 0.6} height={size} />
        </g>
      );
    case "reply":
      return (
        <g className="cast-screen cast-screen-reply" fill="currentColor">
          {state.lines.slice(0, 3).map((line, i) => (
            <text key={i} x={x} y={y + i * lh} fontSize={size} className="cast-screen-text">
              {line}
            </text>
          ))}
        </g>
      );
  }
}

/** The cartridge in the slot, its contacts hidden inside the case. */
function LoadedCartridge({ collection, credential }: { collection: Collection; credential: Pick<Credential, "slug" | "name"> }) {
  const src = useBadgeSrc(collection, credential);
  const scale = 0.72;
  const s = FULL.slot;
  const x = s.x + s.w / 2 - (CARTRIDGE_W * scale) / 2;
  const y = FULL.case.y + 10 - CARTRIDGE_H * scale;
  return (
    // The outer group carries the slide in and the eject (CSS), the inner one its place.
    <g className="cast-loaded-motion">
      <g className="cast-loaded" transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale})`}>
        <CartridgeArt src={src} />
      </g>
    </g>
  );
}
