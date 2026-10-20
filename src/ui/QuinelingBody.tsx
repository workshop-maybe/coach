// The program's body (U6, R12 to R16, KTD11 of
// docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md): the stipple drawing of the body
// Quinelings generates for a compiled program, breathing at rest, walking the selected
// fixture's trace when the fixtures run, naming the operation under the pointer, and marking
// the wrong output in red and the likely cause dashed. Every decision is in
// src/domain/stipple.ts; this file owns the canvas, its size, the clock and the pointer.

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { operationCount } from "../domain/programChecks";
import type { QdlArtifact, QdlSession, QdlTraceStep } from "../domain/quinelings";
import {
  BREATH_CYCLE,
  BREATH_RATE,
  FRAME_BUDGET,
  FRAME_CRESTS,
  MAX_STEP_S,
  caption,
  createFrameCache,
  depthAlpha,
  dotShape,
  layoutFrame,
  ownerBounds,
  pickOwner,
  stepOf,
  toggleKept,
  toneOf,
  walkIndex,
  type BodyFrame,
  type BodyLayout,
} from "../domain/stipple";
import { Outline } from "../cast/Outline";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export interface QuinelingBodyProps {
  session: QdlSession;
  artifact: QdlArtifact;
  /** The selected fixture's agent trace; null before a run. */
  trace: QdlTraceStep[] | null;
  /** A change replays the run walk over `trace` (skipped under reduced motion). */
  walkKey: number;
  /** Lit in the error token (R15). */
  redNodeId: string | null;
  /** Ringed dashed around its tissue and captioned as a likely cause (R16). */
  guessNodeId: string | null;
}

interface Colors {
  ink: string;
  data: string;
  error: string;
}

/** Space between the guess's tissue and its dashed ring. */
const RING_PAD = 6;

