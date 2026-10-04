// @vitest-environment jsdom
// The compare (U9, R11, R12, R17, KTD10): takes under a strip, two opened side by side in the
// full window, each a record with its reply rendered and its saved reading from Jev (U7,
// R14), one switch to show both as stored, and the way back to the page that lists them,
// still picked and Compare focused. Held replies are judged and a go-to chosen in place
// (hold-and-compare R7-R11).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assessmentPath, profilePath } from "../domain/folder";
import type { Assessment, FolderState, Handoff, HeldReply, JevReading, Mark } from "../domain/types";
import type { MemoryStorage } from "../storage/memory";
import { formatDate } from "./format";
import type { TakeRef } from "./routes";
import { heldReply, opus, renderApp, result, review, storageWith } from "./testFolder";

// Each finished matrix build is noted, so a test can wait for the matrix before closing.
const builds = vi.hoisted(() => ({ last: null as FolderState | null }));
vi.mock("../domain/matrix", async (importOriginal) => {
  const real = await importOriginal<typeof import("../domain/matrix")>();
  return {
    ...real,
    buildMatrix: async (state: FolderState) => {
      const matrix = await real.buildMatrix(state);
      builds.last = state;
      return matrix;
    },
  };
});
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  builds.last = null;
});
afterEach(cleanup);

const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5", effort: "medium" };
const a: Handoff = { id: "a", collectionSlug: "eng", credentialSlug: "review", text: "# A\n\n{{task}}\n" };
const day = (n: number) => ({ fileStem: `2026090${n}T090000Z`, recordedAt: `2026-09-0${n}T09:00:00.000Z` });
const take = (slug: string, n: number): TakeRef => ({ profileSlug: slug, fileStem: day(n).fileStem });
const ranA = { id: "a", text: "Filled A" };

/** The folder's actions in the top bar: all three on a page, none on a pane (R8). */
const FOLDER_ACTIONS = ["Change folder", "Reload", "Export"];
const barActions = () => FOLDER_ACTIONS.filter((name) => within(screen.getByRole("banner")).queryByRole("button", { name }) !== null);

function folder(assessments: Assessment[], profiles = [opus, codex], held: HeldReply[] = [], marks: Mark[] = []) {
  return storageWith({ credentials: [review], profiles, handoffs: [a], assessments, held, marks });
}

function open(storage: MemoryStorage, takes: TakeRef[], key = "eng/review") {
  return renderApp(storage, { view: "item", item: "compare", credentialKey: key, takes, picks: takes });
}

/** Removes files outside the app, then gives the window focus, which reloads the folder. */
function reloadAfter(change: () => void) {
  change();
  fireEvent.focus(window);
}

const resultPath = (r: Assessment) => assessmentPath(r.profileSlug, r.collectionSlug, r.credentialSlug, r.fileStem);
const panes = () => within(screen.getByRole("region", { name: "Compare replies" })).getAllByRole("article");
const picked = () => screen.getAllByRole("checkbox").map((b) => (b as HTMLInputElement).checked);

