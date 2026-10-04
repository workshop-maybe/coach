// @vitest-environment jsdom
// The read-only reply view (U3): a stored reply shown as Markdown in the editor's type,
// safely (R11, R13, KTD5), or as its stored string exactly (R12, KTD6).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const opener = vi.hoisted(() => ({ openUrl: vi.fn((_url: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

import { RichView, externalHref } from "./RichView";
import type { RichImageSource } from "./richImage";

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

  it("renders no script, image, frame or inline handler from a reply's raw HTML", () => {
    const el = view(HOSTILE);
    // ProseMirror's own separator beside an inline node is an image with no source; nothing else may be.
    expect(el.querySelector("script, img:not(.ProseMirror-separator), iframe, object, embed, style, link")).toBeNull();
    expect(el.querySelector("[src], [onerror], [onclick], [onmouseover]")).toBeNull();
    expect(el.querySelector(".rich-image-missing")?.textContent).toBe("https://example.com/p.png");
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
