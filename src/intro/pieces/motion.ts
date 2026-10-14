// The intro's motion helpers: the world's easings, a clamped tween, and the stroke dash
// that inks a path on as its progress goes 0 to 1.

/**
 * A CSS-style cubic-bezier easing through (0, 0), (x1, y1), (x2, y2) and (1, 1): for a time
 * `x` in [0, 1] it solves the curve for that x, by Newton's method with a bisection
 * fallback, and returns its y.
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const at = (t: number, p1: number, p2: number) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
  const slope = (t: number, p1: number, p2: number) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);

  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = at(t, x1, x2) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = at(t, x1, x2);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : at(solve(x), y1, y2));
}

/** In and out, for moves the eye follows. */
export const ease = bezier(0.65, 0, 0.35, 1);
/** Fast out, soft landing, for things arriving. */
export const out = bezier(0.16, 1, 0.3, 1);
/** A drop that lands with weight, for a cartridge seating. */
export const drop = bezier(0.3, 0, 0.6, 1);

export const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** From `from` to `to` as the frame runs `a` to `b`, held at both ends. */
export function tween(frame: number, a: number, b: number, from = 0, to = 1, easing: (t: number) => number = out): number {
  const t = b > a ? clamp((frame - a) / (b - a)) : frame >= b ? 1 : 0;
  return from + (to - from) * easing(t);
}

/** Props that ink a path on as `d` goes 0 to 1. */
export function inked(d: number) {
  return { pathLength: 1, strokeDasharray: "1 1", strokeDashoffset: 1 - clamp(d) };
}

/** Part `i` of `n` of a 0-1 progress, so parts ink on one after another with some overlap. */
export function part(d: number, i: number, n: number, overlap = 0.5): number {
  return clamp((d * (n + overlap) - i) / (1 + overlap));
}

/** Fixed pseudo-random in [0, 1), so every play is the same film. */
export function rand(seed: number): number {
  let t = seed + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A point at `t` between two poses. */
export interface Pose {
  x: number;
  y: number;
  s: number;
}

export function between(a: Pose, b: Pose, t: number): Pose {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: a.s + (b.s - a.s) * t };
}

export const at = (p: Pose) => `translate(${p.x} ${p.y}) scale(${p.s})`;
