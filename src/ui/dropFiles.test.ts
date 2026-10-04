// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { storageWith, FOLDER } from "./testFolder";
import { FolderProvider, useFolder } from "./useFolderState";
import * as dropFiles from "./dropFiles";
import type { DropBox } from "./dropFiles";

/** The webview as the module sees it: its one drag-drop subscription and how it was released. */
const webview = vi.hoisted(() => {
  const state: { handler: ((event: { payload: unknown }) => void) | null } = { handler: null };
  const unlisten = vi.fn();
  const onDragDropEvent = vi.fn(async (handler: (event: { payload: unknown }) => void) => {
    state.handler = handler;
    return unlisten;
  });
  return { state, unlisten, onDragDropEvent, getCurrentWebview: vi.fn(() => ({ onDragDropEvent })) };
});
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: webview.getCurrentWebview }));

const bridge = window as unknown as Record<string, unknown>;
const pointAt = (el: Element | null) => {
  document.elementFromPoint = () => el;
};

/** A box made of a plain element in the page, whose drops are recorded. */
function makeBox() {
  const element = document.createElement("div");
  element.className = "rich";
  element.appendChild(document.createElement("p"));
  document.body.appendChild(element);
  return { element, drop: vi.fn<DropBox["drop"]>() };
}

const at = { x: 40, y: 60 };
const drop = (paths: string[], position = at) => ({ type: "drop" as const, paths, position });

let releases: Array<() => void> = [];
function register(box: DropBox) {
  const release = dropFiles.registerDropBox(box);
  releases.push(release);
  return release;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  releases.forEach((r) => r());
  releases = [];
  cleanup();
  document.body.innerHTML = "";
  pointAt(null);
  delete bridge.__TAURI_INTERNALS__;
  webview.state.handler = null;
  vi.clearAllMocks();
  // Ends any in-page drag a test began, a minute ago, so the next test starts well past the grace.
  vi.setSystemTime(Date.now() - 60_000);
  document.dispatchEvent(new Event("dragend"));
  vi.useRealTimers();
});

describe("the listener (KTD8)", () => {
  async function fresh() {
    vi.resetModules();
    return await import("./dropFiles");
  }

  it("installs nothing without the Tauri bridge, and nothing throws", async () => {
    const mod = await fresh();
    const box = makeBox();
    const release = mod.registerDropBox(box);
    const uninstall = mod.installDropNotice(vi.fn());
    expect(webview.getCurrentWebview).not.toHaveBeenCalled();
    expect(webview.onDragDropEvent).not.toHaveBeenCalled();
    // Fed events still reach the box, so a test or the browser recipe can drive it.
    mod.handleDragDrop(drop(["/a/clip.mov"]));
    expect(box.drop).toHaveBeenCalledWith(["/a/clip.mov"], at.x, at.y);
    release();
    uninstall();
  });

  it("subscribes once with the bridge, for any number of boxes and the notice sink", async () => {
    bridge.__TAURI_INTERNALS__ = {};
    const mod = await fresh();
    const a = makeBox();
    const releaseA = mod.registerDropBox(a);
    const releaseB = mod.registerDropBox(makeBox());
    const uninstall = mod.installDropNotice(vi.fn());
    expect(webview.onDragDropEvent).toHaveBeenCalledTimes(1);
    await act(async () => undefined);
    // The real subscription feeds the same handler the tests feed.
    pointAt(a.element.firstElementChild);
    webview.state.handler!({ payload: drop(["/a/clip.mov"]) });
    expect(a.drop).toHaveBeenCalledWith(["/a/clip.mov"], at.x, at.y);
    releaseA();
    releaseB();
    uninstall();
  });

  it("subscribes when only the notice sink is installed, so a drop with no box mounted still gets a notice", async () => {
    bridge.__TAURI_INTERNALS__ = {};
    const mod = await fresh();
    const notice = vi.fn();
    const uninstall = mod.installDropNotice(notice);
    expect(webview.onDragDropEvent).toHaveBeenCalledTimes(1);
    await act(async () => undefined);
    webview.state.handler!({ payload: drop(["/a/clip.mov"]) });
    expect(notice).toHaveBeenCalledWith(mod.DROP_ON_A_BOX);
    uninstall();
  });

  it("survives a bridge that cannot reach the webview", async () => {
    bridge.__TAURI_INTERNALS__ = {};
    webview.getCurrentWebview.mockImplementationOnce(() => {
      throw new TypeError("no metadata");
    });
    const mod = await fresh();
    const box = makeBox();
    expect(() => mod.registerDropBox(box)).not.toThrow();
    mod.handleDragDrop(drop(["/a/clip.mov"]));
    expect(box.drop).toHaveBeenCalledTimes(1);
  });
});

