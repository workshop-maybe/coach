// @vitest-environment jsdom
// The film's player: its clock, its end, and the reduced-motion stills. The composition is
// tested in Intro.test.tsx; here a stand-in shows which frame the player drew.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilmApi, FilmProps } from "./Film";
import { FPS, STILLS, TOTAL_FRAMES } from "./timeline";

vi.mock("./Intro", () => ({ Intro: ({ frame }: { frame: number }) => <p data-drawn={frame} />, INTRO_WIDTH: 1920, INTRO_HEIGHT: 1080 }));

const { default: FilmPlayer, frameAt } = await import("./FilmPlayer");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(over: Partial<FilmProps> = {}) {
  let api: FilmApi | null = null;
  const props: FilmProps = {
    reducedMotion: false,
    muted: false,
    still: 0,
    onReady: (a) => (api = a),
    onEnded: vi.fn(),
    onFrame: vi.fn(),
    onFailed: vi.fn(),
    ...over,
  };
  const view = render(<FilmPlayer {...props} />);
  const drawn = () => Number(view.container.querySelector("[data-drawn]")!.getAttribute("data-drawn"));
  return { view, props, drawn, api: () => api! };
}

describe("frameAt", () => {
  it("counts frames at the timeline's rate and holds the last", () => {
    expect(frameAt(0)).toBe(0);
    expect(frameAt(1000)).toBe(FPS);
    expect(frameAt(1000 / FPS - 0.01)).toBe(0);
    expect(frameAt(10 * 60 * 1000)).toBe(TOTAL_FRAMES - 1);
    expect(frameAt(-5)).toBe(0);
  });
});

describe("the film's player", () => {
  it("is ready on mount and holds the first frame until played", () => {
    const { api, drawn, props } = mount();
    expect(api()).not.toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(drawn()).toBe(0);
    expect(props.onFrame).not.toHaveBeenCalled();
  });

  it("plays from the first frame on its clock, reporting each frame", () => {
    const { api, drawn, props } = mount();
    act(() => api().play());
    act(() => vi.advanceTimersByTime(1000));
    expect(drawn()).toBeGreaterThanOrEqual(FPS - 1);
    expect(drawn()).toBeLessThanOrEqual(FPS);
    expect(props.onFrame).toHaveBeenLastCalledWith(drawn());
  });

  it("reports the end once and holds the last frame", () => {
    const { api, drawn, props } = mount();
    act(() => api().play());
    act(() => vi.advanceTimersByTime((TOTAL_FRAMES / FPS) * 1000 + 500));
    expect(drawn()).toBe(TOTAL_FRAMES - 1);
    act(() => vi.advanceTimersByTime(5000));
    expect(props.onEnded).toHaveBeenCalledTimes(1);
    expect(drawn()).toBe(TOTAL_FRAMES - 1);
  });

  it("ignores a second play", () => {
    const { api, drawn } = mount();
    act(() => api().play());
    act(() => vi.advanceTimersByTime(2000));
    act(() => api().play());
    act(() => vi.advanceTimersByTime(100));
    expect(drawn()).toBeGreaterThanOrEqual(2 * FPS);
  });

  it("under reduced motion draws the still it is given", () => {
    const { view, props, drawn } = mount({ reducedMotion: true });
    expect(drawn()).toBe(STILLS[0]);
    view.rerender(<FilmPlayer {...props} still={2} />);
    expect(drawn()).toBe(STILLS[2]);
    view.rerender(<FilmPlayer {...props} still={STILLS.length + 3} />);
    expect(drawn()).toBe(STILLS[STILLS.length - 1]);
  });
});
