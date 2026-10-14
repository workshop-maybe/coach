// @vitest-environment jsdom
// The first run (U4): title card, film, play beat, then the folder gate. Remotion's Player
// does not run under jsdom, so a stand-in records what the first run asks of it and lets
// each test fire its events.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref } from "react";
import { FolderGate } from "../ui/FolderGate";
import { HELD_LINE_KEY, readHeldLine } from "./heldLine";
import { MUTE_STORAGE_KEY } from "./mute";
import { SCENES, STILLS, TOTAL_FRAMES } from "./timeline";

const player = vi.hoisted(() => {
  type Listener = (e: { detail: unknown }) => void;
  const listeners = new Map<string, Set<Listener>>();
  return {
    props: null as null | Record<string, unknown>,
    frame: 0,
    play: vi.fn(),
    seekTo: vi.fn(),
    mute: vi.fn(),
    unmute: vi.fn(),
    listeners,
    emit(name: string, detail?: unknown) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn({ detail });
    },
  };
});

vi.mock("@remotion/player", async () => {
  const { useImperativeHandle } = await import("react");
  function Player(props: Record<string, unknown> & { ref?: Ref<unknown>; initialFrame?: number }) {
    player.props = props;
    useImperativeHandle(props.ref, () => ({
      play: player.play,
      seekTo: (f: number) => {
        player.frame = f;
        player.seekTo(f);
      },
      getCurrentFrame: () => player.frame,
      mute: player.mute,
      unmute: player.unmute,
      addEventListener: (name: string, fn: (e: { detail: unknown }) => void) => {
        if (!player.listeners.has(name)) player.listeners.set(name, new Set());
        player.listeners.get(name)!.add(fn);
      },
      removeEventListener: (name: string, fn: (e: { detail: unknown }) => void) => player.listeners.get(name)?.delete(fn),
    }));
    return <div data-testid="player" />;
  }
  return { Player };
});

// The composition itself is tested in Intro.test.tsx; here it only has to be importable.
vi.mock("./Intro", () => ({ Intro: () => null, INTRO_WIDTH: 1920, INTRO_HEIGHT: 1080 }));

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  localStorage.clear();
  player.props = null;
  player.frame = 0;
  player.listeners.clear();
  player.play.mockReset();
  player.seekTo.mockReset();
  player.mute.mockReset();
  player.unmute.mockReset();
  stubReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function firstRun(pickFolder: () => Promise<string | null> = async () => null) {
  return render(
    <FolderGate getFolder={async () => ({ status: "none" })} pickFolder={pickFolder}>
      {(folder) => <p>shell for {folder}</p>}
    </FolderGate>,
  );
}

/** The title card, with the film loaded behind it. */
async function titleCard(pickFolder?: () => Promise<string | null>) {
  const view = firstRun(pickFolder);
  const begin = (await screen.findByRole("button", { name: "Begin" })) as HTMLButtonElement;
  await waitFor(() => expect(begin.disabled).toBe(false));
  return { view, begin };
}

/** Begin pressed: the film is playing. */
async function playing(pickFolder?: () => Promise<string | null>) {
  const { view, begin } = await titleCard(pickFolder);
  fireEvent.click(begin);
  await screen.findByRole("button", { name: "Skip" });
  return view;
}

/** The film ended: the play beat is on the sheet. */
async function playBeat(pickFolder?: () => Promise<string | null>) {
  const view = await playing(pickFolder);
  act(() => player.emit("ended"));
  await screen.findByRole("button", { name: "Make it a badge" });
  return view;
}

const field = () => screen.getByRole("textbox", { name: "What good looks like" }) as HTMLInputElement;
const makeIt = () => screen.getByRole("button", { name: "Make it a badge" }) as HTMLButtonElement;

