// A rich-text box that reads and writes Markdown. Files on disk stay plain Markdown:
// the editor parses `value` once, turns Markdown typed or pasted into structure, and
// hands back Markdown only when the person edits. Opening it changes nothing.
//
// The reply box also cleans what is pasted into it (KTD14): the meaning-safe fixes run on
// every text paste, a terminal copy that comes with rich text takes the text path, and the
// box reports each paste to its owner, which can later write a cleaned-up text back the
// same way (KTD18). Every other box pastes as it always has.
//
// A box given `images` also takes pasted images (KTD5, KTD8 of the paste-images plan). An
// image paste is caught before any of the text handling above, and only when the clipboard
// carries no real text, so every text paste is unchanged. Each image is saved beside the
// box's file, then its ref goes in where the paste happened. An image paste is an edit like
// any other: it reaches `onChange`, never `onPaste`.
//
// A box whose `images` can `add` files also takes videos (KTD8, KTD9 of the video plan): its
// Video key adds a picked file, and each name the add returns goes in where the cursor was,
// as a video or an image by its extension. While an add runs the box says so on a line kept
// free under the text. Such a box also registers with the window's drop listener
// (src/ui/dropFiles.ts) while mounted: a file dropped on it is added where it landed, or at
// the end of the box when it landed off the text. A paste of a video copied in Finder goes in
// at the cursor the same way, with no text and no bytes, ahead of the image paste.
//
// A reply's text item (KTD7 of the reply artifacts plan) sits inside the reply's editor, which
// is the beat's one drop box, so it registers none of its own (`dropBox` false). A paste into
// it of files that are not all PNG, JPEG or video goes to the editor through `onFiles`, ahead
// of every other paste, and becomes items there; a PNG, JPEG or video still goes inline.

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, Ref } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Node as PMNode, Slice } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { ToolKey, type ToolName } from "../cast/ToolKey";
import { findJoinCandidates, fixPastedText, looksTerminalCopied } from "../domain/pasteText";
import { hasVideoExtension } from "../domain/videos";
import type { AddFrom } from "../storage/storage";
import { registerDropBox } from "./dropFiles";
import { filePaste, imagePaste, videoPaste } from "./pasteImages";
import { richExtensions } from "./richExtensions";
import { refreshImages, type RichImageSource } from "./richImage";

/** A box's images and videos: read for display, and saved when pasted or added. */
export interface RichImages extends RichImageSource {
  /**
   * Saves a pasted image beside the box's file and resolves to its bare file name. Rejects,
   * having already told the person why, when the image can't be saved.
   */
  save?(file: File): Promise<string>;
  /**
   * Copies files beside the box's file, from the picker, a drop or a Finder paste, and
   * resolves to the bare names of those it added, in order: none when the picker was closed
   * or nothing could be added, having already told the person why. Rejects, having told
   * them, when the add fails as a whole. Without it, the box has no Video key.
   */
  add?(from: AddFrom): Promise<string[]>;
}

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
  /** The reply box's paste handling (KTD14). Only the reply box sets it. */
  cleanPaste?: boolean;
  /** With `cleanPaste`, called once after each paste, before that paste's `onChange`. */
  onPaste?(paste: PastePayload): void;
  /** Writes text into the box the way a paste would (KTD18). */
  ref?: Ref<RichTextHandle>;
  /** The images beside the box's file. Without it, an image paste is not taken and images show as placeholders. */
  images?: RichImages;
  /**
   * Takes a paste of files that are not all PNG, JPEG or video (`filePaste`), by name and
   * size, in place of the box. Only a reply's text item sets it (reply artifacts KTD7).
   */
  onFiles?(files: { name: string; size: number }[]): void;
  /** Whether the box registers for dropped files while it can add them. A reply's text item does not (KTD7). */
  dropBox?: boolean;
}

/** What a paste into the reply box did, reported once its transaction has run. */
export interface PastePayload {
  /** The clipboard's plain text, as it came. */
  raw: string;
  /** The text after the meaning-safe fixes, which is what the box parsed. Inside a code block, the raw text. */
  fixed: string;
  /** The whole box's Markdown after the paste. */
  markdown: string;
  /** Whether the paste replaced everything in the box: it was empty, or the selection held all of it. */
  whole: boolean;
  /** Whether any join candidates remain in the fixed text (KTD16, KTD17). */
  candidates: boolean;
  /** Whether the raw text looked terminal-copied (KTD16). */
  terminal: boolean;
}

