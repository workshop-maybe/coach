// The program body's drawing, as pure functions (U6, KTD11 of
// docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md): projection and fit, depth shading,
// picking, which operations are lit, the run walk and the frame cache. src/ui/QuinelingBody.tsx
// owns the canvas and the clock; everything it decides comes from here. Nothing here draws or
// reads a colour: tones name tokens, and the component maps them to the values it read.

import { operationCount } from "./programChecks";
import type { QdlNode, QdlTraceStep } from "./quinelings";

/** Points asked of `session.frame`. The runtime needs at least 4000; the stipple look was chosen at 9000. */
export const FRAME_BUDGET = 9000;
export const FRAME_CRESTS = 3;

/** `session.frame(phase)` repeats every 2π (probed against the vendored runtime), so one cycle is cached. */
export const BREATH_CYCLE = 2 * Math.PI;
/** Steps per cycle: a step is about a quarter second of breathing and under a pixel of movement. */
export const CYCLE_STEPS = 72;
/** Radians of phase per second at rest. */
export const BREATH_RATE = 0.35;
/** The run walk crosses the whole trace in this long. */
export const WALK_MS = 2600;
/** The longest step the clock takes, in seconds, so a stalled tab does not jump the body. */
export const MAX_STEP_S = 0.05;

export const PICK_RADIUS = 18;
export const PICK_STRIDE = 6;
export const FIT_MARGIN = 48;

const YAW = 0.42;
const PITCH = -0.32;

/** The parts of a runtime frame the drawing keeps (normals are dropped to keep the cache small). */
export interface BodyFrame {
  /** x, y, z, w per point. */
  points: ArrayLike<number>;
  owners: ArrayLike<number>;
  nodeIds: string[];
  nodeRoles: string[];
}

/** A deterministic hash of a point index into [0, 1), for jitter and dot size; never Math.random. */
export function hash01(i: number): number {
  let x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** The fixed view: a little yaw and pitch, screen y downward, z toward the viewer. */
export function project(x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(YAW);
  const s = Math.sin(YAW);
  const X = x * c + z * s;
  const Z = z * c - x * s;
  const Y = y * Math.cos(PITCH) - Z * Math.sin(PITCH);
  const Zp = Z * Math.cos(PITCH) + y * Math.sin(PITCH);
  return [X, -Y, Zp];
}

export interface BodyLayout {
  /** Screen position of each point, in CSS pixels. */
  x: Float32Array;
  y: Float32Array;
  /** Depth toward the viewer. */
  z: Float32Array;
  /** Point indices far to near, the order they paint in. */
  order: Uint32Array;
  /** Every PICK_STRIDE-th point as x, y, owner triples. */
  picks: Float32Array;
}

/** Projects a frame and fits it, centred, inside the panel less the margin on every side. */
export function layoutFrame(frame: BodyFrame, width: number, height: number, margin = FIT_MARGIN): BodyLayout {
  const n = Math.floor(frame.points.length / 4);
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const z = new Float32Array(n);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const [X, Y, Z] = project(frame.points[i * 4], frame.points[i * 4 + 1], frame.points[i * 4 + 2]);
    px[i] = X;
    py[i] = Y;
    z[i] = Z;
    if (X < x0) x0 = X;
    if (X > x1) x1 = X;
    if (Y < y0) y0 = Y;
    if (Y > y1) y1 = Y;
  }
  const roomX = Math.max(0, width - 2 * margin);
  const roomY = Math.max(0, height - 2 * margin);
  // A span too small to scale (one point, or all coincide) draws at the centre.
  const fit = (room: number, span: number) => (span > 1e-6 ? room / span : Infinity);
  const scale = n ? Math.min(fit(roomX, x1 - x0), fit(roomY, y1 - y0)) : 0;
  if (!Number.isFinite(scale)) return layoutAt(frame, px, py, z, 0, width / 2, height / 2);
  const ox = width / 2 - ((x0 + x1) / 2) * scale;
  const oy = height / 2 - ((y0 + y1) / 2) * scale;
  return layoutAt(frame, px, py, z, scale, ox, oy);
}

function layoutAt(
  frame: BodyFrame,
  px: Float32Array,
  py: Float32Array,
  z: Float32Array,
  scale: number,
  ox: number,
  oy: number,
): BodyLayout {
  const n = px.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = ox + px[i] * scale;
    y[i] = oy + py[i] * scale;
  }
  const order = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => z[a] - z[b]);
  const picks = new Float32Array(Math.ceil(n / PICK_STRIDE) * 3);
  for (let i = 0, k = 0; i < n; i += PICK_STRIDE, k += 3) {
    picks[k] = x[i];
    picks[k + 1] = y[i];
    picks[k + 2] = frame.owners[i];
  }
  return { x, y, z, order, picks };
}

/** A dot's opacity: faint at the back, darker toward the viewer. */
export function depthAlpha(z: number): number {
  const depth = Math.max(0, Math.min(1, (z + 0.15) / 0.3));
  return 0.18 + 0.55 * depth;
}