describe("where a drop lands (KTD8, R1)", () => {
  it("goes to the only box mounted, wherever it lands", () => {
    const box = makeBox();
    register(box);
    pointAt(document.body);
    dropFiles.handleDragDrop(drop(["/a/clip.mov", "/a/shot.png"]));
    expect(box.drop).toHaveBeenCalledTimes(1);
    expect(box.drop).toHaveBeenCalledWith(["/a/clip.mov", "/a/shot.png"], at.x, at.y);
  });

  it("goes to the box under the point when two are mounted, at the point as CSS pixels", () => {
    const a = makeBox();
    const b = makeBox();
    register(a);
    register(b);
    const seen: Array<[number, number]> = [];
    document.elementFromPoint = (x, y) => {
      seen.push([x, y]);
      return b.element.firstElementChild;
    };
    dropFiles.handleDragDrop(drop(["/a/clip.mov"], { x: 300, y: 500 }));
    expect(seen).toEqual([[300, 500]]);
    expect(a.drop).not.toHaveBeenCalled();
    expect(b.drop).toHaveBeenCalledWith(["/a/clip.mov"], 300, 500);
  });

  it("adds nothing and sends one notice when two are mounted and the point is over neither", () => {
    const notice = vi.fn();
    const uninstall = dropFiles.installDropNotice(notice);
    const a = makeBox();
    const b = makeBox();
    register(a);
    register(b);
    pointAt(document.body);
    dropFiles.handleDragDrop(drop(["/a/clip.mov"]));
    expect(a.drop).not.toHaveBeenCalled();
    expect(b.drop).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("Drop the file on a text box.");
    uninstall();
  });

  it("sends the same notice when no box is mounted", () => {
    const notice = vi.fn();
    const uninstall = dropFiles.installDropNotice(notice);
    dropFiles.handleDragDrop(drop(["/a/clip.mov"]));
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith(dropFiles.DROP_ON_A_BOX);
    uninstall();
  });

  it("resolves from the boxes mounted when the drop arrives, not when the drag began", () => {
    const a = makeBox();
    const releaseA = register(a);
    dropFiles.handleDragDrop({ type: "enter", paths: ["/a/clip.mov"], position: at });
    releaseA();
    const b = makeBox();
    register(b);
    dropFiles.handleDragDrop(drop(["/a/clip.mov"]));
    expect(a.drop).not.toHaveBeenCalled();
    expect(b.drop).toHaveBeenCalledTimes(1);
  });

  it("ignores enter, over and leave for adding", () => {
    const box = makeBox();
    register(box);
    dropFiles.handleDragDrop({ type: "enter", paths: ["/a/clip.mov"], position: at });
    dropFiles.handleDragDrop({ type: "over", position: at });
    dropFiles.handleDragDrop({ type: "leave" });
    expect(box.drop).not.toHaveBeenCalled();
  });
});

describe("a drop with no paths (KTD8)", () => {
  it("does nothing and shows nothing while an in-page drag runs", () => {
    const notice = vi.fn();
    const uninstall = dropFiles.installDropNotice(notice);
    const box = makeBox();
    register(box);
    document.dispatchEvent(new Event("dragstart"));
    dropFiles.handleDragDrop(drop([]));
    expect(box.drop).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
    uninstall();
  });

  it("does nothing when the in-page drag's end reaches the page before the window's drop does", () => {
    const notice = vi.fn();
    const uninstall = dropFiles.installDropNotice(notice);
    register(makeBox());
    document.dispatchEvent(new Event("dragstart"));
    document.dispatchEvent(new Event("dragend"));
    vi.setSystemTime(Date.now() + 100);
    dropFiles.handleDragDrop(drop([]));
    expect(notice).not.toHaveBeenCalled();
    uninstall();
  });

  it("over a box with no in-page drag, sends one notice to drag the file from Finder or use the Video key", () => {
    const notice = vi.fn();
    const uninstall = dropFiles.installDropNotice(notice);
    const box = makeBox();
    register(box);
    pointAt(box.element.firstElementChild);
    dropFiles.handleDragDrop(drop([]));
    expect(box.drop).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("Drag the file from Finder, or use the Video key.");
    uninstall();
  });

  it("counts no in-page drag for a dragstart a handler cancelled, as the box does on a video", () => {
    const notice = vi.fn();
    const uninstall = dropFiles.installDropNotice(notice);
    register(makeBox());
    const start = new Event("dragstart", { cancelable: true });
    start.preventDefault();
    document.dispatchEvent(start);
    dropFiles.handleDragDrop(drop([]));
    expect(notice).toHaveBeenCalledWith(dropFiles.DRAG_FROM_FINDER);
    uninstall();
  });

  it("takes the window's drop as the end of an in-page drag whose dragend never came", () => {
    const notice = vi.fn();
    const uninstall = dropFiles.installDropNotice(notice);
    register(makeBox());
    document.dispatchEvent(new Event("dragstart"));
    dropFiles.handleDragDrop(drop([]));
    expect(notice).not.toHaveBeenCalled();
    dropFiles.handleDragDrop(drop([]));
    expect(notice).toHaveBeenCalledWith(dropFiles.DRAG_FROM_FINDER);
    uninstall();
  });

  it("long after an in-page drag ended, is a file the page cannot read again", () => {
    const notice = vi.fn();
    const uninstall = dropFiles.installDropNotice(notice);
    register(makeBox());
    document.dispatchEvent(new Event("dragstart"));
    document.dispatchEvent(new Event("dragend"));
    vi.setSystemTime(Date.now() + 5_000);
    dropFiles.handleDragDrop(drop([]));
    expect(notice).toHaveBeenCalledWith(dropFiles.DRAG_FROM_FINDER);
    uninstall();
  });
});

