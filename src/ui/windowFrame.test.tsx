// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { FolderGate } from "./FolderGate";
import { FOLDER, storageWith } from "./testFolder";
import { FolderProvider } from "./useFolderState";
import { fitWithin, useWindowFrame, WindowFrameContext, WindowFrameProvider, type WindowFrame } from "./windowFrame";

type Handler = () => void;

/** The native window as the hook sees it: its state, its listeners and its calls. */
const native = vi.hoisted(() => {
  const state = { maximized: false, fullscreen: false };
  const handlers = { resized: new Set<() => void>(), moved: new Set<() => void>() };
  const listen = (set: Set<() => void>) => async (h: () => void) => {
    set.add(h);
    return () => {
      set.delete(h);
    };
  };
  const win = {
    isMaximized: vi.fn(async () => state.maximized),
    isFullscreen: vi.fn(async () => state.fullscreen),
    outerSize: vi.fn(async () => ({ width: 1100, height: 760 })),
    outerPosition: vi.fn(async () => ({ x: 200, y: 120 })),
    setSize: vi.fn(async (_size: unknown) => undefined),
    setPosition: vi.fn(async (_position: unknown) => undefined),
    onResized: vi.fn(listen(handlers.resized)),
    onMoved: vi.fn(listen(handlers.moved)),
    close: vi.fn(),
    minimize: vi.fn(),
    setFullscreen: vi.fn(),
  };
  const monitor = {
    name: "Display",
    scaleFactor: 1,
    position: { x: 0, y: 0 },
    size: { width: 1440, height: 900 },
    workArea: { position: { x: 0, y: 25 }, size: { width: 1440, height: 875 } },
  };
  return {
    state,
    handlers,
    win,
    getCurrentWindow: vi.fn(() => win),
    currentMonitor: vi.fn(async (): Promise<typeof monitor | null> => monitor),
  };
});
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: native.getCurrentWindow, currentMonitor: native.currentMonitor }));

const bridge = window as unknown as Record<string, unknown>;

beforeEach(() => {
  bridge.__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  cleanup();
  delete bridge.__TAURI_INTERNALS__;
  native.state.maximized = false;
  native.state.fullscreen = false;
  native.handlers.resized.clear();
  native.handlers.moved.clear();
  vi.resetAllMocks();
});

function Probe() {
  return <p data-testid="frame">{useWindowFrame()}</p>;
}

function mountFrame() {
  return render(
    <WindowFrameProvider>
      <Probe />
    </WindowFrameProvider>,
  );
}

const attr = () => document.documentElement.getAttribute("data-window");

/** Fires a native window event and lets the reads it starts settle. */
async function fire(event: "resized" | "moved") {
  await act(async () => {
    for (const h of [...native.handlers[event]]) (h as Handler)();
  });
}

