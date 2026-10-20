import { describe, expect, it, vi } from "vitest";
import type { QdlNode, QdlTraceStep } from "./quinelings";
import {
  BREATH_CYCLE,
  CYCLE_STEPS,
  FRAME_BUDGET,
  PICK_RADIUS,
  PICK_STRIDE,
  WALK_MS,
  caption,
  createFrameCache,
  depthAlpha,
  hash01,
  layoutFrame,
  ownerBounds,
  pickOwner,
  stepOf,
  toggleKept,
  toneOf,
  walkIndex,
  type BodyFrame,
} from "./stipple";

/** A small frame: points on a tilted ring, owned in turn by three operations. */
function ringFrame(count = 60): BodyFrame {
  const points: number[] = [];
  const owners: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 2 * Math.PI;
    points.push(0.9 * Math.cos(a), 0.4 * Math.sin(a), 0.13 * Math.sin(2 * a), 0.18);
    owners.push(i % 3);
  }
  return { points, owners, nodeIds: ["a", "b", "c"], nodeRoles: ["input", "process", "action"] };
}

describe("hash01", () => {
  it("is deterministic and within [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const h = hash01(i);
      expect(h).toBe(hash01(i));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    expect(new Set(Array.from({ length: 100 }, (_, i) => hash01(i))).size).toBeGreaterThan(90);
  });
});

describe("layoutFrame", () => {
  it("keeps every point inside the panel with a margin", () => {
    for (const [w, h] of [
      [640, 420],
      [300, 700],
      [1200, 200],
    ]) {
      const margin = 40;
      const layout = layoutFrame(ringFrame(), w, h, margin);
      for (let i = 0; i < layout.x.length; i++) {
        expect(layout.x[i]).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(layout.x[i]).toBeLessThanOrEqual(w - margin + 1e-6);
        expect(layout.y[i]).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(layout.y[i]).toBeLessThanOrEqual(h - margin + 1e-6);
      }
    }
  });

  it("centres a frame whose points all coincide, without dividing by zero", () => {
    const frame: BodyFrame = { points: [0.2, 0.1, 0, 0.18, 0.2, 0.1, 0, 0.18], owners: [0, 0], nodeIds: ["a"], nodeRoles: ["input"] };
    const layout = layoutFrame(frame, 200, 100, 10);
    expect(layout.x[0]).toBeCloseTo(100);
    expect(layout.y[0]).toBeCloseTo(50);
  });

  it("orders points far to near, so nearer dots paint over farther ones", () => {
    const layout = layoutFrame(ringFrame(), 400, 300);
    for (let k = 1; k < layout.order.length; k++) {
      expect(layout.z[layout.order[k]]).toBeGreaterThanOrEqual(layout.z[layout.order[k - 1]]);
    }
  });

  it("samples every sixth point for picking", () => {
    const layout = layoutFrame(ringFrame(60), 400, 300);
    expect(PICK_STRIDE).toBe(6);
    expect(layout.picks.length / 3).toBe(10);
  });
});

describe("depthAlpha", () => {
  it("darkens toward the viewer within the prototype's range", () => {
    expect(depthAlpha(-1)).toBeCloseTo(0.18);
    expect(depthAlpha(1)).toBeCloseTo(0.73);
    expect(depthAlpha(0.05)).toBeGreaterThan(depthAlpha(-0.05));
  });
});

describe("pickOwner", () => {
  const picks = new Float32Array([100, 100, 0, 130, 100, 2]);

  it("returns the owner of the nearest sampled point within the radius", () => {
    expect(pickOwner(picks, 104, 100)).toBe(0);
    expect(pickOwner(picks, 120, 101)).toBe(2);
  });

  it("returns null outside the radius", () => {
    expect(pickOwner(picks, 100, 100 + PICK_RADIUS + 1)).toBeNull();
    expect(pickOwner(new Float32Array(), 0, 0)).toBeNull();
  });
});

describe("toneOf and toggleKept", () => {
  it("lights hover, kept and the walk's operation in data blue", () => {
    const marks = { hover: "a", kept: "b", walk: "c", red: null };
    expect(toneOf("a", marks)).toBe("data");
    expect(toneOf("b", marks)).toBe("data");
    expect(toneOf("c", marks)).toBe("data");
    expect(toneOf("d", marks)).toBeNull();
  });

  it("lets the red node win over a hover on the same node", () => {
    expect(toneOf("a", { hover: "a", kept: "a", walk: "a", red: "a" })).toBe("error");
  });

  it("keeps a clicked node lit until it is clicked again", () => {
    let kept = toggleKept(null, "young");
    expect(kept).toBe("young");
    expect(toneOf("young", { hover: null, kept, walk: null, red: null })).toBe("data");
    kept = toggleKept(kept, "young");
    expect(kept).toBeNull();
    expect(toggleKept("young", "fresh")).toBe("fresh");
    expect(toggleKept("young", null)).toBeNull();
  });
});

