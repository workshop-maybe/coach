// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { RichText, looksLikeMarkdown, type RichImages, type RichTextHandle } from "./RichText";
import { RichText as StubRichText } from "./richTextStub";
import { useRichDraft } from "./richDraft";
import { firePaste, pngFile } from "../test/paste";

// The ProseMirror jsdom shims live in src/test/setup.ts (KTD11).
afterEach(cleanup);

function box(name = "Task") {
  return screen.getByRole("textbox", { name });
}

function editorOf(el: HTMLElement): Editor {
  const ed = (el as HTMLElement & { editor?: Editor }).editor;
  if (!ed) throw new Error("no editor on the box");
  return ed;
}

/** Types as a person would: each character goes through the editor's text input handlers, so input rules run. */
function typeInto(ed: Editor, text: string) {
  act(() => {
    for (const ch of text) {
      const { view } = ed;
      if (ch === "\n") {
        ed.commands.keyboardShortcut("Enter");
        continue;
      }
      const { from, to } = view.state.selection;
      const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  });
}

function setup(value: string) {
  const onChange = vi.fn();
  const onNormalized = vi.fn();
  render(<RichText aria-label="Task" value={value} onChange={onChange} onNormalized={onNormalized} />);
  return { onChange, onNormalized, ed: editorOf(box()) };
}

const SAMPLES: Record<string, string> = {
  headings: "# Review\n\n## Steps\n\n### Detail",
  bullets: "- one\n- two\n  - nested",
  ordered: "1. first\n2. second",
  codeBlock: "Run it:\n\n```ts\nconst a = 1;\nconsole.log(a);\n```",
  marks: "Some **bold**, some *italic* and `inline code`.",
  link: "See [the diff](https://example.com/pr/1) first.",
  tasks: "- [ ] write the test\n- [x] read the diff",
  quote: "> Keep it small.",
};

describe("RichText", () => {
  it("exposes a labeled multi-line textbox", () => {
    setup("");
    expect(box().getAttribute("aria-multiline")).toBe("true");
    expect(box().getAttribute("contenteditable")).toBe("true");
  });

  it.each(Object.entries(SAMPLES))("round-trips %s without a change on open", (_, md) => {
    const { ed, onChange, onNormalized } = setup(md);
    expect(ed.getMarkdown()).toBe(md);
    expect(onNormalized).toHaveBeenCalledWith(md);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders structure, not Markdown syntax", () => {
    setup(Object.values(SAMPLES).join("\n\n"));
    const el = box();
    expect(el.querySelector("h1")?.textContent).toBe("Review");
    expect(el.querySelector("strong")?.textContent).toBe("bold");
    expect(el.querySelector("em")?.textContent).toBe("italic");
    expect(el.querySelector("pre code")?.textContent).toContain("const a = 1;");
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://example.com/pr/1");
    expect(el.querySelectorAll('ul[data-type="taskList"] > li')).toHaveLength(2);
    expect(el.querySelector("ol li")?.textContent).toBe("first");
  });

  it("emits Markdown after an edit", () => {
    const { ed, onChange } = setup("Review the diff.");
    act(() => {
      ed.commands.focus("end");
    });
    typeInto(ed, " Twice.");
    expect(onChange).toHaveBeenLastCalledWith("Review the diff. Twice.");
  });

  it("turns Markdown typed at the start of a line into structure", () => {
    const { ed, onChange } = setup("");
    typeInto(ed, "## Plan\n- read it\n");
    typeInto(ed, "\n");
    typeInto(ed, "Then **ship** it");
    expect(box().querySelector("h2")?.textContent).toBe("Plan");
    expect(box().querySelector("ul li")?.textContent).toBe("read it");
    expect(box().querySelector("strong")?.textContent).toBe("ship");
    expect(onChange).toHaveBeenLastCalledWith("## Plan\n\n- read it\n\nThen **ship** it");
  });

  it("types a fenced code block and a task list", () => {
    const { ed, onChange } = setup("");
    typeInto(ed, "```");
    typeInto(ed, " ");
    expect(box().querySelector("pre")).not.toBeNull();
    act(() => {
      ed.commands.setContent("", { emitUpdate: false });
    });
    typeInto(ed, "[ ] ");
    typeInto(ed, "todo");
    expect(onChange).toHaveBeenLastCalledWith("- [ ] todo");
  });

  it("parses pasted Markdown into structure", () => {
    const { ed, onChange } = setup("");
    const reply = "## Findings\n\n- off-by-one in `loop`\n- **missing** test\n\n```js\nfor (;;) {}\n```";
    act(() => {
      ed.view.pasteText(reply);
    });
    expect(box().querySelector("h2")?.textContent).toBe("Findings");
    expect(box().querySelectorAll("ul li")).toHaveLength(2);
    expect(box().querySelector("pre code")?.textContent).toBe("for (;;) {}");
    expect(onChange).toHaveBeenLastCalledWith(reply);
  });

  it("pastes plain prose as text", () => {
    const { ed } = setup("");
    act(() => {
      ed.view.pasteText("Just a sentence.");
    });
    expect(ed.getMarkdown()).toBe("Just a sentence.");
    expect(looksLikeMarkdown("Just a sentence.")).toBe(false);
    expect(looksLikeMarkdown("- a list")).toBe(true);
  });

  it("formats a selection from the menu", async () => {
    const { ed, onChange } = setup("make this bold");
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 6, 10)));
    });
    const menu = await screen.findByRole("toolbar", { name: "Format", hidden: true }, { timeout: 2000 });
    fireEvent.click(within(menu).getByRole("button", { name: "Bold", hidden: true }));
    expect(onChange).toHaveBeenLastCalledWith("make **this** bold");
  });

  it("leaves Escape unhandled, so the deck around the box can step out of it (U6, R19)", () => {
    setup("Keep the diff small");
    box().focus();
    // fireEvent returns false when a handler called preventDefault. ProseMirror marks every
    // Escape as handled, though it does nothing with it, which would hide it from the deck.
    expect(fireEvent.keyDown(box(), { key: "Escape", code: "Escape", keyCode: 27 })).toBe(true);
    expect(fireEvent.keyDown(box(), { key: "Enter", code: "Enter", keyCode: 13 })).toBe(false);
  });

  it("takes a new value from outside without echoing it back", () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichText aria-label="Task" value="One" onChange={onChange} />);
    rerender(<RichText aria-label="Task" value="- Two" onChange={onChange} />);
    expect(box().querySelector("ul li")?.textContent).toBe("Two");
    expect(onChange).not.toHaveBeenCalled();
  });
});

