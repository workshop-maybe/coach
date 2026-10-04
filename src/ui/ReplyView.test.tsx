// @vitest-environment jsdom
// The reply view (U5, R11, R12, R15, R16, KTD7): one take opened as its own pane, with its
// record header, its reply rendered, the handoff text that ran, Jev's saved reading (U7,
// R14), and the way back it works out from the take each time it closes. A held reply's
// reading is the one chosen for the badge's current version, and the verdict step and the
// change links judge and re-judge here as in compare (jev-in-compare U7, KTD10, KTD11).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assessmentPath, profilePath, rejudgedDir, serializeAssessment, serializeProfile } from "../domain/folder";
import { assignmentVersion } from "../domain/hash";
import type { Assessment, Credential, FolderState, Handoff, HeldReading, JevReading } from "../domain/types";
import { FakeJev } from "../jev/fakeJev";
import type { MemoryStorage } from "../storage/memory";
import { AppShell } from "./AppShell";
import { formatDate } from "./format";
import { JevProvider } from "./jevContext";
import type { TakeRef } from "./routes";
import { FOLDER, heldReply, opus, renderApp, result, review, storageWith } from "./testFolder";
import { FolderProvider } from "./useFolderState";

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

/** A reading saved on a result, seen before the verdict. Its points are the rubric as Jev read it then. */
const reading: JevReading = {
  model: "jev-1.13.0",
  assignmentVersion: "v1",
  askedAt: "2026-09-01T09:05:00.000Z",
  seen: "before",
  overall: 0.82,
  points: [
    { text: "Names the off-by-one", probability: 0.94 },
    { text: "Points to the line", probability: 0.52 },
  ],
};

