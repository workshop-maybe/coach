// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { filePaste, htmlHasText, imagePaste } from "./pasteImages";
import { pngFile, videoFile } from "../test/paste";

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

describe("filePaste (reply artifacts KTD7)", () => {
  const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "report.pdf", { type: "application/pdf" });

  it("names every file of a paste that carries one neither a PNG, a JPEG nor a video, with no text", () => {
    expect(filePaste(clipboard({}, [pdf()]))).toEqual([{ name: "report.pdf", size: 4 }]);
    expect(filePaste(clipboard({ "text/plain": "report.pdf" }, [pdf(), pngFile("shot.png")]))).toEqual([
      { name: "report.pdf", size: 4 },
      { name: "shot.png", size: 12 },
    ]);
  });

  it("takes a video beside such a file too, so the whole paste becomes items", () => {
    expect(filePaste(clipboard({}, [videoFile(), pdf()])).map((f) => f.name)).toEqual(["clip.mov", "report.pdf"]);
  });

  it("takes a GIF, since only PNG and JPEG stay inline", () => {
    const gif = new File([new Uint8Array(6)], "anim.gif", { type: "image/gif" });
    expect(filePaste(clipboard({}, [gif]))).toEqual([{ name: "anim.gif", size: 6 }]);
  });

  it("leaves a PNG, a video, a paste with real text, and no paste at all to the box", () => {
    expect(filePaste(clipboard({}, [pngFile()]))).toEqual([]);
    expect(filePaste(clipboard({}, [videoFile()]))).toEqual([]);
    expect(filePaste(clipboard({ "text/plain": "Here is my report" }, [pdf()]))).toEqual([]);
    expect(filePaste(null)).toEqual([]);
  });
});