/** Opens `md`, makes an unrelated edit at the end, and returns what the box saves. */
function editedOnce(md: string): string {
  const { ed, onChange } = setup(md);
  act(() => {
    ed.commands.focus("end");
  });
  typeInto(ed, " x");
  const saved = onChange.mock.lastCall?.[0] as string;
  return saved.endsWith(" x") ? saved.slice(0, -2) : saved;
}

/** Each image and video node in the box, in order, as "type:src". */
function leaves(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name === "image" || n.type.name === "video") out.push(`${n.type.name}:${n.attrs.src as string}`);
  });
  return out;
}

describe("images in the Markdown (KTD1, R9)", () => {
  it.each([
    ["a block image between paragraphs", "Before\n\n![](image-1a2b3c4d.png)\n\nAfter"],
    ["alt and title", 'See ![alt](a.png "t") here'],
    ["an inline image mid-sentence", "Look ![](image-1a2b3c4d.png) here"],
    ["a src with a space", "Shot ![](<Screenshot at 09.12.png>) here"],
    ["a remote src", "Remote ![a picture](https://example.com/p.png) here"],
  ])("keeps %s after an edit", (_, md) => {
    expect(editedOnce(md)).toBe(md);
    cleanup();
  });

  it("keeps a paragraph that holds only an image (KTD15)", () => {
    const { ed } = setup("One\n\n![](image-1a2b3c4d.png)\n\nTwo");
    expect(ed.getMarkdown()).toBe("One\n\n![](image-1a2b3c4d.png)\n\nTwo");
  });

  it.each([
    ["an escaped bracket in alt", "![a\\]b](x.png)", "![a\\]b](x.png)"],
    ["an escaped backslash in alt", "![a\\\\b](x.png)", "![a\\\\b](x.png)"],
    ["an escaped underscore in alt", "![a\\_b](x.png)", "![a_b](x.png)"],
    ["an escaped quote in a title", '![](x.png "say \\"hi\\"")', '![](x.png "say \\"hi\\"")'],
    ["angle brackets in a bracketed src", "![](<a\\<b\\>.png>)", "![](<a\\<b\\>.png>)"],
  ])("settles %s after one edit, and a second edit changes nothing more", (_, md, settled) => {
    const once = editedOnce(md);
    expect(once).toBe(settled);
    cleanup();
    expect(editedOnce(once)).toBe(settled);
    cleanup();
  });

  it("copies an image as its Markdown in plain text", () => {
    const { ed } = setup("![shot](image-1a2b3c4d.png)");
    expect(ed.getText()).toBe("![shot](image-1a2b3c4d.png)");
  });
});

