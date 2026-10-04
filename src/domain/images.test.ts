import { describe, expect, it } from "vitest";
import { bytesToBase64, dataUriToBytes, folderOf, imageExtension, isImageDataUri, isLocalImageName, localImageNames, withAssetsRefs } from "./images";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

describe("isLocalImageName (KTD2)", () => {
  it("takes a bare PNG or JPEG file name, in any case, with spaces and Unicode", () => {
    for (const name of ["image-1a2b3c4d.png", "shot.JPG", "a.jpeg", "Screenshot 2026-10-04 at 09.12.png", "café.png"]) {
      expect(isLocalImageName(name), name).toBe(true);
    }
  });

  it("refuses paths, schemes, markup, other formats and control characters", () => {
    for (const src of [
      "",
      "sub/x.png",
      "..\\x.png",
      "../x.png",
      "a..b.png",
      "/abs.png",
      "C:x.png",
      "https://example.com/p.png",
      "data:image/png;base64,AAAA",
      "x.gif",
      "a<b>.png",
      'a"b.png',
      "x<img/src=x/onerror=alert(1)>.gif",
      "a\u0000b.png",
      "a\nb.png",
      "png",
      ".png",
    ]) {
      expect(isLocalImageName(src), JSON.stringify(src)).toBe(false);
    }
  });
});

describe("isImageDataUri", () => {
  it("accepts only base64 PNG and JPEG data URIs", () => {
    expect(isImageDataUri("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isImageDataUri("data:image/jpeg;base64,/9j/4AA=")).toBe(true);
    expect(isImageDataUri("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isImageDataUri("https://example.com/p.png")).toBe(false);
    expect(isImageDataUri("javascript:alert(1)")).toBe(false);
  });
});

describe("image bytes", () => {
  it("names the format from magic bytes, not from a name", () => {
    expect(imageExtension(PNG_BYTES)).toBe("png");
    expect(imageExtension(JPEG_BYTES)).toBe("jpg");
    expect(imageExtension(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(imageExtension(new Uint8Array())).toBeNull();
  });

  it("round-trips bytes through a data URI", () => {
    const uri = `data:image/png;base64,${bytesToBase64(PNG_BYTES)}`;
    expect(dataUriToBytes(uri)).toEqual(PNG_BYTES);
  });

  it("encodes bytes past the size a single string conversion can take", () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 251);
    expect(dataUriToBytes(`data:image/png;base64,${bytesToBase64(big)}`)).toEqual(big);
  });
});

describe("localImageNames", () => {
  it("lists bare-name image refs in order, once each", () => {
    const md = "Look:\n\n![](image-1a2b3c4d.png)\n\nAnd ![alt](b.jpg \"t\") then ![](image-1a2b3c4d.png) and ![](<two words.png>).";
    expect(localImageNames(md)).toEqual(["image-1a2b3c4d.png", "b.jpg", "two words.png"]);
  });

  it("skips remote, nested and non-image refs, and links", () => {
    expect(localImageNames("![](https://e.com/p.png) ![](sub/x.png) ![](x.gif) [link](a.png)")).toEqual([]);
  });
});

describe("withAssetsRefs (KTD9)", () => {
  it("points each renamed bare ref at assets/, wherever it appears", () => {
    const md = "![](a.png) and ![alt](a.png \"t\") and ![](<my shot.png>) and ![](https://e.com/a.png)";
    const out = withAssetsRefs(md, new Map([["a.png", "image-1a2b3c4d.png"], ["my shot.png", "image-00000000.png"]]));
    expect(out).toBe('![](assets/image-1a2b3c4d.png) and ![alt](assets/image-1a2b3c4d.png "t") and ![](assets/image-00000000.png) and ![](https://e.com/a.png)');
  });

  it("leaves a ref with no entry unchanged", () => {
    expect(withAssetsRefs("![](missing.png)", new Map())).toBe("![](missing.png)");
  });
});

describe("folderOf", () => {
  it("drops the file name, and gives the root for a top-level file", () => {
    expect(folderOf("collections/c/credentials/x.md")).toBe("collections/c/credentials");
    expect(folderOf("agents/a.json")).toBe("agents");
    expect(folderOf("x.md")).toBe("");
  });
});
