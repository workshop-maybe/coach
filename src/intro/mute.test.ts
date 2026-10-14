// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { MUTE_STORAGE_KEY, readMuted, writeMuted } from "./mute";

beforeEach(() => localStorage.clear());

describe("the intro's remembered mute", () => {
  it("reads false when nothing is stored", () => {
    expect(readMuted()).toBe(false);
  });

  it("reads true after it is set, and false after it is cleared", () => {
    writeMuted(true);
    expect(localStorage.getItem(MUTE_STORAGE_KEY)).toBe("true");
    expect(readMuted()).toBe(true);
    writeMuted(false);
    expect(readMuted()).toBe(false);
  });

  it("reads anything but true as sound on", () => {
    localStorage.setItem(MUTE_STORAGE_KEY, "yes");
    expect(readMuted()).toBe(false);
  });

  it("reads false and drops the write when storage throws", () => {
    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    } as unknown as globalThis.Storage;
    expect(readMuted(broken)).toBe(false);
    expect(() => writeMuted(true, broken)).not.toThrow();
  });

  it("reads false when the localStorage accessor itself throws", () => {
    const own = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(readMuted()).toBe(false);
      expect(() => writeMuted(true)).not.toThrow();
    } finally {
      if (own) Object.defineProperty(globalThis, "localStorage", own);
    }
  });
});
