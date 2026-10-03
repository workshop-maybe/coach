// A rich-text box that reads and writes Markdown. Files on disk stay plain Markdown:
// the editor parses `value` once, turns Markdown typed or pasted into structure, and
// hands back Markdown only when the person edits. Opening it changes nothing.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Node as PMNode, Slice } from "@tiptap/pm/model";
import { ToolKey, type ToolName } from "../cast/ToolKey";
import { richExtensions } from "./richExtensions";

export interface RichTextProps {
  /** The text as Markdown. */
  value: string;
  /** Called with Markdown after each edit the person makes, never on open. */
  onChange(markdown: string): void;
  /** Called once with the editor's own Markdown for `value`, so a caller can tell a real change from a reformat. */
  onNormalized?(markdown: string): void;
  "aria-label": string;
  placeholder?: string;
  autoFocus?: boolean;
}

/** True when a pasted string carries Markdown structure worth parsing. */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|(^|\n)\s*[-*_]{3,}\s*($|\n)/.test(text);
}

/** The editor's Markdown, without the blank lines an empty last paragraph leaves. */
function markdownOf(editor: Editor): string {
  return editor.getMarkdown().replace(/\n+$/, "");
}

export function RichText({ value, onChange, onNormalized, placeholder, autoFocus, "aria-label": label }: RichTextProps) {
  const latest = useRef({ onChange, onNormalized });
  latest.current = { onChange, onNormalized };
  // The Markdown the editor last showed or sent, so a value that comes back unchanged is not re-parsed.
  const shown = useRef(value);

  const editor = useEditor({
    extensions: richExtensions(placeholder),
    content: value,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        class: "rich-input",
        spellcheck: "true",
      },
      // ProseMirror marks every Escape as handled, though it does nothing with it, which
      // would hide it from the deck around the box. Escape passes through untouched, so on a
      // pane it steps out of the box (U6, R19, KTD8).
      handleDOMEvents: {
        keydown: (_view, event) => event.key === "Escape",
      },
      // Plain text that reads as Markdown (an agent's reply) comes in as structure.
      clipboardTextParser(text, _context, _plain, view) {
        const md = editorRef.current?.markdown;
        if (!md || !looksLikeMarkdown(text)) return null as unknown as Slice;
        const doc = PMNode.fromJSON(view.state.schema, md.parse(text));
        const open = (n: PMNode | null) => (n?.type.name === "paragraph" ? 1 : 0);
        return new Slice(doc.content, open(doc.firstChild), open(doc.lastChild));
      },
    },
    onUpdate({ editor }) {
      const md = markdownOf(editor);
      shown.current = md;
      latest.current.onChange(md);
    },
  });
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  // Reported after render, since the editor is built during it.
  useEffect(() => {
    if (editor) latest.current.onNormalized?.(markdownOf(editor));
  }, [editor]);

  // A value set from outside (not an echo of our own edit) replaces the content quietly.
  useEffect(() => {
    if (!editor || value === shown.current) return;
    shown.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  return (
    <div className="rich">
      {editor && <Toolbar editor={editor} full label="Formatting" />}
      <EditorContent editor={editor} />
      {editor && <SelectionMenu editor={editor} />}
    </div>
  );
}

/** The small menu that floats over a selection, with the inline tools. */
function SelectionMenu({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      className="rich-menu"
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && !e.isActive("codeBlock")}
    >
      <Toolbar editor={editor} label="Format" />
    </BubbleMenu>
  );
}

/**
 * The formatting tools. `full` is the bar that stands on top of every rich box, with the
 * block tools as well; the selection menu shows only the inline ones.
 */
function Toolbar({ editor, full = false, label }: { editor: Editor; full?: boolean; label: string }) {
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState("");
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      heading: e.isActive("heading", { level: 2 }),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      tasks: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
    }),
  });

  function startLink() {
    setHref((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinking(true);
  }

  function endLink(apply: boolean) {
    if (apply) {
      const url = href.trim();
      const chain = editor.chain().focus().extendMarkRange("link");
      if (url) chain.setLink({ href: url }).run();
      else chain.unsetLink().run();
    } else editor.commands.focus();
    setLinking(false);
  }

  function onLinkKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    // Handled here, so the deck neither moves on (Enter) nor closes (Escape).
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      endLink(e.key === "Enter");
    }
  }

  const tool = (name: string, key: ToolName, on: boolean, run: () => void) => (
    <button
      type="button"
      aria-label={name}
      title={name}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <ToolKey tool={key} on={on} />
    </button>
  );

  if (linking) {
    return (
      <input
        className="rich-link"
        aria-label="Link address"
        value={href}
        placeholder="https://"
        autoFocus
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={onLinkKey}
        onBlur={() => setLinking(false)}
      />
    );
  }

  return (
    <div role="toolbar" aria-label={label} className={full ? "rich-bar" : undefined}>
      {tool("Bold", "bold", active.bold, () => editor.chain().focus().toggleBold().run())}
      {tool("Italic", "italic", active.italic, () => editor.chain().focus().toggleItalic().run())}
      {tool("Code", "code", active.code, () => editor.chain().focus().toggleCode().run())}
      {tool("Link", "link", active.link, startLink)}
      {full && <span className="rich-gap" aria-hidden="true" />}
      {tool("Heading", "heading", active.heading, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
      {tool("Bullet list", "bullets", active.bullets, () => editor.chain().focus().toggleBulletList().run())}
      {full && tool("Numbered list", "numbers", active.numbers, () => editor.chain().focus().toggleOrderedList().run())}
      {full && tool("Checklist", "tasks", active.tasks, () => editor.chain().focus().toggleTaskList().run())}
      {full && tool("Quote", "quote", active.quote, () => editor.chain().focus().toggleBlockquote().run())}
      {full && tool("Code block", "codeBlock", active.codeBlock, () => editor.chain().focus().toggleCodeBlock().run())}
    </div>
  );
}