/** The collapsed part that holds the saved reading, found by its summary. */
function savedReading(summary: string): HTMLDetailsElement {
  return screen.getByText(summary, { selector: "summary" }).closest("details")!;
}

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

  it("keeps a saved reading collapsed under the reply, with its overall in the summary and the stored point text, not the rubric as it is now", async () => {
    const rewritten = { ...review, rubric: "- Covers every file\n- Is kind" };
    const assessments = [await result(opus, review, { ...day(1), jev: reading })];
    const storage = storageWith({ credentials: [rewritten], profiles: [opus, codex], handoffs: [a], assessments });
    open(storage);
    await screen.findByRole("heading", { name: "Opus agent" });

    const saved = savedReading("Jev's reading, meets overall");
    expect(saved.open).toBe(false);
    const panel = saved.querySelector<HTMLElement>(".jev-reading-saved")!;
    expect([...panel.querySelectorAll("li .jev-point-text")].map((t) => t.textContent)).toEqual(["Names the off-by-one", "Points to the line"]);
    expect([...panel.querySelectorAll("li .jev-call")].map((c) => c.textContent)).toEqual(["Meets", "Can't call: sharpen this point"]);
    expect([...panel.querySelectorAll("li .jev-p")].map((p) => p.textContent)).toEqual(["94%", "52%"]);
    expect(panel.querySelector(".jev-overall .jev-call")?.textContent).toBe("Meets");
    expect(panel.querySelector(".jev-overall .jev-p")?.textContent).toBe("82%");
    expect(panel.textContent).not.toContain("Covers every file");
    expect(within(panel).queryByRole("button")).toBeNull();
  });

  it("says in the summary when the verdict changed after Jev's reading was seen", async () => {
    const after = { ...reading, seen: "after" as const, verdictWhenSeen: "met" as const, verdictChanged: true };
    open(folder([await result(opus, review, { ...day(1), result: "not_met", jev: after })]));
    await screen.findByRole("heading", { name: "Opus agent" });
    expect(savedReading("Jev's reading, meets overall · verdict changed after it")).toBeTruthy();
  });

  it("says nothing of the verdict when it stayed as it was when Jev's reading was seen", async () => {
    const after = { ...reading, seen: "after" as const, verdictWhenSeen: "met" as const, verdictChanged: false };
    open(folder([await result(opus, review, { ...day(1), jev: after })]));
    await screen.findByRole("heading", { name: "Opus agent" });
    expect(savedReading("Jev's reading, meets overall")).toBeTruthy();
    expect(screen.queryByText(/verdict changed/)).toBeNull();
  });

  it("shows no reading for a result without one", async () => {
    open(folder([await result(opus, review, day(1))]));
    await screen.findByRole("heading", { name: "Opus agent" });
    expect(screen.queryByText(/Jev's reading/)).toBeNull();
    expect(document.querySelector(".jev-reading")).toBeNull();
  });

  it("shows a saved reading while Jev Mode is off, and asks Jev nothing", async () => {
    const fake = new FakeJev();
    render(
      <JevProvider jev={fake}>
        <FolderProvider storage={folder([await result(opus, review, { ...day(1), jev: reading })])} folder={FOLDER}>
          <AppShell onChangeFolder={() => {}} initialRoute={{ view: "item", item: "reply", credentialKey: "eng/review", take: take("opus", 1) }} />
        </FolderProvider>
      </JevProvider>,
    );
    await screen.findByRole("heading", { name: "Opus agent" });
    expect(fake.current.on).toBe(false);
    expect(savedReading("Jev's reading, meets overall").querySelector(".jev-overall .jev-p")?.textContent).toBe("82%");
    expect(fake.calls).toEqual([{ method: "status" }]);
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

// A held reply, opened (hold-and-compare R6, KTD3, KTD11).
describe("ReplyView of a held reply", () => {
  const heldDay = (n: number) => ({ fileStem: day(n).fileStem, heldAt: day(n).recordedAt });

  async function heldFolder() {
    const held = await heldReply(codex, review, { ...heldDay(2), handBack: "# Held findings" });
    return { held, storage: storageWith({ credentials: [review], profiles: [opus, codex], handoffs: [a], held: [held] }) };
  }

  it("Covers AE2. shows Held with Met and Not yet; Met records a result under the same stem, and the view shows Met", async () => {
    const { held, storage } = await heldFolder();
    open(storage, take("codex", 2));
    const heading = await screen.findByRole("heading", { name: "Codex agent", level: 2 });
    expect(within(heading.closest<HTMLElement>(".reply-bar")!).getByText("Held")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Reply" }).querySelector("h1")?.textContent).toBe("Held findings");
    await userEvent.click(screen.getByRole("button", { name: "Met" }));
    await waitFor(() => expect(within(heading.closest<HTMLElement>(".reply-bar")!).getByText("Met")).toBeTruthy());
    expect(storage.file(resultPath({ ...held, result: "met", recordedAt: held.heldAt, note: "" } as Assessment))).toMatch(/^result: met$/m);
    expect(screen.queryByRole("button", { name: "Not yet" })).toBeNull();
    // The pressed button is gone; the take's heading has the focus.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Codex agent", level: 2 }));
  });

  it("Not yet records Not met", async () => {
    const { storage } = await heldFolder();
    open(storage, take("codex", 2));
    await userEvent.click(await screen.findByRole("button", { name: "Not yet" }));
    const bar = (await screen.findByRole("heading", { name: "Codex agent", level: 2 })).closest<HTMLElement>(".reply-bar")!;
    await waitFor(() => expect(within(bar).getByText("Not met")).toBeTruthy());
  });

  it("a judged result shows no Met or Not yet", async () => {
    const storage = folder([await result(opus, review, day(1))]);
    open(storage);
    await screen.findByRole("heading", { name: "Opus agent" });
    expect(screen.queryByRole("button", { name: "Met" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Not yet" })).toBeNull();
  });

  it("a held reply whose agent is removed while open shows Missing", async () => {
    const { storage } = await heldFolder();
    open(storage, take("codex", 2));
    await screen.findByRole("heading", { name: "Codex agent" });
    reloadAfter(() => storage.remove(profilePath("codex")));
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
  });

  it("while a judgment saves, Close and the other verdict are disabled and Escape does nothing", async () => {
    const { held, storage } = await heldFolder();
    open(storage, take("codex", 2));
    await screen.findByRole("heading", { name: "Codex agent" });
    const path = assessmentPath("codex", "eng", "review", held.fileStem);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const readText = storage.readText.bind(storage);
    storage.readText = async (root, p) => {
      if (p === path) await gate;
      return readText(root, p);
    };
    await userEvent.click(screen.getByRole("button", { name: "Met" }));
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Not yet" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "Codex agent", level: 2 })).toBeTruthy();
    release();
    const bar = screen.getByRole("heading", { name: "Codex agent", level: 2 }).closest<HTMLElement>(".reply-bar")!;
    await waitFor(() => expect(within(bar).getByText("Met")).toBeTruthy());
    expect(storage.file(path)).toMatch(/^result: met$/m);
  });

  it("a failed judgment shows inline and records nothing", async () => {
    const { held, storage } = await heldFolder();
    open(storage, take("codex", 2));
    await screen.findByRole("heading", { name: "Codex agent" });
    // Something else wrote a file at the result's path since the folder was read.
    storage.seed({ [assessmentPath("codex", "eng", "review", held.fileStem)]: "someone else's" });
    await userEvent.click(screen.getByRole("button", { name: "Met" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(storage.file(assessmentPath("codex", "eng", "review", held.fileStem))).toBe("someone else's");
  });
});

// A saved reading read as calls (growing context U5, R9, R11, R12, KTD7, KTD8): with the
// pair the badge's results fit for the reading's own model, worked out from the folder, and
// with Jev's track record there only when the take has a verdict.
describe("ReplyView, a saved reading read as calls", () => {
  /** A reading from `model` with only an overall probability. */
  const jevAt = (overall: number, model = "jev-1.13.0"): JevReading => ({
    model,
    assignmentVersion: "v1",
    askedAt: "2026-09-01T09:05:00.000Z",
    seen: "before",
    overall,
    points: [{ text: "Names the off-by-one", probability: overall }],
  });
  /** Results on the badge, one a day from day 1, each with a reading at its overall. */
  const judged = (rows: [number, "met" | "not_met"][], profile = opus) =>
    Promise.all(rows.map(([overall, verdict], i) => result(profile, review, { ...day(i + 1), result: verdict, jev: jevAt(overall) })));
  /**
   * Eight results where the user judged Met every time Jev gave 60% or more: the fit moves
   * the meets cut-off to 55, the first grid step that reads all of them meets. Day 2 is 65%.
   */
  const metFromSixty = () =>
    judged([
      [0.6, "met"],
      [0.65, "met"],
      [0.68, "met"],
      [0.72, "met"],
      [0.9, "met"],
      [0.1, "not_met"],
      [0.15, "not_met"],
      [0.2, "not_met"],
    ]);
  const panelIn = (summary: string) => savedReading(summary).querySelector<HTMLElement>(".jev-reading-saved")!;

  it("Covers AE6. a past reading at 65% reads Meets under the fitted pair, says so, shows the track record, and asks Jev nothing", async () => {
    const fake = new FakeJev();
    render(
      <JevProvider jev={fake}>
        <FolderProvider storage={folder(await metFromSixty())} folder={FOLDER}>
          <AppShell onChangeFolder={() => {}} initialRoute={{ view: "item", item: "reply", credentialKey: "eng/review", take: take("opus", 2) }} />
        </FolderProvider>
      </JevProvider>,
    );
    await screen.findByRole("heading", { name: "Opus agent" });
    const panel = panelIn("Jev's reading, meets overall");
    expect(panel.querySelector(".jev-overall .jev-call")?.textContent).toBe("Meets");
    expect(panel.querySelector(".jev-overall .jev-p")?.textContent).toBe("65%");
    expect(panel.querySelector("li .jev-call")?.textContent).toBe("Meets");
    expect(within(panel).getByText("Cut-offs fitted to your verdicts")).toBeTruthy();
    expect(within(panel).getByText("Jev matched your verdict 8 of 8 times on this badge")).toBeTruthy();
    expect(fake.calls).toEqual([{ method: "status" }]);
  });

  it("a result's saved reading on a badge with 8 judged readings shows the track record; a held reply's on the same badge shows none", async () => {
    // Every verdict Met, so the fit can't run, but the track record shows from 8 readings.
    const results = await judged([
      [0.9, "met"],
      [0.9, "met"],
      [0.9, "met"],
      [0.9, "met"],
      [0.9, "met"],
      [0.5, "met"],
      [0.5, "met"],
      [0.2, "met"],
    ]);
    const held = await heldReply(codex, review, { fileStem: day(9).fileStem, heldAt: day(9).recordedAt, jev: jevAt(0.9) });
    const storage = storageWith({ credentials: [review], profiles: [opus, codex], handoffs: [a], assessments: results, held: [held] });
    open(storage, take("opus", 1));
    await screen.findByRole("heading", { name: "Opus agent" });
    const panel = panelIn("Jev's reading, meets overall");
    expect(within(panel).getByText("Jev matched your verdict 5 of 6 times on this badge, and couldn't call 2")).toBeTruthy();
    expect(within(panel).queryByText("Cut-offs fitted to your verdicts")).toBeNull();
    cleanup();

    open(storage, take("codex", 9));
    await screen.findByRole("heading", { name: "Codex agent" });
    const heldPanel = panelIn("Jev's reading, meets overall");
    expect(heldPanel.querySelector(".jev-overall .jev-call")?.textContent).toBe("Meets");
    expect(within(heldPanel).queryByText(/Jev matched/)).toBeNull();
  });

  it("a held reply's saved reading reads with the badge's fitted pair and says so, with no track record", async () => {
    const held = await heldReply(codex, review, { fileStem: day(9).fileStem, heldAt: day(9).recordedAt, jev: jevAt(0.65) });
    open(storageWith({ credentials: [review], profiles: [opus, codex], handoffs: [a], assessments: await metFromSixty(), held: [held] }), take("codex", 9));
    await screen.findByRole("heading", { name: "Codex agent" });
    const panel = panelIn("Jev's reading, meets overall");
    expect(panel.querySelector(".jev-overall .jev-call")?.textContent).toBe("Meets");
    expect(within(panel).queryByText(/Jev matched/)).toBeNull();
    expect(within(panel).getByText("Cut-offs fitted to your verdicts")).toBeTruthy();
  });

  it("a saved reading from another model reads with that model's pair, not the one fitted to the badge's other readings", async () => {
    const other = await result(codex, review, { ...day(9), jev: jevAt(0.65, "jev-2.0.0") });
    open(folder([...(await metFromSixty()), other]), take("codex", 9));
    await screen.findByRole("heading", { name: "Codex agent" });
    const panel = panelIn("Jev's reading, can't call overall");
    expect(panel.querySelector(".jev-overall .jev-call")?.textContent).toBe("Jev can't call the whole bar");
    expect(within(panel).queryByText("Cut-offs fitted to your verdicts")).toBeNull();
    expect(within(panel).queryByText(/Jev matched/)).toBeNull();
  });

  it("names a misses call in the summary", async () => {
    open(folder(await judged([[0.12, "not_met"]])));
    await screen.findByRole("heading", { name: "Opus agent" });
    expect(panelIn("Jev's reading, misses overall").querySelector(".jev-overall .jev-call")?.textContent).toBe("Misses");
  });
});

// Judging against Jev and re-judging in the reply view (jev-in-compare U7, KTD10, KTD11, and
// the plan's assumption that the reply view shares compare's verdict step).
describe("ReplyView, judging against Jev and again", () => {
  const POINTS = ["Finds the bug.", "Suggests a fix."];
  const graded: Credential = { ...review, rubric: POINTS.map((p) => `- ${p}`).join("\n") };
  const heldDay = (n: number) => ({ fileStem: day(n).fileStem, heldAt: day(n).recordedAt });
  const current = () => assignmentVersion(graded.task, graded.rubric);
  const jevAt = (overall: number, version: string, askedAt = "2026-09-02T09:05:00.000Z"): JevReading => ({
    model: "jev-1.13.0",
    assignmentVersion: version,
    askedAt,
    seen: "before",
    overall,
    points: POINTS.map((text) => ({ text, probability: overall })),
  });
  const bar = () => screen.getByRole("heading", { name: /agent/, level: 2 }).closest<HTMLElement>(".reply-bar")!;
  const stepTitle = () => screen.queryByRole("heading", { level: 3 })?.textContent ?? null;

  it("shows a held reply's reading taken at the badge's current version over the one it was held with, and judges against it", async () => {
    const held = await heldReply(codex, graded, { ...heldDay(2), jev: jevAt(0.1, "an-older-version", "2026-09-02T09:05:00.000Z") });
    const later: HeldReading = {
      profileSlug: "codex",
      collectionSlug: "eng",
      credentialSlug: "review",
      id: "20260903T090000Z",
      fileStem: held.fileStem,
      reading: jevAt(0.9, await current(), "2026-09-01T09:05:00.000Z"),
    };
    const storage = storageWith({ credentials: [graded], profiles: [opus, codex], held: [held], heldReadings: [later] });
    open(storage, take("codex", 2));
    await screen.findByRole("heading", { name: "Codex agent", level: 2 });
    await waitFor(() => expect(savedReading("Jev's reading, meets overall")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(stepTitle()).toBe("Which points did it miss");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Which points did it miss", level: 3 }));
    await userEvent.click(screen.getByRole("button", { name: POINTS[1] }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Jev called it meets. You said Not yet.")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "Reason" }), "No fix offered");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(bar()).getByText("Not met")).toBeTruthy());
    const saved = storage.file(assessmentPath("codex", "eng", "review", held.fileStem))!;
    expect(saved).toMatch(/^missed_points:\n\s+- Suggests a fix\.$/m);
    expect(saved).toMatch(/## Note\n\nNo fix offered\n/);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Codex agent", level: 2 }));
  });

  it("with a step open, Escape goes back a card and then to the actions, and closes the view only after", async () => {
    const held = await heldReply(codex, graded, { ...heldDay(2), jev: jevAt(0.9, await current()) });
    open(storageWith({ credentials: [graded], profiles: [opus, codex], held: [held] }), take("codex", 2));
    await screen.findByRole("heading", { name: "Codex agent", level: 2 });
    await waitFor(() => expect(builds.last).not.toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Not yet" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await userEvent.keyboard("{Escape}");
    expect(stepTitle()).toBe("Which points did it miss");
    await userEvent.keyboard("{Escape}");
    expect(stepTitle()).toBeNull();
    expect(screen.getByRole("button", { name: "Not yet" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
  });

  it("a Met result offers Change to Not yet; with no reading it records at once, and the reply says Changed from Met", async () => {
    const storage = storageWith({ credentials: [graded], profiles: [opus, codex], assessments: [await result(opus, graded, day(1))] });
    open(storage);
    await screen.findByRole("heading", { name: "Opus agent", level: 2 });
    expect(screen.queryByRole("button", { name: "Met" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Change to Not yet" }));
    await waitFor(() => expect(within(bar()).getByText("Not met")).toBeTruthy());
    expect(stepTitle()).toBeNull();
    expect(screen.getByText("Changed from Met")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change to Met" })).toBeTruthy();
    expect(Object.keys(storage.files()).filter((p) => p.startsWith(`${rejudgedDir("opus", "eng", "review")}/`))).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Opus agent", level: 2 }));
  });

  it("a Met result whose reading called it meets opens the step on Change to Not yet", async () => {
    const storage = storageWith({ credentials: [graded], profiles: [opus, codex], assessments: [await result(opus, graded, { ...day(1), jev: jevAt(0.9, await current()) })] });
    open(storage);
    await screen.findByRole("heading", { name: "Opus agent", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Change to Not yet" }));
    expect(stepTitle()).toBe("Which points did it miss");
    expect(screen.queryByRole("button", { name: "Change to Not yet" })).toBeNull();
  });

  it("a Not met result whose reading called it misses opens only the reason card on Change to Met", async () => {
    const storage = storageWith({
      credentials: [graded],
      profiles: [opus, codex],
      assessments: [await result(opus, graded, { ...day(1), result: "not_met", jev: jevAt(0.1, await current()) })],
    });
    open(storage);
    await screen.findByRole("heading", { name: "Opus agent", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Change to Met" }));
    expect(stepTitle()).toBe("What did Jev miss");
    expect(screen.getByText("Jev called it misses. You said Met.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(bar()).getByText("Met")).toBeTruthy());
    expect(screen.getByText("Changed from Not met")).toBeTruthy();
  });
});
