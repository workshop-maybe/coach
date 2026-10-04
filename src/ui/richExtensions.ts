// The Tiptap extensions behind every rich box, and behind the read-only reply view (KTD5).
// They live apart from RichText.tsx because flow tests replace that whole module with a
// stub that exports only `RichText`, and the view must still parse with the real schema.
//
// The schema has an image node (src/ui/richImage.ts). It never parses a foreign <img>, and
// shows only images its box's source returns for a bare file name, so nothing in a box or
// a reply loads from the network (R7 of the paste-images plan, KTD2; R13 of the panes plan).

import { Extension, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { RichImage, type RichImageSource } from "./richImage";

/** A blank line someone typed or pasted. */
function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === "paragraph" && !node.content?.length;
}

/**
 * Blank lines never save as `&nbsp;` (KTD15, R17), which Tiptap writes for the second empty
 * paragraph of a run. Empty paragraphs between blocks drop out of the Markdown, and one in a
 * quote or a list item writes nothing. This works on the document, not the Markdown, so a
 * literal `&nbsp;` in code survives. An edit that only removes a blank run reads as unchanged.
 */
const BlankDroppingDocument = Document.extend({
  renderMarkdown: (node, h) => (node.content ? h.renderChildren(node.content.filter((n) => !isEmptyParagraph(n)), "\n\n") : ""),
});
const BlankParagraph = Paragraph.extend({
  renderMarkdown: (node, h) => (node.content?.length ? h.renderChildren(node.content) : ""),
  // Tiptap lifts a paragraph's lone image out to the block level, for an image node that is
  // a block. This one is inline, so that paragraph stays a paragraph around it.
  parseMarkdown: (token, helpers) => {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0].type === "image") return helpers.createNode("paragraph", undefined, helpers.parseInline(tokens));
    return Paragraph.config.parseMarkdown!(token, helpers);
  },
});

/**
 * The extensions every rich box uses. Exported for tests that parse and render Markdown.
 * `images` returns the box's image source as it is now; without one, images show as placeholders.
 */
export function richExtensions(placeholder = "", images: () => RichImageSource | null = () => null) {
  return [
    StarterKit.configure({
      document: false,
      paragraph: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      underline: false,
    }),
    BlankDroppingDocument,
    BlankParagraph,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
    RichImage.configure({ source: images }),
    Markdown.configure({ indentation: { style: "space", size: 2 } }),
  ];
}

/**
 * For the read-only view only: a Markdown table, which the schema has no node for, shows
 * as its pipe text in a code block, so the columns line up in the mono. Without it the
 * parser drops a table that sits among other blocks. The editor leaves it out, so what
 * an editor saves is unchanged (KTD6).
 */
export const TableAsText = Extension.create({
  name: "tableAsText",
  markdownTokenName: "table",
  parseMarkdown(token) {
    const text = (token.raw ?? "").replace(/\n+$/, "");
    return text ? { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text }] } : [];
  },
});
