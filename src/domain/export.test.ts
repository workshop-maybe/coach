import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { MemoryStorage } from "../storage/memory";
import { buildExport, writeExport } from "./export";
import type { Collection, Credential } from "./types";

function credential(overrides: Partial<Credential> = {}): Credential {
  return {
    slug: "review-a-pr",
    collectionSlug: "code-review",
    name: "Review a PR",
    learningTargets: ["I can find correctness bugs in a diff.", "I can explain a finding."],
    task: "Review the diff below and list every correctness bug.",
    rubric: "Every real bug is listed. No false positives.",
    extraSections: [],
    ...overrides,
  };
}

const review = credential();
const write = credential({
  slug: "write-tests",
  name: "Write tests",
  learningTargets: ["I can cover the error path."],
  task: "Add tests for the parser.",
  rubric: "Tests fail before the fix.",
});

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    slug: "code-review",
    name: "Code Review",
    description: "Reviewing and testing code.",
    order: ["review-a-pr", "write-tests"],
    codes: { "review-a-pr": 1, "write-tests": 2 },
    ...overrides,
  };
}

const NO_RUBRIC = { includeRubric: false };
const WITH_RUBRIC = { includeRubric: true };

function frontmatter(md: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(md);
  expect(match).not.toBeNull();
  return YAML.parse(match![1]);
}

describe("buildExport", () => {
  it("exports two credentials in the CLI directory layout plus one JSON file", () => {
    const files = buildExport(collection(), [review, write], NO_RUBRIC);
    expect([...files.keys()].sort()).toEqual([
      "code-review.json",
      "code-review/1/assignment.md",
      "code-review/1/outline.md",
      "code-review/2/assignment.md",
      "code-review/2/outline.md",
    ]);
  });

  it("writes outline.md with frontmatter and a numbered SLT list, as the CLI expects", () => {
    const files = buildExport(collection(), [review, write], NO_RUBRIC);
    expect(files.get("code-review/1/outline.md")).toBe(
      [
        "---",
        'title: "Review a PR"',
        'code: "1"',
        "---",
        "",
        "# Review a PR",
        "",
        "## SLTs",
        "",
        "1. I can find correctness bugs in a diff.",
        "2. I can explain a finding.",
        "",
      ].join("\n"),
    );
  });

  it("keeps each credential's directory code when the collection is reordered", () => {
    const before = buildExport(collection(), [review, write], NO_RUBRIC);
    const after = buildExport(
      collection({ order: ["write-tests", "review-a-pr"] }),
      [review, write],
      NO_RUBRIC,
    );
    expect(after.get("code-review/1/outline.md")).toBe(before.get("code-review/1/outline.md"));
    expect(after.get("code-review/2/outline.md")).toBe(before.get("code-review/2/outline.md"));
    expect(after.get("code-review/1/outline.md")).toContain("# Review a PR");
    expect(after.get("code-review/2/outline.md")).toContain("# Write tests");
  });

  it("uses stored codes, not positions", () => {
    const files = buildExport(
      collection({ order: ["write-tests"], codes: { "review-a-pr": 1, "write-tests": 7 } }),
      [review, write],
      NO_RUBRIC,
    );
    expect(files.has("code-review/7/outline.md")).toBe(true);
    expect(files.has("code-review/1/outline.md")).toBe(false);
  });

  it("lists modules in the collection's order", () => {
    const files = buildExport(
      collection({ order: ["write-tests", "review-a-pr"] }),
      [review, write],
      NO_RUBRIC,
    );
    const json = JSON.parse(files.get("code-review.json")!);
    expect(json.course.modules.map((m: { code: string }) => m.code)).toEqual(["2", "1"]);
  });

  it("produces valid frontmatter for a title with a colon and quotes", () => {
    const tricky = credential({ name: 'Review: the "hard" PR \\ #1' });
    const files = buildExport(collection(), [tricky], NO_RUBRIC);
    const fm = frontmatter(files.get("code-review/1/outline.md")!);
    expect(fm).toEqual({ title: 'Review: the "hard" PR \\ #1', code: "1" });
  });

  it("writes assignment.md as the title plus the task", () => {
    const files = buildExport(collection(), [review], NO_RUBRIC);
    expect(files.get("code-review/1/assignment.md")).toBe(
      "# Review a PR\n\nReview the diff below and list every correctness bug.\n",
    );
  });

  it("writes an assignment.md with only its title for an empty task", () => {
    const files = buildExport(collection(), [credential({ task: "  \n" })], NO_RUBRIC);
    expect(files.get("code-review/1/assignment.md")).toBe("# Review a PR\n");
  });

  it("leaves the rubric out of both formats by default", () => {
    const files = buildExport(collection(), [review], NO_RUBRIC);
    expect(files.get("code-review/1/assignment.md")).not.toContain("Rubric");
    expect(files.get("code-review/1/assignment.md")).not.toContain(review.rubric);
    const json = JSON.parse(files.get("code-review.json")!);
    expect("rubric" in json.course.modules[0].assignment).toBe(false);
    expect(files.get("code-review.json")).not.toContain(review.rubric);
  });

  it("includes the rubric in both formats when chosen", () => {
    const files = buildExport(collection(), [review], WITH_RUBRIC);
    expect(files.get("code-review/1/assignment.md")).toBe(
      "# Review a PR\n\nReview the diff below and list every correctness bug.\n\n## Rubric\n\nEvery real bug is listed. No false positives.\n",
    );
    const json = JSON.parse(files.get("code-review.json")!);
    expect(json.course.modules[0].assignment.rubric).toBe(review.rubric);
  });

  it("maps collection to course, credentials to modules, targets to SLTs, task to assignment", () => {
    const files = buildExport(collection(), [review, write], NO_RUBRIC);
    expect(JSON.parse(files.get("code-review.json")!)).toEqual({
      course: {
        title: "Code Review",
        slug: "code-review",
        description: "Reviewing and testing code.",
        modules: [
          {
            code: "1",
            title: "Review a PR",
            slts: ["I can find correctness bugs in a diff.", "I can explain a finding."],
            assignment: {
              title: "Review a PR",
              content: "Review the diff below and list every correctness bug.",
            },
          },
          {
            code: "2",
            title: "Write tests",
            slts: ["I can cover the error path."],
            assignment: { title: "Write tests", content: "Add tests for the parser." },
          },
        ],
      },
    });
  });

  it("ignores credentials from other collections", () => {
    const other = credential({ collectionSlug: "other" });
    const files = buildExport(collection({ order: ["review-a-pr"] }), [other], NO_RUBRIC);
    expect([...files.keys()]).toEqual(["code-review.json"]);
  });
});

describe("writeExport", () => {
  it("writes every file to the export root", async () => {
    const storage = new MemoryStorage();
    const files = buildExport(collection(), [review, write], NO_RUBRIC);
    await writeExport(storage, files);
    expect(storage.files("export")).toEqual(Object.fromEntries(files));
    expect(storage.files("data")).toEqual({});
    expect(storage.writes.every((w) => w.root === "export")).toBe(true);
  });
});