describe("the drag-over outline (KTD8)", () => {
  const lit = (box: DropBox) => box.element.classList.contains(dropFiles.DROP_CLASS);

  it("lights the box a file is dragged over, and clears it on leave", () => {
    const a = makeBox();
    const b = makeBox();
    register(a);
    register(b);
    pointAt(a.element.firstElementChild);
    dropFiles.handleDragDrop({ type: "enter", paths: ["/a/clip.mov"], position: at });
    expect(lit(a)).toBe(true);
    expect(lit(b)).toBe(false);
    pointAt(b.element);
    dropFiles.handleDragDrop({ type: "over", position: { x: 41, y: 61 } });
    expect(lit(a)).toBe(false);
    expect(lit(b)).toBe(true);
    pointAt(document.body);
    dropFiles.handleDragDrop({ type: "over", position: { x: 42, y: 62 } });
    expect(lit(a) || lit(b)).toBe(false);
    pointAt(a.element);
    dropFiles.handleDragDrop({ type: "over", position: at });
    expect(lit(a)).toBe(true);
    dropFiles.handleDragDrop({ type: "leave" });
    expect(lit(a)).toBe(false);
  });

  it("clears it on drop", () => {
    const box = makeBox();
    register(box);
    dropFiles.handleDragDrop({ type: "enter", paths: ["/a/clip.mov"], position: at });
    expect(lit(box)).toBe(true);
    dropFiles.handleDragDrop(drop(["/a/clip.mov"]));
    expect(lit(box)).toBe(false);
  });

  it("never lights for a drag with no paths: an in-page drag or a file the page cannot read", () => {
    const box = makeBox();
    register(box);
    pointAt(box.element);
    dropFiles.handleDragDrop({ type: "enter", paths: [], position: at });
    dropFiles.handleDragDrop({ type: "over", position: at });
    expect(lit(box)).toBe(false);
  });

  it("clears it when the lit box unmounts mid-drag", () => {
    const box = makeBox();
    const release = register(box);
    dropFiles.handleDragDrop({ type: "enter", paths: ["/a/clip.mov"], position: at });
    expect(lit(box)).toBe(true);
    release();
    expect(lit(box)).toBe(false);
  });
});

describe("the notice sink", () => {
  it("drops notices quietly when none is installed, and an old sink's removal leaves the new one", () => {
    expect(() => dropFiles.handleDragDrop(drop(["/a/clip.mov"]))).not.toThrow();
    const first = vi.fn();
    const second = vi.fn();
    const uninstallFirst = dropFiles.installDropNotice(first);
    const uninstallSecond = dropFiles.installDropNotice(second);
    uninstallFirst();
    dropFiles.handleDragDrop(drop(["/a/clip.mov"]));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    uninstallSecond();
    dropFiles.handleDragDrop(drop(["/a/clip.mov"]));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("is the folder's notice while FolderProvider is mounted", async () => {
    function Probe() {
      return createElement("p", { "data-testid": "notice" }, useFolder().notice ?? "");
    }
    const { unmount } = render(createElement(FolderProvider, { storage: storageWith(), folder: FOLDER }, createElement(Probe)));
    await act(async () => {
      dropFiles.handleDragDrop(drop(["/a/clip.mov"]));
    });
    expect(screen.getByTestId("notice").textContent).toBe("Drop the file on a text box.");
    unmount();
    expect(() => dropFiles.handleDragDrop(drop(["/a/clip.mov"]))).not.toThrow();
  });
});
