// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WindowControls } from "./WindowControls";

const win = vi.hoisted(() => ({ close: vi.fn(), minimize: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));

afterEach(cleanup);

describe("WindowControls", () => {
  it("closes and minimizes the window from its own keys", async () => {
    render(<WindowControls />);
    await userEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(win.close).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Minimize window" }));
    expect(win.minimize).toHaveBeenCalledOnce();
  });
});
