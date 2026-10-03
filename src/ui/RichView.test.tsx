// @vitest-environment jsdom
// The read-only reply view (U3): a stored reply shown as Markdown in the editor's type,
// safely (R11, R13, KTD5), or as its stored string exactly (R12, KTD6).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const opener = vi.hoisted(() => ({ openUrl: vi.fn((_url: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

import { RichView, externalHref } from "./RichView";

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
    expect(el.querySelector("script, img, iframe, object, embed, style, link")).toBeNull();
    expect(el.querySelector("[onerror], [onclick], [onmouseover]")).toBeNull();
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
