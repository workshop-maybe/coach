// The intro's motion helpers: the world's two easings, a clamped tween, and the stroke
// dash that inks a path on as its progress goes 0 to 1.

import { Easing, interpolate } from "remotion";

/** In and out, for moves the eye follows. */
export const ease = Easing.bezier(0.65, 0, 0.35, 1);
/** Fast out, soft landing, for things arriving. */
export const out = Easing.bezier(0.16, 1, 0.3, 1);
/** A drop that lands with weight, for a cartridge seating. */
export const drop = Easing.bezier(0.3, 0, 0.6, 1);

export const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** From `from` to `to` as the frame runs `a` to `b`, held at both ends. */
export function tween(frame: number, a: number, b: number, from = 0, to = 1, easing: (t: number) => number = out): number {
  return interpolate(frame, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
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
