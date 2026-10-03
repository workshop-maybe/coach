// @vitest-environment jsdom
// The compare (U9, R11, R12, R17, KTD10): two takes opened side by side in the full window,
// each a record with its reply rendered and its saved reading from Jev (U7, R14), one switch
// to show both as stored, and the way back to the page that lists them, with both still
// picked and Compare focused.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assessmentPath, profilePath } from "../domain/folder";
import type { Assessment, FolderState, Handoff, JevReading } from "../domain/types";
import type { MemoryStorage } from "../storage/memory";
import { formatDate } from "./format";
import type { TakeRef } from "./routes";
import { opus, renderApp, result, review, storageWith } from "./testFolder";

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

function folder(assessments: Assessment[], profiles = [opus, codex]) {
  return storageWith({ credentials: [review], profiles, handoffs: [a], assessments });
}

function open(storage: MemoryStorage, takes: [TakeRef, TakeRef], key = "eng/review") {
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
    const leftReading = within(left).getByText("Jev's reading, 94% overall", { selector: "summary" }).closest("details")!;
    expect(leftReading.open).toBe(false);
    expect(leftReading.querySelector("li .jev-point-text")?.textContent).toBe("Names the off-by-one");
    expect(leftReading.querySelector("li .jev-p")?.textContent).toBe("94%");
    const rightReading = within(right).getByText("Jev's reading, 12% overall", { selector: "summary" }).closest("details")!;
    expect(rightReading.querySelector("li .jev-point-text")?.textContent).toBe("Suggests a fix");
    expect(within(left).queryByText("Suggests a fix")).toBeNull();
    expect(within(right).queryByText("Names the off-by-one")).toBeNull();
    cleanup();

    open(
      folder([await result(opus, review, { ...day(1), jev: reading(0.94, "Names the off-by-one") }), await result(codex, review, day(2))]),
      [take("opus", 1), take("codex", 2)],
    );
    await screen.findByRole("region", { name: "Compare replies" });
    expect(within(panes()[0]).getByText("Jev's reading, 94% overall", { selector: "summary" })).toBeTruthy();
    expect(within(panes()[1]).queryByText(/Jev's reading/)).toBeNull();
    expect(panes()[1].querySelector(".jev-reading")).toBeNull();
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
