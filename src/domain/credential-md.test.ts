import { describe, expect, it } from "vitest";
import { parseCredentialMd, serializeCredentialMd } from "./credential-md";
import type { Credential } from "./types";

const ids = { slug: "code-review", collectionSlug: "engineering" };

const credential: Credential = {
  ...ids,
  name: "Code review",
  learningTargets: ["I can find bugs in a diff.", "I can explain a fix."],
  task: "Review the open PR.\n\nList every bug you find.",
  rubric: "- Finds the off-by-one.\n- No false positives.",
  extraSections: [],
};

describe("serializeCredentialMd", () => {
  it("writes H1, numbered targets, Task and Rubric in order", () => {
    expect(serializeCredentialMd(credential)).toBe(
      [
        "# Code review",
        "",
        "## Learning targets",
        "",
        "1. I can find bugs in a diff.",
        "2. I can explain a fix.",
        "",
        "## Task",
        "",
        "Review the open PR.",
        "",
        "List every bug you find.",
        "",
        "## Rubric",
        "",
        "- Finds the off-by-one.",
        "- No false positives.",
        "",
      ].join("\n"),
    );
  });

  it("writes extra sections after Rubric in their original order", () => {
    const text = serializeCredentialMd({
      ...credential,
      extraSections: [
        { heading: "Notes", body: "Hand note." },
        { heading: "Links", body: "- a\n- b" },
      ],
    });
    expect(text.endsWith("## Rubric\n\n- Finds the off-by-one.\n- No false positives.\n\n## Notes\n\nHand note.\n\n## Links\n\n- a\n- b\n")).toBe(true);
  });
});

describe("parseCredentialMd", () => {
  it("parses an app-written credential back to the same fields", () => {
    expect(parseCredentialMd(serializeCredentialMd(credential), ids)).toEqual(credential);
  });

  it("round-trips stably, including extras and empty sections", () => {
    const withExtras: Credential = {
      ...credential,
      task: "",
      learningTargets: [],
      extraSections: [{ heading: "Notes", body: "Kept.\n\n```\n## fenced\n```\n" }],
    };
    const once = serializeCredentialMd(withExtras);
    const twice = serializeCredentialMd(parseCredentialMd(once, ids));
    expect(twice).toBe(once);
  });

  it("keeps a hand-added ## Notes section through an edit and save", () => {
    const hand = serializeCredentialMd(credential) + "\n## Notes\n\nWritten by hand.\nTwo lines.\n";
    const parsed = parseCredentialMd(hand, ids);
    expect(parsed.extraSections).toEqual([{ heading: "Notes", body: "Written by hand.\nTwo lines." }]);
    const saved = serializeCredentialMd({ ...parsed, task: "A new task." });
    const reparsed = parseCredentialMd(saved, ids);
    expect(reparsed.task).toBe("A new task.");
    expect(reparsed.extraSections).toEqual(parsed.extraSections);
    expect(saved).toContain("## Notes\n\nWritten by hand.\nTwo lines.\n");
  });

  it("loads a file with no ## Rubric with an empty rubric", () => {
    const parsed = parseCredentialMd("# Name\n\n## Learning targets\n\n1. One\n\n## Task\n\nDo it.\n", ids);
    expect(parsed.rubric).toBe("");
    expect(parsed.task).toBe("Do it.");
    expect(parsed.learningTargets).toEqual(["One"]);
  });

  it("tolerates a file with only an H1", () => {
    const parsed = parseCredentialMd("# Only a name\n", ids);
    expect(parsed).toEqual({ ...ids, name: "Only a name", learningTargets: [], task: "", rubric: "", extraSections: [] });
  });

  it("throws a descriptive error when there is no H1", () => {
    expect(() => parseCredentialMd("## Task\n\nDo it.\n", ids)).toThrow(/H1/);
  });

  it("matches known headings case-insensitively", () => {
    const parsed = parseCredentialMd("# N\n\n## LEARNING TARGETS\n\n1. a\n\n## task\n\nT\n\n## RuBrIc\n\nR\n", ids);
    expect(parsed.learningTargets).toEqual(["a"]);
    expect(parsed.task).toBe("T");
    expect(parsed.rubric).toBe("R");
    expect(parsed.extraSections).toEqual([]);
  });

  it("reads bullets as well as numbers in learning targets", () => {
    const parsed = parseCredentialMd("# N\n\n## Learning targets\n\n- one\n* two\n3) three\n+ four\n", ids);
    expect(parsed.learningTargets).toEqual(["one", "two", "three", "four"]);
  });

  it("handles CRLF line endings", () => {
    const crlf = serializeCredentialMd({ ...credential, extraSections: [{ heading: "Notes", body: "x" }] }).replace(/\n/g, "\r\n");
    const parsed = parseCredentialMd(crlf, ids);
    expect(parsed).toEqual({ ...credential, extraSections: [{ heading: "Notes", body: "x" }] });
  });

  it("does not split sections on headings inside fenced code blocks", () => {
    const text = [
      "# N",
      "",
      "## Task",
      "",
      "Write this file:",
      "",
      "```md",
      "# Not the title",
      "## Rubric",
      "not a rubric",
      "```",
      "",
      "~~~",
      "## Notes",
      "~~~",
      "",
      "## Rubric",
      "",
      "Real rubric.",
      "",
    ].join("\n");
    const parsed = parseCredentialMd(text, ids);
    expect(parsed.name).toBe("N");
    expect(parsed.task).toBe("Write this file:\n\n```md\n# Not the title\n## Rubric\nnot a rubric\n```\n\n~~~\n## Notes\n~~~");
    expect(parsed.rubric).toBe("Real rubric.");
    expect(parsed.extraSections).toEqual([]);
    expect(serializeCredentialMd(parseCredentialMd(serializeCredentialMd(parsed), ids))).toBe(serializeCredentialMd(parsed));
  });

  it("does not take a fenced H1 as the name", () => {
    expect(() => parseCredentialMd("```\n# Fenced\n```\n\n## Task\n\nx\n", ids)).toThrow(/H1/);
  });
});

describe("preamble between the title and the first section", () => {
  it("survives a parse and save, including a fenced block", () => {
    const text = "# Review a PR\n\nWritten for the platform team.\n\n```\n## not a heading\n```\n\n## Learning targets\n\n1. Read a diff\n\n## Task\n\nReview it.\n";
    const credential = parseCredentialMd(text, { slug: "review-a-pr", collectionSlug: "eng" });
    const saved = serializeCredentialMd(credential);
    expect(saved).toContain("Written for the platform team.");
    expect(saved).toContain("```\n## not a heading\n```");
    expect(saved.indexOf("Written for")).toBeLessThan(saved.indexOf("## Learning targets"));
    expect(credential.learningTargets).toEqual(["Read a diff"]);
    expect(serializeCredentialMd(parseCredentialMd(saved, { slug: "review-a-pr", collectionSlug: "eng" }))).toBe(saved);
  });
});