export interface RichTextHandle {
  /**
   * Replaces the whole box with `text` through the same path as a paste into the emptied
   * box, so with `cleanPaste` the fixes and paste rules apply, and returns the Markdown that
   * produced. The change goes to `onChange` like an edit; `onPaste` is not called.
   */
  replaceAsPaste(text: string): string;
}

/** True when a pasted string carries Markdown structure worth parsing. */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|(^|\n)\s*[-*_]{3,}\s*($|\n)/.test(text);
}

/** The editor's Markdown, without the blank lines an empty last paragraph leaves. */
function markdownOf(editor: Editor): string {
  return editor.getMarkdown().replace(/\n+$/, "");
}

/**
 * Keeps the webview's own menu and drag off a video, so it offers no "Open Video in New
 * Window" or "Download Video" (KTD2 of the video plan). Caught on the box, since the video
 * node view hands every mouse and drag event inside the player back to the browser.
 */
function stopOnVideo(e: ReactMouseEvent<HTMLElement> | ReactDragEvent<HTMLElement>) {
  const video = e.target instanceof Element ? e.target.closest("video") : null;
  if (video && e.currentTarget.contains(video)) e.preventDefault();
}

/** Whether a paste now would replace everything in the box: nothing but blanks lies outside the selection. */
function replacesWholeBox(state: EditorState): boolean {
  const { doc, selection } = state;
  // A leaf such as a rule counts as content.
  const outside = doc.textBetween(0, selection.from, "", "\uFFFC") + doc.textBetween(selection.to, doc.content.size, "", "\uFFFC");
  return outside.trim() === "";
}

/** A paste on its way in: what `transformPastedText` saw, until the paste's transaction lands. */
type PendingPaste = Omit<PastePayload, "markdown" | "candidates">;

/**
 * Puts a node for each name over `from`–`to`: a video for a video name, an image for any
 * other, as the Markdown would parse back (KTD1 of the video plan). In a code block, where
 * neither can sit, they go in a new paragraph after the block. The cursor moves after them
 * only if it is still where the paste left it; a person who typed or clicked elsewhere
 * meanwhile keeps their place.
 */
function insertFiles(view: EditorView, from: number, to: number, names: string[]): void {
  const { state } = view;
  const untouched = state.selection.from === from && state.selection.to === to;
  const { image, video } = state.schema.nodes;
  const nodes = names.map((src) => (hasVideoExtension(src) ? video : image).create({ src }));
  const $from = state.doc.resolve(from);
  let tr: Transaction;
  let end: number;
  if ($from.parent.type.spec.code) {
    const after = $from.after($from.depth);
    tr = state.tr.insert(after, state.schema.nodes.paragraph.create(null, nodes));
    end = after + 1 + nodes.length;
  } else {
    tr = state.tr.replaceWith(from, to, nodes);
    end = tr.mapping.map(to);
  }
  view.dispatch(untouched ? tr.setSelection(TextSelection.near(tr.doc.resolve(end))).scrollIntoView() : tr);
}

