// @vitest-environment jsdom
// The first run (U4): title card, film, play beat, then the folder gate. The film's player draws
// every frame against a clock, so a stand-in records what the first run asks of it and lets
// each test fire its events.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderGate } from "../ui/FolderGate";
import { HELD_LINE_KEY, readHeldLine } from "./heldLine";
import { MUTE_STORAGE_KEY } from "./mute";
import { SCENES, STILLS, TOTAL_FRAMES } from "./timeline";

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

  it("mounts the film behind it, not yet playing, with sound on", async () => {
    await titleCard();
    expect(player.play).not.toHaveBeenCalled();
    expect(player.props).toMatchObject({ reducedMotion: false, muted: false });
  });

  it("Begin plays the film once, inside the key's own event", async () => {
    const { begin } = await titleCard();
    // fireEvent returns after the click handler ran, so play was called inside the key's own event.
    fireEvent.click(begin);
    expect(player.play).toHaveBeenCalledTimes(1);
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
    expect(player.props?.still).toBe(0);
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
    expect(player.props?.muted).toBe(true);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeTruthy();
  });

  it("when the film ends the play beat mounts over its held last frame", async () => {
    await playing();
    act(() => player.emit("frameupdate", { frame: TOTAL_FRAMES - 1 }));
    act(() => player.emit("ended"));
    expect(await screen.findByRole("heading", { name: "What would a good result look like" })).toBeTruthy();
    expect(screen.getByTestId("player")).toBeTruthy();
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
    expect(player.props).toMatchObject({ reducedMotion: true, still: 0 });
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    fireEvent.click(begin);
    await screen.findByRole("button", { name: "Skip" });
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(player.props?.still).toBe(1);
    await userEvent.keyboard("{ArrowRight}");
    expect(player.props?.still).toBe(2);
    await userEvent.keyboard("m");
    expect(player.mute).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });

  it("ignores the film's own frame and end reports while the newcomer steps", async () => {
    const { begin } = await titleCard();
    fireEvent.click(begin);
    await screen.findByRole("button", { name: "Next" });
    await userEvent.keyboard("{Enter}{Enter}");
    act(() => player.emit("frameupdate", { frame: STILLS[1] }));
    act(() => player.emit("ended"));
    expect(screen.queryByRole("button", { name: "Make it a badge" })).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(player.props?.still).toBe(3);
  });

  it("advancing past the last still mounts the play beat", async () => {
    const { begin } = await titleCard();
    fireEvent.click(begin);
    await screen.findByRole("button", { name: "Next" });
    for (let i = 1; i < STILLS.length; i++) await userEvent.keyboard("{Enter}");
    expect(player.props?.still).toBe(STILLS.length - 1);
    expect(screen.queryByRole("button", { name: "Make it a badge" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Make it a badge" })).toBeTruthy();
    expect(player.play).not.toHaveBeenCalled();
  });
});

describe("a film that cannot load or draw", () => {
  it("skips to the folder gate instead of blanking the window", async () => {
    player.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    firstRun();
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Begin" })).toBeNull();
  });
});

describe("a held key under reduced motion", () => {
  it("advances one still, not every still", async () => {
    stubReducedMotion(true);
    const { begin } = await titleCard();
    fireEvent.click(begin);
    await screen.findByRole("button", { name: "Skip" });
    const before = player.props?.still;
    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    expect(player.props?.still).toBe(before);
    expect(screen.queryByRole("button", { name: "Make it a badge" })).toBeNull();
  });
});