describe("walkIndex", () => {
  it("lights the trace entry at floor(t * length), and none after the duration", () => {
    expect(walkIndex(0, 10, false)).toBe(0);
    expect(walkIndex(WALK_MS * 0.55, 10, false)).toBe(5);
    expect(walkIndex(WALK_MS * 0.999, 10, false)).toBe(9);
    expect(walkIndex(WALK_MS, 10, false)).toBeNull();
    expect(walkIndex(WALK_MS * 3, 10, false)).toBeNull();
    expect(walkIndex(-1, 10, false)).toBeNull();
    expect(walkIndex(100, 0, false)).toBeNull();
  });

  it("Covers AE6. With reduced motion no operation lights in sequence", () => {
    for (const t of [0, WALK_MS * 0.3, WALK_MS * 0.9]) expect(walkIndex(t, 10, true)).toBeNull();
  });
});

describe("the frame cache", () => {
  it("returns the same frame within one quantized step and calls the runtime once per step", () => {
    const compute = vi.fn((phase: number) => ({ phase }));
    const cache = createFrameCache(compute);
    const step = BREATH_CYCLE / CYCLE_STEPS;
    const a = cache.at(step * 3 + step * 0.1);
    const b = cache.at(step * 3 + step * 0.9);
    expect(b).toBe(a);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(compute).toHaveBeenCalledWith(step * 3);
    cache.at(step * 4.2);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("wraps phase onto one breathing cycle, since the body repeats every 2π", () => {
    const compute = vi.fn((phase: number) => ({ phase }));
    const cache = createFrameCache(compute);
    const first = cache.at(0);
    expect(cache.at(BREATH_CYCLE + 1e-9)).toBe(first);
    expect(cache.at(5 * BREATH_CYCLE)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(stepOf(-1e-9)).toBe(CYCLE_STEPS - 1);
  });

  it("asks the runtime for at least 4000 points", () => {
    expect(FRAME_BUDGET).toBeGreaterThanOrEqual(4000);
  });
});

describe("ownerBounds", () => {
  it("bounds one operation's tissue on screen, and nothing for an operation with none", () => {
    const frame = ringFrame();
    const layout = layoutFrame(frame, 400, 300);
    const box = ownerBounds(layout, frame.owners, 1);
    expect(box).not.toBeNull();
    for (let i = 1; i < frame.owners.length; i += 3) {
      expect(layout.x[i]).toBeGreaterThanOrEqual(box!.x0);
      expect(layout.x[i]).toBeLessThanOrEqual(box!.x1);
      expect(layout.y[i]).toBeGreaterThanOrEqual(box!.y0);
      expect(layout.y[i]).toBeLessThanOrEqual(box!.y1);
    }
    expect(ownerBounds(layout, frame.owners, 7)).toBeNull();
  });
});

describe("caption", () => {
  const nodes: QdlNode[] = [
    { id: "age", op: "subtract", inputs: ["now", "observedAt"], params: {} },
    { id: "young", op: "compare", inputs: ["age", "maxAge"], params: { operator: "lte" } },
    { id: "ready", op: "and", inputs: ["young", "fresh"], params: {} },
  ];
  const roles = new Map([
    ["age", "process"],
    ["young", "decision"],
    ["ready", "action"],
  ]);
  const trace: QdlTraceStep[] = [{ nodeId: "young", op: "compare", inputs: [30, 30], value: false }];
  const base = { nodes, roles, trace: null, hover: null, kept: null, red: null, guess: null };

  it("counts the operations by default", () => {
    expect(caption(base)).toEqual({ text: "3 operations", tone: "ink" });
  });

  it("names the hovered operation, its inputs and role, and its value in the selected run", () => {
    expect(caption({ ...base, hover: "young" })).toEqual({ text: "young · compare(age, maxAge) · decision", tone: "data" });
    expect(caption({ ...base, hover: "young", trace })).toEqual({
      text: "young · compare(age, maxAge) · decision = false",
      tone: "data",
    });
  });

  it("names a kept operation when nothing is hovered", () => {
    expect(caption({ ...base, kept: "age" }).text).toBe("age · subtract(now, observedAt) · process");
  });

  it("captions the guess as a likely cause when nothing is hovered, in the error tone", () => {
    expect(caption({ ...base, red: "ready", guess: "young" })).toEqual({
      text: "young · compare(age, maxAge) · decision · likely cause",
      tone: "error",
    });
    expect(caption({ ...base, red: "ready", guess: "young", hover: "age" }).text).toBe("age · subtract(now, observedAt) · process");
  });

  it("names the red operation in the error tone when there is no guess, and when it is hovered", () => {
    expect(caption({ ...base, red: "ready" })).toEqual({ text: "ready · and(young, fresh) · action", tone: "error" });
    expect(caption({ ...base, red: "ready", hover: "ready" }).tone).toBe("error");
  });

  it("shortens a long value", () => {
    const long: QdlTraceStep[] = [{ nodeId: "age", op: "subtract", inputs: [], value: "x".repeat(200) }];
    expect(caption({ ...base, hover: "age", trace: long }).text.length).toBeLessThan(90);
  });
});
