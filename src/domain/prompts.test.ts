import { describe, expect, it } from "vitest";
import type { AgentProfile, Credential } from "./types";
import {
  PROMPT_JOBS,
  buildPrompt,
  checkCriteriaPrompt,
  refineHandoffNote,
  reviewAssignmentPrompt,
  suggestAssignmentsPrompt,
  testPrompt,
  type PromptJob,
} from "./prompts";

const RUBRIC = "The change must include tests. Tests cover the error path.";

function credential(overrides: Partial<Credential> = {}): Credential {
  return {
    slug: "review-a-pr",
    collectionSlug: "code-review",
    name: "Review a PR",
    learningTargets: [
      "I can find correctness bugs in a diff.",
      "I can explain a finding so the author can act on it.",
    ],
    task: "Review the diff below and list every correctness bug you find.",
    rubric: RUBRIC,
    extraSections: [],
    ...overrides,
  };
}

const profile: AgentProfile = {
  slug: "claude-high-api",
  name: "Claude high in api",
  harness: "claude-code-harness",
  model: "model-xyz-123",
  effort: "effort-ultra",
  repo: "/Users/someone/projects/secret-repo",
  notes: "private note about this setup",
  params: { temperatureKnob: "0.77", sandboxMode: "strict-mode-value" },
};

const allJobs: PromptJob[] = ["test", "check", "review", "suggest", "refine"];

function allPrompts(c: Credential): Record<PromptJob, string> {
  return {
    test: testPrompt(c, profile),
    check: checkCriteriaPrompt(c),
    review: reviewAssignmentPrompt(c),
    suggest: suggestAssignmentsPrompt(c),
    refine: refineHandoffNote(c),
  };
}

