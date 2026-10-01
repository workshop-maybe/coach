import { describe, expect, it } from "vitest";
import type { Credential } from "./types";
import { BUILT_IN_HANDOFF, checkHandoff, fillHandoff } from "./handoffs";

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

const HANDBACK = [
  "---",
  "",
  "## Handback",
  "",
  "End your reply with this section, filled in. I will read it when I review your work.",
  "",
  "- **What I did:**",
  "- **What I found:**",
  "- **What is still open:**",
  "",
].join("\n");

const INTRO =
  "This is a test. Do the task below as well as you can, and I will review your results. " +
  "Work on your own. Do not ask me questions before you start. If something is unclear, " +
  "make a reasonable choice and say what you chose in your hand-back.";

/** The test prompt exactly as it read before handoffs, captured from `testPrompt`. */
const TODAY_REVIEW = [
  "# Test: Review a PR",
  "",
  INTRO,
  "",
  "## Learning targets",
  "",
  "1. I can find correctness bugs in a diff.",
  "2. I can explain a finding so the author can act on it.",
  "",
  "## Task",
  "",
  "Review the diff below and list every correctness bug you find.",
  "",
  HANDBACK,
].join("\n");

const TODAY_EMPTY = [
  "# Test: Review a PR",
  "",
  INTRO,
  "",
  "## Learning targets",
  "",
  "(No learning targets written yet.)",
  "",
  "## Task",
  "",
  "(No task written yet.)",
  "",
  HANDBACK,
].join("\n");

describe("BUILT_IN_HANDOFF", () => {
  it("filled with the review credential is exactly today's test prompt", () => {
    expect(fillHandoff(BUILT_IN_HANDOFF, credential())).toBe(TODAY_REVIEW);
  });

  it("keeps today's placeholders for empty learning targets and an empty task", () => {
    const c = credential({ learningTargets: ["", "  "], task: "  \n" });
    expect(fillHandoff(BUILT_IN_HANDOFF, c)).toBe(TODAY_EMPTY);
  });

  it("holds the three slots and passes the save check", () => {
    for (const slot of ["{{name}}", "{{learning_targets}}", "{{task}}"]) {
      expect(BUILT_IN_HANDOFF).toContain(slot);
    }
    expect(checkHandoff(BUILT_IN_HANDOFF)).toBeNull();
  });
});

describe("fillHandoff", () => {
  it("fills name, learning targets and task from the credential", () => {
    const template = "Badge {{name}}.\nTargets:\n{{learning_targets}}\nDo this: {{task}}";
    expect(fillHandoff(template, credential())).toBe(
      "Badge Review a PR.\nTargets:\n" +
        "1. I can find correctness bugs in a diff.\n" +
        "2. I can explain a finding so the author can act on it.\n" +
        "Do this: Review the diff below and list every correctness bug you find.",
    );
  });

  it("fills a slot every time it appears", () => {
    expect(fillHandoff("{{name}} / {{name}}", credential())).toBe("Review a PR / Review a PR");
  });

  it("leaves {{rubric}} and any other braces literal", () => {
    const out = fillHandoff("{{task}}\n{{rubric}} {{unknown}} {{ task }} {{Name}}", credential());
    expect(out).toContain("{{rubric}} {{unknown}} {{ task }} {{Name}}");
    expect(out).not.toContain(RUBRIC);
  });

  it("puts credential text in as written, without filling slots inside it", () => {
    const c = credential({ name: "Cost $& and $1", task: "Write {{name}} in the {{task}} box." });
    expect(fillHandoff("{{name}}: {{task}}", c)).toBe(
      "Cost $& and $1: Write {{name}} in the {{task}} box.",
    );
  });

  it("Covers AE7. carries the task as it is now, and never the rubric", () => {
    const template = "# {{name}}\n\n{{learning_targets}}\n\n{{task}}\n\n{{rubric}}\n";
    const edited = credential({ task: "Review the new diff and rank the bugs by severity." });
    const out = fillHandoff(template, edited);
    expect(out).toContain("Review the new diff and rank the bugs by severity.");
    expect(out).not.toContain(credential().task);
    expect(out).not.toContain(RUBRIC);
  });
});

describe("checkHandoff", () => {
  it("passes a template with {{task}}", () => {
    expect(checkHandoff("Do this: {{task}}", RUBRIC)).toBeNull();
  });

  it("fails a template without {{task}} and names the missing slot", () => {
    expect(checkHandoff("# {{name}}\n\n{{learning_targets}}")).toEqual({
      kind: "missing-slot",
      slot: "{{task}}",
    });
  });

  it("fails a badge template that holds the badge's rubric verbatim", () => {
    expect(checkHandoff(`{{task}}\n\nYou pass when: ${RUBRIC}`, RUBRIC)).toEqual({
      kind: "has-rubric",
    });
  });

  it("matches the rubric after trimming its surrounding whitespace", () => {
    expect(checkHandoff(`{{task}}\n${RUBRIC}`, `\n  ${RUBRIC}  \n`)).toEqual({ kind: "has-rubric" });
  });

  it("never fails on an empty or blank rubric", () => {
    expect(checkHandoff("{{task}}", "")).toBeNull();
    expect(checkHandoff("{{task}}", "  \n ")).toBeNull();
  });
});
