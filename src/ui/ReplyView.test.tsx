// @vitest-environment jsdom
// The reply view (U5, R11, R12, R15, R16, KTD7): one take opened as its own pane, with its
// record header, its reply rendered, the handoff text that ran, and the way back it works
// out from the take each time it closes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assessmentPath, profilePath, serializeAssessment, serializeProfile } from "../domain/folder";
import type { Assessment, FolderState, Handoff } from "../domain/types";
import type { MemoryStorage } from "../storage/memory";
import { formatDate } from "./format";
import type { TakeRef } from "./routes";
import { opus, renderApp, result, review, storageWith } from "./testFolder";

// Each finished matrix build is noted, so a test can wait for the build of a reloaded folder.
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

/** The folder's actions in the top bar: all three on a page, none on a pane (R8). */
const FOLDER_ACTIONS = ["Change folder", "Reload", "Export"];
const barActions = () => FOLDER_ACTIONS.filter((name) => within(screen.getByRole("banner")).queryByRole("button", { name }) !== null);

function folder(assessments: Assessment[], profiles = [opus, codex]) {
  return storageWith({ credentials: [review], profiles, handoffs: [a], assessments });
}

function open(storage: MemoryStorage, at: TakeRef = take("opus", 1), picks?: TakeRef[]) {
  return renderApp(storage, { view: "item", item: "reply", credentialKey: "eng/review", take: at, ...(picks ? { picks } : {}) });
}

/** Writes or removes files outside the app, then gives the window focus, which reloads the folder. */
function reloadAfter(change: () => void) {
  change();
  fireEvent.focus(window);
}

const write = (storage: MemoryStorage, path: string, text: string) => storage.seed({ [path]: text });
const resultPath = (r: Assessment) => assessmentPath(r.profileSlug, r.collectionSlug, r.credentialSlug, r.fileStem);

/** The take's row on the page the view went back to, found by its pick box's name. */
function takeHead(agent: string, n: number): HTMLElement {
  const box = screen.getByRole("checkbox", { name: `Pick ${agent}, ${formatDate(day(n).recordedAt)}` });
  return box.parentElement!.querySelector("button.take-head")!;
}