describe("testPrompt", () => {
  it("Covers AE4. contains the task and every learning target and never the rubric", () => {
    const c = credential({ rubric: "must include tests" });
    const out = testPrompt(c);
    expect(out).toContain(c.task);
    for (const t of c.learningTargets) expect(out).toContain(t);
    expect(out).not.toContain("must include tests");
    expect(out.toLowerCase()).not.toContain("rubric");
  });

  it("says this is a test the user will review", () => {
    const out = testPrompt(credential());
    expect(out).toMatch(/this is a test/i);
    expect(out).toMatch(/review/i);
  });

  it("numbers the learning targets in order", () => {
    const out = testPrompt(credential());
    expect(out).toContain("1. I can find correctness bugs in a diff.");
    expect(out).toContain("2. I can explain a finding so the author can act on it.");
  });

  it("ends with the handback block: a line, then ## Handback with three items", () => {
    const out = testPrompt(credential()).trimEnd();
    const lineAt = out.lastIndexOf("\n---\n");
    const handbackAt = out.lastIndexOf("## Handback");
    expect(lineAt).toBeGreaterThan(0);
    expect(handbackAt).toBeGreaterThan(lineAt);
    const block = out.slice(handbackAt);
    const did = block.indexOf("What I did");
    const found = block.indexOf("What I found");
    const open = block.indexOf("What is still open");
    expect(did).toBeGreaterThan(0);
    expect(found).toBeGreaterThan(did);
    expect(open).toBeGreaterThan(found);
    // Nothing but the handback block follows the line.
    expect(out.slice(lineAt + 5).trimStart().startsWith("## Handback")).toBe(true);
  });

  it("does not leak profile details beyond the display name", () => {
    const out = testPrompt(credential(), profile);
    for (const secret of [
      profile.slug,
      profile.harness,
      profile.model,
      profile.effort,
      profile.repo,
      profile.notes,
      "temperatureKnob",
      "0.77",
      "strict-mode-value",
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it("does not depend on the profile beyond the display name", () => {
    const c = credential();
    const withProfile = testPrompt(c, profile).split(profile.name).join("");
    const without = testPrompt(c);
    expect(withProfile.replace(/\s+/g, " ")).toBe(without.replace(/\s+/g, " "));
  });

  it("never includes the rubric even when it is long and multi-line", () => {
    const rubric = "## Pass\n\nSECRET-RUBRIC-LINE\n\n- tests present";
    const out = testPrompt(credential({ rubric }));
    expect(out).not.toContain("SECRET-RUBRIC-LINE");
  });
});

describe("helper prompts", () => {
  it("check includes the rubric, task and targets", () => {
    const c = credential();
    const out = checkCriteriaPrompt(c);
    expect(out).toContain(RUBRIC);
    expect(out).toContain(c.task);
    for (const t of c.learningTargets) expect(out).toContain(t);
    expect(out).toMatch(/acceptance criteria/i);
  });

  it("review includes the rubric, task and targets", () => {
    const c = credential();
    const out = reviewAssignmentPrompt(c);
    expect(out).toContain(RUBRIC);
    expect(out).toContain(c.task);
    for (const t of c.learningTargets) expect(out).toContain(t);
  });

  it("refine includes the rubric, task and targets", () => {
    const c = credential();
    const out = refineHandoffNote(c);
    expect(out).toContain(RUBRIC);
    expect(out).toContain(c.task);
    for (const t of c.learningTargets) expect(out).toContain(t);
  });

  it("helper prompts say they are for an agent helping the user, not a test", () => {
    for (const out of [
      checkCriteriaPrompt(credential()),
      reviewAssignmentPrompt(credential()),
      suggestAssignmentsPrompt(credential()),
      refineHandoffNote(credential()),
    ]) {
      expect(out).not.toMatch(/this is a test/i);
    }
  });
});

describe("suggestAssignmentsPrompt", () => {
  it("works for a credential with targets and an empty task", () => {
    const c = credential({ task: "", rubric: "" });
    const out = suggestAssignmentsPrompt(c);
    for (const t of c.learningTargets) expect(out).toContain(t);
    expect(out).toMatch(/suggest/i);
    expect(out).not.toContain("undefined");
    expect(out).not.toMatch(/\n{4,}/);
  });

  it("includes the current task when there is one", () => {
    const c = credential();
    expect(suggestAssignmentsPrompt(c)).toContain(c.task);
  });
});

describe("refineHandoffNote", () => {
  it("puts the brief above a line and a Handback section below it", () => {
    const out = refineHandoffNote(credential());
    const lineAt = out.lastIndexOf("\n---\n");
    const handbackAt = out.indexOf("## Handback");
    expect(lineAt).toBeGreaterThan(0);
    expect(handbackAt).toBeGreaterThan(lineAt);
    const above = out.slice(0, lineAt);
    expect(above).toContain(RUBRIC);
    expect(above).toContain(credential().task);
    const below = out.slice(handbackAt);
    expect(below).toMatch(/append/i);
    expect(below).toMatch(/below/i);
    expect(below).toContain("what I did · what I found · what is still open");
  });
});

describe("all prompts", () => {
  it("never mention the data folder or any file path (R10)", () => {
    const c = credential();
    for (const [job, out] of Object.entries(allPrompts(c))) {
      expect(out, job).not.toMatch(/data folder/i);
      expect(out, job).not.toContain(`${c.collectionSlug}/${c.slug}`);
      expect(out, job).not.toContain(c.collectionSlug);
      expect(out, job).not.toMatch(/\.(md|json)\b/);
      expect(out, job).not.toMatch(/(^|\s)(\.{0,2}\/|~\/|[A-Za-z]:\\)/m);
      expect(out, job).not.toContain(profile.repo);
    }
  });

  it("include a task with Markdown headings and code fences intact", () => {
    const task = [
      "## Setup",
      "",
      "Run this:",
      "",
      "```ts",
      "export function add(a: number, b: number) {",
      "  return a + b;",
      "}",
      "```",
      "",
      "### Then",
      "",
      "- Fix the bug.",
    ].join("\n");
    const c = credential({ task });
    for (const [job, out] of Object.entries(allPrompts(c))) {
      expect(out, job).toContain(task);
    }
  });

  it("handle an empty rubric", () => {
    const c = credential({ rubric: "" });
    for (const [job, out] of Object.entries(allPrompts(c))) {
      expect(out, job).not.toContain("undefined");
      expect(out, job).not.toMatch(/\n{4,}/);
    }
    for (const out of [checkCriteriaPrompt(c), reviewAssignmentPrompt(c), refineHandoffNote(c)]) {
      expect(out).toMatch(/no rubric/i);
    }
  });

  it("handle a credential with no learning targets", () => {
    const c = credential({ learningTargets: [] });
    for (const [job, out] of Object.entries(allPrompts(c))) {
      expect(out, job).not.toContain("undefined");
      expect(out, job).not.toMatch(/^1\.\s*$/m);
      expect(out, job).toMatch(/no learning targets/i);
      expect(out, job).toContain(c.task);
    }
  });

  it("use no em-dashes and no British spellings", () => {
    for (const [job, out] of Object.entries(allPrompts(credential()))) {
      expect(out, job).not.toContain("—");
      expect(out, job).not.toMatch(/behaviour|organis|colour|licence/i);
    }
  });

  it("include the credential name", () => {
    for (const out of Object.values(allPrompts(credential()))) {
      expect(out).toContain("Review a PR");
    }
  });
});

describe("buildPrompt and PROMPT_JOBS", () => {
  it("dispatches each job to its function", () => {
    const c = credential();
    const expected = allPrompts(c);
    for (const job of allJobs) {
      const out = buildPrompt(job, c, job === "test" ? profile : undefined);
      expect(out).toBe(expected[job]);
    }
  });

  it("lists all five jobs with labels, and only test needs a profile", () => {
    expect(PROMPT_JOBS.map((j) => j.job)).toEqual(allJobs);
    for (const j of PROMPT_JOBS) {
      expect(j.label.length).toBeGreaterThan(0);
      expect(j.needsProfile).toBe(j.job === "test");
    }
  });
});
