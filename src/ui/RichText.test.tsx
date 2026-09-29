// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { RichText, looksLikeMarkdown } from "./RichText";
import { useRichDraft } from "./richDraft";

// jsdom has no layout. ProseMirror asks for rects when it scrolls a selection into view.
beforeAll(() => {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  const list = () => Object.assign([rect()], { item: () => rect() });
  Range.prototype.getBoundingClientRect = rect as never;
  Range.prototype.getClientRects = list as never;
  Element.prototype.getClientRects = list as never;
  document.elementFromPoint = () => null;
  // jsdom has no ClipboardEvent; ProseMirror builds one for a text paste.
  globalThis.ClipboardEvent ??= class extends Event {
    clipboardData = null;
  } as never;
});
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
    fireEvent.click(await screen.findByRole("button", { name: "Bold", hidden: true }, { timeout: 2000 }));
    expect(onChange).toHaveBeenLastCalledWith("make **this** bold");
  });

  it("takes a new value from outside without echoing it back", () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichText aria-label="Task" value="One" onChange={onChange} />);
    rerender(<RichText aria-label="Task" value="- Two" onChange={onChange} />);
    expect(box().querySelector("ul li")?.textContent).toBe("Two");
    expect(onChange).not.toHaveBeenCalled();
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
});
