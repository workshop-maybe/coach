// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

function Probe() {
  return <p>{usePrefersReducedMotion() ? "still" : "moving"}</p>;
}

/** A stubbed media query whose match can be flipped. */
function stubMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => mq);
  return (next: boolean) => {
    mq.matches = next;
    listeners.forEach((fn) => fn());
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("usePrefersReducedMotion", () => {
  it("is true when the system asks for reduced motion", () => {
    stubMedia(true);
    render(<Probe />);
    expect(screen.getByText("still")).toBeTruthy();
  });

  it("follows the setting when it changes", () => {
    const flip = stubMedia(false);
    render(<Probe />);
    expect(screen.getByText("moving")).toBeTruthy();
    act(() => flip(true));
    expect(screen.getByText("still")).toBeTruthy();
  });

  it("is false where matchMedia is missing", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Probe />);
    expect(screen.getByText("moving")).toBeTruthy();
  });
});