/** Waits for the mount to finish: listeners attached and the first read applied. */
async function mounted() {
  await waitFor(() => {
    expect(native.handlers.resized.size).toBe(1);
    expect(native.handlers.moved.size).toBe(1);
  });
  await act(async () => {});
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("the window frame hook", () => {
  it("R4. reads the window's state on mount and writes it on the document element", async () => {
    native.state.maximized = true;
    mountFrame();
    await waitFor(() => expect(attr()).toBe("maximized"));
    expect(screen.getByTestId("frame").textContent).toBe("maximized");
  });

  it("R4. after a resize event, the attribute follows each state the window reports", async () => {
    mountFrame();
    await mounted();
    expect(attr()).toBe("normal");

    native.state.fullscreen = true;
    await fire("resized");
    expect(attr()).toBe("fullscreen");
    expect(screen.getByTestId("frame").textContent).toBe("fullscreen");

    native.state.fullscreen = false;
    native.state.maximized = true;
    await fire("resized");
    expect(attr()).toBe("maximized");

    native.state.maximized = false;
    await fire("resized");
    expect(attr()).toBe("normal");
  });

  it("R4. full screen wins when the window reports both full screen and maximized", async () => {
    native.state.maximized = true;
    native.state.fullscreen = true;
    mountFrame();
    await waitFor(() => expect(attr()).toBe("fullscreen"));
  });

  it("R4. a move that ends the maximized state resets the attribute (dragging off the frame on macOS)", async () => {
    native.state.maximized = true;
    mountFrame();
    await waitFor(() => expect(attr()).toBe("maximized"));
    native.state.maximized = false;
    await fire("moved");
    expect(attr()).toBe("normal");
  });

  it("a read that lands late never leaves a stale state behind", async () => {
    mountFrame();
    await mounted();
    const late = deferred<boolean>();
    native.win.isFullscreen.mockReturnValueOnce(late.promise);
    await fire("resized");
    native.state.maximized = true;
    await fire("resized");
    await act(async () => late.resolve(false));
    await waitFor(() => expect(attr()).toBe("maximized"));
  });

  it("with no Tauri bridge, makes no window calls and the attribute stays normal", async () => {
    delete bridge.__TAURI_INTERNALS__;
    mountFrame();
    await act(async () => {});
    expect(attr()).toBe("normal");
    expect(screen.getByTestId("frame").textContent).toBe("normal");
    expect(native.getCurrentWindow).not.toHaveBeenCalled();
    expect(native.currentMonitor).not.toHaveBeenCalled();
    for (const call of Object.values(native.win)) expect(call).not.toHaveBeenCalled();
  });

  it("when the window cannot be read, the frame stays normal and the next event reads again", async () => {
    native.win.isMaximized.mockRejectedValueOnce(new Error("no window"));
    mountFrame();
    await mounted();
    expect(attr()).toBe("normal");
    expect(native.win.setSize).not.toHaveBeenCalled();
    native.state.maximized = true;
    await fire("resized");
    expect(attr()).toBe("maximized");
  });

  it("stops listening and clears the attribute on unmount", async () => {
    const view = mountFrame();
    await mounted();
    view.unmount();
    expect(native.handlers.resized.size).toBe(0);
    expect(native.handlers.moved.size).toBe(0);
    expect(attr()).toBeNull();
  });

  it("a listener that attaches after unmount is removed at once", async () => {
    const attach = deferred<() => void>();
    const unlisten = vi.fn();
    native.win.onResized.mockReturnValueOnce(attach.promise);
    const view = mountFrame();
    view.unmount();
    await act(async () => attach.resolve(unlisten));
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

describe("fitting the window to its monitor on mount", () => {
  it("KTD1. a window larger than the work area is resized and moved to fit it", async () => {
    native.win.outerSize.mockResolvedValue({ width: 2200, height: 1520 });
    native.win.outerPosition.mockResolvedValue({ x: 100, y: 60 });
    mountFrame();
    await waitFor(() => expect(native.win.setPosition).toHaveBeenCalled());
    expect(native.win.setSize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ width: 1440, height: 875 }));
    expect(native.win.setPosition).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ x: 0, y: 25 }));
  });

  it("KTD1. a window that fits its work area is left alone", async () => {
    mountFrame();
    await mounted();
    await waitFor(() => expect(native.win.outerSize).toHaveBeenCalled());
    await act(async () => {});
    expect(native.win.setSize).not.toHaveBeenCalled();
    expect(native.win.setPosition).not.toHaveBeenCalled();
  });

  it("KTD1. a full-screen window is not resized, though it is larger than the work area", async () => {
    native.state.fullscreen = true;
    native.win.outerSize.mockResolvedValue({ width: 1440, height: 900 });
    mountFrame();
    await mounted();
    expect(attr()).toBe("fullscreen");
    expect(native.win.setSize).not.toHaveBeenCalled();
  });

  it("KTD1. with no monitor found, or a monitor that cannot be read, the window is left alone", async () => {
    native.win.outerSize.mockResolvedValue({ width: 2200, height: 1520 });
    native.currentMonitor.mockResolvedValueOnce(null);
    mountFrame();
    await mounted();
    expect(native.win.setSize).not.toHaveBeenCalled();
    cleanup();
    native.currentMonitor.mockRejectedValueOnce(new Error("no monitor"));
    mountFrame();
    await mounted();
    expect(native.win.setSize).not.toHaveBeenCalled();
    expect(attr()).toBe("normal");
  });

  it("fitWithin shrinks only the axis that overflows and slides the window inside the area", () => {
    const area = { position: { x: 0, y: 25 }, size: { width: 1440, height: 875 } };
    expect(fitWithin({ width: 1100, height: 760 }, { x: 500, y: 200 }, area)).toBeNull();
    expect(fitWithin({ width: 1440, height: 875 }, { x: 0, y: 25 }, area)).toBeNull();
    expect(fitWithin({ width: 1200, height: 1000 }, { x: 500, y: 200 }, area)).toEqual({ width: 1200, height: 875, x: 240, y: 25 });
    expect(fitWithin({ width: 3000, height: 2000 }, { x: -50, y: -50 }, area)).toEqual({ width: 1440, height: 875, x: 0, y: 25 });
  });

  it("fitWithin works on a monitor away from the origin, sliding in the axis that fits but overhangs", () => {
    const area = { position: { x: 1440, y: -200 }, size: { width: 1920, height: 1080 } };
    expect(fitWithin({ width: 2400, height: 900 }, { x: 1500, y: 0 }, area)).toEqual({ width: 1920, height: 900, x: 1440, y: -20 });
  });
});