describe("videos in the Markdown (KTD1, R11)", () => {
  it.each([
    ["a block video between paragraphs", "Before\n\n![](video-1a2b3c4d.mp4)\n\nAfter", "video-1a2b3c4d.mp4"],
    ["alt and title on a movie", '![alt](a.mov "t")', "a.mov"],
    ["a video mid-sentence", "Look ![](video-1a2b3c4d.webm) here", "video-1a2b3c4d.webm"],
    ["a src with a space", "![](<my clip.webm>)", "my clip.webm"],
    ["an upper-case extension", "![](x.MP4)", "x.MP4"],
    ["an M4V mid-sentence", "Clip ![](c.m4v) end", "c.m4v"],
    ["a remote video", "Remote ![](https://example.com/v.mp4) here", "https://example.com/v.mp4"],
  ])("keeps %s after an edit, as a video node", (_, md, src) => {
    const { ed } = setup(md);
    expect(leaves(ed)).toEqual([`video:${src}`]);
    cleanup();
    expect(editedOnce(md)).toBe(md);
    cleanup();
  });

  it("keeps a paragraph that holds only a video, in a document the schema accepts", () => {
    const { ed } = setup("![](x.MP4)");
    expect(() => ed.state.doc.check()).not.toThrow();
    expect(ed.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(ed.state.doc.firstChild?.firstChild?.type.name).toBe("video");
    expect(ed.getMarkdown()).toBe("![](x.MP4)");
  });

  it("keeps an image and a video side by side as their own nodes", () => {
    const { ed } = setup("A ![](shot.png) B ![](clip.mp4) C");
    expect(leaves(ed)).toEqual(["image:shot.png", "video:clip.mp4"]);
    expect(ed.getMarkdown()).toBe("A ![](shot.png) B ![](clip.mp4) C");
  });

  it.each([
    ["an escaped bracket in alt", "![a\\]b](x.mp4)", "![a\\]b](x.mp4)"],
    ["an escaped backslash in alt", "![a\\\\b](x.mp4)", "![a\\\\b](x.mp4)"],
    ["an escaped underscore in alt", "![a\\_b](x.mp4)", "![a_b](x.mp4)"],
    ["an escaped quote in a title", '![](x.mov "say \\"hi\\"")', '![](x.mov "say \\"hi\\"")'],
    ["angle brackets in a bracketed src", "![](<a\\<b\\>.webm>)", "![](<a\\<b\\>.webm>)"],
  ])("settles %s after one edit, and a second edit changes nothing more", (_, md, settled) => {
    const { ed } = setup(md);
    expect(leaves(ed)[0]).toMatch(/^video:/);
    cleanup();
    const once = editedOnce(md);
    expect(once).toBe(settled);
    cleanup();
    expect(editedOnce(once)).toBe(settled);
    cleanup();
  });

  it("copies a video as its Markdown in plain text, and as HTML with no src and no player", () => {
    const { ed } = setup('![a clip](video-1a2b3c4d.mp4 "t")');
    expect(ed.getText()).toBe('![a clip](video-1a2b3c4d.mp4 "t")');
    const html = ed.getHTML();
    expect(html).toContain('data-md-video="video-1a2b3c4d.mp4"');
    expect(html).not.toMatch(/\ssrc=/);
    expect(html).not.toMatch(/<video|poster=/);
  });

  /** Selects the first `type` node, cuts it as a person would, and pastes it at the end of the box. */
  function cutAndPaste(ed: Editor, type: string) {
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === type) pos = p;
    });
    expect(pos).toBeGreaterThanOrEqual(0);
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
    });
    const { dom, text } = ed.view.serializeForClipboard(ed.state.selection.content());
    act(() => {
      ed.view.dispatch(ed.state.tr.deleteSelection());
      ed.commands.focus("end");
    });
    firePaste(box(), { "text/html": dom.innerHTML, "text/plain": text });
  }

  it("rebuilds a cut video, and a cut image beside it, as the same nodes", () => {
    const { ed, onChange } = setup("A ![](clip.mp4) B ![](shot.png) C");
    cutAndPaste(ed, "video");
    expect(leaves(ed)).toEqual(["image:shot.png", "video:clip.mp4"]);
    cutAndPaste(ed, "image");
    expect(leaves(ed)).toEqual(["video:clip.mp4", "image:shot.png"]);
    expect(onChange).toHaveBeenLastCalledWith("A  B  C![](clip.mp4)![](shot.png)");
  });

  it("never makes an image node of a video name in pasted HTML", () => {
    const { ed } = setup("");
    firePaste(box(), { "text/html": '<p>x <img data-md-src="clip.mp4" src="https://example.com/clip.mp4"></p>', "text/plain": "x" });
    expect(leaves(ed)).not.toContain("image:clip.mp4");
  });
});

describe("a video in a box (KTD2)", () => {
  /** A box whose videos each get a fresh handle per ask; the editor may ask twice as it mounts. */
  function setupVideo(value: string) {
    const handed: { name: string; release: ReturnType<typeof vi.fn> }[] = [];
    const images: RichImages = {
      load: () => Promise.resolve(null),
      video: vi.fn(async (name: string) => {
        const release = vi.fn();
        handed.push({ name, release });
        return { url: "blob:x", preload: "metadata" as const, release };
      }),
    };
    /** The names whose handles are not yet released. */
    const held = () => handed.filter((h) => h.release.mock.calls.length === 0).map((h) => h.name);
    const onChange = vi.fn();
    render(<RichText aria-label="Task" value={value} onChange={onChange} images={images} />);
    return { ed: editorOf(box()), onChange, handed, held, images };
  }

  async function shown(): Promise<HTMLVideoElement> {
    await waitFor(() => expect(box().querySelector("video[src]")).not.toBeNull());
    return box().querySelector("video")!;
  }

  function videoPos(ed: Editor): number {
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === "video") pos = p;
    });
    return pos;
  }

  it("plays from the box's source, with controls and no autoplay", async () => {
    const { images } = setupVideo("Watch ![](clip.mp4)");
    const video = await shown();
    expect(video.getAttribute("src")).toBe("blob:x");
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(images.video).toHaveBeenCalledWith("clip.mp4");
  });

  it("keeps Space and Backspace inside the video from replacing the selected node", async () => {
    const { ed, onChange } = setupVideo("A ![](clip.mp4) B");
    const video = await shown();
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, videoPos(ed))));
    });
    fireEvent.keyDown(video, { key: " ", code: "Space", keyCode: 32 });
    fireEvent.keyPress(video, { key: " ", code: "Space", charCode: 32, keyCode: 32 });
    fireEvent.keyDown(video, { key: "Backspace", code: "Backspace", keyCode: 8 });
    expect(leaves(ed)).toEqual(["video:clip.mp4"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves pointer, mouse, key and drag events inside the video to the video", async () => {
    setupVideo("A ![](clip.mp4) B");
    const video = await shown();
    const frame = video.closest(".rich-video") as HTMLElement & { pmViewDesc?: { stopEvent(e: Event): boolean } };
    const desc = frame.pmViewDesc!;
    const seen: Record<string, boolean> = {};
    const types = ["mousedown", "mouseup", "pointerdown", "click", "dblclick", "keydown", "keypress", "dragstart", "drop", "contextmenu"];
    for (const type of types) {
      video.addEventListener(type, (e) => (seen[type] = desc.stopEvent(e)), { once: true });
      fireEvent(video, new Event(type, { bubbles: true, cancelable: true }));
    }
    expect(Object.keys(seen)).toEqual(types);
    expect(Object.entries(seen).filter(([, stopped]) => !stopped)).toEqual([]);
    // The frame around the player still belongs to the editor, so a click there selects the node.
    let frameStopped: boolean | undefined;
    frame.addEventListener("mousedown", (e) => (frameStopped = desc.stopEvent(e)), { once: true });
    fireEvent.mouseDown(frame);
    expect(frameStopped).toBe(false);
  });

  it("marks a selected video without making it draggable", async () => {
    const { ed } = setupVideo("A ![](clip.mp4) B");
    const video = await shown();
    const frame = video.closest(".rich-video") as HTMLElement;
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, videoPos(ed))));
    });
    expect(frame.classList.contains("ProseMirror-selectednode")).toBe(true);
    expect(frame.draggable).toBe(false);
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1)));
    });
    expect(frame.classList.contains("ProseMirror-selectednode")).toBe(false);
  });

  it("keeps the webview's menu and drag off a video, and leaves the menu alone on text", async () => {
    setupVideo("Words ![](clip.mp4)");
    const video = await shown();
    expect(fireEvent.contextMenu(video)).toBe(false);
    expect(fireEvent.dragStart(video)).toBe(false);
    expect(fireEvent.contextMenu(box().querySelector("p")!)).toBe(true);
  });

  it("releases its URL when the src changes and when the box closes", async () => {
    const { ed, handed, held, images } = setupVideo("![](a.mp4)");
    await shown();
    expect(held()).toEqual(["a.mp4"]);
    act(() => {
      ed.view.dispatch(ed.state.tr.setNodeMarkup(videoPos(ed), undefined, { src: "b.mp4", alt: "", title: null }));
    });
    expect(held()).not.toContain("a.mp4");
    await waitFor(() => expect(images.video).toHaveBeenLastCalledWith("b.mp4"));
    await waitFor(() => expect(held()).toEqual(["b.mp4"]));
    cleanup();
    expect(held()).toEqual([]);
    expect(handed.every((h) => h.release.mock.calls.length === 1)).toBe(true);
  });
});

