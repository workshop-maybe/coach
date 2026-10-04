// @vitest-environment jsdom
// The read-only reply view (U3): a stored reply shown as Markdown in the editor's type,
// safely (R11, R13, KTD5), or as its stored string exactly (R12, KTD6).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const opener = vi.hoisted(() => ({ openUrl: vi.fn((_url: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

import { RichView, externalHref } from "./RichView";
import type { RichImageSource, RichVideo } from "./richImage";
import { VIDEO_BUSY_MS } from "./richVideo";
import { imageSource, resultImages } from "./imageSource";
import { MemoryStorage } from "../storage/memory";
import { mp4Bytes } from "../test/videoBytes";

afterEach(cleanup);
beforeEach(() => opener.openUrl.mockClear());

function region(name = "Reply") {
  return screen.getByRole("region", { name });
}

function view(value: string, stored = false) {
  render(<RichView aria-label="Reply" value={value} stored={stored} />);
  return region();
}

function link(el: HTMLElement, text: string): HTMLAnchorElement {
  const a = [...el.querySelectorAll("a")].find((x) => x.textContent === text);
  if (!a) throw new Error(`no link "${text}"`);
  return a;
}

function middleClick(el: Element) {
  return fireEvent(el, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
}

const HOSTILE = [
  "Before",
  "<script>window.__ran = true</script>",
  '<img src=x onerror="window.__ran = true">',
  '<div onclick="window.__ran = true">raw <b>bold</b> <iframe src="https://example.com"></iframe></div>',
  "![a picture](https://example.com/p.png)",
  "![](v.mp4<img onerror>)",
  '<video src="https://x/v.mp4" autoplay controls poster="https://x/p.png"><source src="https://x/s.mp4"><track src="https://x/t.vtt"></video>',
  '<video data-md-video="https://x/w.mp4" src="https://x/w.mp4" autoplay></video>',
  'Copied <span data-md-video="https://x/v.mp4" src="https://x/q.mp4" poster="https://x/p.png" srcset="https://x/s.png 2x" onerror="window.__ran = true"></span> video',
  '<audio src="https://x/a.mp3" autoplay></audio>',
  'After <span onmouseover="x()">inline</span>',
].join("\n\n");

describe("RichView, rendered", () => {
  it("renders a heading, a list and a code block as those elements", () => {
    const el = view("## Findings\n\n- off by one\n- missing test\n\n```ts\nconst a = 1;\n```\n\nSome **bold** and `code`.");
    expect(el.querySelector("h2")?.textContent).toBe("Findings");
    expect([...el.querySelectorAll("ul li")].map((li) => li.textContent)).toEqual(["off by one", "missing test"]);
    expect(el.querySelector("pre code")?.textContent).toBe("const a = 1;");
    expect(el.querySelector("strong")?.textContent).toBe("bold");
    expect(el.textContent).not.toContain("##");
  });

  it("is drawn in the editor's prose type, and is not an editor", () => {
    const el = view("Plain words.");
    const prose = el.querySelector(".rich-prose");
    expect(prose?.textContent).toBe("Plain words.");
    expect(prose?.getAttribute("contenteditable")).toBe("false");
    expect(el.querySelector('[contenteditable="true"]')).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders no script, image, media, frame or inline handler from a reply's raw HTML", () => {
    const el = view(HOSTILE);
    // ProseMirror's own separator beside an inline node is an image with no source; nothing else may be.
    expect(el.querySelector("script, img:not(.ProseMirror-separator), video, audio, source, track, iframe, object, embed, style, link")).toBeNull();
    expect(el.querySelector("[src], [poster], [srcset], [autoplay], [onerror], [onclick], [onmouseover]")).toBeNull();
    expect(el.querySelector(".rich-image-missing")?.textContent).toBe("https://example.com/p.png");
    expect(el.querySelector(".rich-video-missing")?.textContent).toBe("https://x/v.mp4");
    expect((window as { __ran?: boolean }).__ran).toBeUndefined();
    expect(el.textContent).toContain("Before");
    expect(el.textContent).toContain("After");
  });

  it("shows a Markdown table's cell text, alone or among other blocks", () => {
    const alone = view("| Agent | Score |\n|---|---|\n| opus | 9 |");
    expect(alone.textContent).toContain("opus");
    expect(alone.textContent).toContain("9");
    cleanup();

    const among = view("Intro\n\n| Agent | Score |\n|---|---|\n| opus | 9 |\n| codex | 7 |\n\nOutro");
    for (const text of ["Intro", "Agent", "Score", "opus", "codex", "Outro"]) expect(among.textContent).toContain(text);
    expect(among.querySelector("table")).toBeNull();
  });

  it("renders an empty reply and a whitespace-only reply as an empty region", () => {
    expect(view("").textContent).toBe("");
    cleanup();
    expect(view("   \n\n  \n").textContent?.trim()).toBe("");
  });

  it("renders a very long reply in full", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `Paragraph ${i + 1} of the reply.`);
    const el = view(lines.join("\n\n"));
    expect(el.querySelectorAll(".rich-prose > p")).toHaveLength(1000);
    expect(el.textContent).toContain("Paragraph 1000 of the reply.");
  });

  it("takes a new value from outside", () => {
    const { rerender } = render(<RichView aria-label="Reply" value="# One" />);
    expect(region().querySelector("h1")?.textContent).toBe("One");
    rerender(<RichView aria-label="Reply" value="- Two" />);
    expect(region().querySelector("ul li")?.textContent).toBe("Two");
    expect(region().querySelector("h1")).toBeNull();
  });
});

