// @vitest-environment jsdom
// The grid above compare's panes (jev-in-compare U6, R6-R9, KTD6, KTD7, KTD13): it takes the
// strip's place once Jev has anything current for the badge, with the strip's chips as its
// column headers, the badge's points, learning targets and Overall down the side, calls read
// with the badge's pair, and head-to-head marks where both orders agree.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { profilePath } from "../domain/folder";
import { assignmentVersion } from "../domain/hash";
import { JEV_MODEL, type JevAnswers } from "../domain/jevRequest";
import type { AgentProfile, Assessment, Credential, HeadToHead, HeldReply, JevReading } from "../domain/types";
import { FAKE_ON, FakeJev } from "../jev/fakeJev";
import type { MemoryStorage } from "../storage/memory";
import { formatDate } from "./format";
import type { TakeRef } from "./routes";
import { heldReply, opus, renderApp, renderWithJev, result, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const POINTS = ["Finds the bug.", "Suggests a fix."];
const TARGET = "I can find bugs in a diff.";
const badge: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: [TARGET],
  task: "Review the attached diff.",
  rubric: POINTS.map((p) => `- ${p}`).join("\n"),
  extraSections: [],
};
const claude: AgentProfile = { ...opus, slug: "claude", name: "Claude Code" };
const codex: AgentProfile = { ...opus, slug: "codex", name: "Codex", harness: "codex", model: "gpt-5", effort: "medium" };
const gemini: AgentProfile = { ...opus, slug: "gemini", name: "Gemini", model: "gemini" };

const stem = (n: number) => `2026090${n}T090000Z`;
const at = (n: number) => `2026-09-0${n}T09:00:00.000Z`;
const ref = (p: AgentProfile, n: number): TakeRef => ({ profileSlug: p.slug, fileStem: stem(n) });
const version = () => assignmentVersion(badge.task, badge.rubric);

/** A reading at the badge's current version (or `v`), every point, the target and the overall at `p`. */
async function reading(p: number, v?: string): Promise<JevReading> {
  return {
    model: JEV_MODEL,
    assignmentVersion: v ?? (await version()),
    askedAt: "2026-09-09T09:00:00.000Z",
    seen: "before",
    overall: p,
    points: POINTS.map((text) => ({ text, probability: p })),
    targets: [{ text: TARGET, probability: p }],
    examplesSent: 0,
  };
}

const held = (p: AgentProfile, n: number, jev?: JevReading) => heldReply(p, badge, { fileStem: stem(n), heldAt: at(n), handBack: `${p.name} replied.`, ...(jev ? { jev } : {}) });

/** A head-to-head at the current version: `first` and `second` by agent and day, one [firstOver, secondOver] per point. */
async function pair(id: number, first: [AgentProfile, number], second: [AgentProfile, number], answers: [number, number][]): Promise<HeadToHead> {
  return {
    collectionSlug: "eng",
    credentialSlug: "review",
    id: stem(id),
    model: JEV_MODEL,
    assignmentVersion: await version(),
    askedAt: at(id),
    first: { profileSlug: first[0].slug, fileStem: stem(first[1]) },
    second: { profileSlug: second[0].slug, fileStem: stem(second[1]) },
    points: POINTS.map((text, i) => ({ text, firstOver: answers[i][0], secondOver: answers[i][1] })),
  };
}

function folder(opts: { held?: HeldReply[]; assessments?: Assessment[]; headToHeads?: HeadToHead[]; profiles?: AgentProfile[] }) {
  return storageWith({ credentials: [badge], profiles: opts.profiles ?? [claude, codex, gemini], held: opts.held, assessments: opts.assessments, headToHeads: opts.headToHeads });
}

const route = (takes: TakeRef[]) => ({ view: "item" as const, item: "compare" as const, credentialKey: "eng/review", takes, picks: takes });
const open = (storage: MemoryStorage, takes: TakeRef[]) => renderApp(storage, route(takes));

const table = () => screen.getByRole("table", { name: "Jev's calls" });
/** The grid's column headers' chips, in order. */
const headers = () => within(table()).getAllByRole("button");
const header = (name: RegExp) => within(table()).getByRole("button", { name });
/** The cell in row `row` under the `column`th reply. */
function cell(row: string, column: number): HTMLElement {
  const tr = within(table()).getByRole("rowheader", { name: row }).closest("tr")!;
  return within(tr).getAllByRole("cell")[column];
}
const rowNames = () => within(table()).getAllByRole("rowheader").map((h) => h.textContent);
const panes = () => within(screen.getByRole("region", { name: "Compare replies" })).getAllByRole("article");
const openNames = () => panes().map((p) => within(p).getByRole("heading", { level: 2 }).textContent);