export function RichText({
  value,
  onChange,
  onNormalized,
  placeholder,
  autoFocus,
  cleanPaste = false,
  onPaste,
  ref,
  images,
  onFiles,
  dropBox = true,
  "aria-label": label,
}: RichTextProps) {
  const latest = useRef({ onChange, onNormalized, onPaste, cleanPaste, images, onFiles });
  latest.current = { onChange, onNormalized, onPaste, cleanPaste, images, onFiles };
  // The Markdown the editor last showed or sent, so a value that comes back unchanged is not re-parsed.
  const shown = useRef(value);
  const pending = useRef<PendingPaste | null>(null);
  // Set while a terminal copy re-enters the paste as text, and while `replaceAsPaste` writes.
  const rerouting = useRef(false);
  const writing = useRef(false);
  // Bumped whenever the box's content is replaced from outside, so an image still saving
  // from before then is not put into content it was never pasted into (KTD8).
  const replaced = useRef(0);
  // False once the box unmounts. Tiptap destroys the editor a moment later, so this is the first sign.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The adds still running. Kept here, never on `images`, whose new identity would make
  // every view read its file again (KTD9).
  const [adding, setAdding] = useState(0);

  /**
   * Runs `names` (a save or an add), then puts the names it resolves to over `from`–`to`,
   * mapped through every edit made meanwhile, so typing while it runs moves the spot along
   * with the text (KTD8). Nothing goes in if the box closed, its editor was destroyed, or its
   * content was replaced from outside since. Resolves to whether anything went in.
   */
  async function insertWhenDone(from: number, to: number, names: () => Promise<string[]>): Promise<boolean> {
    const ed = editorRef.current;
    if (!ed) return false;
    const generation = replaced.current;
    const mapping = new Mapping();
    const track = ({ transaction }: { transaction: Transaction }) => mapping.appendMapping(transaction.mapping);
    ed.on("transaction", track);
    try {
      const done = await names();
      if (done.length === 0 || !mounted.current || ed.isDestroyed || replaced.current !== generation) return false;
      insertFiles(ed.view, mapping.map(from, -1), mapping.map(to, -1), done);
      return true;
    } finally {
      ed.off("transaction", track);
    }
  }

  /** Saves pasted images, then puts their refs where the paste happened (KTD8). */
  async function pasteImages(view: EditorView, files: File[], save: (file: File) => Promise<string>) {
    if (!editorRef.current) return;
    const { from, to } = view.state.selection;
    await insertWhenDone(from, to, async () => {
      const saved = await Promise.allSettled(files.map((file) => save(file)));
      return saved.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    });
  }

  /**
   * Runs one add of files (`run` calls `images.add`) and puts the names it returns over
   * `from`–`to`, read from the editor's state just before. The pick, a drop and a Finder
   * paste all come through here, so each counts toward the status line. A failed add puts
   * nothing in: the add has already told the person. Resolves to whether anything went in.
   */
  async function addThenInsert(from: number, to: number, run: () => Promise<string[]>): Promise<boolean> {
    setAdding((n) => n + 1);
    try {
      const added = await insertWhenDone(from, to, run);
      // A ref already in the text, written by hand, may name a file that only now exists.
      // Asking again keeps what shows, and a playing video plays on.
      if (added && editorRef.current) refreshImages(editorRef.current);
      return added;
    } catch {
      return false;
    } finally {
      if (mounted.current) setAdding((n) => n - 1);
    }
  }

  /** The Video key: picks a file, puts it at the selection, and hands focus back to the text (KTD9). */
  async function pickFile() {
    const ed = editorRef.current;
    const add = latest.current.images?.add;
    if (!ed || !add || !ed.isEditable) return;
    const { from, to } = ed.state.selection;
    await addThenInsert(from, to, () => add({ kind: "pick" }));
    if (mounted.current && !ed.isDestroyed) ed.view.focus();
  }

  /**
   * Adds files dropped on the box (KTD8). Over the text the point (CSS pixels) picks the
   * spot; anywhere else on the box the files go at the end. Everything is read at drop time,
   * so the add goes to the folder the box shows now.
   */
  function takeDrop(paths: string[], x: number, y: number) {
    const ed = editorRef.current;
    const add = latest.current.images?.add;
    if (!ed || ed.isDestroyed || !add || !ed.isEditable) return;
    const { view } = ed;
    const under = document.elementFromPoint(x, y);
    const point = under && view.dom.contains(under) ? view.posAtCoords({ left: x, top: y })?.pos : undefined;
    const at = point ?? TextSelection.atEnd(view.state.doc).from;
    void addThenInsert(at, at, () => add({ kind: "drop", paths }));
  }

  const editor = useEditor({
    extensions: richExtensions(placeholder, () => latest.current.images ?? null),
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
        // A video copied in Finder, and then an image paste, are taken here, ahead of
        // ProseMirror's own paste and the text handling below, and only when the clipboard
        // carries no real text (KTD5 of both plans). A video paste sends only the files'
        // names and sizes; Rust copies them from the paths on the clipboard.
        paste: (view, event) => {
          const take = latest.current.onFiles;
          const others = take && view.editable ? filePaste(event.clipboardData) : [];
          if (take && others.length > 0) {
            event.preventDefault();
            take(others);
            return true;
          }
          const add = latest.current.images?.add;
          const videos = add && view.editable ? videoPaste(event.clipboardData) : [];
          if (add && videos.length > 0) {
            event.preventDefault();
            const { from, to } = view.state.selection;
            void addThenInsert(from, to, () => add({ kind: "paste", files: videos }));
            return true;
          }
          const save = latest.current.images?.save;
          if (!save || !view.editable) return false;
          const files = imagePaste(event.clipboardData);
          if (files.length === 0) return false;
          event.preventDefault();
          void pasteImages(view, files, save);
          return true;
        },
      },
      // The reply box's fixes see every text paste, Shift-pastes and external text drops
      // included, and leave the dispatch to ProseMirror, so paste rules, a link pasted over a
      // selection and the code block's raw insert all still run. In a code block the text
      // goes in raw. The paste is reported once its transaction lands, in onUpdate.
      transformPastedText(text, _plain, view) {
        if (!latest.current.cleanPaste) return text;
        const inCode = !!view.state.selection.$from.parent.type.spec.code;
        const fixed = inCode ? { text, terminal: false } : fixPastedText(text);
        pending.current = { raw: text, fixed: fixed.text, terminal: fixed.terminal, whole: replacesWholeBox(view.state) };
        // A paste a plugin takes without a transaction leaves nothing to report.
        queueMicrotask(() => {
          pending.current = null;
        });
        return fixed.text;
      },
      // A terminal can copy rich text alongside the plain text, which ProseMirror would parse
      // as HTML. When the plain text looks terminal-copied, it goes through the text path
      // instead. Any other HTML paste keeps the HTML path, whose parsing collapses whitespace.
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!latest.current.cleanPaste || rerouting.current || !data) return false;
        // A VS Code copy is the code block's to take.
        if (Array.from(data.types ?? []).includes("vscode-editor-data")) return false;
        const text = data.getData("text/plain");
        const html = data.getData("text/html");
        if (!text || !html || view.state.selection.$from.parent.type.spec.code) return false;
        // A copy from a ProseMirror editor, this box included, carries its structure.
        if (html.includes("data-pm-slice") || !looksTerminalCopied(text)) return false;
        rerouting.current = true;
        try {
          return view.pasteText(text, event);
        } finally {
          rerouting.current = false;
        }
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
      const paste = pending.current;
      pending.current = null;
      if (paste && !writing.current) {
        latest.current.onPaste?.({ ...paste, markdown: md, candidates: findJoinCandidates(paste.fixed).length > 0 });
      }
      latest.current.onChange(md);
    },
  });
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  useImperativeHandle(
    ref,
    () => ({
      replaceAsPaste(text) {
        if (!editor) return shown.current;
        replaced.current++;
        // Emptied first, so a lone URL replaces the text instead of linking it.
        writing.current = true;
        try {
          editor.commands.clearContent(false);
          editor.view.pasteText(text);
        } finally {
          writing.current = false;
        }
        // An empty text dispatches nothing after the quiet clear, so the change is sent here.
        const md = markdownOf(editor);
        if (md !== shown.current) {
          shown.current = md;
          latest.current.onChange(md);
        }
        return md;
      },
    }),
    [editor],
  );

  // Reported after render, since the editor is built during it.
  useEffect(() => {
    if (editor) latest.current.onNormalized?.(markdownOf(editor));
  }, [editor]);

  // A value set from outside (not an echo of our own edit) replaces the content quietly.
  useEffect(() => {
    if (!editor || value === shown.current) return;
    shown.current = value;
    replaced.current++;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  // Images and videos from a new source (another folder) are read again.
  const imagesShown = useRef(images);
  useEffect(() => {
    if (!editor || imagesShown.current === images) return;
    imagesShown.current = images;
    refreshImages(editor);
  }, [editor, images]);

  const canAdd = !!images?.add;
  const takesDrops = canAdd && dropBox;
  // While it can add files, the box takes drops, unless it sits in a drop box of its own (KTD7). Its class name stays fixed, since the drop
  // listener puts its outline class on this element directly.
  const root = useRef<HTMLDivElement>(null);
  const latestDrop = useRef(takeDrop);
  latestDrop.current = takeDrop;
  useEffect(() => {
    const element = root.current;
    if (!takesDrops || !element) return;
    return registerDropBox({ element, drop: (paths, x, y) => latestDrop.current(paths, x, y) });
  }, [takesDrops]);

  return (
    <div ref={root} className="rich" onContextMenuCapture={stopOnVideo} onDragStartCapture={stopOnVideo}>
      {editor && <Toolbar editor={editor} full label="Formatting" onVideo={canAdd ? () => void pickFile() : undefined} />}
      <EditorContent editor={editor} />
      {editor && <SelectionMenu editor={editor} />}
      {(canAdd || adding > 0) && (
        <div className="rich-foot">
          {adding > 0 && (
            <p className="rich-status" role="status">
              Saving the file
            </p>
          )}
        </div>
      )}
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
 * block tools as well, and the Video key when the box can add files (`onVideo`); the
 * selection menu shows only the inline ones.
 */
function Toolbar({ editor, full = false, label, onVideo }: { editor: Editor; full?: boolean; label: string; onVideo?: () => void }) {
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

  // `on` is left out for a key that is not a toggle.
  const tool = (name: string, key: ToolName, on: boolean | undefined, run: () => void) => (
    <button
      type="button"
      aria-label={name}
      title={name}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <ToolKey tool={key} on={on ?? false} />
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
      {full && onVideo && <span className="rich-gap" aria-hidden="true" />}
      {full && onVideo && tool("Video", "video", undefined, onVideo)}
    </div>
  );
}