describe("ReplyView", () => {
  it("shows the agent, date, setup, verdict and note over the reply rendered, with the top bar slim from its first render", async () => {
    const storage = folder([
      await result(opus, review, {
        ...day(1),
        result: "not_met",
        note: "Missed the race.",
        handBack: "# Findings\n\n- one\n- two",
        handoff: { id: "a", text: "Filled handoff A" },
      }),
    ]);
    // Any moment the view shows under a full bar would be a full bar painted, then slimmed.
    let fullBarWithView = false;
    const watch = new MutationObserver(() => {
      if (document.querySelector(".reply-view") && document.querySelector(".topbar-actions")) fullBarWithView = true;
    });
    watch.observe(document.body, { childList: true, subtree: true });
    open(storage);
    const heading = await screen.findByRole("heading", { name: "Opus agent", level: 2 });
    watch.disconnect();
    expect(fullBarWithView).toBe(false);
    expect(barActions()).toEqual([]);

    const bar = heading.closest<HTMLElement>(".reply-bar")!;
    expect(within(bar).getByText("claude-code · opus · high")).toBeTruthy();
    expect(within(bar).getByText("Not met")).toBeTruthy();
    expect(within(bar).getByText(new RegExp(formatDate(day(1).recordedAt)))).toBeTruthy();
    expect(within(bar).getByText("Missed the race.")).toBeTruthy();

    const reply = screen.getByRole("region", { name: "Reply" });
    expect(reply.querySelector("h1")?.textContent).toBe("Findings");
    expect([...reply.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["one", "two"]);
    expect(reply.textContent).not.toContain("# ");
  });

  it("shows a note only when the result has one", async () => {
    open(folder([await result(opus, review, { ...day(1), note: "" })]));
    await screen.findByRole("heading", { name: "Opus agent" });
    expect(document.querySelector(".reply-note")).toBeNull();
  });

  it("keeps the handoff text that ran collapsed under the reply", async () => {
    open(folder([await result(opus, review, { ...day(1), handoff: { id: "a", text: "Filled handoff A" } })]));
    const summary = await screen.findByText("Handoff A");
    const ranWith = summary.closest("details")!;
    expect(ranWith.open).toBe(false);
    expect(ranWith.querySelector("pre")?.textContent).toBe("Filled handoff A");
  });

  it("switches the reply to its stored text, exactly as stored, and back", async () => {
    const stored = "# Findings\n\n- one\n- two";
    open(folder([await result(opus, review, { ...day(1), handBack: stored })]));
    await screen.findByRole("heading", { name: "Opus agent" });
    await userEvent.click(screen.getByRole("button", { name: "Show as stored" }));
    expect(screen.getByRole("region", { name: "Reply" }).querySelector("pre")?.textContent).toBe(stored);
    await userEvent.click(screen.getByRole("button", { name: "Show formatted" }));
    expect(screen.getByRole("region", { name: "Reply" }).querySelector("h1")?.textContent).toBe("Findings");
  });

  it("puts focus on its heading when it opens", async () => {
    open(folder([await result(opus, review, day(1))]));
    const heading = await screen.findByRole("heading", { name: "Opus agent" });
    expect(document.activeElement).toBe(heading);
  });

  it("Close from a take on a one-run badge returns to the badge with that agent lit and that take's row focused", async () => {
    open(folder([await result(opus, review, day(1)), await result(opus, review, day(2)), await result(codex, review, day(3))]));
    await screen.findByRole("heading", { name: "Opus agent" });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(takeHead("Opus agent", 1)));
    const lit = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "true");
    expect(lit?.getAttribute("aria-label")).toBe("Opus agent");
    expect(barActions()).toEqual(FOLDER_ACTIONS);
  });

  it("Escape from an older take on a handoff that is not the agent's latest returns to that handoff's page", async () => {
    open(
      folder([
        await result(opus, review, day(1)),
        await result(opus, review, { ...day(2), handoff: { id: "a", text: "Filled A" } }),
        await result(codex, review, { ...day(3), handoff: { id: "a", text: "Filled A" } }),
      ]),
    );
    await screen.findByRole("heading", { name: "Opus agent" });
    await waitFor(() => expect(builds.last).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "Skeleton", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(takeHead("Opus agent", 1)));
  });

  it("a second run appearing while the view is open sends Close to the handoff page", async () => {
    const storage = folder([await result(opus, review, day(1))]);
    open(storage);
    await screen.findByRole("heading", { name: "Opus agent" });
    await waitFor(() => expect(builds.last?.assessments).toHaveLength(1));
    const second = await result(codex, review, { ...day(2), handoff: { id: "a", text: "Filled A" } });
    reloadAfter(() => write(storage, resultPath(second), serializeAssessment(second)));
    await waitFor(() => expect(builds.last?.assessments).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Skeleton", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(takeHead("Opus agent", 1)));
  });

  it("a take whose file disappears on reload shows Missing, and its button returns to the badge", async () => {
    const gone = await result(opus, review, day(1));
    const storage = folder([gone, await result(codex, review, day(2))]);
    open(storage);
    await screen.findByRole("heading", { name: "Opus agent" });
    reloadAfter(() => storage.remove(resultPath(gone)));
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    expect(barActions()).toEqual(FOLDER_ACTIONS);
    await userEvent.click(screen.getByRole("button", { name: "Back to the badge" }));
    expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
  });

  it("a take whose agent file is deleted shows Missing", async () => {
    const storage = folder([await result(opus, review, day(1))]);
    open(storage);
    await screen.findByRole("heading", { name: "Opus agent" });
    reloadAfter(() => storage.remove(profilePath("opus")));
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to the badge" })).toBeTruthy();
  });

  it("a take named by a route for a badge that is gone shows Missing with the way home", async () => {
    renderApp(folder([await result(opus, review, day(1))]), { view: "item", item: "reply", credentialKey: "eng/gone", take: take("opus", 1) });
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(await screen.findByRole("region", { name: "Badges" })).toBeTruthy();
  });

  it("a renamed agent shows its new name in the open view", async () => {
    const storage = folder([await result(opus, review, day(1))]);
    open(storage);
    await screen.findByRole("heading", { name: "Opus agent" });
    reloadAfter(() => write(storage, profilePath("opus"), serializeProfile({ ...opus, name: "Opus, renamed" })));
    expect(await screen.findByRole("heading", { name: "Opus, renamed" })).toBeTruthy();
  });
});
