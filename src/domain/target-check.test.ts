import { describe, expect, it } from "vitest";
import { appendToRubric, checkTarget } from "./target-check";

// Before/after pairs from coach knowledge/slt-patterns/successful-rewrites.yaml, where the
// rewrite is a pure removal. The rest are this app's own cases.

function moved(text: string) {
  const hit = checkTarget(text);
  if (hit?.kind !== "move") throw new Error(`expected a move for: ${text}`);
  return hit;
}

describe("checkTarget: a list in the target", () => {
  it("moves a parenthetical list", () => {
    expect(moved("I can review a PR (tests, types, docs).")).toEqual({
      kind: "move",
      issue: "list",
      target: "I can review a PR.",
      rubricLine: "Tests, types, docs",
    });
  });

  it.each([
    ["I can navigate the course catalog and identify key course metadata (status, modules, credential).", "I can navigate the course catalog and identify key course metadata."],
    ["I can describe how courses are structured (Course → Module → SLTs → Lessons → Assignment → Credential).", "I can describe how courses are structured."],
    ["I can navigate to the admin dashboard and identify its key sections (courses, projects).", "I can navigate to the admin dashboard and identify its key sections."],
    ["I can explain the assignment review workflow: submit > review > accept/revise > credential claim.", "I can explain the assignment review workflow."],
    ["I can write effective Student Learning Targets using the formula: measurable verb + specific outcome + observable evidence.", "I can write effective Student Learning Targets."],
    ["I can create lesson content using the Tiptap rich text editor including text, formatting, and media.", "I can create lesson content using the Tiptap rich text editor."],
    ["I can define a moderation policy for my relay using allow lists, deny lists, or NIP-based filtering.", "I can define a moderation policy for my relay."],
  ])("coach rewrite: %s", (before, after) => {
    expect(moved(before).target).toBe(after);
  });

  it("keeps the words that lead into a colon list with the list", () => {
    expect(moved("I can write effective Student Learning Targets using the formula: measurable verb + specific outcome + observable evidence.").rubricLine).toBe(
      "Using the formula: measurable verb + specific outcome + observable evidence",
    );
  });

  it("moves an inline list with the word that introduces it", () => {
    expect(moved("I can monitor relay health using logs, metrics, and connection status.")).toMatchObject({
      target: "I can monitor relay health.",
      rubricLine: "Using logs, metrics, and connection status",
    });
  });

  it("leaves a pair alone, and a parenthetical that is not a list", () => {
    expect(checkTarget("I can create a task definition with description and requirements.")).toBeNull();
    expect(checkTarget("I can write a migration (Postgres).")).toBeNull();
  });
});

describe("checkTarget: a quantity", () => {
  it("coach rewrite: moves at least one, and keeps the article", () => {
    expect(moved("I can add at least one teacher to a course.")).toEqual({
      kind: "move",
      issue: "quantity",
      target: "I can add a teacher to a course.",
      rubricLine: "At least one teacher to a course",
    });
  });

  it("uses an before a vowel and drops a larger count", () => {
    expect(moved("I can write at least one integration test.").target).toBe("I can write an integration test.");
    expect(moved("I can list at least 3 risks in a plan.").target).toBe("I can list risks in a plan.");
  });

  it("uses a before a vowel letter that sounds like a consonant", () => {
    expect(moved("I can write at least one unit test.").target).toBe("I can write a unit test.");
    expect(moved("I can onboard at least one user.").target).toBe("I can onboard a user.");
  });
});

describe("checkTarget: a how clause", () => {
  it("coach rewrite: moves the by-clause, quantity and all", () => {
    expect(moved("I can compare a portable access token to a traditional platform account by identifying at least two differences in ownership, portability, and revocability.")).toEqual({
      kind: "move",
      issue: "how",
      target: "I can compare a portable access token to a traditional platform account.",
      rubricLine: "By identifying at least two differences in ownership, portability, and revocability",
    });
  });

  it("needs a verb after by", () => {
    expect(checkTarget("I can ship a fix by the end of a session.")).toBeNull();
    expect(checkTarget("I can sort records by string length.")).toBeNull();
  });
});

describe("checkTarget: two skills", () => {
  it.each([
    "I can claim my credential after teacher approval and explain what makes it verifiable.",
    "I can explain the contributor assessment workflow and how treasury payouts work.",
    "I can compare nostr-rs-relay to other relay implementations and explain why you might choose it.",
  ])("asks, and never moves: %s", (text) => {
    expect(checkTarget(text)).toEqual({ kind: "ask", issue: "two-skills" });
  });

  it.each(["I can add and remove project managers.", "I can fund the project treasury and publish tasks on-chain.", "I can generate and export a treasury report."])(
    "leaves one workflow alone: %s",
    (text) => {
      expect(checkTarget(text)).toBeNull();
    },
  );
});

describe("checkTarget: nothing to say", () => {
  it.each(["", "I can find correctness bugs in a diff.", "I can review a PR."])("%s", (text) => {
    expect(checkTarget(text)).toBeNull();
  });

  it("offers nothing when the move would leave too little of the target", () => {
    expect(checkTarget("Review (tests, types, docs).")).toBeNull();
  });

  it("settles after one move", () => {
    const first = moved("I can review a PR (tests, types, docs).");
    expect(checkTarget(first.target)).toBeNull();
  });
});

describe("appendToRubric", () => {
  it("starts an empty rubric with the line", () => {
    expect(appendToRubric("", "Tests, types, docs")).toBe("- Tests, types, docs");
  });

  it("continues a list, and starts one after prose", () => {
    expect(appendToRubric("- Tests pass\n", "Types check")).toBe("- Tests pass\n- Types check");
    expect(appendToRubric("It builds.", "Types check")).toBe("It builds.\n\n- Types check");
    expect(appendToRubric("* Tests pass", "Types check")).toBe("* Tests pass\n- Types check");
  });

  it("adds a line already in the rubric only once", () => {
    expect(appendToRubric("- Tests pass\n- Types check", "Tests pass")).toBe("- Tests pass\n- Types check");
  });
});
