// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlHasText, imagePaste } from "./pasteImages";
import { pngFile } from "../test/paste";

/** Clipboard data as a paste event carries it. */
function clipboard(flavors: Record<string, string>, files: File[] = []): DataTransfer {
  return {
    types: Object.keys(flavors),
    getData: (type: string) => flavors[type] ?? "",
    files,
    items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
  } as unknown as DataTransfer;
}

describe("htmlHasText", () => {
  it("finds text beside an image, and none in an image alone", () => {
    expect(htmlHasText("<p>Revenue</p><img src=x>")).toBe(true);
    expect(htmlHasText('<meta charset="utf-8"><img src="https://example.com/p.png">')).toBe(false);
    expect(htmlHasText('<img src="x" alt="a picture">')).toBe(false);
  });
});

describe("imagePaste (KTD5)", () => {
  it("takes the image files of a paste with no text", () => {
    const file = pngFile();
    expect(imagePaste(clipboard({}, [file]))).toEqual([file]);
  });

  it("takes an image whose text is only its address", () => {
    expect(imagePaste(clipboard({ "text/plain": "https://example.com/p.png" }, [pngFile()]))).toHaveLength(1);
  });

  it("leaves a paste with real text to the text path", () => {
    expect(imagePaste(clipboard({ "text/plain": "Revenue Q3" }, [pngFile()]))).toEqual([]);
    expect(imagePaste(clipboard({ "text/html": "<p>Revenue Q3</p>" }, [pngFile()]))).toEqual([]);
  });

  it("ignores files that are not images, and a paste with no clipboard", () => {
    expect(imagePaste(clipboard({}, [new File(["%PDF"], "a.pdf", { type: "application/pdf" })]))).toEqual([]);
    expect(imagePaste(null)).toEqual([]);
  });

  it("reads the items when the files list is empty", () => {
    const file = pngFile();
    const data = { ...clipboard({}, [file]), files: [], getData: () => "" } as unknown as DataTransfer;
    expect(imagePaste(data)).toEqual([file]);
  });
});
