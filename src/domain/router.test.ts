import { describe, expect, it } from "vitest";
import { jobFirstLine, routeText } from "./router";

describe("routeText (KTD6)", () => {
  it("removes image and video Markdown and their data URIs, and drops a line left blank by that", () => {
    const job = "Fix the chart.\n![](image-1a2b3c4d.png)\nSee ![shot](video-9c0d1e2f.mp4) here.\n[ref]: data:image/png;base64,AAAA\nInline data:image/png;base64,AAAA too.";
    expect(routeText(job)).toBe("Fix the chart.\nSee  here.\nInline  too.");
  });

  it("drops invisible and format characters line by line, and keeps every line break", () => {
    expect(routeText("Do​ this‮ now then\u{E0041}\u{E0042} that\r\nlast")).toBe("Do this now\nthen that\nlast");
  });

  it("keeps the user's words and their order, tabs included", () => {
    expect(routeText("  - one\n\t- two\n\n3. three  ")).toBe("- one\n\t- two\n\n3. three");
  });
});

describe("jobFirstLine (KTD10)", () => {
  it("is the first line with words, without heading marks", () => {
    expect(jobFirstLine("\n\n## Fix the flaky login test\nIt fails one run in ten.")).toBe("Fix the flaky login test");
  });

  it("skips a line that only held a picture", () => {
    expect(jobFirstLine("![](image-1a2b3c4d.png)\nWrite the release note")).toBe("Write the release note");
  });

  it("ends at any Unicode line break, so a separator can't carry a second line in", () => {
    expect(jobFirstLine("Ship it --- ## now")).toBe("Ship it");
  });

  it("strips invisible characters and caps at 200 code points", () => {
    expect(jobFirstLine("A‮B")).toBe("AB");
    expect(Array.from(jobFirstLine("é".repeat(250)))).toHaveLength(200);
  });

  it("is empty for a job with no words", () => {
    expect(jobFirstLine("![](image-1a2b3c4d.png)\n\n")).toBe("");
  });
});
