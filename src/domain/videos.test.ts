import { describe, expect, it } from "vitest";
import vectors from "./video-name-vectors.json";
import {
  FILE_NOT_APPROVED,
  ONLY_VIDEOS_AND_IMAGES,
  VIDEO_EXTENSIONS,
  VIDEO_MAX_BYTES,
  VIDEO_TOO_LARGE,
  alreadyNamed,
  hasVideoExtension,
  isAllowedVideoUrl,
  isLocalVideoName,
  localVideoNames,
  platformOf,
  type Platform,
} from "./videos";

describe("isLocalVideoName (KTD2)", () => {
  it("takes a bare MP4, M4V, MOV or WebM name, in any case, with spaces and Unicode", () => {
    for (const name of ["video-1a2b3c4d.mp4", "Clip 1.MOV", "é.webm"]) expect(isLocalVideoName(name), name).toBe(true);
  });

  it("refuses paths, schemes, queries, hidden names, other formats and markup", () => {
    for (const src of ["sub/x.mp4", "../x.mp4", "/x.mp4", "x.mp4?a", "https://x/v.mp4", ".x.mp4", "x.mkv", "x.png", "a<b.mp4"]) {
      expect(isLocalVideoName(src), JSON.stringify(src)).toBe(false);
    }
  });

  // The same file feeds the Rust tests, so the two rules cannot drift.
  it("agrees with every shared case", () => {
    for (const name of vectors.accept) expect(isLocalVideoName(name), JSON.stringify(name)).toBe(true);
    for (const name of vectors.refuse) expect(isLocalVideoName(name), JSON.stringify(name)).toBe(false);
  });
});

describe("hasVideoExtension", () => {
  it("is true for the four video extensions in any case, and false otherwise", () => {
    expect(VIDEO_EXTENSIONS).toEqual(["mp4", "m4v", "mov", "webm"]);
    for (const name of ["a.mp4", "a.M4V", "a.Mov", "dir/a.WEBM"]) expect(hasVideoExtension(name), name).toBe(true);
    for (const name of ["a.mkv", "a.png", "mp4", "a.mp4.txt", "a.mp4 "]) expect(hasVideoExtension(name), name).toBe(false);
  });
});

describe("isAllowedVideoUrl (KTD2)", () => {
  const everywhereRefused = [
    "media://evil/x.mp4",
    "media://localhost.evil/x.mp4",
    "https://media.localhost.evil/x.mp4",
    "http://media.localhost.evil/x.mp4",
    "file:///x.mp4",
    "data:video/mp4;base64,AA",
    "javascript:alert(1)",
    "https://example.com/x.mp4",
    "MEDIA://localhost/x.mp4",
    " media://localhost/x.mp4",
    "",
  ];

  for (const platform of ["mac", "linux"] as Platform[]) {
    it(`on ${platform} takes only the media scheme and blob URLs`, () => {
      expect(isAllowedVideoUrl("media://localhost/a%2Fvideo-1a2b3c4d.mp4", platform)).toBe(true);
      expect(isAllowedVideoUrl("blob:tauri://localhost/5b0c1c2e-0000-4000-8000-000000000000", platform)).toBe(true);
      // A loopback address another local process could answer.
      expect(isAllowedVideoUrl("http://media.localhost/x.mp4", platform)).toBe(false);
      expect(isAllowedVideoUrl("https://media.localhost/x.mp4", platform)).toBe(false);
      for (const url of everywhereRefused) expect(isAllowedVideoUrl(url, platform), url).toBe(false);
    });
  }

  it("on windows takes the media host over http or https, and blob URLs", () => {
    expect(isAllowedVideoUrl("http://media.localhost/a%2Fx.mp4", "windows")).toBe(true);
    expect(isAllowedVideoUrl("https://media.localhost/a%2Fx.mp4", "windows")).toBe(true);
    expect(isAllowedVideoUrl("blob:http://tauri.localhost/5b0c1c2e", "windows")).toBe(true);
    expect(isAllowedVideoUrl("media://localhost/x.mp4", "windows")).toBe(false);
    for (const url of everywhereRefused) expect(isAllowedVideoUrl(url, "windows"), url).toBe(false);
  });
});

describe("platformOf", () => {
  it("reads the platform from the webview's user agent", () => {
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)")).toBe("mac");
    expect(platformOf("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)")).toBe("linux");
    expect(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0")).toBe("windows");
  });

  it("reads an unknown agent as linux, the platform that plays from a blob", () => {
    expect(platformOf("Node.js/25")).toBe("linux");
    expect(platformOf("")).toBe("linux");
  });
});

describe("localVideoNames", () => {
  it("lists bare-name video refs in order, once each, with angle brackets and titles", () => {
    const md = "See ![](video-1a2b3c4d.mp4) and ![a](<my clip.mov>) then ![](video-1a2b3c4d.mp4 \"again\").";
    expect(localVideoNames(md)).toEqual(["video-1a2b3c4d.mp4", "my clip.mov"]);
  });

  it("skips remote, nested and image refs, and links", () => {
    expect(localVideoNames("![](https://e.com/v.mp4) ![](sub/x.mp4) ![](a.png) ![](x.mkv) [link](a.mp4)")).toEqual([]);
  });
});

describe("limits and refusals", () => {
  it("caps a video at 100 MiB", () => {
    expect(VIDEO_MAX_BYTES).toBe(100 * 1024 * 1024);
  });

  // The guide quotes these, and Rust sends the same text (the IPC contract).
  it("says each refusal in the contract's exact words", () => {
    expect(FILE_NOT_APPROVED).toBe("That file can't be added. Drag it from Finder or use the Video key.");
    expect(ONLY_VIDEOS_AND_IMAGES).toBe("Only MP4, MOV, M4V and WebM videos, and PNG and JPEG images, can be added.");
    expect(VIDEO_TOO_LARGE).toBe("That video is larger than 100 MB.");
    expect(alreadyNamed("video-1a2b3c4d.mp4")).toBe("A different file is already named video-1a2b3c4d.mp4.");
  });
});
