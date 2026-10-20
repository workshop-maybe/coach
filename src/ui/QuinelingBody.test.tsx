// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QdlArtifact, QdlSession, QdlTraceStep } from "../domain/quinelings";
import { layoutFrame, WALK_MS, type BodyFrame } from "../domain/stipple";
import { QuinelingBody } from "./QuinelingBody";

const W = 400;
const H = 300;

const artifact = {
  id: "art-1",
  sourceHash: "h",
  payload: {
    task: {
      nodes: [
        { id: "a", op: "input", inputs: [], params: {} },
        { id: "b", op: "compare", inputs: ["a"], params: {} },
        { id: "c", op: "and", inputs: ["b"], params: {} },
      ],
      outputs: ["c"],
    },
  },
} as QdlArtifact;

/** Points on a ring, owned in turn by a, b and c. */
function ring(): BodyFrame {
  const points: number[] = [];
  const owners: number[] = [];
  for (let i = 0; i < 90; i++) {
    const t = (i / 90) * 2 * Math.PI;
    points.push(0.9 * Math.cos(t), 0.4 * Math.sin(t), 0.1 * Math.sin(2 * t), 0.18);
    owners.push(i % 3);
  }
  return { points, owners, nodeIds: ["a", "b", "c"], nodeRoles: ["input", "decision", "action"] };
}

const trace: QdlTraceStep[] = [
  { nodeId: "a", op: "input", inputs: [], value: 3 },
  { nodeId: "b", op: "compare", inputs: [3], value: true },
  { nodeId: "c", op: "and", inputs: [true], value: false },
];

/** A 2D context that records the colours it fills and strokes in, and its dashed strokes. */
function fakeContext() {
  const fills: string[] = [];
  const strokes: { style: string; dash: number[] }[] = [];
  let fillStyle = "";
  let strokeStyle = "";
  let dash: number[] = [];
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: () => fills.push(fillStyle),
    strokeRect: () => strokes.push({ style: strokeStyle, dash }),
    setLineDash: (d: number[]) => (dash = d),
    globalAlpha: 1,
    lineWidth: 1,
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v: string) {
      fillStyle = v;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
    },
  };
  return { ctx, fills, strokes, reset: () => (fills.length = 0) };
}

let session: QdlSession;
let frameCalls: ReturnType<typeof vi.fn>;
let raf: ReturnType<typeof vi.fn>;
let caf: ReturnType<typeof vi.fn>;

function stubReduced(reduced: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
}

function withContext() {
  const fake = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fake.ctx as unknown as CanvasRenderingContext2D);
  return fake;
}

