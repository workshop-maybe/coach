// The image node behind every rich box and the read-only view (KTD1, KTD2 of
// docs/plans/2026-10-04-0033-feat-paste-images-into-rich-boxes-plan.md).
//
// In the Markdown an image is `![alt](src "title")`; in the editor it is an inline atom.
// Its Markdown hooks round-trip it exactly, so no box drops an image ref any more (R9).
// The same syntax names a video (KTD1 of the video plan): its Markdown hook makes a `video`
// node (src/ui/richVideo.ts) when the src ends .mp4, .m4v, .mov or .webm, since Tiptap
// reaches only the first handler for an inline `image` token.
//
// Nothing here loads from the network or from outside the data folder (R7; R13 of the
// panes plan; R9 of the video plan). That holds at the node views, not at the parser:
// - the only HTML it parses is its own copy format (an `img` carrying `data-md-src`, never
//   with a video name), and its HTML carries the src there, never in `src`, so no copy takes
//   a remote address out;
// - the node view asks the box's image source only for a bare PNG or JPEG file name, and
//   the only `src` it ever sets is a PNG or JPEG data URI that source returned;
// - everything else is an inert placeholder whose text is the ref.
// The video node holds to the same rule with its own checks. The views are built with
// createElement and textContent only. marked passes markup through into alt, title and src,
// and the webview has no CSP, so an HTML string here would run a reply's script.

import { Node } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isImageDataUri, isLocalImageName } from "../domain/images";
import { hasVideoExtension } from "../domain/videos";

/**
 * A video a box's source can play: a URL, how much the player may load before play, and
 * the release the view calls once it lets go (KTD2, KTD4 of the video plan). The view calls
 * `release` exactly once for each handle it was given.
 */
export interface RichVideo {
  url: string;
  /** "none" for a reply's folder, where nothing decodes until play; "metadata" elsewhere. */
  preload: "none" | "metadata";
  release(): void;
}

/** Where a box's images come from: a bare file name in, a data URI (or null) out. */
export interface RichImageSource {
  load(name: string): Promise<string | null>;
  /** A bare video file name in, a playable handle (or null) out. Without it, videos show as placeholders. */
  video?(name: string): Promise<RichVideo | null>;
}

export interface RichImageOptions {
  /** The box's image source as it is now. Read on every render, so a new source never rebuilds the editor. */
  source: () => RichImageSource | null;
}

interface RichImageStorage {
  /** The live node views, so a box can redraw them when its source changes. */
  views: Set<ImageView>;
}

/** A node view a box redraws when its source changes. */
interface Refreshable {
  refresh(): void;
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
    if (!this.loadedOnce) this.dom.setAttribute("aria-busy", "true");
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
    const shown = this.dom.firstElementChild;
    const img = shown instanceof HTMLImageElement ? shown : document.createElement("img");
    if (img !== shown) {
      img.setAttribute("draggable", "false");
      this.dom.replaceChildren(img);
    }
    img.src = uri;
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
    // A video name is the video node's, so a cut and paste of either rebuilds the same node.
    return [{ tag: "img[data-md-src]", getAttrs: (el) => (hasVideoExtension(el.getAttribute("data-md-src") ?? "") ? false : null) }];
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

  // Also the video node's parser: an `image` token whose src has a video extension is a video.
  parseMarkdown(token): JSONContent {
    const t = token as { href?: string; title?: string | null; text?: string; tokens?: AltToken[] };
    const src = t.href ?? "";
    return { type: hasVideoExtension(src) ? "video" : "image", attrs: { src, alt: altOf(t.tokens, t.text ?? ""), title: t.title ?? null } };
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

/** Redraws a box's images and videos after its image source changed. */
export function refreshImages(editor: { storage: unknown }): void {
  const storage = editor.storage as { image?: { views: Set<Refreshable> }; video?: { views: Set<Refreshable> } };
  for (const view of [...(storage.image?.views ?? []), ...(storage.video?.views ?? [])]) view.refresh();
}