describe("blank lines (KTD15, R17)", () => {
  it("saves no &nbsp; after Enter three times between paragraphs", () => {
    const { ed, onChange } = setup("First\n\nSecond");
    act(() => {
      ed.commands.focus(6);
    });
    typeInto(ed, "\n\n\n");
    expect(ed.state.doc.childCount).toBe(5);
    expect(onChange).toHaveBeenLastCalledWith("First\n\nSecond");
  });

  it("saves no &nbsp; for a run of empty paragraphs inside a quote", () => {
    const { ed } = setup("");
    const p = (text?: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
    act(() => {
      ed.commands.setContent({ type: "doc", content: [{ type: "blockquote", content: [p("a"), p(), p(), p("b")] }] }, { emitUpdate: false });
    });
    expect(box().querySelectorAll("blockquote p")).toHaveLength(4);
    expect(ed.getMarkdown()).not.toContain("&nbsp;");
  });

  it("keeps a literal &nbsp; inside a code block", () => {
    const md = "Keep it:\n\n```html\n<p>&nbsp;</p>\n\n\n&nbsp;\n```";
    const { ed, onChange } = setup(md);
    expect(ed.getMarkdown()).toBe(md);
    act(() => {
      ed.commands.focus(5);
    });
    typeInto(ed, "!");
    expect(onChange).toHaveBeenLastCalledWith("Keep! it:\n\n```html\n<p>&nbsp;</p>\n\n\n&nbsp;\n```");
  });

  it("saves plain blank lines and no &nbsp; for a Markdown paste with blank runs, in any box (AE7)", () => {
    const { ed, onChange } = setup("");
    act(() => {
      ed.view.pasteText("## Findings\n\n\n\n\nFirst paragraph.\n\n\n\nSecond paragraph.");
    });
    expect(onChange).toHaveBeenLastCalledWith("## Findings\n\nFirst paragraph.\n\nSecond paragraph.");
  });
});

describe("the reply box's paste (KTD14)", () => {
  function setupReply(value = "") {
    const onChange = vi.fn();
    const onPaste = vi.fn();
    const ref = createRef<RichTextHandle>();
    render(<RichText ref={ref} aria-label="Reply" value={value} onChange={onChange} onPaste={onPaste} cleanPaste placeholder="Paste the reply" />);
    return { onChange, onPaste, ref, ed: editorOf(box("Reply")) };
  }

  /** The text of each top-level block. */
  function blocks(ed: Editor): string[] {
    const out: string[] = [];
    ed.state.doc.forEach((n) => out.push(n.textContent));
    return out;
  }

  const TERMINAL = "⏺ I fixed the parser. The stale flag on the  \n  badge page now clears.\u00a0\r\n\r\n\r\n\r\n  ⎿  Saved";

  it("arrives clean: CRLF, non-breaking spaces, trailing spaces, blank runs, markers and the gutter", () => {
    const { ed, onChange } = setupReply();
    expect(firePaste(box("Reply"), { "text/plain": TERMINAL })).toBe(false);
    expect(blocks(ed)).toEqual(["I fixed the parser. The stale flag on the", "badge page now clears.", "   Saved"]);
    expect(onChange).toHaveBeenLastCalledWith("I fixed the parser. The stale flag on the\n\nbadge page now clears.\n\n   Saved");
  });

  it("reports one payload after the paste, before the change", () => {
    const { onChange, onPaste } = setupReply();
    firePaste(box("Reply"), { "text/plain": TERMINAL });
    expect(onPaste).toHaveBeenCalledTimes(1);
    const markdown = onChange.mock.lastCall?.[0];
    expect(onPaste).toHaveBeenCalledWith({
      raw: TERMINAL,
      fixed: "I fixed the parser. The stale flag on the\nbadge page now clears.\n\n   Saved",
      markdown,
      whole: true,
      candidates: true,
      terminal: true,
    });
    expect(onPaste.mock.invocationCallOrder[0]).toBeLessThan(onChange.mock.invocationCallOrder[0]);
  });

  it("reports a paste into a box that already held text as not whole, and one with no breaks to join as having no candidates", () => {
    const { ed, onPaste } = setupReply("Already here.");
    act(() => {
      ed.commands.focus("end");
    });
    firePaste(box("Reply"), { "text/plain": " And more." });
    expect(onPaste).toHaveBeenLastCalledWith(expect.objectContaining({ whole: false, candidates: false, terminal: false, markdown: "Already here. And more." }));
  });

  it("reports a paste over a selection of everything as whole", () => {
    const { ed, onPaste } = setupReply("Old reply.");
    act(() => {
      ed.commands.selectAll();
    });
    firePaste(box("Reply"), { "text/plain": "New reply." });
    expect(onPaste).toHaveBeenLastCalledWith(expect.objectContaining({ whole: true, markdown: "New reply." }));
  });

  it("keeps the HTML path, and its link, for an HTML paste that does not look terminal-copied", () => {
    const { onChange, onPaste } = setupReply();
    const taken = firePaste(box("Reply"), { "text/plain": "See the docs first.", "text/html": '<p>See <a href="https://example.com/docs">the docs</a> first.</p>' });
    expect(taken).toBe(false);
    expect(box("Reply").querySelector("a")?.getAttribute("href")).toBe("https://example.com/docs");
    expect(onChange).toHaveBeenLastCalledWith("See [the docs](https://example.com/docs) first.");
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("takes the text path for an HTML paste whose plain text looks terminal-copied", () => {
    const { ed, onPaste } = setupReply();
    const taken = firePaste(box("Reply"), { "text/plain": TERMINAL, "text/html": "<pre><b>HTML</b> flavor</pre>" });
    expect(taken).toBe(false);
    expect(box("Reply").textContent).not.toContain("HTML");
    expect(blocks(ed)).toEqual(["I fixed the parser. The stale flag on the", "badge page now clears.", "   Saved"]);
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenLastCalledWith(expect.objectContaining({ raw: TERMINAL, terminal: true }));
  });

  it("keeps the HTML path for a copy from an editor like this one, whatever its plain text looks like", () => {
    const { onPaste } = setupReply();
    firePaste(box("Reply"), { "text/plain": TERMINAL, "text/html": '<p data-pm-slice="1 1 []"><strong>Kept</strong> as copied</p>' });
    expect(box("Reply").querySelector("strong")?.textContent).toBe("Kept");
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("leaves a VS Code paste to the code block's own handler", () => {
    const { ed } = setupReply();
    const code = "  if (a) {\n    b();\n  }";
    firePaste(box("Reply"), { "text/plain": code, "text/html": "<div>code</div>", "vscode-editor-data": JSON.stringify({ mode: "typescript" }) });
    expect(ed.state.doc.firstChild?.type.name).toBe("codeBlock");
    expect(ed.state.doc.firstChild?.textContent).toBe(code);
  });

  it("inserts the raw text when pasting into a code block", () => {
    const { ed, onPaste } = setupReply("```\nx\n```");
    act(() => {
      ed.commands.focus(2);
    });
    const raw = "  a  \n\n\n\n⏺ b\u00a0";
    firePaste(box("Reply"), { "text/plain": raw, "text/html": "<p>ignored</p>" });
    expect(ed.state.doc.firstChild?.textContent).toBe(`x${raw}`);
    expect(onPaste).toHaveBeenLastCalledWith(expect.objectContaining({ raw, fixed: raw, terminal: false }));
  });

  it("links a selection when a URL is pasted over it", () => {
    const { ed, onChange } = setupReply("See the docs first.");
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 5, 13)));
    });
    firePaste(box("Reply"), { "text/plain": "https://example.com/docs" });
    expect(onChange).toHaveBeenLastCalledWith("See [the docs](https://example.com/docs) first.");
  });

  it("still turns a Markdown-looking paste into headings and lists", () => {
    const { onChange } = setupReply();
    firePaste(box("Reply"), { "text/plain": "## Findings  \n\n\n\n- one  \n- two\u00a0items\n" });
    expect(box("Reply").querySelector("h2")?.textContent).toBe("Findings");
    expect(box("Reply").querySelectorAll("ul li")).toHaveLength(2);
    expect(onChange).toHaveBeenLastCalledWith("## Findings\n\n- one\n- two items");
  });

  it("keeps a Markdown hard break in a paste that does not look terminal-copied", () => {
    const { onChange } = setupReply();
    firePaste(box("Reply"), { "text/plain": "**Note:** first  \nsecond" });
    expect(box("Reply").querySelector("p br")).not.toBeNull();
    expect(onChange).toHaveBeenLastCalledWith("**Note:** first  \nsecond");
  });

  it("saves plain blank lines and no &nbsp; for paragraphs pasted with blank lines between (AE7)", () => {
    const { onChange } = setupReply();
    firePaste(box("Reply"), { "text/plain": "**First** paragraph.\n\n\n\nSecond paragraph.\n\n\nThird." });
    expect(onChange).toHaveBeenLastCalledWith("**First** paragraph.\n\nSecond paragraph.\n\nThird.");
  });

  it("leaves Escape unhandled with the reply's paste handling on", () => {
    setupReply("Keep the diff small");
    expect(fireEvent.keyDown(box("Reply"), { key: "Escape", code: "Escape", keyCode: 27 })).toBe(true);
  });

  describe("replaceAsPaste", () => {
    it("produces the same document as pasting the text, and returns its Markdown", () => {
      const text = `${TERMINAL}\n\n## Next\n\n- one`;
      const pasted = setupReply();
      firePaste(box("Reply"), { "text/plain": text });
      const expected = pasted.ed.getJSON();
      cleanup();

      const { ed, ref, onChange, onPaste } = setupReply("Old **reply** with [a link](https://example.com).");
      let md = "";
      act(() => {
        md = ref.current!.replaceAsPaste(text);
      });
      expect(ed.getJSON()).toEqual(expected);
      expect(md).toBe(pasted.onChange.mock.lastCall?.[0]);
      expect(onChange).toHaveBeenLastCalledWith(md);
      expect(onPaste).not.toHaveBeenCalled();
    });

    it("replaces the box with a lone URL rather than linking the old text", () => {
      const { ref } = setupReply("Old reply.");
      let md = "";
      act(() => {
        md = ref.current!.replaceAsPaste("https://example.com/pr/1");
      });
      // As a paste of it into an empty box: the paste rule links the URL itself.
      expect(md).toBe("[https://example.com/pr/1](https://example.com/pr/1)");
    });

    it("empties the box for an empty text, and says so", () => {
      const { ref, onChange } = setupReply("Old reply.");
      let md = "unset";
      act(() => {
        md = ref.current!.replaceAsPaste("");
      });
      expect(md).toBe("");
      expect(onChange).toHaveBeenLastCalledWith("");
    });
  });
});

