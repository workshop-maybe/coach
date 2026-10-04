// The video node behind every rich box and the read-only view (KTD1, KTD2 of
// docs/plans/2026-10-04-0732-feat-video-in-rich-boxes-plan.md).
//
// In the Markdown a video is an image ref whose src ends .mp4, .m4v, .mov or .webm:
// `![alt](video-1a2b3c4d.mp4 "title")`. RichImage's Markdown hook makes this node for it,
// and this node writes the same Markdown back with the image's escaping, so no box drops a
// video ref (R11). In the editor it is an inline atom: selectable, never dragged.
//
// Nothing here loads from the network or from outside the data folder (R9). That holds at
// the node view, as it does for pictures:
// - the only HTML it parses is its own copy format (a `span` carrying `data-md-video`), and
//   its HTML carries the src there, with no `src`, `poster` or `<video>`, so no copy takes a
//   remote address out;
// - the node view asks the box's source only for a bare local video name, and the one line
//   that sets the player's `src` sets it only to a URL allowed for the platform;
// - everything else, and a video the system can't play, is an inert placeholder whose text
//   is the ref.
// The view is built with createElement, property setters and textContent only, and never
// autoplays. A reply's video gets preload "none" from its source, so nothing decodes a
// file an agent named until the person presses play.

import { Node } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { hasVideoExtension, isAllowedVideoUrl, isLocalVideoName } from "../domain/videos";
import { imageMarkdown, type RichImageSource, type RichVideo } from "./richImage";

/** How long a video waits for its first frame before it stops holding the screen busy (KTD2). */
export const VIDEO_BUSY_MS = 5000;

/** The events a player's own controls take: ProseMirror leaves them alone inside the `<video>`. */
const PLAYER_EVENTS = /^(pointer|mouse|key|drag|touch)|^(click|dblclick|auxclick|contextmenu|drop|wheel)$/;

export interface VideoNodeOptions {
  /** The box's source as it is now. Read on every render, so a new source never rebuilds the editor. */
  source: () => RichImageSource | null;
}

interface VideoNodeStorage {
  /** The live node views, so a box can redraw them when its source changes. */
  views: Set<VideoView>;
}