describe("the title card", () => {
  it("shows Begin, disabled until the film is ready, then focused, with Skip beside it", async () => {
    firstRun();
    const begin = (await screen.findByRole("button", { name: "Begin" })) as HTMLButtonElement;
    expect(begin.disabled).toBe(true);
    await waitFor(() => expect(begin.disabled).toBe(false));
    expect(document.activeElement).toBe(begin);
    expect(begin.classList.contains("primary")).toBe(true);
    expect(screen.getByRole("button", { name: "Skip" }).classList.contains("ghost")).toBe(true);
    expect(document.querySelectorAll("button.primary")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Choose folder" })).toBeNull();
  });

  it("mounts the film paused at its first frame, with the Player's settings fixed", async () => {
    await titleCard();
    expect(player.play).not.toHaveBeenCalled();
    expect(player.props).toMatchObject({
      durationInFrames: TOTAL_FRAMES,
      initialFrame: 0,
      controls: false,
      clickToPlay: false,
      spaceKeyToPlayOrPause: false,
      moveToBeginningWhenEnded: false,
      initiallyMuted: false,
    });
  });

  it("Begin calls the Player's play once, in the same tick as the key event", async () => {
    const { begin } = await titleCard();
    fireEvent.click(begin);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.play.mock.calls[0][0]).toHaveProperty("type", "click");
    expect(screen.queryByRole("button", { name: "Begin" })).toBeNull();
  });

  it("tabs from Begin to Skip to Mute", async () => {
    await titleCard();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Skip" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mute" }));
  });

  it("clears a held line left by a run quit before a folder was chosen; skip then a folder seeds nothing", async () => {
    localStorage.setItem(HELD_LINE_KEY, JSON.stringify({ line: "Old line", name: "Old line" }));
    await titleCard(async () => "/data");
    expect(readHeldLine()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText(/Pick a folder for your credentials/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(await screen.findByText("shell for /data")).toBeTruthy();
    expect(readHeldLine()).toBeNull();
  });

  it("Escape on the title card skips to the gate", async () => {
    await titleCard();
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(player.play).not.toHaveBeenCalled();
  });
});

describe("the film", () => {
  it("keeps the gate bar's window keys above it, and Skip and Mute in the strip", async () => {
    const { container } = await playing();
    expect(container.querySelector(".shell > .gate-bar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close window" })).toBeTruthy();
    const strip = container.querySelector(".intro-strip") as HTMLElement;
    expect([...strip.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Skip", "Mute"]);
    expect(container.querySelectorAll("button.primary")).toHaveLength(0);
  });

  it("reads each scene's line in a live region as the scene arrives", async () => {
    const { container } = await playing();
    const live = container.querySelector("[aria-live]") as HTMLElement;
    expect(live.textContent).toBe(SCENES[0].rows.join(" "));
    act(() => player.emit("frameupdate", { frame: SCENES[2].start + 5 }));
    expect(live.textContent).toBe(SCENES[2].rows.join(" "));
  });

  it("Enter and the right arrow do not step a playing film", async () => {
    const { container } = await playing();
    await userEvent.keyboard("{Enter}{ArrowRight}");
    expect(container.querySelector("[aria-live]")?.textContent).toBe(SCENES[0].rows.join(" "));
    expect(player.seekTo).not.toHaveBeenCalled();
  });

  it("AE2. Escape on the third scene goes to the gate with no line held", async () => {
    await playing();
    act(() => player.emit("frameupdate", { frame: SCENES[2].start + 30 }));
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(screen.getByText(/Pick a folder for your credentials/)).toBeTruthy();
    expect(readHeldLine()).toBeNull();
    expect(screen.queryByTestId("player")).toBeNull();
  });

  it("the Skip key does the same as Escape", async () => {
    await playing();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(readHeldLine()).toBeNull();
  });

  it("AE5. Mute is labelled for its state, mutes the film, and is remembered; M does the same", async () => {
    await playing();
    await userEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(player.mute).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MUTE_STORAGE_KEY)).toBe("true");
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
    await userEvent.keyboard("m");
    expect(player.unmute).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MUTE_STORAGE_KEY)).toBe("false");
    expect(screen.getByRole("button", { name: "Mute" })).toBeTruthy();
  });

  it("AE5. a stored mute starts the film muted", async () => {
    localStorage.setItem(MUTE_STORAGE_KEY, "true");
    await titleCard();
    expect(player.props?.initiallyMuted).toBe(true);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
  });

  it("on the Player's ended event the play beat mounts over the held last frame, not rewound", async () => {
    await playing();
    act(() => player.emit("frameupdate", { frame: TOTAL_FRAMES - 1 }));
    act(() => player.emit("ended"));
    expect(await screen.findByRole("heading", { name: "What would a good result look like" })).toBeTruthy();
    expect(screen.getByTestId("player")).toBeTruthy();
    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.props?.moveToBeginningWhenEnded).toBe(false);
    expect(document.activeElement).toBe(field());
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
  });
});