const SHOT = "data:image/png;base64,iVBORw0KGgo=";

/** A source that answers every name with `uri`, and records what it was asked for. */
function source(uri: string | null | ((name: string) => Promise<string | null>)) {
  const asked: string[] = [];
  const images: RichImageSource = {
    load: (name) => {
      asked.push(name);
      return typeof uri === "function" ? uri(name) : Promise.resolve(uri);
    },
  };
  return { images, asked };
}

function viewWith(value: string, images?: RichImageSource, stored = false) {
  render(<RichView aria-label="Reply" value={value} stored={stored} images={images} />);
  return region();
}

describe("RichView, images (KTD2)", () => {
  it("shows a bare-name image as the data URI its source returns, and nothing else", async () => {
    const { images, asked } = source(SHOT);
    const el = viewWith("Here:\n\n![](image-1a2b3c4d.png)", images);
    // ProseMirror adds src-less separator images beside inline nodes; only the node's own image has a src.
    await waitFor(() => expect(el.querySelector("img[src]")).not.toBeNull());
    const imgs = el.querySelectorAll("img[src]");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe(SHOT);
    expect(imgs[0].getAttribute("alt")).toBe("image-1a2b3c4d.png");
    expect(imgs[0].getAttribute("draggable")).toBe("false");
    expect(new Set(asked)).toEqual(new Set(["image-1a2b3c4d.png"]));
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it.each(["https://example.com/p.png", "sub/x.png", "../x.png", "/abs.png", "data:image/png;base64,AAAA", "x.gif"])(
    "shows %s as an inert placeholder and never asks for it",
    async (src) => {
      const { images, asked } = source(SHOT);
      const el = viewWith(`![](<${src}>)`, images);
      await Promise.resolve();
      expect(el.querySelector("img[src]")).toBeNull();
      expect(el.querySelector(".rich-image-missing")?.textContent).toBe(src);
      expect(asked).toEqual([]);
    },
  );

  it("shows a placeholder, not busy, when the file is missing or the read fails", async () => {
    for (const answer of [null, () => Promise.reject(new Error("gone"))] as const) {
      const { images } = source(answer as never);
      const el = viewWith("![](image-1a2b3c4d.png)", images);
      await waitFor(() => expect(el.querySelector(".rich-image-missing")?.textContent).toBe("image-1a2b3c4d.png"));
      expect(el.querySelector("img[src]")).toBeNull();
      expect(el.querySelector('[aria-busy="true"]')).toBeNull();
      cleanup();
    }
  });

  it("shows a placeholder when the source answers with anything but a PNG or JPEG data URI", async () => {
    const { images } = source("data:image/svg+xml;base64,PHN2Zz4=");
    const el = viewWith("![](image-1a2b3c4d.png)", images);
    await waitFor(() => expect(el.querySelector(".rich-image-missing")).not.toBeNull());
    expect(el.querySelector("img[src]")).toBeNull();
  });

  it("is busy while the first read is in flight", async () => {
    let answer: (uri: string) => void = () => undefined;
    const { images } = source(() => new Promise<string>((r) => (answer = r)));
    const el = viewWith("![](image-1a2b3c4d.png)", images);
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    answer(SHOT);
    await waitFor(() => expect(el.querySelector("img[src]")).not.toBeNull());
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("shows a placeholder with no image source", () => {
    const el = viewWith("![](image-1a2b3c4d.png)");
    expect(el.querySelector("img[src]")).toBeNull();
    expect(el.querySelector(".rich-image-missing")?.textContent).toBe("image-1a2b3c4d.png");
  });

  it("builds nothing from markup in an image's alt, title or src", async () => {
    const { images } = source(SHOT);
    const md = [
      '![<b>x</b> <img src=x onerror=alert(1)>](a.png "t\\"<i>")',
      "![](x<img/src=x/onerror=alert(1)>.gif)",
      "![](<a\\<b\\>.png>)",
      '<img data-md-src="https://example.com/p.png" src="https://example.com/q.png" onerror="window.__ran = true">',
    ].join("\n\n");
    const el = viewWith(md, images);
    await waitFor(() => expect(el.querySelectorAll("img[src]")).toHaveLength(1));
    const img = el.querySelector("img[src]")!;
    expect(img.getAttribute("src")).toBe(SHOT);
    expect(img.getAttribute("alt")).toBe("<b>x</b> <img src=x onerror=alert(1)>");
    expect(el.querySelector("b, i, [onerror], [onclick], [onload]")).toBeNull();
    for (const node of el.querySelectorAll("[src]")) expect(node.getAttribute("src")).toBe(SHOT);
    const missing = [...el.querySelectorAll(".rich-image-missing")].map((x) => x.textContent);
    expect(missing).toEqual(expect.arrayContaining(["a<b>.png", "https://example.com/p.png"]));
    expect((window as { __ran?: boolean }).__ran).toBeUndefined();
  });

  it("keeps the webview's menu and drag off an image", async () => {
    const { images } = source(SHOT);
    const el = viewWith("![](image-1a2b3c4d.png)", images);
    await waitFor(() => expect(el.querySelector("img[src]")).not.toBeNull());
    const img = el.querySelector("img[src]")!;
    expect(fireEvent.contextMenu(img)).toBe(false);
    expect(fireEvent.dragStart(img)).toBe(false);
  });

  it("shows the stored Markdown as it is", () => {
    const { images } = source(SHOT);
    const el = viewWith("![](image-1a2b3c4d.png)", images, true);
    expect(el.querySelector("pre")?.textContent).toBe("![](image-1a2b3c4d.png)");
    expect(el.querySelector("img[src]")).toBeNull();
  });
});

/** One handle a video source gave out. */
interface Handed {
  name: string;
  url: string;
  release: ReturnType<typeof vi.fn>;
}

/**
 * A source whose pictures are SHOT and whose videos get a fresh handle per ask, with the URL
 * `urlFor` gives (null: missing). It records each name asked and each handle handed out. The
 * editor builds its node views twice as it mounts, so a name can be asked more than once;
 * what matters is that every handle but the one showing is released, and none twice.
 */
function videoSource(urlFor: (name: string) => string | null | Promise<string | null>, preload: RichVideo["preload"] = "metadata") {
  const asked: string[] = [];
  const handed: Handed[] = [];
  const images: RichImageSource = {
    load: () => Promise.resolve(SHOT),
    video: async (name) => {
      asked.push(name);
      const url = await urlFor(name);
      if (url === null) return null;
      const release = vi.fn();
      handed.push({ name, url, release });
      return { url, preload, release };
    },
  };
  /** The handles not yet released. */
  const held = () => handed.filter((h) => h.release.mock.calls.length === 0);
  /** Whether no handle was released more than once. */
  const releasedAtMostOnce = () => handed.every((h) => h.release.mock.calls.length <= 1);
  return { images, asked, handed, held, releasedAtMostOnce };
}

/** A URL that waits until the test answers it; every pending ask gets the same answer. */
function later() {
  const waiting: ((url: string | null) => void)[] = [];
  return {
    urlFor: () => new Promise<string | null>((r) => waiting.push(r)),
    answer: (url: string | null) => waiting.splice(0).forEach((r) => r(url)),
  };
}

/** The text of every image and video placeholder, in order. */
function missing(el: Element): (string | null)[] {
  return [...el.querySelectorAll(".rich-image-missing, .rich-video-missing")].map((x) => x.textContent);
}

/** Runs `body` with the webview's user agent reading as `ua`. */
async function withUserAgent(ua: string, body: () => Promise<void>) {
  const spy = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  try {
    await body();
  } finally {
    spy.mockRestore();
  }
}

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/120.0";

describe("RichView, videos (KTD2)", () => {
  it("plays a bare-name video from the URL its source returns, with controls and no autoplay", async () => {
    const { images, asked, held } = videoSource(() => "blob:x");
    const el = viewWith('Watch:\n\n![a demo](clip.mp4 "Take one")', images);
    await waitFor(() => expect(el.querySelector("video[src]")).not.toBeNull());
    const videos = el.querySelectorAll("video");
    expect(videos).toHaveLength(1);
    const player = videos[0];
    expect(player.getAttribute("src")).toBe("blob:x");
    expect(player.controls).toBe(true);
    expect(player.autoplay).toBe(false);
    expect(player.hasAttribute("autoplay")).toBe(false);
    expect(player.getAttribute("aria-label")).toMatch(/^Video/);
    expect(player.getAttribute("aria-label")).toContain("a demo");
    expect(player.getAttribute("title")).toBe("Take one");
    expect(new Set(asked)).toEqual(new Set(["clip.mp4"]));
    expect(held()).toHaveLength(1);
  });

  it("names a video with no alt just Video", async () => {
    const el = viewWith("![](clip.mp4)", videoSource(() => "blob:x").images);
    await waitFor(() => expect(el.querySelector("video[src]")).not.toBeNull());
    expect(el.querySelector("video")!.getAttribute("aria-label")).toBe("Video");
  });

  it.each(["https://x/v.mp4", "../v.mp4", "sub/v.mp4", "/v.mp4", "v.mkv", "data:video/mp4;base64,AA"])(
    "shows %s as an inert placeholder and never asks for it",
    async (src) => {
      const { images, asked } = videoSource(() => "blob:x");
      const el = viewWith(`![](<${src}>)`, images);
      await Promise.resolve();
      expect(el.querySelector("video")).toBeNull();
      expect(el.querySelector("[src]")).toBeNull();
      expect(missing(el)).toEqual([src]);
      expect(asked).toEqual([]);
    },
  );

  it.each(["https://example.com/v.mp4", "file:///v.mp4", "javascript:alert(1)", "http://media.localhost/x.mp4", "data:video/mp4;base64,AA"])(
    "shows a placeholder, and lets go, when the source answers %s",
    async (url) => {
      const { images, handed, held, releasedAtMostOnce } = videoSource(() => url);
      const el = viewWith("![](clip.mp4)", images);
      await waitFor(() => expect(missing(el)).toEqual(["clip.mp4"]));
      await waitFor(() => expect(handed.length).toBeGreaterThan(0));
      expect(held()).toEqual([]);
      expect(releasedAtMostOnce()).toBe(true);
      expect(el.querySelector("video")).toBeNull();
      expect(el.querySelector("[src]")).toBeNull();
      expect(el.querySelector('[aria-busy="true"]')).toBeNull();
    },
  );

  it("shows a placeholder, not busy, when the source answers null or fails", async () => {
    for (const urlFor of [() => null, () => Promise.reject(new Error("gone"))]) {
      const el = viewWith("![](clip.mp4)", videoSource(urlFor).images);
      await waitFor(() => expect(missing(el)).toEqual(["clip.mp4"]));
      expect(el.querySelector("video")).toBeNull();
      expect(el.querySelector('[aria-busy="true"]')).toBeNull();
      cleanup();
    }
  });

  it("shows a placeholder, not busy, when the source throws as it is asked", async () => {
    const images: RichImageSource = {
      load: () => Promise.resolve(SHOT),
      video: () => {
        throw new Error("no");
      },
    };
    const el = viewWith("![](clip.mp4)", images);
    await waitFor(() => expect(missing(el)).toEqual(["clip.mp4"]));
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("shows a placeholder with no source, or a source that has no videos", () => {
    expect(missing(viewWith("![](clip.mp4)"))).toEqual(["clip.mp4"]);
    cleanup();
    const el = viewWith("![](clip.mp4)", { load: () => Promise.resolve(SHOT) });
    expect(missing(el)).toEqual(["clip.mp4"]);
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("swaps in the placeholder and lets go when the system can't play the video", async () => {
    const { images, held, releasedAtMostOnce } = videoSource(() => "blob:x");
    const el = viewWith("![](clip.mp4)", images);
    await waitFor(() => expect(el.querySelector("video[src]")).not.toBeNull());
    expect(held()).toHaveLength(1);
    fireEvent(el.querySelector("video")!, new Event("error"));
    expect(el.querySelector("video")).toBeNull();
    expect(missing(el)).toEqual(["clip.mp4"]);
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
    expect(held()).toEqual([]);
    expect(releasedAtMostOnce()).toBe(true);
  });

  it("lets go of its URL when it closes, and when its src changes", async () => {
    const { images, handed, held, releasedAtMostOnce } = videoSource((name) => `blob:${name}`);
    const { rerender, unmount } = render(<RichView aria-label="Reply" value="![](a.mp4)" images={images} />);
    await waitFor(() => expect(region().querySelector("video")?.getAttribute("src")).toBe("blob:a.mp4"));
    rerender(<RichView aria-label="Reply" value="![](b.mp4)" images={images} />);
    await waitFor(() => expect(region().querySelector("video")?.getAttribute("src")).toBe("blob:b.mp4"));
    expect(held().map((h) => h.name)).toEqual(["b.mp4"]);
    expect(handed.some((h) => h.name === "a.mp4")).toBe(true);
    unmount();
    expect(held()).toEqual([]);
    expect(releasedAtMostOnce()).toBe(true);
  });

  it("lets go of a URL that lands after the view closed", async () => {
    const { urlFor, answer } = later();
    const { images, handed, held } = videoSource(urlFor);
    viewWith("![](clip.mp4)", images);
    cleanup();
    answer("blob:x");
    await waitFor(() => expect(handed.length).toBeGreaterThan(0));
    expect(held()).toEqual([]);
  });

  it("asks storage once for two references to one video, and lets go once both are gone", async () => {
    const storage = new MemoryStorage();
    const path = "collections/eng/credentials/video-1a2b3c4d.mp4";
    storage.seedVideo(path, mp4Bytes());
    const images = imageSource(storage, "collections/eng/credentials");
    const { unmount } = render(<RichView aria-label="Reply" value="![](video-1a2b3c4d.mp4) and ![](video-1a2b3c4d.mp4)" images={images} />);
    await waitFor(() => expect(region().querySelectorAll("video[src]")).toHaveLength(2));
    for (const v of region().querySelectorAll("video")) expect(v.getAttribute("src")).toBe(`blob:memory/${path}`);
    expect(storage.videoUrls).toHaveLength(1);
    expect(storage.openVideoUrls()).toEqual([path]);
    unmount();
    await waitFor(() => expect(storage.videoUrls).toEqual([{ path, releases: 1 }]));
  });

  it("waits for nothing on a reply's video, and is busy on a task's until its first frame", async () => {
    const storage = new MemoryStorage();
    storage.seedVideo("assessments/opus/eng/review/clip.mp4", mp4Bytes());
    storage.seedVideo("collections/eng/credentials/clip.mp4", mp4Bytes());

    const reply = viewWith("![](clip.mp4)", resultImages(storage, { profileSlug: "opus", collectionSlug: "eng", credentialSlug: "review" }));
    await waitFor(() => expect(reply.querySelector("video[src]")).not.toBeNull());
    expect(reply.querySelector("video")!.getAttribute("preload")).toBe("none");
    expect(reply.querySelector('[aria-busy="true"]')).toBeNull();
    cleanup();

    const task = viewWith("![](clip.mp4)", imageSource(storage, "collections/eng/credentials"));
    await waitFor(() => expect(task.querySelector("video[src]")).not.toBeNull());
    const player = task.querySelector("video")!;
    expect(player.getAttribute("preload")).toBe("metadata");
    expect(task.querySelector('[aria-busy="true"]')).not.toBeNull();
    fireEvent(player, new Event("loadeddata"));
    expect(task.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("is busy while the source answers", async () => {
    const { urlFor, answer } = later();
    const el = viewWith("![](clip.mp4)", videoSource(urlFor, "none").images);
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    answer("blob:x");
    await waitFor(() => expect(el.querySelector("video[src]")).not.toBeNull());
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("stops being busy after five seconds if the first frame never comes", async () => {
    vi.useFakeTimers();
    try {
      const el = viewWith("![](clip.mp4)", videoSource(() => "blob:x").images);
      await act(async () => {});
      await act(async () => {});
      expect(el.querySelector("video[src]")).not.toBeNull();
      expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
      act(() => vi.advanceTimersByTime(VIDEO_BUSY_MS - 1));
      expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(el.querySelector('[aria-busy="true"]')).toBeNull();
      expect(el.querySelector("video[src]")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("plays from a new source when the reply's folder changes, and lets go of the old URL", async () => {
    const first = videoSource(() => "blob:one");
    const second = videoSource(() => "blob:two");
    const { rerender } = render(<RichView aria-label="Reply" value="![](clip.mp4)" images={first.images} />);
    await waitFor(() => expect(region().querySelector("video")?.getAttribute("src")).toBe("blob:one"));
    rerender(<RichView aria-label="Reply" value="![](clip.mp4)" images={second.images} />);
    await waitFor(() => expect(region().querySelector("video")?.getAttribute("src")).toBe("blob:two"));
    expect(region().querySelectorAll("video")).toHaveLength(1);
    expect(first.held()).toEqual([]);
    expect(first.releasedAtMostOnce()).toBe(true);
    expect(second.held()).toHaveLength(1);
  });

  it("refuses a media.localhost address on a Mac, and takes it on Windows", async () => {
    await withUserAgent(MAC, async () => {
      for (const url of ["http://media.localhost/x.mp4", "https://media.localhost/x.mp4"]) {
        const { images, handed, held } = videoSource(() => url);
        const el = viewWith("![](clip.mp4)", images);
        await waitFor(() => expect(missing(el)).toEqual(["clip.mp4"]));
        await waitFor(() => expect(handed.length).toBeGreaterThan(0));
        expect(held()).toEqual([]);
        expect(el.querySelector("video")).toBeNull();
        cleanup();
      }
      const el = viewWith("![](clip.mp4)", videoSource(() => "media://localhost/collections%2Fclip.mp4").images);
      await waitFor(() => expect(el.querySelector("video")?.getAttribute("src")).toBe("media://localhost/collections%2Fclip.mp4"));
      cleanup();
    });
    await withUserAgent(WINDOWS, async () => {
      const el = viewWith("![](clip.mp4)", videoSource(() => "http://media.localhost/collections%2Fclip.mp4").images);
      await waitFor(() => expect(el.querySelector("video")?.getAttribute("src")).toBe("http://media.localhost/collections%2Fclip.mp4"));
    });
  });

  it("builds nothing from a reply's video markup, and plays only what its source returns", async () => {
    const { images, asked } = videoSource(() => "blob:x");
    const md = [
      '![<b>x</b> <img src=x onerror=alert(1)>](clip.mp4 "t\\"<i>")',
      "![](v.mp4<img onerror>)",
      '<video src="https://x/v.mp4" autoplay controls poster="https://x/p.png"><source src="https://x/s.mp4"><track src="https://x/t.vtt"></video>',
      '<video data-md-video="https://x/w.mp4" src="https://x/w.mp4" autoplay></video>',
      'Copied <span data-md-video="https://x/v.mp4" src="https://x/q.mp4" poster="https://x/p.png" onerror="window.__ran = true"></span> video',
      '<span data-md-video="clip.webm" src="https://x/q.webm" poster="https://x/p.png" autoplay></span>',
      '<audio src="https://x/a.mp3" autoplay></audio>',
    ].join("\n\n");
    const el = viewWith(md, images);
    await waitFor(() => expect(el.querySelectorAll("video[src]")).toHaveLength(2));
    expect(el.querySelector("audio, source, track, b, i, [autoplay], [poster], [srcset], [onerror], [onclick], [onload]")).toBeNull();
    for (const node of el.querySelectorAll("[src]")) {
      expect(node.tagName).toBe("VIDEO");
      expect(node.getAttribute("src")).toBe("blob:x");
    }
    expect(el.querySelector("video")!.getAttribute("aria-label")).toContain("<b>x</b> <img src=x onerror=alert(1)>");
    expect(new Set(asked)).toEqual(new Set(["clip.mp4", "clip.webm"]));
    expect(missing(el)).toEqual(["https://x/v.mp4"]);
    expect((window as { __ran?: boolean }).__ran).toBeUndefined();
  });

  it("keeps the webview's menu and drag off a video", async () => {
    const el = viewWith("![](clip.mp4)", videoSource(() => "blob:x").images);
    await waitFor(() => expect(el.querySelector("video[src]")).not.toBeNull());
    const player = el.querySelector("video")!;
    expect(fireEvent.contextMenu(player)).toBe(false);
    expect(fireEvent.dragStart(player)).toBe(false);
  });

  it("shows the stored Markdown as it is", () => {
    const { images, asked } = videoSource(() => "blob:x");
    const el = viewWith('Watch ![a demo](video-1a2b3c4d.mov "t")', images, true);
    expect(el.querySelector("pre")?.textContent).toBe('Watch ![a demo](video-1a2b3c4d.mov "t")');
    expect(el.querySelector("video")).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe("RichView, links", () => {
  const LINKS = "See [the diff](https://example.com/pr/1), [plain](http://example.com/a), [mail](mailto:a@example.com), [js](javascript:alert(1)), [file](file:///etc/passwd) and [rel](notes/today).";

  it("opens a clicked https link in the system browser, and the app stays put", () => {
    const el = view(LINKS);
    const before = window.location.href;
    expect(fireEvent.click(link(el, "the diff"))).toBe(false);
    expect(opener.openUrl).toHaveBeenCalledTimes(1);
    expect(opener.openUrl).toHaveBeenCalledWith("https://example.com/pr/1");
    expect(window.location.href).toBe(before);
  });

  it("opens a middle-clicked link the same way", () => {
    const el = view(LINKS);
    const before = window.location.href;
    expect(middleClick(link(el, "the diff"))).toBe(false);
    expect(opener.openUrl).toHaveBeenCalledWith("https://example.com/pr/1");
    expect(window.location.href).toBe(before);
  });

  it("opens http and mailto links", () => {
    const el = view(LINKS);
    fireEvent.click(link(el, "plain"));
    fireEvent.click(link(el, "mail"));
    expect(opener.openUrl.mock.calls.map(([url]) => url)).toEqual(["http://example.com/a", "mailto:a@example.com"]);
  });

  it("never hands a javascript:, file: or relative link to the opener, and never follows it", () => {
    const el = view(LINKS);
    for (const text of ["js", "file", "rel"]) {
      expect(fireEvent.click(link(el, text))).toBe(false);
      expect(middleClick(link(el, text))).toBe(false);
    }
    expect(opener.openUrl).not.toHaveBeenCalled();
  });

  it("keeps the webview's own menu off a link, and opens nothing", () => {
    const el = view(LINKS);
    const before = window.location.href;
    expect(fireEvent.contextMenu(link(el, "the diff"))).toBe(false);
    expect(opener.openUrl).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
  });

  it("does not drag a link out, where a drop could navigate the window", () => {
    const el = view(LINKS);
    expect(fireEvent.dragStart(link(el, "the diff"))).toBe(false);
  });

  it("leaves clicks and the menu alone away from links", () => {
    const el = view(LINKS);
    const text = el.querySelector(".rich-prose p") as HTMLElement;
    expect(fireEvent.click(text)).toBe(true);
    expect(fireEvent.contextMenu(text)).toBe(true);
    expect(opener.openUrl).not.toHaveBeenCalled();
  });

  it("does not open on a right button's auxclick", () => {
    const el = view(LINKS);
    const right = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 });
    expect(fireEvent(link(el, "the diff"), right)).toBe(false);
    expect(opener.openUrl).not.toHaveBeenCalled();
  });
});

describe("externalHref", () => {
  it.each([
    ["https://example.com/pr/1", "https://example.com/pr/1"],
    ["http://example.com/a", "http://example.com/a"],
    ["mailto:a@example.com", "mailto:a@example.com"],
    ["  https://example.com/x  ", "https://example.com/x"],
    ["HTTPS://EXAMPLE.COM/", "https://example.com/"],
  ])("lets %s through as %s", (raw, url) => {
    expect(externalHref(raw)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/1",
    "tauri://localhost/",
    "notes/today",
    "/notes/today",
    "//example.com/x",
    "#top",
    "",
    null,
  ])("refuses %s", (raw) => {
    expect(externalHref(raw)).toBeNull();
  });
});

describe("RichView, stored text", () => {
  const RAW = '<div onclick="x()">raw <b>html</b></div>\n<script>alert(1)</script>\n\n| a | b |\n|---|---|\n| one | two |\n\nline one\nline two\n  indented\tand tabbed  \n\n\n';

  it("shows every character of the stored string, raw HTML, table and single newlines included", () => {
    const el = view(RAW, true);
    const stored = el.querySelector("pre.rich-stored");
    expect(stored?.textContent).toBe(RAW);
    expect(el.textContent).toBe(RAW);
    expect(el.querySelector(".rich-prose")).toBeNull();
    expect(el.querySelector("script, img, div[onclick], b")).toBeNull();
  });

  it("shows an empty and a whitespace-only reply exactly", () => {
    expect(view("", true).querySelector("pre.rich-stored")?.textContent).toBe("");
    cleanup();
    expect(view(" \n\t\n ", true).querySelector("pre.rich-stored")?.textContent).toBe(" \n\t\n ");
  });

  it("switches between the stored text and the rendered reply", () => {
    const md = "## Plan\n\n- read it";
    const { rerender } = render(<RichView aria-label="Reply" value={md} stored />);
    expect(region().querySelector("pre.rich-stored")?.textContent).toBe(md);
    rerender(<RichView aria-label="Reply" value={md} />);
    expect(region().querySelector("h2")?.textContent).toBe("Plan");
    expect(region().querySelector("pre.rich-stored")).toBeNull();
    rerender(<RichView aria-label="Reply" value={md} stored />);
    expect(region().querySelector("pre.rich-stored")?.textContent).toBe(md);
    expect(region().querySelector("h2")).toBeNull();
  });
});

describe("RichView, the scroll region", () => {
  it.each([false, true])("is focusable and carries its label (stored: %s)", (stored) => {
    render(<RichView aria-label="Opus agent's reply" value="Some words." stored={stored} />);
    const el = region("Opus agent's reply");
    expect(el.tabIndex).toBe(0);
    el.focus();
    expect(document.activeElement).toBe(el);
  });

  it("holds the measure inside the region", () => {
    const el = view("Some words.");
    expect(el.firstElementChild?.classList.contains("rich-view-measure")).toBe(true);
    expect(el.querySelector(".rich-view-measure .rich-prose")).not.toBeNull();
  });
});