/** One video in a box or view. A leaf: ProseMirror ignores what happens inside it. */
class VideoView {
  readonly dom: HTMLElement;
  private node: PMNode;
  private ticket = 0;
  /** The handle behind the player that shows, released once the view lets go of it. */
  private held: RichVideo | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    node: PMNode,
    private readonly source: () => RichImageSource | null,
    private readonly views: Set<VideoView>,
  ) {
    this.node = node;
    this.dom = document.createElement("span");
    this.dom.className = "rich-video";
    views.add(this);
    this.render(false);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    if (changed) this.render(false);
    else this.label();
    return true;
  }

  /** Asks the box's current source again, keeping what shows until the answer lands. */
  refresh(): void {
    this.render(true);
  }

  /** The player's controls take their own events, so a click plays and Space never replaces the node. */
  stopEvent(event: Event): boolean {
    const video = this.dom.firstElementChild;
    return video instanceof HTMLVideoElement && event.target instanceof globalThis.Node && video.contains(event.target) && PLAYER_EVENTS.test(event.type);
  }

  // ProseMirror makes a selected node draggable; this one is never dragged, so a drag on
  // its controls seeks instead of moving the node.
  selectNode(): void {
    this.dom.classList.add("ProseMirror-selectednode");
  }

  deselectNode(): void {
    this.dom.classList.remove("ProseMirror-selectednode");
  }

  destroy(): void {
    this.ticket++;
    this.views.delete(this);
    this.letGo();
  }

  private get src(): string {
    return (this.node.attrs.src as string | null) ?? "";
  }

  private get alt(): string {
    return (this.node.attrs.alt as string | null) ?? "";
  }

  private render(keep: boolean): void {
    const src = this.src;
    const source = this.source();
    const ticket = ++this.ticket;
    if (!isLocalVideoName(src) || !source?.video) {
      this.placeholder();
      return;
    }
    if (!keep) {
      this.letGo();
      this.dom.replaceChildren();
    }
    if (!this.held) this.dom.setAttribute("aria-busy", "true");
    let ask: Promise<RichVideo | null>;
    try {
      ask = source.video(src);
    } catch {
      ask = Promise.resolve(null);
    }
    ask.then(
      (video) => this.landed(ticket, video),
      () => this.landed(ticket, null),
    );
  }

  private landed(ticket: number, video: RichVideo | null): void {
    if (ticket !== this.ticket) {
      video?.release();
      return;
    }
    if (video === null) this.placeholder();
    else this.play(video);
  }

  /** Shows the player when the URL is allowed for the platform, letting go of the handle it replaces. */
  private play(handle: RichVideo): void {
    if (!isAllowedVideoUrl(handle.url)) {
      handle.release();
      this.placeholder();
      return;
    }
    const shown = this.dom.firstElementChild;
    const previous = this.held;
    this.held = handle;
    // The same URL, as a new source over the same file gives: the player keeps playing.
    if (previous?.url === handle.url && shown instanceof HTMLVideoElement) {
      previous.release();
      return;
    }
    previous?.release();
    clearTimeout(this.timer);
    const video = document.createElement("video");
    video.controls = true;
    video.preload = handle.preload;
    video.draggable = false;
    video.addEventListener("loadeddata", () => this.ready(video));
    video.addEventListener("error", () => this.failed(video));
    this.dom.replaceChildren(video);
    this.label();
    video.src = handle.url;
    // Nothing loads before play with preload "none", so there is nothing to wait for.
    if (handle.preload === "none") {
      this.dom.removeAttribute("aria-busy");
    } else {
      this.dom.setAttribute("aria-busy", "true");
      this.timer = setTimeout(() => this.ready(video), VIDEO_BUSY_MS);
    }
  }

  /** The first frame is in, or the wait is over: the screen is no longer held. */
  private ready(video: HTMLVideoElement): void {
    if (this.dom.firstElementChild !== video) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dom.removeAttribute("aria-busy");
  }

  /** The system can't play it: the placeholder, and the URL let go. */
  private failed(video: HTMLVideoElement): void {
    if (this.dom.firstElementChild !== video) return;
    this.placeholder();
  }

  /** The player's accessible name and tooltip, from the ref's alt and title. */
  private label(): void {
    const video = this.dom.firstElementChild;
    if (!(video instanceof HTMLVideoElement)) return;
    video.setAttribute("aria-label", this.alt ? `Video: ${this.alt}` : "Video");
    const title = this.node.attrs.title as string | null;
    if (title) video.title = title;
    else video.removeAttribute("title");
  }

  private letGo(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const held = this.held;
    this.held = null;
    held?.release();
  }

  private placeholder(): void {
    this.letGo();
    this.dom.removeAttribute("aria-busy");
    const label = document.createElement("span");
    label.className = "rich-video-missing";
    label.textContent = this.src || this.alt;
    this.dom.replaceChildren(label);
  }
}

export const VideoNode = Node.create<VideoNodeOptions, VideoNodeStorage>({
  name: "video",
  inline: true,
  group: "inline",
  atom: true,
  draggable: false,
  selectable: true,

  addOptions() {
    return { source: () => null };
  },

  addStorage() {
    return { views: new Set<VideoView>() };
  },

  addAttributes() {
    return {
      // Every attribute lives in a data- attribute both ways, so no copy carries a real `src` or `title`.
      src: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-md-video") ?? "",
        renderHTML: (attrs) => ({ "data-md-video": attrs.src as string }),
      },
      alt: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-md-alt") ?? "",
        renderHTML: (attrs) => (attrs.alt ? { "data-md-alt": attrs.alt as string } : {}),
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-md-title"),
        renderHTML: (attrs) => (attrs.title ? { "data-md-title": attrs.title as string } : {}),
      },
    };
  },

  parseHTML() {
    // Only its own copy format, and only for a video name: anything else is the image's or nobody's.
    return [{ tag: "span[data-md-video]", getAttrs: (el) => (hasVideoExtension(el.getAttribute("data-md-video") ?? "") ? null : false) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Rebuilt from the three rendered attributes, so nothing else can ride along. Its text is
    // the ref, so a copy pasted into another app keeps it.
    const { "data-md-video": src, "data-md-alt": alt, "data-md-title": title } = HTMLAttributes as Record<string, string | undefined>;
    return ["span", { "data-md-video": src ?? "", ...(alt ? { "data-md-alt": alt } : {}), ...(title ? { "data-md-title": title } : {}) }, imageMarkdown(node.attrs)];
  },

  renderText({ node }) {
    return imageMarkdown(node.attrs);
  },

  // No parseMarkdown: Tiptap reaches only the first inline handler for an `image` token, so
  // RichImage's makes this node.
  renderMarkdown(node) {
    return imageMarkdown(node.attrs ?? {});
  },

  addNodeView() {
    const { source } = this.options;
    const { views } = this.storage;
    return ({ node }) => new VideoView(node as PMNode, source, views);
  },
});
