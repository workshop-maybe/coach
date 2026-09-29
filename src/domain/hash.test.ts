import { describe, expect, it } from "vitest";
import { assignmentVersion } from "./hash";

const task = "Review the open PR.\nList every bug you find.";
const rubric = "Finds the off-by-one.\nNo false positives.";

describe("assignmentVersion", () => {
  it("returns 12 lowercase hex chars", async () => {
    expect(await assignmentVersion(task, rubric)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is stable for the same task and rubric", async () => {
    const a = await assignmentVersion(task, rubric);
    const b = await assignmentVersion(task, rubric);
    expect(a).toBe(b);
  });

  it("ignores trailing spaces on lines", async () => {
    const spaced = "Review the open PR.   \nList every bug you find.\t";
    expect(await assignmentVersion(spaced, rubric)).toBe(await assignmentVersion(task, rubric));
  });

  it("ignores CRLF and CR line endings", async () => {
    const crlf = rubric.replace(/\n/g, "\r\n");
    const cr = rubric.replace(/\n/g, "\r");
    const base = await assignmentVersion(task, rubric);
    expect(await assignmentVersion(task, crlf)).toBe(base);
    expect(await assignmentVersion(task, cr)).toBe(base);
  });

  it("ignores leading and trailing blank lines", async () => {
    const padded = "\n  \n" + rubric + "\n\n   \n";
    expect(await assignmentVersion(task, padded)).toBe(await assignmentVersion(task, rubric));
  });

  it("changes when one word in the rubric changes", async () => {
    const edited = rubric.replace("off-by-one", "race");
    expect(await assignmentVersion(task, edited)).not.toBe(await assignmentVersion(task, rubric));
  });

  it("changes when task and rubric are swapped", async () => {
    expect(await assignmentVersion(rubric, task)).not.toBe(await assignmentVersion(task, rubric));
  });

  it("does not let text move across the task and rubric boundary", async () => {
    expect(await assignmentVersion("a\nb", "c")).not.toBe(await assignmentVersion("a", "b\nc"));
  });

  it("counts inner blank lines and indentation", async () => {
    const base = await assignmentVersion("a\nb", "c");
    expect(await assignmentVersion("a\n\nb", "c")).not.toBe(base);
    expect(await assignmentVersion("a\n  b", "c")).not.toBe(base);
  });

  it("handles empty parts", async () => {
    expect(await assignmentVersion("", "")).toMatch(/^[0-9a-f]{12}$/);
    expect(await assignmentVersion("x", "")).not.toBe(await assignmentVersion("", "x"));
  });
});
