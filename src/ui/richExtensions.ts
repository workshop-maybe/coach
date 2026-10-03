// The Tiptap extensions behind every rich box, and behind the read-only reply view (KTD5).
// They live apart from RichText.tsx because flow tests replace that whole module with a
// stub that exports only `RichText`, and the view must still parse with the real schema.

import { Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";

/** The extensions every rich box uses. Exported for tests that parse and render Markdown. */
export function richExtensions(placeholder = "") {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      underline: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
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
