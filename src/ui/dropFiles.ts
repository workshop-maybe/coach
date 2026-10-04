// Files dropped on the window (KTD8 of the video plan). Tauri reports a drag to the webview
// as a whole, never to the element under it, so one listener for the app takes every drag
// and drop event and hands a drop to the rich box it landed in. Each box that can add files
// registers its root element and a drop handler while it is mounted.
//
// The target is resolved when each event arrives, from the boxes mounted then: the box whose
// element holds the point, else the only box mounted, else none, which gets one notice. The
// point is used as CSS pixels. On macOS wry reports it in the view's points, whatever the
// name of Tauri's type says.
//
// A drop with no paths is either a drag inside the page (a picture or text moved in a box)
// or a file promise from an app such as Photos, which wry cannot read. The page's own
// dragstart and dragend tell them apart: an in-page drag is ignored, and a promise over a box
// gets one notice. The window's drop reaches the page through the event loop, possibly after
// the drag's dragend, so a drop just after a dragend still counts as in-page.
//
// The listener lives outside React, so FolderProvider installs its setNotice as the sink for
// notices while it is mounted. Without a Tauri bridge (tests, the browser recipe) nothing
// subscribes, and `handleDragDrop` takes events fed to it directly.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { hasTauriBridge } from "./windowFrame";

/** A point in the webview, as Tauri reports it. */
interface Point {
  x: number;
  y: number;
}

/** A drag and drop event, as `onDragDropEvent` delivers its payload. */
export type DragDropPayload =
  | { type: "enter"; paths: string[]; position: Point }
  | { type: "over"; position: Point }
  | { type: "drop"; paths: string[]; position: Point }
  | { type: "leave" };

/** A mounted box that takes dropped files. */
export interface DropBox {
  /**
   * The box's root. A drop whose point is inside it is the box's, and it carries DROP_CLASS
   * while a file dragged over the window would land in it. Its own class name must stay
   * fixed, so React never writes over the one added here.
   */
  element: Element;
  /** Takes a drop's paths, with its point in CSS pixels from the viewport's top left. */
  drop(paths: string[], x: number, y: number): void;
}

/** A file dropped where no box takes it. */
export const DROP_ON_A_BOX = "Drop the file on a text box.";
/** A drop the page got no path for, such as a clip dragged from Photos. */
export const DRAG_FROM_FINDER = "Drag the file from Finder, or use the Video key.";
/** The class on the box a file drag would land in: an outline in data blue, never a fill. */
export const DROP_CLASS = "rich-drop";

/** How long after an in-page drag ends an empty drop is still taken as that drag's. */
const DRAG_END_GRACE_MS = 500;

const boxes = new Set<DropBox>();
let sink: ((message: string) => void) | null = null;
let lit: DropBox | null = null;
// Whether the drag now over the window, if any, carries paths. Only `enter` says so.
let dragHasPaths = false;
let pageDragging = false;
let pageDragEnded = Number.NEGATIVE_INFINITY;
let watchingPage = false;
let subscription: { live: boolean; unlisten: (() => void) | null } | null = null;

/** Removes a listener. Tauri's removal is async and can fail once the window is gone. */
function release(unlisten: () => void) {
  try {
    void Promise.resolve(unlisten() as unknown).catch(() => undefined);
  } catch {
    // Already gone with the window.
  }
}

/** Starts watching the page's own drags and, inside Tauri, subscribes to the window's drags. */
function start() {
  if (!watchingPage && typeof document !== "undefined") {
    watchingPage = true;
    // Bubbling to the document, a dragstart has passed every handler that might cancel it,
    // as the box does for a video. A cancelled one starts no drag and ends with no dragend.
    document.addEventListener("dragstart", (e) => {
      if (!e.defaultPrevented) pageDragging = true;
    });
    document.addEventListener("dragend", () => {
      pageDragging = false;
      pageDragEnded = Date.now();
    });
  }
  if (subscription || !hasTauriBridge()) return;
  const sub: { live: boolean; unlisten: (() => void) | null } = { live: true, unlisten: null };
  subscription = sub;
  try {
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (sub.live) handleDragDrop(event.payload);
      })
      .then(
        (unlisten) => {
          if (sub.live) sub.unlisten = unlisten;
          else release(unlisten);
        },
        () => {
          if (subscription === sub) subscription = null;
        },
      );
  } catch {
    // A bridge that can't reach its webview. A later registration tries again.
    subscription = null;
  }
}

/** Unsubscribes once no box and no sink is left to hear a drop. */
function stopIfIdle() {
  if (boxes.size > 0 || sink || !subscription) return;
  subscription.live = false;
  if (subscription.unlisten) release(subscription.unlisten);
  subscription = null;
}

/** Registers a box for drops until the returned function is called. */
export function registerDropBox(box: DropBox): () => void {
  boxes.add(box);
  start();
  return () => {
    boxes.delete(box);
    if (lit === box) light(null);
    stopIfIdle();
  };
}

/** Sends the drop's notices to `next` until the returned function is called. */
export function installDropNotice(next: (message: string) => void): () => void {
  sink = next;
  start();
  return () => {
    if (sink === next) sink = null;
    stopIfIdle();
  };
}

/** The box a drop at this point lands in: the one under it, else the only one, else none. */
function targetAt({ x, y }: Point): DropBox | null {
  const under = document.elementFromPoint(x, y);
  if (under) {
    for (const box of boxes) if (box.element.contains(under)) return box;
  }
  if (boxes.size === 1) return boxes.values().next().value ?? null;
  return null;
}

function light(box: DropBox | null) {
  if (lit === box) return;
  lit?.element.classList.remove(DROP_CLASS);
  lit = box;
  box?.element.classList.add(DROP_CLASS);
}

/** Takes one drag and drop event of the window. The Tauri listener calls it; tests feed it. */
export function handleDragDrop(event: DragDropPayload): void {
  switch (event.type) {
    case "enter":
      dragHasPaths = event.paths.length > 0;
      light(dragHasPaths ? targetAt(event.position) : null);
      return;
    case "over":
      light(dragHasPaths ? targetAt(event.position) : null);
      return;
    case "leave":
      dragHasPaths = false;
      light(null);
      return;
    case "drop": {
      dragHasPaths = false;
      light(null);
      const { paths, position } = event;
      const box = targetAt(position);
      if (paths.length === 0) {
        if (pageDragging || Date.now() - pageDragEnded < DRAG_END_GRACE_MS) {
          // The window's drop ends the drag even if the page never sees its dragend.
          pageDragging = false;
          return;
        }
        if (box) sink?.(DRAG_FROM_FINDER);
        return;
      }
      if (box) box.drop(paths, position.x, position.y);
      else sink?.(DROP_ON_A_BOX);
    }
  }
}