/** A dot's radius and its small offset, both from the point's index. */
export function dotShape(i: number, lit: boolean): { r: number; dx: number; dy: number } {
  return {
    r: (lit ? 1.35 : 0.85) + 0.5 * hash01(i),
    dx: (hash01(i + 7) - 0.5) * 0.6,
    dy: (hash01(i + 9) - 0.5) * 0.6,
  };
}

/** The owner index of the nearest sampled point within the radius, or null. */
export function pickOwner(picks: Float32Array, x: number, y: number, radius = PICK_RADIUS): number | null {
  let best: number | null = null;
  let bestD = radius * radius;
  for (let k = 0; k + 2 < picks.length; k += 3) {
    const d = (picks[k] - x) ** 2 + (picks[k + 1] - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = picks[k + 2];
    }
  }
  return best;
}

/** The screen box around one operation's tissue, or null when it has no points in the frame. */
export function ownerBounds(
  layout: BodyLayout,
  owners: ArrayLike<number>,
  owner: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < layout.x.length; i++) {
    if (owners[i] !== owner) continue;
    x0 = Math.min(x0, layout.x[i]);
    x1 = Math.max(x1, layout.x[i]);
    y0 = Math.min(y0, layout.y[i]);
    y1 = Math.max(y1, layout.y[i]);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

export interface Marks {
  hover: string | null;
  kept: string | null;
  walk: string | null;
  red: string | null;
}

/** How an operation's dots are lit: the red node in error (R15, over a hover), the others in data blue. */
export function toneOf(id: string, marks: Marks): "data" | "error" | null {
  if (id === marks.red) return "error";
  if (id === marks.hover || id === marks.kept || id === marks.walk) return "data";
  return null;
}

/** A click keeps the operation under the pointer lit, and clicking it again, or the paper, clears it. */
export function toggleKept(kept: string | null, hover: string | null): string | null {
  return hover && hover !== kept ? hover : null;
}

/**
 * The trace entry the run walk lights `elapsedMs` after it started: floor(t * length) for t in
 * [0, 1), and none after the duration or under reduced motion (AE6).
 */
export function walkIndex(elapsedMs: number, length: number, reduced: boolean, duration = WALK_MS): number | null {
  if (reduced || length <= 0 || elapsedMs < 0) return null;
  const t = elapsedMs / duration;
  return t >= 1 ? null : Math.floor(t * length);
}

/** The cached step a phase falls in, wrapped onto one cycle. */
export function stepOf(phase: number): number {
  const turn = (((phase % BREATH_CYCLE) + BREATH_CYCLE) % BREATH_CYCLE) / BREATH_CYCLE;
  return Math.min(CYCLE_STEPS - 1, Math.floor(turn * CYCLE_STEPS));
}

/**
 * Frames by quantized phase (KTD11): each step is computed once, the first time the clock reaches
 * it, at the step's own phase, and reused every cycle after.
 */
export function createFrameCache<F>(compute: (phase: number) => F): { at(phase: number): F } {
  const steps = new Map<number, F>();
  return {
    at(phase) {
      const step = stepOf(phase);
      let frame = steps.get(step);
      if (frame === undefined) {
        frame = compute((step * BREATH_CYCLE) / CYCLE_STEPS);
        steps.set(step, frame);
      }
      return frame;
    },
  };
}

function shortValue(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 40 ? `${text.slice(0, 38)}…` : text;
}

export interface CaptionInput {
  nodes: QdlNode[];
  /** Each operation's role, from the frame. */
  roles: ReadonlyMap<string, string>;
  /** The selected fixture's trace, or null before a run. */
  trace: QdlTraceStep[] | null;
  hover: string | null;
  kept: string | null;
  red: string | null;
  guess: string | null;
}

/**
 * The mono caption under the body (R14, R16): the hovered or kept operation, else the guess as a
 * likely cause, else the red operation, else the operation count.
 */
export function caption(input: CaptionInput): { text: string; tone: "ink" | "data" | "error" } {
  const name = (id: string): string | null => {
    const node = input.nodes.find((n) => n.id === id);
    if (!node) return null;
    const role = input.roles.get(id);
    const step = input.trace?.find((t) => t.nodeId === id);
    return `${node.id} · ${node.op}(${node.inputs.join(", ")})${role ? ` · ${role}` : ""}${step ? ` = ${shortValue(step.value)}` : ""}`;
  };
  const named = input.hover ?? input.kept;
  if (named) {
    const text = name(named);
    if (text) return { text, tone: named === input.red ? "error" : "data" };
  }
  if (input.guess) {
    const text = name(input.guess);
    if (text) return { text: `${text} · likely cause`, tone: "error" };
  }
  if (input.red) {
    const text = name(input.red);
    if (text) return { text, tone: "error" };
  }
  return { text: `${operationCount(input.nodes)} operations`, tone: "ink" };
}
