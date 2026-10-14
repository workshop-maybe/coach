// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearHeldLine, HELD_LINE_KEY, readHeldLine, writeHeldLine } from "./heldLine";

beforeEach(() => localStorage.clear());

const broken = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
} as unknown as Storage;

describe("the held line", () => {
  it("reads null when nothing is held", () => {
    expect(readHeldLine()).toBeNull();
  });

  it("holds the line and its name until cleared", () => {
    expect(writeHeldLine({ line: "It finds the bug", name: "It finds the bug" })).toBe(true);
    expect(JSON.parse(localStorage.getItem(HELD_LINE_KEY)!)).toEqual({ line: "It finds the bug", name: "It finds the bug" });
    expect(readHeldLine()).toEqual({ line: "It finds the bug", name: "It finds the bug" });
    clearHeldLine();
    expect(readHeldLine()).toBeNull();
  });

  it("reads a malformed or empty entry as nothing held", () => {
    localStorage.setItem(HELD_LINE_KEY, "not json");
    expect(readHeldLine()).toBeNull();
    localStorage.setItem(HELD_LINE_KEY, JSON.stringify({ line: "  ", name: "x" }));
    expect(readHeldLine()).toBeNull();
    localStorage.setItem(HELD_LINE_KEY, JSON.stringify({ line: "x" }));
    expect(readHeldLine()).toBeNull();
  });

  it("survives storage that throws or is missing", () => {
    expect(readHeldLine(broken)).toBeNull();
    expect(writeHeldLine({ line: "a", name: "a" }, broken)).toBe(false);
    expect(() => clearHeldLine(broken)).not.toThrow();
    expect(readHeldLine(null)).toBeNull();
    expect(writeHeldLine({ line: "a", name: "a" }, null)).toBe(false);
  });
});
