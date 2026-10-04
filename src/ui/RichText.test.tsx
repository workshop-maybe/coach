// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { RichText, looksLikeMarkdown, type RichTextHandle } from "./RichText";
import { RichText as StubRichText } from "./richTextStub";
import { useRichDraft } from "./richDraft";
import { firePaste } from "../test/paste";

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

describe("images in the Markdown (KTD1, R9)", () => {
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
