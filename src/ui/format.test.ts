import { describe, expect, it } from "vitest";
import { firstLine } from "./format";

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