describe("the play beat", () => {
  it("keeps Make it a badge disabled for an empty or whitespace-only line", async () => {
    await playBeat();
    expect(makeIt().disabled).toBe(true);
    await userEvent.type(field(), "   ");
    expect(makeIt().disabled).toBe(true);
    await userEvent.type(field(), "x");
    expect(makeIt().disabled).toBe(false);
  });

  it("confirming holds the line with its derived name, then shows the gate saying the badge is saved there", async () => {
    await playBeat();
    await userEvent.type(field(), "It finds the bug and names the line that causes it");
    await userEvent.click(makeIt());
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(readHeldLine()).toEqual({
      line: "It finds the bug and names the line that causes it",
      name: "It finds the bug and names",
    });
    expect(screen.getByText(/Pick a folder for your badge/)).toBeTruthy();
  });

  it("Enter in the line confirms it, as the forward key would", async () => {
    await playBeat();
    await userEvent.type(field(), "Cites its sources{Enter}");
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(readHeldLine()).toEqual({ line: "Cites its sources", name: "Cites its sources" });
  });

  it("holds the line trimmed", async () => {
    await playBeat();
    await userEvent.type(field(), "  Cites its sources  ");
    await userEvent.click(makeIt());
    expect(readHeldLine()).toEqual({ line: "Cites its sources", name: "Cites its sources" });
  });

  it("flattens a pasted multi-line line to one line and caps it at 200 characters", async () => {
    await playBeat();
    field().focus();
    await userEvent.paste(`First part\nsecond part\r\n\t${"x".repeat(300)}`);
    expect(field().value).not.toMatch(/\n/);
    await userEvent.click(makeIt());
    const held = readHeldLine()!;
    expect(held.line.startsWith("First part second part x")).toBe(true);
    expect(held.line).toHaveLength(200);
    expect(held.name).toBe(`First part second part ${"x".repeat(177)}`);
  });

  it("AE3. closing the card after typing goes to the gate with nothing held", async () => {
    await playBeat();
    await userEvent.type(field(), "A line I changed my mind about");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(readHeldLine()).toBeNull();
    expect(screen.getByText(/Pick a folder for your credentials/)).toBeTruthy();
  });

  it("AE3. Escape, owned by the deck, closes the card the same way", async () => {
    await playBeat();
    await userEvent.type(field(), "Another line");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(readHeldLine()).toBeNull();
  });

  it("cancelling the folder pick keeps the gate and the held line", async () => {
    const pick = vi.fn(async () => null);
    await playBeat(pick);
    await userEvent.type(field(), "Names the failing test");
    await userEvent.click(makeIt());
    await userEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(readHeldLine()).toEqual({ line: "Names the failing test", name: "Names the failing test" });
  });

  it("choosing a folder after confirming opens the app and leaves the line held for the badge to be saved", async () => {
    await playBeat(async () => "/data");
    await userEvent.type(field(), "Names the failing test");
    await userEvent.click(makeIt());
    await userEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    expect(await screen.findByText("shell for /data")).toBeTruthy();
    expect(readHeldLine()?.line).toBe("Names the failing test");
  });

  it("storage that throws on write still lets the newcomer reach the gate", async () => {
    await playBeat();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await userEvent.type(field(), "Names the failing test");
    await userEvent.click(makeIt());
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    // Nothing could be held, so the gate does not promise a badge.
    expect(screen.getByText(/Pick a folder for your credentials/)).toBeTruthy();
  });
});

describe("under reduced motion", () => {
  beforeEach(() => stubReducedMotion(true));

  it("AE4. shows the first scene's still, steps on Enter, never plays, and shows no Mute key", async () => {
    const { begin } = await titleCard();
    expect(player.props?.initialFrame).toBe(STILLS[0]);
    expect(player.props?.initiallyMuted).toBe(true);
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    fireEvent.click(begin);
    await screen.findByRole("button", { name: "Skip" });
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(player.seekTo).toHaveBeenLastCalledWith(STILLS[1]);
    await userEvent.keyboard("{ArrowRight}");
    expect(player.seekTo).toHaveBeenLastCalledWith(STILLS[2]);
    await userEvent.keyboard("m");
    expect(player.mute).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });

  it("ignores the Player's own frame and end events, which a seek fires", async () => {
    const { begin } = await titleCard();
    fireEvent.click(begin);
    await screen.findByRole("button", { name: "Next" });
    await userEvent.keyboard("{Enter}{Enter}");
    // A late report from the first seek, then the end a seek to the last frame reports.
    act(() => player.emit("frameupdate", { frame: STILLS[1] }));
    act(() => player.emit("ended"));
    expect(screen.queryByRole("button", { name: "Make it a badge" })).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(player.seekTo).toHaveBeenLastCalledWith(STILLS[3]);
  });

  it("advancing past the last still mounts the play beat", async () => {
    const { begin } = await titleCard();
    fireEvent.click(begin);
    await screen.findByRole("button", { name: "Next" });
    for (let i = 1; i < STILLS.length; i++) await userEvent.keyboard("{Enter}");
    expect(player.seekTo).toHaveBeenLastCalledWith(STILLS[STILLS.length - 1]);
    expect(screen.queryByRole("button", { name: "Make it a badge" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Make it a badge" })).toBeTruthy();
    expect(player.play).not.toHaveBeenCalled();
  });
});