beforeEach(() => {
  frameCalls = vi.fn(() => ring());
  session = { frame: frameCalls } as unknown as QdlSession;
  raf = vi.fn(() => 1);
  caf = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);
  const tokens: Record<string, string> = { "--ink": "INK", "--data": "DATA", "--error": "ERROR" };
  vi.spyOn(window, "getComputedStyle").mockReturnValue({ getPropertyValue: (n: string) => tokens[n] ?? "" } as CSSStyleDeclaration);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: W,
    height: H,
    right: W,
    bottom: H,
    x: 0,
    y: 0,
    toJSON() {},
  });
  stubReduced(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function body(props: Partial<Parameters<typeof QuinelingBody>[0]> = {}) {
  return <QuinelingBody session={session} artifact={artifact} trace={null} walkKey={0} redNodeId={null} guessNodeId={null} {...props} />;
}

function canvas(): HTMLCanvasElement {
  return document.querySelector(".quineling-canvas-wrap canvas") as HTMLCanvasElement;
}

describe("QuinelingBody", () => {
  it("keeps its DOM, names the operation count and stays busy when there is no 2D context", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(body());
    expect(canvas().getAttribute("aria-busy")).toBe("true");
    expect(canvas().getAttribute("aria-label")).toMatch(/2 operations/);
    expect(screen.getByText("2 operations").className).toBe("quineling-caption");
  });

  it("shows the missing-body outline, not a canvas that never paints, when the runtime cannot sample the body (R17)", () => {
    withContext();
    session = {
      frame: vi.fn(() => {
        throw Object.assign(new Error("Source has no supported assembly anatomy and gesture"), { code: "unsupported-frame" });
      }),
    } as unknown as QdlSession;
    render(body());
    expect(canvas()).toBeNull();
    expect(document.querySelector(".quineling-canvas-wrap [data-outline='body']")).not.toBeNull();
    expect(document.querySelector("[aria-busy]")).toBeNull();
    expect(screen.getByText("This program's body can't be drawn")).toBeTruthy();
  });

  it("carries aria-busy until the first frame is painted, then drops it", () => {
    const fake = withContext();
    render(body());
    expect(canvas().hasAttribute("aria-busy")).toBe(false);
    expect(fake.fills.length).toBeGreaterThan(0);
    expect(fake.fills.every((c) => c === "INK")).toBe(true);
  });

  it("draws in token colours read from the canvas", () => {
    withContext();
    render(body());
    expect(window.getComputedStyle).toHaveBeenCalledWith(canvas());
  });

  it("lights the red node in the error token and rings the guess dashed, captioned as a likely cause", () => {
    const fake = withContext();
    render(body({ trace, redNodeId: "c", guessNodeId: "b" }));
    expect(fake.fills).toContain("ERROR");
    expect(fake.fills).not.toContain("DATA");
    const ring = fake.strokes.find((s) => s.style === "ERROR");
    expect(ring?.dash.length).toBeGreaterThan(0);
    const cap = screen.getByText("b · compare(a) · decision = true · likely cause");
    expect(cap.getAttribute("data-tone")).toBe("error");
  });

  it("names the operation under the pointer, keeps it on click, and clears it on a second click", () => {
    withContext();
    render(body({ trace }));
    const layout = layoutFrame(ring(), W, H);
    // The first sampled point belongs to a (owner 0).
    const at = { clientX: layout.picks[0], clientY: layout.picks[1] };
    fireEvent.mouseMove(canvas(), at);
    expect(screen.getByText("a · input() · input = 3").getAttribute("data-tone")).toBe("data");
    fireEvent.click(canvas(), at);
    fireEvent.mouseLeave(canvas());
    expect(screen.getByText("a · input() · input = 3")).toBeTruthy();
    fireEvent.mouseMove(canvas(), at);
    fireEvent.click(canvas(), at);
    fireEvent.mouseLeave(canvas());
    expect(screen.getByText("2 operations")).toBeTruthy();
  });

  it("lets the red node win over a hover on it", () => {
    const fake = withContext();
    render(body({ redNodeId: "a" }));
    const layout = layoutFrame(ring(), W, H);
    fake.reset();
    fireEvent.mouseMove(canvas(), { clientX: layout.picks[0], clientY: layout.picks[1] });
    expect(fake.fills).toContain("ERROR");
    expect(fake.fills).not.toContain("DATA");
  });

  it("breathes on one animation clock, computes each frame step once, and stops on unmount", () => {
    withContext();
    const { unmount } = render(body());
    expect(raf).toHaveBeenCalledTimes(1);
    const tick = raf.mock.calls[0][0] as FrameRequestCallback;
    const callsBefore = frameCalls.mock.calls.length;
    act(() => tick(performance.now() + 16));
    act(() => tick(performance.now() + 32));
    expect(frameCalls.mock.calls.length).toBe(callsBefore);
    unmount();
    expect(caf).toHaveBeenCalled();
  });

  it("walks the trace in data blue when the walk key changes", () => {
    const fake = withContext();
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const { rerender } = render(body({ trace }));
    rerender(body({ trace, walkKey: 1 }));
    const tick = raf.mock.calls[raf.mock.calls.length - 1][0] as FrameRequestCallback;
    fake.reset();
    now.mockReturnValue(1000 + WALK_MS * 0.5);
    act(() => tick(1000 + WALK_MS * 0.5));
    expect(fake.fills).toContain("DATA");
    fake.reset();
    now.mockReturnValue(1000 + WALK_MS * 1.2);
    act(() => tick(1000 + WALK_MS * 1.2));
    expect(fake.fills).not.toContain("DATA");
  });

  it("Covers AE6. With reduced motion the clock requests no frame and no operation lights in sequence", () => {
    stubReduced(true);
    const fake = withContext();
    const { rerender } = render(body({ trace }));
    rerender(body({ trace, walkKey: 1 }));
    rerender(body({ trace, walkKey: 2 }));
    expect(raf).not.toHaveBeenCalled();
    expect(fake.fills.length).toBeGreaterThan(0);
    expect(fake.fills).not.toContain("DATA");
    expect(frameCalls.mock.calls.every((c) => c[1] === 0)).toBe(true);
  });

  it("stops the clock while the document is hidden", () => {
    withContext();
    render(body());
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(caf).toHaveBeenCalled();
    hidden.mockReturnValue(false);
    raf.mockClear();
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
