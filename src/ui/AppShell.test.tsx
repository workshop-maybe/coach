// @vitest-environment jsdom
// Pane mode in the shell (U2, KTD3, KTD4): a view claims the window, the top bar keeps only
// the window keys and the brand (R8), and the claim is the view's own to release.
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MARKER_PATH, collectionPath, profilePath } from "../domain/folder";
import { MemoryStorage } from "../storage/memory";
import { useNav } from "./nav";
import { PaneContext, usePane, usePaneClaims } from "./pane";
import { FOLDER, renderApp, storageWith } from "./testFolder";

// Home stands in for any view that claims pane mode: the shell renders it on its home route.
const stand = vi.hoisted(() => ({ home: (): ReactNode => null }));
vi.mock("./Home", () => ({ Home: () => stand.home() }));

afterEach(cleanup);

function Claimer({ name, active = true }: { name: string; active?: boolean }) {
  usePane(active);
  return <p>{name} is open</p>;
}

/** Two views that claim pane mode, each mounted and unmounted by a button, and B switched on and off. */
function Probe() {
  const { navigate } = useNav();
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const [bActive, setBActive] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setA((v) => !v)}>
        Toggle A
      </button>
      <button type="button" onClick={() => setB((v) => !v)}>
        Toggle B
      </button>
      <button type="button" onClick={() => setBActive((v) => !v)}>
        Switch B
      </button>
      <button type="button" onClick={() => navigate({ view: "home" })}>
        Open again
      </button>
      {a && <Claimer name="A" />}
      {b && <Claimer name="B" active={bActive} />}
    </>
  );
}
stand.home = () => <Probe />;

const bar = () => screen.getByRole("banner");
const shell = () => document.querySelector(".shell");

/** The bar's actions after the folder, in order. */
const BAR_ACTIONS = ["Change folder", "Reload", "Export", "Jev Mode"];

/** The full bar shows the folder and its four actions; the slim bar shows neither. */
function expectFolderInBar(shown: boolean) {
  for (const name of BAR_ACTIONS) {
    expect(within(bar()).queryByRole("button", { name }) !== null, name).toBe(shown);
  }
  expect(within(bar()).queryByText(FOLDER) !== null, "folder path").toBe(shown);
  expect(shell()?.hasAttribute("data-pane"), "data-pane").toBe(!shown);
}

function expectWindowKeysAndBrand() {
  for (const name of ["Close window", "Minimize window", "Enter full screen", "Coach, go home"]) {
    expect(within(bar()).getByRole("button", { name })).toBeTruthy();
  }
}

async function openShell(storage = storageWith()) {
  const user = userEvent.setup();
  renderApp(storage);
  await screen.findByRole("button", { name: "Toggle A" });
  return { user, press: (name: string) => user.click(screen.getByRole("button", { name })) };
}

describe("pane mode in the shell", () => {
  it("shows the full bar while no view claims the window", async () => {
    await openShell();
    expectFolderInBar(true);
    expectWindowKeysAndBrand();
  });

  it("lists Change folder, Reload, Export and Jev Mode, in that order", async () => {
    await openShell();
    const actions = bar().querySelector(".topbar-actions") as HTMLElement;
    expect(within(actions).getAllByRole("button").map((b) => b.textContent)).toEqual(BAR_ACTIONS);
  });

  it("Jev Mode opens the Jev Mode deck", async () => {
    const { press } = await openShell();
    await press("Jev Mode");
    expect(await screen.findByRole("region", { name: "Jev Mode" })).toBeTruthy();
    expectFolderInBar(true);
  });

  it("a view that claims pane mode hides the folder path and its actions, and keeps the window keys and the brand", async () => {
    const { press } = await openShell();
    await press("Toggle A");
    expect(screen.getByText("A is open")).toBeTruthy();
    expectFolderInBar(false);
    expectWindowKeysAndBrand();
  });

  it("unmounting the claiming view brings the folder and its actions back", async () => {
    const { press } = await openShell();
    await press("Toggle A");
    expectFolderInBar(false);
    await press("Toggle A");
    expect(screen.queryByText("A is open")).toBeNull();
    expectFolderInBar(true);
    expectWindowKeysAndBrand();
  });

  it("two claims with one released keep pane mode on, until the second is released too", async () => {
    const { press } = await openShell();
    await press("Toggle A");
    await press("Toggle B");
    await press("Toggle A");
    expect(screen.getByText("B is open")).toBeTruthy();
    expectFolderInBar(false);
    await press("Toggle B");
    expectFolderInBar(true);
  });

  it("a claim that turns inactive releases only itself, and claims again when it turns active", async () => {
    const { press } = await openShell();
    await press("Toggle A");
    await press("Toggle B");
    await press("Switch B");
    expectFolderInBar(false);
    await press("Toggle A");
    expect(screen.getByText("B is open")).toBeTruthy();
    expectFolderInBar(true);
    await press("Switch B");
    expectFolderInBar(false);
  });

  it("a mounted view that never claims leaves the full bar", async () => {
    const { press } = await openShell();
    await press("Switch B");
    await press("Toggle B");
    expect(screen.getByText("B is open")).toBeTruthy();
    expectFolderInBar(true);
  });

  it("keeps the load-error and warning banners mounted through pane mode, so an alert is not announced again", async () => {
    const storage = new MemoryStorage({
      [MARKER_PATH]: '{ "format": 1 }\n',
      [profilePath("broken")]: '{ "name": "Broken", ',
      [collectionPath("eng")]: '{ "name": "Engineering", "badge": "loud" }\n',
    });
    const { press } = await openShell(storage);
    const alert = screen.getByRole("alert");
    const warning = screen.getByText("Some badge settings could not be read and are shown with defaults.").closest("section");
    expect(warning).toBeTruthy();
    await press("Toggle A");
    expectFolderInBar(false);
    expect(screen.getByRole("alert")).toBe(alert);
    expect(within(alert).getByText("agents/broken.json")).toBeTruthy();
    expect(warning?.isConnected).toBe(true);
    await press("Toggle A");
    expect(screen.getByRole("alert")).toBe(alert);
  });
});