describe("CompareGrid", () => {
  it("with no current reading and no current head-to-head, the strip shows and no table does", async () => {
    const old = await reading(0.9, "an-older-version");
    open(folder({ held: [await held(claude, 1, old), await held(codex, 2)] }), [ref(claude, 1), ref(codex, 2)]);
    expect(await screen.findByRole("list", { name: "Replies" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("region", { name: "Jev's calls" })).toBeNull();
  });

  it("with a current reading, the first render after the version resolves is the table, and the strip never shows", async () => {
    const storage = folder({ held: [await held(claude, 1, await reading(0.9)), await held(codex, 2)] });
    let stripShown = false;
    const watch = new MutationObserver(() => {
      if (document.querySelector(".compare-strip")) stripShown = true;
    });
    watch.observe(document.body, { childList: true, subtree: true });
    open(storage, [ref(claude, 1), ref(codex, 2)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    watch.disconnect();
    expect(stripShown).toBe(false);
    // The panes showed without waiting for it.
    expect(openNames()).toEqual(["Claude Code", "Codex"]);
  });

  it("is a named table in a named, keyboard-focusable scroll box, its headers carrying scope", async () => {
    open(folder({ held: [await held(claude, 1, await reading(0.9)), await held(codex, 2)] }), [ref(claude, 1), ref(codex, 2)]);
    const box = await screen.findByRole("region", { name: "Jev's calls" });
    expect(box.tabIndex).toBe(0);
    expect(within(box).getByRole("table", { name: "Jev's calls" })).toBeTruthy();
    const columnHeads = [...table().querySelectorAll("thead th")].filter((th) => th.textContent !== "");
    expect(columnHeads.map((th) => th.getAttribute("scope"))).toEqual(["col", "col"]);
    expect([...table().querySelectorAll("tbody th")].every((th) => th.getAttribute("scope") === "row")).toBe(true);
    // Points, the learning target and Overall, in that order.
    expect(rowNames()).toEqual([...POINTS, TARGET, "Overall"]);
    expect(box.querySelectorAll("tbody")).toHaveLength(3);
  });

  it("each column header is the strip's chip: agent, setup, state and date, the open pair pressed", async () => {
    open(folder({ held: [await held(claude, 1, await reading(0.9)), await held(codex, 2), await held(gemini, 3)] }), [ref(claude, 1), ref(codex, 2), ref(gemini, 3)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    expect(headers()).toHaveLength(3);
    expect(header(/Codex/).textContent).toContain("codex · gpt-5 · medium");
    expect(header(/Codex/).textContent).toContain("Held");
    expect(header(/Codex/).textContent).toContain(formatDate(at(2)));
    expect(headers().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "true", "false"]);
  });

  it("a cell holds the call in words and the percent, and a reading missing a row leaves it blank", async () => {
    const partial = { ...(await reading(0.9)), targets: [], points: [{ text: POINTS[0], probability: 0.2 }, { text: "Some other point.", probability: 0.9 }] };
    open(folder({ held: [await held(claude, 1, await reading(0.94)), await held(codex, 2, partial)] }), [ref(claude, 1), ref(codex, 2)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    expect(cell(POINTS[0], 0).textContent).toBe("Meets 94%");
    expect(cell(POINTS[0], 0).querySelector(".jev-call")?.textContent).toBe("Meets");
    expect(cell(POINTS[0], 0).querySelector(".jev-p")?.textContent).toBe("94%");
    expect(cell(POINTS[0], 1).textContent).toBe("Misses 20%");
    expect(cell(POINTS[1], 1).textContent).toBe("");
    expect(cell(TARGET, 1).textContent).toBe("");
    expect(cell("Overall", 1).textContent).toBe("Meets 90%");
  });

  it("with only a head-to-head and no current reading, the table has point rows and no target or overall rows", async () => {
    const h = await pair(5, [claude, 1], [codex, 2], [[0.9, 0.1], [0.5, 0.5]]);
    open(folder({ held: [await held(claude, 1), await held(codex, 2)], headToHeads: [h] }), [ref(claude, 1), ref(codex, 2)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    expect(rowNames()).toEqual(POINTS);
    expect(cell(POINTS[0], 0).textContent).toBe("Better than Codex");
    expect(cell(POINTS[0], 1).textContent).toBe("");
  });

  it("Covers AE2. Codex over Claude Code on point 2 in both orders marks Codex's cell; point 1, where the orders disagree, marks neither", async () => {
    // Asked with Claude Code first: point 1 reads yes both ways, point 2 says Codex in both orders.
    const h = await pair(5, [claude, 1], [codex, 2], [[0.9, 0.8], [0.1, 0.9]]);
    open(folder({ held: [await held(claude, 1), await held(codex, 2)], headToHeads: [h] }), [ref(claude, 1), ref(codex, 2)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    expect(cell(POINTS[1], 1).textContent).toBe("Better than Claude Code");
    expect(cell(POINTS[1], 0).textContent).toBe("");
    expect(cell(POINTS[0], 0).textContent).toBe("");
    expect(cell(POINTS[0], 1).textContent).toBe("");
  });

  it("names every reply a cell covers the point better than, after its call", async () => {
    const pairs = [await pair(5, [claude, 1], [codex, 2], [[0.9, 0.1], [0.5, 0.5]]), await pair(6, [claude, 1], [gemini, 3], [[0.9, 0.1], [0.5, 0.5]])];
    open(folder({ held: [await held(claude, 1, await reading(0.94)), await held(codex, 2), await held(gemini, 3)], headToHeads: pairs }), [
      ref(claude, 1),
      ref(codex, 2),
      ref(gemini, 3),
    ]);
    await screen.findByRole("table", { name: "Jev's calls" });
    expect(cell(POINTS[0], 0).textContent).toBe("Meets 94% Better than Codex and Gemini");
    expect(cell("Overall", 0).textContent).toBe("Meets 94%");
  });

  it("Covers AE7. a judged reply with no reading has blank cells, and the cell of a reply that beat it names it", async () => {
    const judged = await result(claude, badge, { fileStem: stem(1), recordedAt: at(1), result: "met" });
    const h = await pair(5, [codex, 2], [claude, 1], [[0.9, 0.1], [0.5, 0.5]]);
    open(folder({ assessments: [judged], held: [await held(codex, 2, await reading(0.94))], headToHeads: [h] }), [ref(claude, 1), ref(codex, 2)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    for (const row of [...POINTS, TARGET, "Overall"]) expect(cell(row, 0).textContent).toBe("");
    expect(cell(POINTS[0], 1).textContent).toBe("Meets 94% Better than Claude Code");
  });

  it("a held reply's reading from an older version shows nothing in the grid, while its folded reading still shows", async () => {
    open(folder({ held: [await held(claude, 1, await reading(0.94)), await held(codex, 2, await reading(0.12, "an-older-version"))] }), [ref(claude, 1), ref(codex, 2)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    for (const row of [...POINTS, TARGET, "Overall"]) expect(cell(row, 1).textContent).toBe("");
    expect(within(panes()[1]).getByText("Jev's reading, misses overall", { selector: "summary" })).toBeTruthy();
  });

  it("two takes by one agent are named by agent and date in marks", async () => {
    const h = await pair(5, [claude, 1], [claude, 2], [[0.1, 0.9], [0.5, 0.5]]);
    open(folder({ held: [await held(claude, 1), await held(claude, 2)], headToHeads: [h] }), [ref(claude, 1), ref(claude, 2)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    expect(cell(POINTS[0], 1).textContent).toBe(`Better than Claude Code, ${formatDate(at(1))}`);
  });

  it("calls read with the badge's fitted pair: a 65% reading reads Meets once the pair is 40/60", async () => {
    // Eight judged readings: the fit reads 61% as meets and 39% as misses, so it lands on 40/60.
    const judged = await Promise.all(
      (
        [
          [0.61, "met"],
          [0.61, "met"],
          [0.8, "met"],
          [0.9, "met"],
          [0.39, "not_met"],
          [0.39, "not_met"],
          [0.1, "not_met"],
          [0.2, "not_met"],
        ] as const
      ).map(([overall, verdict], i) =>
        result(gemini, badge, { fileStem: `2026080${i + 1}T090000Z`, recordedAt: `2026-08-0${i + 1}T09:00:00.000Z`, result: verdict, jev: { model: JEV_MODEL, assignmentVersion: "v0", askedAt: at(1), seen: "before", overall, points: [] } }),
      ),
    );
    const sixtyFive = { ...(await reading(0.65)), points: [{ text: POINTS[0], probability: 0.65 }, { text: POINTS[1], probability: 0.58 }] };
    open(folder({ assessments: judged, held: [await held(claude, 1, sixtyFive), await held(codex, 2)] }), [ref(claude, 1), ref(codex, 2)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    expect(cell("Overall", 0).textContent).toBe("Meets 65%");
    expect(cell(POINTS[0], 0).textContent).toBe("Meets 65%");
    // 58% sits inside 40/60, where a 55 cut-off would have read it meets.
    expect(cell(POINTS[1], 0).textContent).toBe("Can't call 58%");
    // Under the default 30/70 the same reading is can't call; 61% would be too.
    expect(within(panes()[0]).getByText("Jev's reading, meets overall", { selector: "summary" })).toBeTruthy();
  });

  it("clicking a closed column's header opens it on the right; clicking the right one swaps; the left stays", async () => {
    open(folder({ held: [await held(claude, 1, await reading(0.9)), await held(codex, 2), await held(gemini, 3)] }), [ref(claude, 1), ref(codex, 2), ref(gemini, 3)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    await userEvent.click(header(/Gemini/));
    expect(openNames()).toEqual(["Claude Code", "Gemini"]);
    expect(document.activeElement).toBe(header(/Gemini/));
    await userEvent.click(header(/Gemini/));
    expect(openNames()).toEqual(["Gemini", "Claude Code"]);
    await userEvent.click(header(/Gemini/));
    expect(openNames()).toEqual(["Gemini", "Claude Code"]);
    expect(headers().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "true"]);
  });

  it("a take that leaves the folder on a reload drops its column without an error", async () => {
    const storage = folder({ held: [await held(claude, 1, await reading(0.9)), await held(codex, 2), await held(gemini, 3)] });
    open(storage, [ref(claude, 1), ref(codex, 2), ref(gemini, 3)]);
    await screen.findByRole("table", { name: "Jev's calls" });
    storage.remove(profilePath("gemini"));
    fireEvent.focus(window);
    await waitFor(() => expect(headers()).toHaveLength(2));
    expect(within(table()).getAllByRole("cell").length).toBe(2 * (POINTS.length + 2));
  });
});

// The strip turning into the grid while Jev answers (KTD13's focus rules).
describe("CompareGrid during a run", () => {
  /** Every id a reading or a head-to-head on the badge asks for. */
  const ANSWERS = { p1: 0.9, p2: 0.9, t1: 0.9, overall: 0.9, a1: 0.5, a2: 0.5, b1: 0.5, b2: 0.5 };

  async function twoHeld() {
    return folder({ held: [await held(claude, 1), await held(codex, 2)] });
  }

  it("when the first saved answer turns the strip into the table, a focused chip's take keeps the focus as its column header", async () => {
    const fake = new FakeJev(FAKE_ON, ANSWERS);
    let answer!: (a: JevAnswers) => void;
    fake.queue("ask", new Promise<JevAnswers>((resolve) => (answer = resolve)));
    renderWithJev(await twoHeld(), fake, route([ref(claude, 1), ref(codex, 2)]));
    await userEvent.click(await screen.findByRole("button", { name: "Compare with Jev" }));
    const chip = within(screen.getByRole("list", { name: "Replies" })).getByRole("button", { name: /Codex/ });
    act(() => chip.focus());
    expect(document.activeElement).toBe(chip);
    await act(async () => answer({ answers: ANSWERS, model: JEV_MODEL }));
    await screen.findByRole("table", { name: "Jev's calls" });
    expect(screen.queryByRole("list", { name: "Replies" })).toBeNull();
    expect(document.activeElement).toBe(header(/Codex/));
    // The run goes on to its end and leaves the focus where it is.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Asking Jev/ })).toBeNull());
    expect(document.activeElement).toBe(header(/Codex/));
  });

  it("when a run ends and the action leaves, the focus goes to the first column header", async () => {
    const fake = new FakeJev(FAKE_ON, ANSWERS);
    renderWithJev(await twoHeld(), fake, route([ref(claude, 1), ref(codex, 2)]));
    await userEvent.click(await screen.findByRole("button", { name: "Compare with Jev" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Compare with Jev|Asking Jev/ })).toBeNull());
    expect(fake.asks).toHaveLength(3);
    expect(document.activeElement).toBe(headers()[0]);
    expect(headers()[0].textContent).toContain("Claude Code");
  });
});
