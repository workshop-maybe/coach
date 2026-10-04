import { describe, expect, it } from "vitest";
import { firstLine, goToLine } from "./format";

describe("the go-to line (KTD8, KTD9)", () => {
  it("names the agent, then each flag in a few words", () => {
    expect(goToLine("Codex", [])).toBe("Go-to: Codex");
    expect(goToLine("Codex", ["not_met"])).toBe("Go-to: Codex · not met");
    expect(goToLine("Codex", ["not_met", "setup_mismatch"])).toBe("Go-to: Codex · not met · setup changed");
  });
});

describe("firstLine", () => {
  it("takes the first line of the text", () => {
    expect(firstLine("\n  Fix the header\nThen the footer")).toBe("Fix the header");
  });

  it("skips lines that hold only images, so a preview never shows raw image Markdown", () => {
    expect(firstLine("![](image-1a2b3c4d.png)\nFix the header")).toBe("Fix the header");
    expect(firstLine("![a](x.png) ![](<two words.png>)\n\nFix it")).toBe("Fix it");
    expect(firstLine("See ![](x.png) here")).toBe("See ![](x.png) here");
  });

  it("falls back to the first line when every line is an image, and gives nothing for no text", () => {
    expect(firstLine("![](x.png)\n![](y.png)")).toBe("![](x.png)");
    expect(firstLine("")).toBe("");
  });
});