export function QuinelingBody({ session, artifact, trace, walkKey, redNodeId, guessNodeId }: QuinelingBodyProps): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  const [painted, setPainted] = useState(false);
  const nodes = artifact.payload.task.nodes;

  const cache = useMemo(
    () =>
      createFrameCache<BodyFrame>((phase) => {
        const f = session.frame(artifact.id, phase, { budget: FRAME_BUDGET, crests: FRAME_CRESTS });
        // Copied, so the cache holds only what the drawing needs.
        return { points: Float32Array.from(f.points), owners: Int32Array.from(f.owners), nodeIds: f.nodeIds, nodeRoles: f.nodeRoles };
      }),
    [session, artifact.id],
  );

  // A program that brings its own design without an assembly anatomy still compiles and runs,
  // but the runtime cannot sample its body. It then shows as missing, as a failed program does
  // (R17), rather than as a canvas that never paints.
  const { roles, drawable } = useMemo(() => {
    try {
      const f = cache.at(0);
      return { roles: new Map(f.nodeIds.map((id, i) => [id, f.nodeRoles[i]])), drawable: true };
    } catch {
      return { roles: new Map<string, string>(), drawable: false };
    }
  }, [cache]);

  // What the paint reads, current as of the last render.
  const view = useRef({ hover, kept, trace, redNodeId, guessNodeId, reduced });
  view.current = { hover, kept, trace, redNodeId, guessNodeId, reduced };

  // The drawing's own state, outside React.
  const live = useRef({
    ctx: null as CanvasRenderingContext2D | null,
    colors: null as Colors | null,
    width: 0,
    height: 0,
    dpr: 1,
    phase: 0,
    walkStart: -Infinity,
    lastStep: -1,
    lastWalk: null as string | null,
    painted: false,
    shown: null as { frame: BodyFrame; width: number; height: number; layout: BodyLayout } | null,
  });

  const walkAt = useCallback((now: number): string | null => {
    const { trace: steps, reduced: still } = view.current;
    if (!steps) return null;
    const k = walkIndex(now - live.current.walkStart, steps.length, still);
    return k === null ? null : (steps[k]?.nodeId ?? null);
  }, []);

  const paint = useCallback(
    (now: number) => {
      const s = live.current;
      const canvas = canvasRef.current;
      if (!canvas || !s.ctx || !s.width || !s.height) return;
      const ctx = s.ctx;
      if (!s.colors) {
        const style = getComputedStyle(canvas);
        const token = (name: string) => style.getPropertyValue(name).trim();
        s.colors = { ink: token("--ink"), data: token("--data"), error: token("--error") };
      }
      const v = view.current;
      const phase = v.reduced ? 0 : s.phase;
      let frame: BodyFrame;
      try {
        frame = cache.at(phase);
      } catch {
        return;
      }
      if (!s.shown || s.shown.frame !== frame || s.shown.width !== s.width || s.shown.height !== s.height) {
        s.shown = { frame, width: s.width, height: s.height, layout: layoutFrame(frame, s.width, s.height) };
      }
      const { layout } = s.shown;
      const walk = walkAt(now);
      const marks = { hover: v.hover, kept: v.kept, walk, red: v.redNodeId };
      const tones = frame.nodeIds.map((id) => toneOf(id, marks));
      const colors = s.colors;

      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx.clearRect(0, 0, s.width, s.height);
      let fill = "";
      for (const i of layout.order) {
        const tone = tones[frame.owners[i]];
        const color = tone ? colors[tone] : colors.ink;
        if (color !== fill) {
          ctx.fillStyle = color;
          fill = color;
        }
        ctx.globalAlpha = tone ? 0.9 : depthAlpha(layout.z[i]);
        const dot = dotShape(i, tone !== null);
        ctx.beginPath();
        ctx.arc(layout.x[i] + dot.dx, layout.y[i] + dot.dy, dot.r, 0, 2 * Math.PI);
        ctx.fill();
      }

      const guess = v.guessNodeId ? frame.nodeIds.indexOf(v.guessNodeId) : -1;
      const box = guess >= 0 ? ownerBounds(layout, frame.owners, guess) : null;
      if (box) {
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = colors.error;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(box.x0 - RING_PAD, box.y0 - RING_PAD, box.x1 - box.x0 + 2 * RING_PAD, box.y1 - box.y0 + 2 * RING_PAD);
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;

      s.lastStep = stepOf(phase);
      s.lastWalk = walk;
      if (!s.painted) {
        s.painted = true;
        setPainted(true);
      }
    },
    [cache, walkAt],
  );

  // A new program starts clean.
  useEffect(() => {
    setHover(null);
    setKept(null);
    live.current.shown = null;
  }, [cache]);

  // The context once, and the backing store sized to the panel by devicePixelRatio.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    live.current.ctx = canvas.getContext("2d") ?? null;
    // The observer also fires once on observe, so an unchanged size is skipped: resizing the
    // backing store clears it.
    let last = "";
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const size = `${box.width}x${box.height}@${dpr}`;
      if (size === last) return;
      last = size;
      const s = live.current;
      s.dpr = dpr;
      s.width = box.width;
      s.height = box.height;
      canvas.width = Math.round(box.width * dpr);
      canvas.height = Math.round(box.height * dpr);
      paint(performance.now());
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  // Every change in what is lit repaints at once; under reduced motion this is the only paint.
  useEffect(() => {
    paint(performance.now());
  }, [paint, hover, kept, trace, redNodeId, guessNodeId, reduced]);

  // A new walk key replays the run walk; the clock paints it. Reduced motion never walks (AE6).
  const lastWalkKey = useRef(walkKey);
  useEffect(() => {
    if (lastWalkKey.current === walkKey) return;
    lastWalkKey.current = walkKey;
    if (!reduced) live.current.walkStart = performance.now();
  }, [walkKey, reduced]);

  // One clock: breathing and the walk. It never runs under reduced motion, and stops while hidden.
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const s = live.current;
      const dt = Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000));
      last = now;
      s.phase = (s.phase + dt * BREATH_RATE) % BREATH_CYCLE;
      if (stepOf(s.phase) !== s.lastStep || walkAt(now) !== s.lastWalk) paint(now);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (raf || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced, paint, walkAt]);

  const ownerAt = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    const shown = live.current.shown;
    if (!canvas || !shown) return null;
    const box = canvas.getBoundingClientRect();
    const owner = pickOwner(shown.layout.picks, clientX - box.left, clientY - box.top);
    return owner === null ? null : (shown.frame.nodeIds[owner] ?? null);
  };

  const line = caption({ nodes, roles, trace, hover, kept, red: redNodeId, guess: guessNodeId });

  if (!drawable) {
    return (
      <div className="quineling-canvas-wrap">
        <Outline kind="body" />
        <p className="quineling-caption" data-tone="ink">
          This program's body can't be drawn
        </p>
      </div>
    );
  }

  return (
    <div className="quineling-canvas-wrap">
      <canvas
        ref={canvasRef}
        aria-busy={painted ? undefined : "true"}
        aria-label={`The program's body, ${operationCount(nodes)} operations`}
        style={{ width: "100%", height: "100%", cursor: hover ? "pointer" : "default" }}
        onMouseMove={(e) => {
          const id = ownerAt(e.clientX, e.clientY);
          if (id !== hover) setHover(id);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => setKept((k) => toggleKept(k, ownerAt(e.clientX, e.clientY)))}
      />
      <p className="quineling-caption" data-tone={line.tone}>
        {line.text}
      </p>
    </div>
  );
}
