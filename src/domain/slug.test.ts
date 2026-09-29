import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates a name", () => {
    expect(slugify("Review a PR")).toBe("review-a-pr");
  });

  it("collapses runs of symbols and trims edge hyphens", () => {
    expect(slugify("  --Hello,   World!!  ")).toBe("hello-world");
  });

  it("strips diacritics to ASCII", () => {
    expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu");
  });

  it("keeps digits", () => {
    expect(slugify("Level 2 Refactor")).toBe("level-2-refactor");
  });

  it("falls back to a non-empty slug for symbols only", () => {
    expect(slugify("!!! ???")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
    expect(slugify("日本語")).toBe("untitled");
  });
});

describe("uniqueSlug", () => {
  it("returns the base slug when free", () => {
    expect(uniqueSlug("Review a PR", [])).toBe("review-a-pr");
  });

  it("appends -2 on the first collision", () => {
    expect(uniqueSlug("Review a PR", ["review-a-pr"])).toBe("review-a-pr-2");
  });

  it("keeps counting past taken suffixes", () => {
    const taken = new Set(["review-a-pr", "review-a-pr-2", "review-a-pr-3"]);
    expect(uniqueSlug("Review a PR", taken)).toBe("review-a-pr-4");
  });

  it("applies suffixes to the fallback slug too", () => {
    expect(uniqueSlug("???", ["untitled"])).toBe("untitled-2");
  });

  it("accepts any iterable", () => {
    function* gen() {
      yield "a";
    }
    expect(uniqueSlug("A", gen())).toBe("a-2");
  });
});
