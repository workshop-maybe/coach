// The window's frame: normal, maximized or full screen (KTD1). One hook at the app root,
// above FolderGate so the corners never flash on the gate-to-shell swap, reads the native
// window on mount and after every resize or move. Move matters because on macOS dragging a
// maximized borderless window off its frame fires no resize. The hook writes the frame as
// `data-window` on the document element, where app-tokens.css squares the corners (R4), and
// shares it through a context the window keys and the bars read (R2). The context defaults
// to a normal window, so components render alone in tests with any frame supplied.
//
// On mount, a window larger than its monitor's work area is resized and moved to fit it.
// The window-state plugin restores sizes in physical pixels (KTD2), so this catches a size
// saved on a 2x display and restored on a 1x one, and a size saved while full screen.
//
// Without a Tauri bridge (tests, the browser recipe) the hook makes no window calls and the
// window reads as normal.

import { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

export type WindowFrame = "normal" | "maximized" | "fullscreen";

export const WindowFrameContext = createContext<WindowFrame>("normal");

/** The window's frame, as the root provider last read it. Normal outside one. */
export function useWindowFrame(): WindowFrame {
  return useContext(WindowFrameContext);
}

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * The size and position that fit a window inside an area, or null when it already fits.
 * Only the axes that overflow shrink; the window then slides in from whichever edge it
 * overhangs. All values in physical pixels.
 */
export function fitWithin(size: Size, position: Point, area: { position: Point; size: Size }): (Size & Point) | null {
  if (size.width <= area.size.width && size.height <= area.size.height) return null;
  const width = Math.min(size.width, area.size.width);
  const height = Math.min(size.height, area.size.height);
  return {
    width,
    height,
    x: clamp(position.x, area.position.x, area.position.x + area.size.width - width),
    y: clamp(position.y, area.position.y, area.position.y + area.size.height - height),
  };
}

/** Whether the page runs inside Tauri. False in tests and the browser recipe, which make no native calls. */
export const hasTauriBridge = () => "__TAURI_INTERNALS__" in window;

type NativeWindow = ReturnType<typeof getCurrentWindow>;

async function readFrame(win: NativeWindow): Promise<WindowFrame | null> {
  try {
    const [fullscreen, maximized] = await Promise.all([win.isFullscreen(), win.isMaximized()]);
    return fullscreen ? "fullscreen" : maximized ? "maximized" : "normal";
  } catch {
    // The window could not be read. The last known frame stands until the next event.
    return null;
  }
}

async function fitToWorkArea(win: NativeWindow): Promise<void> {
  const [monitor, size, position] = await Promise.all([currentMonitor(), win.outerSize(), win.outerPosition()]);
  if (!monitor) return;
  const fit = fitWithin(size, position, monitor.workArea);
  if (!fit) return;
  await win.setSize(new PhysicalSize(fit.width, fit.height));
  await win.setPosition(new PhysicalPosition(fit.x, fit.y));
}

/** Removes a listener. Tauri's removal is async and can fail once the window is gone. */
function release(unlisten: () => void) {
  try {
    void Promise.resolve(unlisten() as unknown).catch(() => undefined);
  } catch {
    // Already gone with the window.
  }
}

function useNativeWindowFrame(): WindowFrame {
  const [frame, setFrame] = useState<WindowFrame>("normal");

  useEffect(() => {
    if (!hasTauriBridge()) return;
    const win = getCurrentWindow();
    let live = true;
    let last: WindowFrame | null = null;
    // A resize drag fires many events. One read runs at a time, and events that arrive
    // during it ask for one more read, so the last read always follows the last event.
    let reading = false;
    let again = false;
    const unlisteners: Array<() => void> = [];

    async function refresh() {
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      do {
        again = false;
        const next = await readFrame(win);
        if (live && next) {
          last = next;
          setFrame(next);
        }
      } while (again && live);
      reading = false;
    }

    for (const listen of [win.onResized.bind(win), win.onMoved.bind(win)]) {
      listen(() => void refresh()).then(
        (unlisten) => {
          if (live) unlisteners.push(unlisten);
          else release(unlisten);
        },
        () => undefined,
      );
    }

    // A full-screen or maximized window is the size the OS gave it, so only a normal one is fitted.
    void refresh()
      .then(() => (live && last === "normal" ? fitToWorkArea(win) : undefined))
      .catch(() => undefined);

    return () => {
      live = false;
      unlisteners.forEach(release);
    };
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-window", frame);
    return () => root.removeAttribute("data-window");
  }, [frame]);

  return frame;
}

/** Reads the native window's frame and shares it with everything below. Mounted once, at the root. */
export function WindowFrameProvider({ children }: { children: ReactNode }) {
  const frame = useNativeWindowFrame();
  return <WindowFrameContext.Provider value={frame}>{children}</WindowFrameContext.Provider>;
}
