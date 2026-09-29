// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { followColorScheme } from "./colorScheme";

type Listener = (e: { matches: boolean }) => void;

function fakeMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const media = {
    matches: initial,
    addEventListener: (_: "change", l: Listener) => listeners.add(l),
    removeEventListener: (_: "change", l: Listener) => listeners.delete(l),
  };
  return {
    media,
    listeners,
    set(matches: boolean) {
      media.matches = matches;
      listeners.forEach((l) => l({ matches }));
    },
  };
}

const root = () => document.documentElement;

describe("followColorScheme", () => {
  afterEach(() => root().classList.remove("dark"));

  it("adds the dark class when the OS prefers dark", () => {
    const { media } = fakeMedia(true);
    followColorScheme(root(), media);
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("leaves the dark class off when the OS prefers light", () => {
    const { media } = fakeMedia(false);
    followColorScheme(root(), media);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("follows OS changes while running", () => {
    const fake = fakeMedia(false);
    followColorScheme(root(), fake.media);
    fake.set(true);
    expect(root().classList.contains("dark")).toBe(true);
    fake.set(false);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("stops following after cleanup", () => {
    const fake = fakeMedia(false);
    const stop = followColorScheme(root(), fake.media);
    stop();
    expect(fake.listeners.size).toBe(0);
    fake.set(true);
    expect(root().classList.contains("dark")).toBe(false);
  });
});
