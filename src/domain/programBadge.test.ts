import { describe, expect, it } from "vitest";
import { BOUNDED_PROGRAMS, programBadge } from "./programBadge";
import type { Collection, Credential } from "./types";

function collection(slug: string, from?: string): Collection {
  return { slug, name: "Programs", description: "", order: [], codes: {}, ...(from === undefined ? {} : { from }) };
}

function badge(slug: string, collectionSlug: string, name = "Craft quote"): Credential {
  return { slug, collectionSlug, name, learningTargets: [], task: "", rubric: "", extraSections: [] };
}

describe("programBadge (KTD3)", () => {
  it("gives the job id for a library badge in a copy of Bounded programs", () => {
    expect(programBadge(badge("craft-quote", "bounded-programs"), collection("bounded-programs", BOUNDED_PROGRAMS))).toBe("craft-quote");
  });

  it("gives the job id in a copy that took the next free slug", () => {
    expect(programBadge(badge("water-total", "bounded-programs-2"), collection("bounded-programs-2", BOUNDED_PROGRAMS))).toBe("water-total");
  });

  it("keeps a renamed badge a program badge, since its slug stays", () => {
    expect(programBadge(badge("craft-quote", "bounded-programs", "Quote a batch"), collection("bounded-programs", BOUNDED_PROGRAMS))).toBe("craft-quote");
  });

  it("gives null for a badge the user made in the copy", () => {
    expect(programBadge(badge("my-own-badge", "bounded-programs", "My own badge"), collection("bounded-programs", BOUNDED_PROGRAMS))).toBeNull();
  });

  it("gives null for a job-id slug in another built-in's copy", () => {
    expect(programBadge(badge("craft-quote", "cardano-dev-skills"), collection("cardano-dev-skills", "cardano-dev-skills"))).toBeNull();
  });

  it("gives null for a job-id slug in a collection of your own, even one named like the built-in", () => {
    expect(programBadge(badge("craft-quote", "bounded-programs"), collection("bounded-programs"))).toBeNull();
  });
});
