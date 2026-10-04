// The image node behind every rich box and the read-only view (KTD1, KTD2 of
// docs/plans/2026-10-04-0033-feat-paste-images-into-rich-boxes-plan.md).
//
// In the Markdown an image is `![alt](src "title")`; in the editor it is an inline atom.
// Its Markdown hooks round-trip it exactly, so no box drops an image ref any more (R9).
//
// Nothing here loads from the network or from outside the data folder (R7; R13 of the
// panes plan). That holds at the node view, not at the parser:
// - the only HTML it parses is its own copy format (an `img` carrying `data-md-src`), and
//   its HTML carries the src there, never in `src`, so no copy takes a remote address out;
// - the node view asks the box's image source only for a bare PNG or JPEG file name, and
//   the only `src` it ever sets is a PNG or JPEG data URI that source returned;
// - everything else is an inert placeholder whose text is the ref.
// The view is built with createElement and textContent only. marked passes markup through
// into alt, title and src, and the webview has no CSP, so an HTML string here would run a
// reply's script.

import { Node } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isImageDataUri, isLocalImageName } from "../domain/images";

/** Where a box's images come from: a bare file name in, a data URI (or null) out. */
export interface RichImageSource {
  load(name: string): Promise<string | null>;
}

export interface RichImageOptions {
  /** The box's image source as it is now. Read on every render, so a new source never rebuilds the editor. */
  source: () => RichImageSource | null;
}

interface RichImageStorage {
  /** The live node views, so a box can redraw them when its source changes. */
  views: Set<ImageView>;
}

/** marked's inline tokens, as far as an alt needs them. */
interface AltToken {
  text?: string;
  tokens?: AltToken[];
}

/** An alt's literal text: each text token's text and each escape's character, flattened. */
function altOf(tokens: AltToken[] | undefined, fallback: string): string {
  if (!tokens) return fallback;
  return tokens.map((t) => (t.tokens ? altOf(t.tokens, "") : (t.text ?? ""))).join("");
}

const escapeAlt = (alt: string) => alt.replace(/[\\[\]]/g, "\\$&");
const escapeTitle = (title: string) => title.replace(/[\\"]/g, "\\$&");
/** A src as Markdown: bare when it can be, else in <...> with its brackets escaped. */
function srcMarkdown(src: string): string {
  if (src === "" || /[\s()<>]/.test(src)) return `<${src.replace(/[\\<>]/g, "\\$&")}>`;
  return src.replace(/\\/g, "\\\\");
}

/** The Markdown for one image. Also its plain text, so a text copy keeps the ref. */
export function imageMarkdown(attrs: { src?: string | null; alt?: string | null; title?: string | null }): string {
  const title = attrs.title ? ` "${escapeTitle(attrs.title)}"` : "";
  return `![${escapeAlt(attrs.alt ?? "")}](${srcMarkdown(attrs.src ?? "")}${title})`;
}

/** One image in a box or view. A leaf: ProseMirror ignores what happens inside it. */
class ImageView {
  readonly dom: HTMLElement;
  private node: PMNode;
  private shown: string | null = null;
  private ticket = 0;
  private loadedOnce = false;

  constructor(
    node: PMNode,
    private readonly source: () => RichImageSource | null,
    private readonly views: Set<ImageView>,
  ) {
    this.node = node;
    this.dom = document.createElement("span");
    this.dom.className = "rich-image";
    views.add(this);
    this.render();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    if (changed) {
      this.shown = null;
      this.loadedOnce = false;
      this.render();
    } else {
      this.label();
    }
    return true;
  }

  /** Reads again from the box's current source, keeping what shows until the read lands. */
  refresh(): void {
    this.render();
  }

  destroy(): void {
    this.ticket++;
    this.views.delete(this);
  }

  private get src(): string {
    return (this.node.attrs.src as string | null) ?? "";
  }

  private render(): void {
    const src = this.src;
    const source = this.source();
    const ticket = ++this.ticket;
    if (!isLocalImageName(src) || !source) {
      this.placeholder();
      return;
    }
    if (!this.loadedOnce && this.shown === null) this.dom.setAttribute("aria-busy", "true");
    let read: Promise<string | null>;
    try {
      read = source.load(src);
    } catch {
      read = Promise.resolve(null);
    }
    read.then(
      (uri) => this.landed(ticket, uri),
      () => this.landed(ticket, null),
    );
  }

  private landed(ticket: number, uri: string | null): void {
    if (ticket !== this.ticket) return;
    this.loadedOnce = true;
    this.dom.removeAttribute("aria-busy");
    if (uri !== null && isImageDataUri(uri)) this.image(uri);
    else this.placeholder();
  }

  private image(uri: string): void {
    this.shown = uri;
    let img = this.dom.firstElementChild;
    if (!(img instanceof HTMLImageElement)) {
      img = document.createElement("img");
      (img as HTMLImageElement).draggable = false;
      img.setAttribute("draggable", "false");
      this.dom.replaceChildren(img);
    }
    (img as HTMLImageElement).src = uri;
    this.label();
  }

  /** The image's accessible name and tooltip, from its alt, title and file name. */
  private label(): void {
    const img = this.dom.firstElementChild;
    if (!(img instanceof HTMLImageElement)) return;
    img.alt = (this.node.attrs.alt as string | null) || this.src;
    const title = this.node.attrs.title as string | null;
    if (title) img.title = title;
    else img.removeAttribute("title");
  }

  private placeholder(): void {
    this.shown = null;
    this.dom.removeAttribute("aria-busy");
    const label = document.createElement("span");
    label.className = "rich-image-missing";
    label.textContent = this.src || ((this.node.attrs.alt as string | null) ?? "");
    this.dom.replaceChildren(label);
  }
}

export const RichImage = Node.create<RichImageOptions, RichImageStorage>({
  name: "image",
  inline: true,
  group: "inline",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { source: () => null };
  },

  addStorage() {
    return { views: new Set<ImageView>() };
  },

  addAttributes() {
    return {
      // The src lives in data-md-src both ways, so no copy of the node ever carries a real `src`.
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-md-src") ?? "",
        renderHTML: (attrs) => ({ "data-md-src": attrs.src as string }),
      },
      alt: {
        default: "",
        parseHTML: (el) => el.getAttribute("alt") ?? "",
        renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt as string } : {}),
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute("title"),
        renderHTML: (attrs) => (attrs.title ? { title: attrs.title as string } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[data-md-src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    // Rebuilt from the three rendered attributes, so nothing else can ride along.
    const { "data-md-src": src, alt, title } = HTMLAttributes as Record<string, string | undefined>;
    return ["img", { "data-md-src": src ?? "", ...(alt ? { alt } : {}), ...(title ? { title } : {}) }];
  },

  renderText({ node }) {
    return imageMarkdown(node.attrs);
  },

  markdownTokenName: "image",

  parseMarkdown(token): JSONContent {
    const t = token as { href?: string; title?: string | null; text?: string; tokens?: AltToken[] };
    return { type: "image", attrs: { src: t.href ?? "", alt: altOf(t.tokens, t.text ?? ""), title: t.title ?? null } };
  },

  renderMarkdown(node) {
    return imageMarkdown(node.attrs ?? {});
  },

  addNodeView() {
    const { source } = this.options;
    const { views } = this.storage;
    return ({ node }) => new ImageView(node as PMNode, source, views);
  },
});

/** Redraws a box's images after its image source changed. */
export function refreshImages(editor: { storage: unknown }): void {
  const storage = editor.storage as { image?: RichImageStorage };
  for (const view of storage.image?.views ?? []) view.refresh();
}