describe("the other boxes' paste", () => {
  it("is as before: no fixes, no payload, and an HTML paste keeps the HTML path", () => {
    const onChange = vi.fn();
    const onPaste = vi.fn();
    render(<RichText aria-label="Task" value="" onChange={onChange} onPaste={onPaste} />);
    const ed = editorOf(box());
    firePaste(box(), { "text/plain": "⏺ Done.   \n  badge\u00a0page" });
    expect(ed.state.doc.child(0).textContent).toBe("⏺ Done.   ");
    expect(ed.state.doc.child(1).textContent).toBe("  badge\u00a0page");
    act(() => {
      ed.commands.clearContent(false);
    });
    firePaste(box(), { "text/plain": "⏺ Done.\n  next", "text/html": "<p><b>HTML</b> flavor</p>" });
    expect(box().querySelector("strong")?.textContent).toBe("HTML");
    expect(onPaste).not.toHaveBeenCalled();
  });
});

describe("pasting an image (KTD5, KTD8)", () => {
  /** A box whose images save to the names given, in order, each when its promise is settled by `land`. */
  function setupImages(value = "", props: { cleanPaste?: boolean; onPaste?: () => void } = {}) {
    const onChange = vi.fn();
    const saves: { file: File; resolve: (name: string) => void; reject: (e: Error) => void }[] = [];
    const images: RichImages = {
      load: () => Promise.resolve("data:image/png;base64,iVBORw0KGgo="),
      save: vi.fn(
        (file: File) =>
          new Promise<string>((resolve, reject) => {
            saves.push({ file, resolve, reject });
          }),
      ),
    };
    const ref = createRef<RichTextHandle>();
    const label = props.cleanPaste ? "Reply" : "Task";
    const utils = render(<RichText ref={ref} aria-label={label} value={value} onChange={onChange} images={images} {...props} />);
    const ed = editorOf(box(label));
    /** Lets every pending save land with its name, then waits for the inserts. */
    async function land(...names: string[]) {
      await act(async () => {
        names.forEach((name, i) => saves[i].resolve(name));
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    return { onChange, images, saves, ed, ref, land, label, utils };
  }

  it("saves a pasted PNG and puts its ref at the cursor (R1)", async () => {
    const { onChange, images, saves, ed, land } = setupImages("Look here");
    act(() => {
      ed.commands.focus("end");
    });
    const file = pngFile();
    expect(firePaste(box(), {}, [file])).toBe(false);
    expect(images.save).toHaveBeenCalledTimes(1);
    expect(saves[0].file).toBe(file);
    await land("image-1a2b3c4d.png");
    expect(onChange).toHaveBeenLastCalledWith("Look here![](image-1a2b3c4d.png)");
  });

  it("replaces a selected word with the image", async () => {
    const { onChange, ed, land } = setupImages("make this bold");
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 6, 10)));
    });
    firePaste(box(), {}, [pngFile()]);
    await land("a.png");
    expect(onChange).toHaveBeenLastCalledWith("make ![](a.png) bold");
  });

  it("puts two images in clipboard order", async () => {
    const { onChange, images, ed, land } = setupImages("");
    act(() => {
      ed.commands.focus("end");
    });
    firePaste(box(), {}, [pngFile("one.png"), pngFile("two.jpg", "image/jpeg")]);
    expect(images.save).toHaveBeenCalledTimes(2);
    await land("one.png", "two.jpg");
    expect(onChange).toHaveBeenLastCalledWith("![](one.png)![](two.jpg)");
  });

  it("inserts only the images that saved", async () => {
    const { onChange, saves, ed } = setupImages("");
    act(() => {
      ed.commands.focus("end");
    });
    firePaste(box(), {}, [pngFile("one.png"), pngFile("two.gif", "image/gif")]);
    await act(async () => {
      saves[0].resolve("one.png");
      saves[1].reject(new Error("Only PNG and JPEG images can be pasted."));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onChange).toHaveBeenLastCalledWith("![](one.png)");
  });

  it("takes the text path for an image that comes with real text, as an Office copy does (R3)", () => {
    const { onChange, images } = setupImages("");
    firePaste(box(), { "text/plain": "Revenue Q3", "text/html": "<table><tr><td>Revenue Q3</td></tr></table>" }, [pngFile()]);
    expect(images.save).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith("Revenue Q3");
  });

  it("takes the image for a browser's Copy Image, whose HTML is only the image and whose text is its address", async () => {
    const { images, land } = setupImages("");
    firePaste(box(), { "text/plain": "https://example.com/p.png", "text/html": '<meta charset="utf-8"><img src="https://example.com/p.png">' }, [pngFile()]);
    expect(images.save).toHaveBeenCalledTimes(1);
    await land("image-1a2b3c4d.png");
  });

  it("hands a GIF to save, which refuses it, and inserts nothing", async () => {
    const { onChange, images, saves } = setupImages("Before");
    firePaste(box(), {}, [pngFile("anim.gif", "image/gif")]);
    expect(images.save).toHaveBeenCalledTimes(1);
    await act(async () => {
      saves[0].reject(new Error("Only PNG and JPEG images can be pasted."));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is not taken by a box with no images", () => {
    const onChange = vi.fn();
    render(<RichText aria-label="Task" value="" onChange={onChange} />);
    expect(firePaste(box(), {}, [pngFile()])).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not report an image paste to the reply box's owner, and leaves its text paste as it was", async () => {
    const onPaste = vi.fn();
    const { onChange, images, land, label } = setupImages("", { cleanPaste: true, onPaste });
    firePaste(box(label), {}, [pngFile()]);
    await land("image-1a2b3c4d.png");
    expect(onChange).toHaveBeenLastCalledWith("![](image-1a2b3c4d.png)");
    expect(onPaste).not.toHaveBeenCalled();
    firePaste(box(label), { "text/plain": " and more" });
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(images.save).toHaveBeenCalledTimes(1);
  });

  it("lands at the paste position when the person types while it saves", async () => {
    const { onChange, ed, land } = setupImages("One two");
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 4)));
    });
    firePaste(box(), {}, [pngFile()]);
    act(() => {
      ed.commands.focus("end");
    });
    typeInto(ed, " three");
    await land("a.png");
    expect(onChange).toHaveBeenLastCalledWith("One![](a.png) two three");
    // The cursor stays where the person was typing, at the end, not back beside the image.
    expect(ed.state.selection.from).toBe(ed.state.doc.content.size - 1);
  });

  it("leaves the cursor right after the image when nothing moved it while it saved", async () => {
    const { ed, land } = setupImages("One two");
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 4)));
    });
    firePaste(box(), {}, [pngFile()]);
    await land("a.png");
    expect(ed.state.selection.from).toBe(5);
  });

  it("drops the insert when the box is set from outside while it saves", async () => {
    const { onChange, ed, land, utils, images } = setupImages("Old reply");
    act(() => {
      ed.commands.focus("end");
    });
    firePaste(box(), {}, [pngFile()]);
    utils.rerender(<RichText aria-label="Task" value="" onChange={onChange} images={images} />);
    await land("a.png");
    expect(ed.getMarkdown()).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops the insert when replaceAsPaste writes the box while it saves", async () => {
    const { onChange, ed, ref, land } = setupImages("Old reply");
    firePaste(box(), {}, [pngFile()]);
    act(() => {
      ref.current!.replaceAsPaste("New reply.");
    });
    await land("a.png");
    expect(ed.getMarkdown()).toBe("New reply.");
    expect(onChange).toHaveBeenLastCalledWith("New reply.");
  });

  it("drops the insert, quietly, when the box closes while it saves", async () => {
    const { onChange, land, utils } = setupImages("Old reply");
    firePaste(box(), {}, [pngFile()]);
    utils.unmount();
    await land("a.png");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("puts an image pasted in a code block in a new paragraph after the block", async () => {
    const { onChange, ed, land } = setupImages("```\nx\n```");
    act(() => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2)));
    });
    firePaste(box(), {}, [pngFile()]);
    await land("a.png");
    expect(onChange).toHaveBeenLastCalledWith("```\nx\n```\n\n![](a.png)");
  });

  it("still passes Escape through", () => {
    setupImages("Keep it");
    expect(fireEvent.keyDown(box(), { key: "Escape", code: "Escape", keyCode: 27 })).toBe(true);
  });
});