describe("a view the shell opens", () => {
  // The sheet's scroller (App.css) keeps its offset across views, so without a reset a page
  // opened from a scrolled one arrives scrolled part way down (R6, R10).
  function pageScroller() {
    const scroller = document.querySelector(".sheet > .sheet-scroll") as HTMLElement;
    const scrolledTo = vi.fn();
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => 120, set: scrolledTo });
    return scrolledTo;
  }

  it("holds the banners and the view inside the sheet, and the bar on the board outside it", async () => {
    await openShell();
    const sheet = document.querySelector(".shell > .sheet") as HTMLElement;
    expect(sheet.querySelector(".sheet-scroll > main.content")).toBeTruthy();
    expect(sheet.contains(bar())).toBe(false);
  });

  it("keeps the sheet around a view that claims the window as a pane", async () => {
    const { press } = await openShell();
    await press("Toggle A");
    expect(document.querySelector(".shell[data-pane] > .sheet > .sheet-scroll > main.content")).toBeTruthy();
  });

  it("starts at the top of the sheet when the route changes", async () => {
    const { press } = await openShell();
    const scrolledTo = pageScroller();
    await press("Open again");
    expect(scrolledTo).toHaveBeenCalledWith(0);
  });

  it("leaves the sheet alone when nothing navigates", async () => {
    const { press } = await openShell();
    const scrolledTo = pageScroller();
    await press("Toggle A");
    expect(scrolledTo).not.toHaveBeenCalled();
  });
});

describe("the pane context", () => {
  /** The shell's half of the context, reduced to a word. */
  function Harness({ children }: { children?: ReactNode }) {
    const { pane, claims } = usePaneClaims();
    return (
      <PaneContext.Provider value={claims}>
        <output>{pane ? "pane" : "page"}</output>
        {children}
      </PaneContext.Provider>
    );
  }

  /** A careless view that calls its release twice. */
  function DoubleRelease() {
    const { claim } = useContext(PaneContext);
    useLayoutEffect(() => {
      const release = claim();
      return () => {
        release();
        release();
      };
    }, [claim]);
    return null;
  }

  it("a view using the pane hook renders outside the shell without throwing", () => {
    render(<Claimer name="Alone" />);
    expect(screen.getByText("Alone is open")).toBeTruthy();
    cleanup();
    render(<Claimer name="Idle" active={false} />);
    expect(screen.getByText("Idle is open")).toBeTruthy();
  });

  it("is in pane mode from the claiming view's first render", () => {
    render(
      <Harness>
        <Claimer name="A" />
      </Harness>,
    );
    expect(screen.getByRole("status").textContent).toBe("pane");
  });

  it("a release called twice releases only its own claim", () => {
    const { rerender } = render(
      <Harness>
        <Claimer name="A" />
        <DoubleRelease />
      </Harness>,
    );
    rerender(
      <Harness>
        <Claimer name="A" />
      </Harness>,
    );
    expect(screen.getByRole("status").textContent).toBe("pane");
    rerender(<Harness />);
    expect(screen.getByRole("status").textContent).toBe("page");
  });

  it("StrictMode's doubled effects leave one claim, and unmounting releases it", () => {
    const { rerender } = render(
      <StrictMode>
        <Harness>
          <Claimer name="A" />
        </Harness>
      </StrictMode>,
    );
    expect(screen.getByRole("status").textContent).toBe("pane");
    rerender(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(screen.getByRole("status").textContent).toBe("page");
  });
});
