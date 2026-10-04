import { describe, expect, it } from "vitest";
import { MAX_REASON_CHARS } from "./jevExamples";
import { reasonLine } from "./reasonLine";

describe("reasonLine", () => {
  it("keeps a plain line as written, trimmed", () => {
    expect(reasonLine("  skips the rollback ")).toBe("skips the rollback");
    expect(reasonLine("")).toBe("");
    expect(reasonLine("   ")).toBe("");
  });

  it("turns every Unicode line break into a space, a CRLF into one", () => {
    expect(reasonLine("a\nb\rc\r\nd\u000be\u000cf\u0085g\u2028h\u2029i")).toBe("a b c d e f g h i");
  });

  it("drops leading # marks and spaces until none are left, so it never reads as a heading", () => {
    expect(reasonLine("## Note")).toBe("Note");
    expect(reasonLine("# # \t## Handback")).toBe("Handback");
    expect(reasonLine("\u2028## Note")).toBe("Note");
    expect(reasonLine("###")).toBe("");
    // A # inside the line stays.
    expect(reasonLine("misses #2")).toBe("misses #2");
  });

  it("caps the line at 200 code points, so an emoji is never split", () => {
    expect(MAX_REASON_CHARS).toBe(200);
    expect(Array.from(reasonLine("😀".repeat(201)))).toHaveLength(200);
    expect(reasonLine("😀".repeat(201))).toBe("😀".repeat(200));
    expect(reasonLine(`${"a".repeat(199)} b`)).toBe("a".repeat(199));
  });
});
