// @vitest-environment jsdom
// The replay (U6): the intro again from Home, watch-only, an overlay over Home that closes back
// to it. The film's player draws every frame against a clock, so a stand-in records what the replay asks
// of it and lets each test fire its events.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../storage/memory";
import { MARKER_PATH } from "../domain/folder";
import { renderApp, review, storageWith, snapshot } from "../ui/testFolder";
import { HELD_LINE_KEY } from "./heldLine";
import { MUTE_STORAGE_KEY } from "./mute";
import { SCENES } from "./timeline";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onResized: async () => () => {}, isFullscreen: async () => false, isMaximized: async () => false }) }));

const player = vi.hoisted(() => {
  type Props = {
    reducedMotion: boolean;
    muted: boolean;
    still: number;
    onReady(api: { play(): void; setMuted(m: boolean): void }): void;
    onEnded(): void;
    onFrame(frame: number): void;
  };
  const state = {
    props: null as null | Props,
    fail: false,
    play: vi.fn(),
    mute: vi.fn(),
    unmute: vi.fn(),
    /** What the film reports: "frameupdate" with a frame, or "ended". */
    emit(name: "frameupdate" | "ended", detail?: { frame: number }) {
      if (name === "ended") state.props?.onEnded();
      else state.props?.onFrame(detail!.frame);
    },
  };
  return state;
});

vi.mock("./FilmPlayer", async () => {
  const { useEffect } = await import("react");
  function FilmPlayer(props: NonNullable<typeof player.props>) {
    if (player.fail) throw new Error("the webview cannot draw the film");
    player.props = props;
    useEffect(() => {
      props.onReady({ play: () => player.play(), setMuted: (m) => (m ? player.mute() : player.unmute()) });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="player" />;
  }
  return { default: FilmPlayer };
});

// The composition itself is tested in Intro.test.tsx; here it only has to be importable.
vi.mock("./Intro", () => ({ Intro: () => null, INTRO_WIDTH: 1920, INTRO_HEIGHT: 1080 }));


function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  localStorage.clear();
  player.props = null;
  player.fail = false;
  for (const fn of [player.play, player.mute, player.unmute]) fn.mockReset();
  stubReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const replayKey = () => screen.findByRole("button", { name: "Watch the intro" });

/** Home over a folder with one badge, the replay key pressed: the title card is up. */
async function replayOpen(storage = storageWith({ credentials: [review] })) {
  renderApp(storage);
  fireEvent.click(await replayKey());
  const begin = (await screen.findByRole("button", { name: "Begin" })) as HTMLButtonElement;
  await waitFor(() => expect(begin.disabled).toBe(false));
  return { begin, storage };
}

describe("the replay key on Home", () => {
  it("shows with an empty folder", async () => {
    renderApp(new MemoryStorage({ [MARKER_PATH]: '{ "format": 1 }\n' }));
    const key = await replayKey();
    expect(key.classList.contains("ghost")).toBe(true);
  });

  it("shows with a full folder", async () => {
    renderApp(storageWith({ credentials: [review] }));
    expect(await replayKey()).toBeTruthy();
    expect((await screen.findAllByText("Code review")).length).toBeGreaterThan(0);
  });
});

describe("the replay", () => {
  it("opens on the title card with the film paused behind it, and Begin plays in the same tick", async () => {
    const { begin } = await replayOpen();
    expect(player.play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(document.querySelector(".replay")).toBeTruthy();
    // The window keys stay reachable.
    expect(document.querySelector(".replay .window-key-close")).toBeTruthy();
    // fireEvent returns after the click handler ran, so play was called inside the key's own event.
    fireEvent.click(begin);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Mute" })).toBeTruthy();
  });

  it("runs to the end and closes to Home with the badges unchanged and no play beat (AE6)", async () => {
    const { begin, storage } = await replayOpen();
    const before = await snapshot(storage);
    fireEvent.click(begin);
    act(() => player.emit("ended"));
    await waitFor(() => expect(document.querySelector(".replay")).toBeNull());
    expect(screen.queryByRole("textbox", { name: "What good looks like" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make it a badge" })).toBeNull();
    expect(screen.getByRole("button", { name: "Watch the intro" })).toBeTruthy();
    expect(screen.getAllByText("Code review").length).toBeGreaterThan(0);
    expect(await snapshot(storage)).toEqual(before);
    expect(localStorage.getItem(HELD_LINE_KEY)).toBeNull();
  });

  it("closes to Home on Escape, from the title card and from the film", async () => {
    const { begin } = await replayOpen();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".replay")).toBeNull());
    expect(player.play).not.toHaveBeenCalled();

    fireEvent.click(await replayKey());
    const again = (await screen.findByRole("button", { name: "Begin" })) as HTMLButtonElement;
    await waitFor(() => expect(again.disabled).toBe(false));
    fireEvent.click(again);
    await screen.findByRole("button", { name: "Mute" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".replay")).toBeNull());
    expect(begin).toBeTruthy();
  });

  it("closes to Home on Skip during the film", async () => {
    const { begin } = await replayOpen();
    fireEvent.click(begin);
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    await waitFor(() => expect(document.querySelector(".replay")).toBeNull());
  });

  it("starts muted when mute was stored, and Mute persists a change (AE5)", async () => {
    localStorage.setItem(MUTE_STORAGE_KEY, "true");
    const { begin } = await replayOpen();
    expect(player.props).toMatchObject({ muted: true });
    fireEvent.click(begin);
    fireEvent.click(await screen.findByRole("button", { name: "Unmute" }));
    expect(player.unmute).toHaveBeenCalled();
    expect(localStorage.getItem(MUTE_STORAGE_KEY)).toBe("false");
  });

  it("under reduced motion shows silent stills with Next, no Mute, and closes past the last", async () => {
    stubReducedMotion(true);
    const { begin } = await replayOpen();
    expect(screen.queryByRole("button", { name: /Mute/ })).toBeNull();
    fireEvent.click(begin);
    expect(player.play).not.toHaveBeenCalled();
    const next = await screen.findByRole("button", { name: "Next" });
    for (let i = 0; i < SCENES.length - 1; i++) fireEvent.click(next);
    expect(document.querySelector(".replay")).toBeTruthy();
    fireEvent.click(next);
    await waitFor(() => expect(document.querySelector(".replay")).toBeNull());
  });

  it("leaves Home inert underneath while it plays", async () => {
    await replayOpen();
    expect(document.querySelector(".shell")?.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".shell")?.hasAttribute("inert")).toBe(false));
  });
});