describe("CompareView", () => {
  it("shows both replies rendered, each with its agent, setup, verdict and date, with the top bar slim from its first render", async () => {
    const storage = folder([
      await result(opus, review, { ...day(1), handBack: "# Opus findings\n\n- one\n- two" }),
      await result(codex, review, { ...day(2), result: "not_met", handBack: "Codex wrote a **plan**." }),
    ]);
    // Any moment the view shows under a full bar would be a full bar painted, then slimmed.
    let fullBarWithView = false;
    const watch = new MutationObserver(() => {
      if (document.querySelector(".compare-view") && document.querySelector(".topbar-actions")) fullBarWithView = true;
    });
    watch.observe(document.body, { childList: true, subtree: true });
    open(storage, [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    watch.disconnect();
    expect(fullBarWithView).toBe(false);
    expect(barActions()).toEqual([]);

    const [left, right] = panes();
    expect(left.getAttribute("aria-label")).toBe(`Opus agent, ${formatDate(day(1).recordedAt)}`);
    expect(within(left).getByRole("heading", { name: "Opus agent" })).toBeTruthy();
    expect(within(left).getByText("claude-code · opus · high")).toBeTruthy();
    expect(within(left).getByText("Met")).toBeTruthy();
    expect(within(left).getByText(new RegExp(formatDate(day(1).recordedAt)))).toBeTruthy();
    const leftReply = within(left).getByRole("region", { name: "Reply" });
    expect(leftReply.querySelector("h1")?.textContent).toBe("Opus findings");
    expect([...leftReply.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["one", "two"]);

    expect(within(right).getByRole("heading", { name: "Codex agent" })).toBeTruthy();
    expect(within(right).getByText("codex · gpt-5 · medium")).toBeTruthy();
    expect(within(right).getByText("Not met")).toBeTruthy();
    expect(within(right).getByText(new RegExp(formatDate(day(2).recordedAt)))).toBeTruthy();
    expect(within(right).getByRole("region", { name: "Reply" }).querySelector("strong")?.textContent).toBe("plan");
  });

  it("puts focus on the first reply's heading when it opens", async () => {
    open(folder([await result(opus, review, day(1)), await result(codex, review, day(2))]), [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    expect(document.activeElement).toBe(within(panes()[0]).getByRole("heading", { name: "Opus agent" }));
  });

  it("one switch shows both replies exactly as stored, and back", async () => {
    const opusText = "# Opus findings\n\n- one\n- two";
    const codexText = "Codex wrote a **plan**.";
    open(folder([await result(opus, review, { ...day(1), handBack: opusText }), await result(codex, review, { ...day(2), handBack: codexText })]), [
      take("opus", 1),
      take("codex", 2),
    ]);
    await screen.findByRole("region", { name: "Compare replies" });
    expect(screen.getAllByRole("button", { name: "Show as stored" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Show as stored" }));
    const [left, right] = panes();
    expect(within(left).getByRole("region", { name: "Reply" }).querySelector("pre")?.textContent).toBe(opusText);
    expect(within(right).getByRole("region", { name: "Reply" }).querySelector("pre")?.textContent).toBe(codexText);
    await userEvent.click(screen.getByRole("button", { name: "Show formatted" }));
    expect(within(panes()[0]).getByRole("region", { name: "Reply" }).querySelector("h1")?.textContent).toBe("Opus findings");
    expect(within(panes()[1]).getByRole("region", { name: "Reply" }).querySelector("pre")).toBeNull();
  });

  it("shows each take's saved reading in its own pane, and none for a take without one", async () => {
    const reading = (overall: number, text: string): JevReading => ({
      model: "jev-1.13.0",
      assignmentVersion: "v1",
      askedAt: "2026-09-01T09:05:00.000Z",
      seen: "before",
      overall,
      points: [{ text, probability: overall }],
    });
    open(
      folder([
        await result(opus, review, { ...day(1), jev: reading(0.94, "Names the off-by-one") }),
        await result(codex, review, { ...day(2), jev: reading(0.12, "Suggests a fix") }),
        await result(opus, review, day(3)),
      ]),
      [take("opus", 1), take("codex", 2)],
    );
    await screen.findByRole("region", { name: "Compare replies" });
    const [left, right] = panes();
    const leftReading = within(left).getByText("Jev's reading, meets overall", { selector: "summary" }).closest("details")!;
    expect(leftReading.open).toBe(false);
    expect(leftReading.querySelector("li .jev-point-text")?.textContent).toBe("Names the off-by-one");
    expect(leftReading.querySelector("li .jev-call")?.textContent).toBe("Meets");
    expect(leftReading.querySelector("li .jev-p")?.textContent).toBe("94%");
    const rightReading = within(right).getByText("Jev's reading, misses overall", { selector: "summary" }).closest("details")!;
    expect(rightReading.querySelector("li .jev-point-text")?.textContent).toBe("Suggests a fix");
    expect(rightReading.querySelector("li .jev-call")?.textContent).toBe("Misses");
    expect(within(left).queryByText("Suggests a fix")).toBeNull();
    expect(within(right).queryByText("Names the off-by-one")).toBeNull();
    cleanup();

    open(
      folder([await result(opus, review, { ...day(1), jev: reading(0.94, "Names the off-by-one") }), await result(codex, review, day(2))]),
      [take("opus", 1), take("codex", 2)],
    );
    await screen.findByRole("region", { name: "Compare replies" });
    expect(within(panes()[0]).getByText("Jev's reading, meets overall", { selector: "summary" })).toBeTruthy();
    expect(within(panes()[1]).queryByText(/Jev's reading/)).toBeNull();
    expect(panes()[1].querySelector(".jev-reading")).toBeNull();
  });

  it("shows Jev's track record on a result's saved reading and never on a held reply's, each read with the badge's pair", async () => {
    const reading = (overall: number): JevReading => ({
      model: "jev-1.13.0",
      assignmentVersion: "v1",
      askedAt: "2026-09-01T09:05:00.000Z",
      seen: "before",
      overall,
      points: [],
    });
    // Eight judged readings on the badge, every verdict Met, so the track record shows.
    const results = await Promise.all(
      [0.9, 0.9, 0.9, 0.9, 0.9, 0.5, 0.5, 0.2].map((overall, i) => result(opus, review, { ...day(i + 1), jev: reading(overall) })),
    );
    const held = await heldReply(codex, review, { fileStem: day(9).fileStem, heldAt: day(9).recordedAt, jev: reading(0.5) });
    open(folder(results, [opus, codex], [held]), [take("opus", 1), take("codex", 9)]);
    await screen.findByRole("region", { name: "Compare replies" });
    const [left, right] = panes();
    const leftReading = within(left).getByText("Jev's reading, meets overall", { selector: "summary" }).closest("details")!;
    expect(within(leftReading).getByText("Jev matched your verdict 5 of 6 times on this badge, and couldn't call 2")).toBeTruthy();
    const rightReading = within(right).getByText("Jev's reading, can't call overall", { selector: "summary" }).closest("details")!;
    expect(rightReading.querySelector(".jev-overall .jev-call")?.textContent).toBe("Jev can't call the whole bar");
    expect(within(rightReading).queryByText(/Jev matched/)).toBeNull();
  });

  it("two takes from the same agent each show their own verdict and date", async () => {
    open(
      folder([
        await result(opus, review, { ...day(1), result: "not_met", handBack: "First try" }),
        await result(opus, review, { ...day(2), handBack: "Second try" }),
      ]),
      [take("opus", 2), take("opus", 1)],
    );
    await screen.findByRole("region", { name: "Compare replies" });
    const [left, right] = panes();
    expect(within(left).getByRole("heading", { name: "Opus agent" })).toBeTruthy();
    expect(within(left).getByText("Second try")).toBeTruthy();
    expect(within(left).getByText("Met")).toBeTruthy();
    expect(within(right).getByRole("heading", { name: "Opus agent" })).toBeTruthy();
    expect(within(right).getByText("First try")).toBeTruthy();
    expect(within(right).getByText("Not met")).toBeTruthy();
  });

  it("Close returns to the badge while one handoff has run, with both still picked and focus on Compare", async () => {
    open(folder([await result(opus, review, day(1)), await result(codex, review, day(2))]), [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    await waitFor(() => expect(builds.last).not.toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Compare" })));
    expect(picked()).toEqual([true, true]);
    expect(barActions()).toEqual(FOLDER_ACTIONS);
  });

  it("Escape from takes on a handoff page, once two handoffs have run, returns to that handoff with both picked and focus on Compare", async () => {
    open(
      folder([
        await result(opus, review, day(1)),
        await result(opus, review, { ...day(2), handoff: ranA }),
        await result(codex, review, { ...day(3), handoff: ranA }),
      ]),
      [take("opus", 2), take("codex", 3)],
    );
    await screen.findByRole("region", { name: "Compare replies" });
    await waitFor(() => expect(builds.last).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "Handoff A", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Compare" })));
    expect(picked()).toEqual([true, true]);
  });

  it("a reload that removes one take says it is gone, with the way back to the badge", async () => {
    const gone = await result(codex, review, day(2));
    const storage = folder([await result(opus, review, day(1)), gone]);
    open(storage, [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    reloadAfter(() => storage.remove(resultPath(gone)));
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    expect(barActions()).toEqual(FOLDER_ACTIONS);
    await userEvent.click(screen.getByRole("button", { name: "Back to the badge" }));
    expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Pick Opus agent/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "Pick two to compare" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a reload that removes one take on a handoff page names the way back to that handoff", async () => {
    const gone = await result(codex, review, { ...day(3), handoff: ranA });
    const storage = folder([await result(opus, review, day(1)), await result(opus, review, { ...day(2), handoff: ranA }), gone]);
    open(storage, [take("opus", 2), take("codex", 3)]);
    await screen.findByRole("region", { name: "Compare replies" });
    await waitFor(() => expect(builds.last).not.toBeNull());
    reloadAfter(() => storage.remove(resultPath(gone)));
    await userEvent.click(await screen.findByRole("button", { name: "Back to the handoff" }));
    expect(await screen.findByRole("heading", { name: "Handoff A", level: 2 })).toBeTruthy();
  });

  it("a take whose agent file is deleted shows it gone", async () => {
    const storage = folder([await result(opus, review, day(1)), await result(codex, review, day(2))]);
    open(storage, [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    reloadAfter(() => storage.remove(profilePath("opus")));
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to the badge" })).toBeTruthy();
  });

  it("a compare named by a route for a badge that is gone shows Missing with the way home", async () => {
    open(folder([await result(opus, review, day(1))]), [take("opus", 1), take("opus", 2)], "eng/gone");
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(await screen.findByRole("region", { name: "Badges" })).toBeTruthy();
  });
});

// The strip and the judging in place (hold-and-compare R7-R11, KTD10, KTD11).
describe("CompareView under a strip", () => {
  const haiku = { ...opus, slug: "haiku", name: "Haiku agent", model: "haiku", effort: "low" };
  const heldDay = (n: number) => ({ fileStem: day(n).fileStem, heldAt: day(n).recordedAt });
  const strip = () => within(screen.getByRole("list", { name: "Replies" }));
  const chip = (name: RegExp) => strip().getByRole("button", { name });
  const openNames = () => panes().map((p) => within(p).getByRole("heading").textContent);

  async function threeHeld() {
    return folder([], [opus, codex, haiku], [
      await heldReply(opus, review, { ...heldDay(1), handBack: "Opus held" }),
      await heldReply(codex, review, { ...heldDay(2), handBack: "Codex held" }),
      await heldReply(haiku, review, { ...heldDay(3), handBack: "Haiku held" }),
    ]);
  }

  it("Covers AE3. three held replies are all in the strip, each with its agent, setup and state, and the first two open", async () => {
    open(await threeHeld(), [take("opus", 1), take("codex", 2), take("haiku", 3)]);
    await screen.findByRole("region", { name: "Compare replies" });
    expect(strip().getAllByRole("button")).toHaveLength(3);
    expect(chip(/Haiku agent/).textContent).toContain("claude-code · haiku · low");
    expect(chip(/Haiku agent/).textContent).toContain("Held");
    expect(openNames()).toEqual(["Opus agent", "Codex agent"]);
    expect(chip(/Opus agent/).getAttribute("aria-pressed")).toBe("true");
    expect(chip(/Haiku agent/).getAttribute("aria-pressed")).toBe("false");
  });

  it("Covers AE4. four takes, two held and two judged, are all in the strip with their states", async () => {
    const storage = folder(
      [await result(opus, review, day(1)), await result(codex, review, { ...day(2), result: "not_met" })],
      [opus, codex, haiku],
      [await heldReply(haiku, review, heldDay(3)), await heldReply(opus, review, heldDay(4))],
    );
    open(storage, [take("opus", 1), take("codex", 2), take("haiku", 3), take("opus", 4)]);
    await screen.findByRole("region", { name: "Compare replies" });
    expect(strip().getAllByRole("button").map((b) => b.querySelector(".verdict")?.textContent)).toEqual(["Met", "Not met", "Held", "Held"]);
  });

  it("a closed reply chosen in the strip opens on the right and the left holds; the right one swaps sides; the left one stays", async () => {
    open(await threeHeld(), [take("opus", 1), take("codex", 2), take("haiku", 3)]);
    await screen.findByRole("region", { name: "Compare replies" });
    await userEvent.click(chip(/Haiku agent/));
    expect(openNames()).toEqual(["Opus agent", "Haiku agent"]);
    // Focus stays on the strip button that was pressed.
    expect(document.activeElement).toBe(chip(/Haiku agent/));
    await userEvent.click(chip(/Haiku agent/));
    expect(openNames()).toEqual(["Haiku agent", "Opus agent"]);
    await userEvent.click(chip(/Haiku agent/));
    expect(openNames()).toEqual(["Haiku agent", "Opus agent"]);
    await userEvent.click(chip(/Codex agent/));
    expect(openNames()).toEqual(["Haiku agent", "Codex agent"]);
  });

  it("Covers AE5. only a Met reply offers Make go-to; marking the held one Met records it and offers it there too", async () => {
    const held = await heldReply(codex, review, { ...heldDay(2), handBack: "Codex held" });
    const storage = folder([await result(opus, review, day(1))], [opus, codex], [held]);
    open(storage, [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    const [left, right] = panes();
    expect(within(left).getByRole("button", { name: "Make go-to" })).toBeTruthy();
    expect(within(right).queryByRole("button", { name: "Make go-to" })).toBeNull();
    await userEvent.click(within(right).getByRole("button", { name: "Met" }));
    await waitFor(() => expect(within(panes()[1]).getByRole("button", { name: "Make go-to" })).toBeTruthy());
    expect(storage.file(assessmentPath("codex", "eng", "review", held.fileStem))).toMatch(/^result: met$/m);
    expect(chip(/Codex agent/).querySelector(".verdict")?.textContent).toBe("Met");
    // The pressed button is gone; focus is on that reply's heading, not on Make go-to.
    expect(document.activeElement).toBe(within(panes()[1]).getByRole("heading", { name: "Codex agent" }));
  });

  it("Make go-to marks that result, and the reply then says Go-to", async () => {
    const storage = folder([await result(opus, review, day(1)), await result(codex, review, day(2))]);
    open(storage, [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    await userEvent.click(within(panes()[1]).getByRole("button", { name: "Make go-to" }));
    await waitFor(() => expect(within(panes()[1]).getByText("Go-to")).toBeTruthy());
    const marks = Object.keys(storage.files()).filter((p) => p.startsWith("collections/eng/marks/review/"));
    expect(marks).toHaveLength(1);
    expect(JSON.parse(storage.file(marks[0])!)).toEqual({ agent: "codex", result: day(2).fileStem });
    expect(within(panes()[0]).getByRole("button", { name: "Make go-to" })).toBeTruthy();
  });

  it("a reply the go-to's mark names says Go-to from the start", async () => {
    const mark: Mark = { collectionSlug: "eng", credentialSlug: "review", id: "20260905T090000Z", profileSlug: "opus", fileStem: day(1).fileStem };
    open(folder([await result(opus, review, day(1)), await result(codex, review, day(2))], [opus, codex], [], [mark]), [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    expect(within(panes()[0]).getByText("Go-to")).toBeTruthy();
    expect(within(panes()[0]).queryByRole("button", { name: "Make go-to" })).toBeNull();
  });

  it("Not yet on a held reply records Not met and offers no go-to", async () => {
    const storage = folder([await result(opus, review, day(1))], [opus, codex], [await heldReply(codex, review, heldDay(2))]);
    open(storage, [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    await userEvent.click(within(panes()[1]).getByRole("button", { name: "Not yet" }));
    await waitFor(() => expect(within(panes()[1]).getByText("Not met")).toBeTruthy());
    expect(within(panes()[1]).queryByRole("button", { name: "Make go-to" })).toBeNull();
  });

  it("while a judgment saves every action is disabled and Escape does nothing; a failure shows inline and records nothing", async () => {
    const held = await heldReply(codex, review, heldDay(2));
    const storage = folder([await result(opus, review, day(1))], [opus, codex], [held]);
    open(storage, [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    // Something else wrote a file at the result's path since the folder was read.
    const path = assessmentPath("codex", "eng", "review", held.fileStem);
    storage.seed({ [path]: "someone else's" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const readText = storage.readText.bind(storage);
    storage.readText = async (root, p) => {
      if (p === path) await gate;
      return readText(root, p);
    };
    await userEvent.click(within(panes()[1]).getByRole("button", { name: "Met" }));
    expect((within(panes()[0]).getByRole("button", { name: "Make go-to" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(panes()[1]).getByRole("button", { name: "Not yet" }) as HTMLButtonElement).disabled).toBe(true);
    // Close and the strip wait too, so a failed write is never left behind unseen.
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    expect(strip().getAllByRole("button").every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "Compare replies" })).toBeTruthy();
    release();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(storage.file(path)).toBe("someone else's");
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failed Make go-to shows inline and writes no mark", async () => {
    const storage = folder([await result(opus, review, day(1)), await result(codex, review, day(2))]);
    open(storage, [take("opus", 1), take("codex", 2)]);
    await screen.findByRole("region", { name: "Compare replies" });
    vi.spyOn(storage, "writeText").mockRejectedValueOnce(new Error("disk full"));
    await userEvent.click(within(panes()[1]).getByRole("button", { name: "Make go-to" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/disk full/);
    expect(Object.keys(storage.files()).filter((p) => p.startsWith("collections/eng/marks/"))).toEqual([]);
    expect(within(panes()[1]).getByRole("button", { name: "Make go-to" })).toBeTruthy();
  });

  it("an open reply removed by a reload is replaced by the next one in the strip", async () => {
    const storage = await threeHeld();
    open(storage, [take("opus", 1), take("codex", 2), take("haiku", 3)]);
    await screen.findByRole("region", { name: "Compare replies" });
    reloadAfter(() => storage.remove(profilePath("codex")));
    await waitFor(() => expect(openNames()).toEqual(["Opus agent", "Haiku agent"]));
    expect(strip().getAllByRole("button")).toHaveLength(2);
  });

  it("two held replies by one agent on one day are told apart by their time", async () => {
    const storage = folder([], [opus, codex], [
      await heldReply(codex, review, { fileStem: "20260903T090000Z", heldAt: "2026-09-03T09:00:00.000Z" }),
      await heldReply(codex, review, { fileStem: "20260903T150000Z", heldAt: "2026-09-03T15:00:00.000Z" }),
    ]);
    open(storage, [
      { profileSlug: "codex", fileStem: "20260903T090000Z" },
      { profileSlug: "codex", fileStem: "20260903T150000Z" },
    ]);
    await screen.findByRole("region", { name: "Compare replies" });
    const labels = panes().map((p) => p.getAttribute("aria-label"));
    expect(new Set(labels).size).toBe(2);
  });
});