describe("the frame in the bars", () => {
  async function shellIn(frame: WindowFrame) {
    const view = render(
      <WindowFrameContext.Provider value={frame}>
        <FolderProvider storage={storageWith({})} folder={FOLDER}>
          <AppShell onChangeFolder={() => {}} />
        </FolderProvider>
      </WindowFrameContext.Provider>,
    );
    await screen.findByRole("button", { name: "Try a first test" });
    return view;
  }

  function gateIn(frame: WindowFrame) {
    return render(
      <WindowFrameContext.Provider value={frame}>
        <FolderGate getFolder={async () => null} pickFolder={async () => null}>
          {() => null}
        </FolderGate>
      </WindowFrameContext.Provider>,
    );
  }

  it("R2. the top bar is the drag region in a normal or maximized window", async () => {
    for (const frame of ["normal", "maximized"] as const) {
      const { container } = await shellIn(frame);
      expect(container.querySelector(".topbar")?.hasAttribute("data-tauri-drag-region")).toBe(true);
      expect(container.querySelector(".folder-path")?.hasAttribute("data-tauri-drag-region")).toBe(true);
      cleanup();
    }
  });

  it("R2. in full screen the top bar drops its drag region, so a double-click cannot maximize", async () => {
    const { container } = await shellIn("fullscreen");
    expect(container.querySelector(".topbar")?.hasAttribute("data-tauri-drag-region")).toBe(false);
    expect(container.querySelector(".folder-path")?.hasAttribute("data-tauri-drag-region")).toBe(false);
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeTruthy();
  });

  it("R2. the first-run gate bar drops its drag region in full screen and keeps it otherwise", async () => {
    const normal = gateIn("normal");
    await screen.findByRole("button", { name: "Choose folder" });
    expect(normal.container.querySelector(".gate-bar")?.hasAttribute("data-tauri-drag-region")).toBe(true);
    cleanup();
    const full = gateIn("fullscreen");
    await screen.findByRole("button", { name: "Choose folder" });
    expect(full.container.querySelector(".gate-bar")?.hasAttribute("data-tauri-drag-region")).toBe(false);
  });

  it("R2, R4. entering full screen reaches the keys and the bar through the root provider", async () => {
    const { container } = render(
      <WindowFrameProvider>
        <FolderGate getFolder={async () => null} pickFolder={async () => null}>
          {() => null}
        </FolderGate>
      </WindowFrameProvider>,
    );
    await screen.findByRole("button", { name: "Choose folder" });
    await mounted();
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeTruthy();

    native.state.fullscreen = true;
    await fire("resized");
    expect(attr()).toBe("fullscreen");
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Minimize window" }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector(".gate-bar")?.hasAttribute("data-tauri-drag-region")).toBe(false);
  });
});