describe("the flow-test stub's image paste", () => {
  it("saves the image and splices its ref in at the selection", async () => {
    const onChange = vi.fn();
    const save = vi.fn(() => Promise.resolve("image-x.png"));
    render(<StubRichText aria-label="Task" value="AB" onChange={onChange} images={{ load: () => Promise.resolve(null), save }} />);
    const el = screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement;
    el.setSelectionRange(1, 1);
    firePaste(el, {}, [pngFile()]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("A![](image-x.png)B");
  });

  it("leaves a text paste with an image to the text path", () => {
    const onChange = vi.fn();
    const save = vi.fn(() => Promise.resolve("image-x.png"));
    render(<StubRichText aria-label="Task" value="" onChange={onChange} images={{ load: () => Promise.resolve(null), save }} />);
    firePaste(screen.getByRole("textbox", { name: "Task" }), { "text/plain": "Revenue" }, [pngFile()]);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("useRichDraft", () => {
  function Probe({ initial }: { initial: string }) {
    const d = useRichDraft(initial);
    return (
      <>
        <RichText aria-label="Task" value={d.value} onChange={d.setValue} onNormalized={d.onNormalized} />
        <output>{d.changed ? "changed" : "same"}</output>
      </>
    );
  }

  it("is unchanged on open even when the editor rewrites the Markdown", () => {
    render(<Probe initial={"* star\n* list"} />);
    expect(screen.getByRole("status").textContent).toBe("same");
  });

  it("is unchanged on open for text saved with blank runs and &nbsp; (R17)", () => {
    render(<Probe initial={"First\n\n\n\n&nbsp;\n\n&nbsp;\n\nSecond"} />);
    expect(screen.getByRole("status").textContent).toBe("same");
  });

  it("changes after an edit, and not after an edit that is undone", () => {
    render(<Probe initial={"* star"} />);
    const ed = editorOf(box());
    act(() => {
      ed.commands.focus("end");
    });
    typeInto(ed, "s");
    expect(screen.getByRole("status").textContent).toBe("changed");
    act(() => {
      ed.commands.deleteRange({ from: ed.state.selection.from - 1, to: ed.state.selection.from });
    });
    expect(screen.getByRole("status").textContent).toBe("same");
  });

  it("stays changed when the box mounts again with the edited text, as on Back to its card (U6)", () => {
    function Remount() {
      const d = useRichDraft("* star");
      const [shown, setShown] = useState(true);
      return (
        <>
          {shown && <RichText aria-label="Task" value={d.value} onChange={d.setValue} onNormalized={d.onNormalized} />}
          <button type="button" onClick={() => setShown((s) => !s)}>
            Toggle
          </button>
          <output>{d.changed ? "changed" : "same"}</output>
        </>
      );
    }
    render(<Remount />);
    const ed = editorOf(box());
    act(() => {
      ed.commands.focus("end");
    });
    typeInto(ed, "s");
    expect(screen.getByRole("status").textContent).toBe("changed");
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(box().textContent).toBe("stars");
    expect(screen.getByRole("status").textContent).toBe("changed");
  });

  it("stands a formatting bar on top of the box, whose tools change the text", () => {
    const changes: string[] = [];
    render(<RichText aria-label="Task" value="Keep the diff small" onChange={(md) => changes.push(md)} placeholder="What the agent is asked to do" />);
    const bar = screen.getByRole("toolbar", { name: "Formatting" });
    for (const name of ["Bold", "Italic", "Code", "Link", "Heading", "Bullet list", "Numbered list", "Checklist", "Quote", "Code block"]) {
      expect(within(bar).getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(within(bar).getByRole("button", { name: "Checklist" }));
    expect(changes[changes.length - 1]).toBe("- [ ] Keep the diff small");
    expect(within(bar).getByRole("button", { name: "Checklist" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the flow-test stub's paste", () => {
  function setupStub(value: string, cleanPaste = true) {
    const onChange = vi.fn();
    const onPaste = vi.fn();
    const ref = createRef<RichTextHandle>();
    render(<StubRichText ref={ref} aria-label="Reply" value={value} onChange={onChange} onPaste={onPaste} cleanPaste={cleanPaste} />);
    return { onChange, onPaste, ref, area: screen.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement };
  }

  it("fixes a paste, reports the payload and then the change", () => {
    const { onChange, onPaste, area } = setupStub("");
    const raw = "⏺ The stale flag on the\n  badge page clears.  ";
    expect(firePaste(area, { "text/plain": raw })).toBe(false);
    const fixed = "The stale flag on the\nbadge page clears.";
    expect(onPaste).toHaveBeenCalledWith({ raw, fixed, markdown: fixed, whole: true, candidates: true, terminal: true });
    expect(onChange).toHaveBeenLastCalledWith(fixed);
    expect(onPaste.mock.invocationCallOrder[0]).toBeLessThan(onChange.mock.invocationCallOrder[0]);
  });

  it("pastes at the selection, and reports a paste beside text as not whole", () => {
    const { onChange, onPaste, area } = setupStub("Already here.");
    area.setSelectionRange(13, 13);
    firePaste(area, { "text/plain": " And more." });
    expect(onPaste).toHaveBeenLastCalledWith(expect.objectContaining({ whole: false, candidates: false, markdown: "Already here. And more." }));
    expect(onChange).toHaveBeenLastCalledWith("Already here. And more.");
  });

  it("writes through replaceAsPaste with the fixes, without a payload", () => {
    const { onChange, onPaste, ref } = setupStub("Old reply.");
    let md = "";
    act(() => {
      md = ref.current!.replaceAsPaste("⏺ Joined text.  ");
    });
    expect(md).toBe("Joined text.");
    expect(onChange).toHaveBeenLastCalledWith("Joined text.");
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("leaves a paste alone without cleanPaste", () => {
    const { onChange, onPaste, area } = setupStub("", false);
    expect(firePaste(area, { "text/plain": "⏺ Done." })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(onPaste).not.toHaveBeenCalled();
  });
});
