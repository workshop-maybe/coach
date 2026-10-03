// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WindowControls } from "./WindowControls";
import { WindowFrameContext, type WindowFrame } from "./windowFrame";

const win = vi.hoisted(() => ({ close: vi.fn(), minimize: vi.fn(), setFullscreen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderIn(frame: WindowFrame) {
  return render(
    <WindowFrameContext.Provider value={frame}>
      <WindowControls />
    </WindowFrameContext.Provider>,
  );
}

/** A promise the test settles by hand, standing in for a toggle still in flight. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("WindowControls", () => {
  it("closes and minimizes the window from its own keys", async () => {
    render(<WindowControls />);
    await userEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(win.close).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Minimize window" }));
    expect(win.minimize).toHaveBeenCalledOnce();
  });

  it("R2. with no frame provided, the keys read as a normal window", () => {
    render(<WindowControls />);
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Minimize window" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("R2. the full-screen key enters full screen from a normal or maximized window", async () => {
    renderIn("normal");
    await userEvent.click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(win.setFullscreen).toHaveBeenCalledExactlyOnceWith(true);
    cleanup();
    win.setFullscreen.mockClear();
    renderIn("maximized");
    await userEvent.click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(win.setFullscreen).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("R2. the full-screen key leaves full screen when the window is full screen", async () => {
    renderIn("fullscreen");
    expect(screen.queryByRole("button", { name: "Enter full screen" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(win.setFullscreen).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("R2. the key's label follows the frame as it changes", () => {
    const view = renderIn("normal");
    expect(screen.getByRole("button", { name: "Enter full screen" })).toBeTruthy();
    view.rerender(
      <WindowFrameContext.Provider value="fullscreen">
        <WindowControls />
      </WindowFrameContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enter full screen" })).toBeNull();
  });

  it("R2. a second press while the first toggle is in flight makes no second call", async () => {
    const pending = deferred();
    win.setFullscreen.mockReturnValueOnce(pending.promise);
    renderIn("normal");
    const key = screen.getByRole("button", { name: "Enter full screen" });
    await userEvent.click(key);
    await userEvent.click(key);
    expect(win.setFullscreen).toHaveBeenCalledOnce();
    await act(async () => pending.resolve());
    await userEvent.click(key);
    expect(win.setFullscreen).toHaveBeenCalledTimes(2);
  });

  it("R2. a toggle the window refuses frees the key for the next press", async () => {
    const pending = deferred();
    win.setFullscreen.mockReturnValueOnce(pending.promise);
    renderIn("normal");
    const key = screen.getByRole("button", { name: "Enter full screen" });
    await userEvent.click(key);
    await act(async () => pending.reject(new Error("not permitted")));
    await userEvent.click(key);
    expect(win.setFullscreen).toHaveBeenCalledTimes(2);
  });

  it("R2. minimize is unavailable in full screen and available otherwise", async () => {
    const view = renderIn("fullscreen");
    const minimize = screen.getByRole("button", { name: "Minimize window" }) as HTMLButtonElement;
    expect(minimize.disabled).toBe(true);
    await userEvent.click(minimize);
    expect(win.minimize).not.toHaveBeenCalled();
    for (const frame of ["normal", "maximized"] as const) {
      view.rerender(
        <WindowFrameContext.Provider value={frame}>
          <WindowControls />
        </WindowFrameContext.Provider>,
      );
      expect((screen.getByRole("button", { name: "Minimize window" }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("draws the full-screen key like the other keys, its icon turning with the frame", () => {
    const view = renderIn("normal");
    const icon = () => screen.getByRole("button", { name: /full screen/ }).querySelector(".window-key-icon")?.getAttribute("d");
    expect(screen.getByRole("button", { name: "Enter full screen" }).querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 28 24");
    const enter = icon();
    view.rerender(
      <WindowFrameContext.Provider value="fullscreen">
        <WindowControls />
      </WindowFrameContext.Provider>,
    );
    expect(icon()).toBeTruthy();
    expect(icon()).not.toBe(enter);
  });
});
