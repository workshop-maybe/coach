// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadFolder } from "../domain/folder";
import { handoffRuns } from "../domain/handoffResults";
import { buildMatrix } from "../domain/matrix";
import type { Assessment, Handoff } from "../domain/types";
import { NavContext } from "./nav";
import { ReplyList } from "./ReplyList";
import type { ReplyListState, Route, TakeRef } from "./routes";
import { opus, result, review, storageWith } from "./testFolder";

afterEach(cleanup);

const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5", effort: "medium" };
const a: Handoff = { id: "a", collectionSlug: "eng", credentialSlug: "review", text: "# A\n\n{{task}}\n" };
const ran = { id: "a", text: "Filled handoff A" };

async function setup(assessments: Assessment[], back: ReplyListState = {}) {
  const state = await loadFolder(storageWith({ credentials: [review], profiles: [opus, codex], handoffs: [a], assessments }));
  const matrix = await buildMatrix(state);
  const run = handoffRuns(matrix, state, "eng/review").runs[0];
  const navigate = vi.fn<(r: Route) => void>();
  const list = (r: typeof run) => (
    <NavContext.Provider value={{ route: { view: "home" }, navigate }}>
      <ReplyList credentialKey="eng/review" run={r} state={state} matrix={matrix} {...back} />
    </NavContext.Provider>
  );
  const { rerender } = render(list(run));
  /** Shows the list again as a folder reload would, with some agents' takes gone. */
  const reload = (without: string) => rerender(list({ ...run, agents: run.agents.filter((e) => e.profile.slug !== without) }));
  return { navigate, reload };
}

const day = (n: number) => ({ fileStem: `2026090${n}T090000Z`, recordedAt: `2026-09-0${n}T09:00:00.000Z` });
const take = (slug: string, n: number): TakeRef => ({ profileSlug: slug, fileStem: day(n).fileStem });
/** The button that opens a take: the row's own, or an older take's under it. */
const head = (el: HTMLElement) => el.querySelector<HTMLButtonElement>("button.take-head")!;
const replyTo = (at: TakeRef, picks?: TakeRef[]) => ({ view: "item", item: "reply", credentialKey: "eng/review", take: at, ...(picks ? { picks } : {}) });

async function twoAgents() {
  return [
    await result(opus, review, { ...day(1), handoff: ran, handBack: "Opus found two bugs.\nLine 2\nLine 3\nLine 4 hidden" }),
    await result(codex, review, { ...day(2), handoff: ran, result: "not_met", handBack: "Codex wrote a plan instead." }),
  ];
}

describe("ReplyList", () => {
  it("lists one row per agent, Met and Not met, newest latest result first", async () => {
    await setup(await twoAgents());
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("aria-label"))).toEqual(["Codex agent", "Opus agent"]);
    expect(within(items[0]).getByText("Not met")).toBeTruthy();
    expect(within(items[1]).getByText("Met")).toBeTruthy();
  });

  it("a row shows the reply's opening lines, and clicking it opens that take's reply view", async () => {
    const { navigate } = await setup(await twoAgents());
    const opusRow = screen.getAllByRole("listitem")[1];
    expect(within(opusRow).getByText(/Opus found two bugs/).textContent).not.toContain("Line 4 hidden");
    expect(head(opusRow).hasAttribute("aria-expanded")).toBe(false);
    await userEvent.click(head(opusRow));
    expect(navigate).toHaveBeenCalledWith(replyTo(take("opus", 1)));
    // Nothing opens in place: the reply and the text that ran are the reply view's.
    expect(screen.queryByText(/Line 4 hidden/)).toBeNull();
    expect(screen.queryByText("Filled handoff A")).toBeNull();
  });

  it("opening a take carries the current picks with it", async () => {
    const { navigate } = await setup(await twoAgents());
    await userEvent.click(screen.getByRole("checkbox", { name: /Pick Codex agent/ }));
    await userEvent.click(head(screen.getAllByRole("listitem")[1]));
    expect(navigate).toHaveBeenCalledWith(replyTo(take("opus", 1), [take("codex", 2)]));
  });

  it("an agent's older take sits under its row and opens its own reply view", async () => {
    const { navigate } = await setup([
      await result(opus, review, { ...day(1), handoff: ran, result: "not_met", handBack: "First try" }),
      await result(opus, review, { ...day(2), handoff: ran, handBack: "Second try" }),
    ]);
    const older = within(screen.getAllByRole("listitem")[0]).getAllByRole("listitem");
    expect(older).toHaveLength(1);
    await userEvent.click(head(older[0]));
    expect(navigate).toHaveBeenCalledWith(replyTo(take("opus", 1)));
  });

  it("back from a reply, the picks are restored and the lit take's row has focus", async () => {
    await setup([...(await twoAgents()), await result(opus, review, { ...day(3), handoff: ran, handBack: "Third" })], {
      lit: "opus",
      litTake: day(1).fileStem,
      picks: [take("codex", 2)],
    });
    const [opusRow, codexRow] = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("aria-label"));
    expect(opusRow.getAttribute("aria-current")).toBe("true");
    const [older] = within(opusRow).getAllByRole("listitem");
    expect(document.activeElement).toBe(head(older));
    expect((within(codexRow).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByRole("checkbox").filter((b) => (b as HTMLInputElement).checked)).toHaveLength(1);
  });

  it("a carried-back take or pick that is gone focuses nothing and counts for nothing", async () => {
    await setup(await twoAgents(), { lit: "opus", litTake: "20990101T090000Z", picks: [take("opus", 9), take("codex", 2)] });
    expect(document.activeElement).toBe(document.body);
    expect((screen.getByRole("button", { name: "Pick two to compare" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Compare waits for two picks", async () => {
    await setup(await twoAgents());
    expect((screen.getByRole("button", { name: "Pick two to compare" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("checkbox", { name: /Pick Opus agent/ }));
    expect((screen.getByRole("button", { name: "Pick two to compare" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("checkbox", { name: /Pick Codex agent/ }));
    expect((screen.getByRole("button", { name: "Compare" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a third pick drops the oldest pick", async () => {
    await setup([...(await twoAgents()), await result(opus, review, { ...day(3), handoff: ran, handBack: "Third" })]);
    const boxes = screen.getAllByRole("checkbox");
    for (const box of boxes) await userEvent.click(box);
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, true, true]);
  });

  it("Covers AE5. Two takes from one agent open side by side, each pane naming agent, setup, verdict and date", async () => {
    await setup([
      await result(opus, review, { ...day(1), handoff: ran, result: "not_met", handBack: "First try" }),
      await result(opus, review, { ...day(2), handoff: ran, handBack: "Second try" }),
    ]);
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const panes = within(screen.getByRole("region", { name: "Compare replies" })).getAllByRole("article");
    expect(panes).toHaveLength(2);
    expect(within(panes[0]).getByText("Second try")).toBeTruthy();
    expect(within(panes[1]).getByText("First try")).toBeTruthy();
    expect(within(panes[1]).getByText("claude-code · opus · high")).toBeTruthy();
    expect(within(panes[1]).getByText("Not met")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to replies" }));
  });

  it("Escape in the compare goes back to the list and is handled there", async () => {
    await setup(await twoAgents());
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const seen: boolean[] = [];
    const after = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    window.addEventListener("keydown", after);
    await userEvent.keyboard("{Escape}");
    window.removeEventListener("keydown", after);
    expect(seen).toEqual([true]);
    expect(screen.queryByRole("region", { name: "Compare replies" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Compare" }));
  });

  it("a reload that drops a picked take closes the compare and asks for two again", async () => {
    const { reload } = await setup(await twoAgents());
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    reload("codex");
    expect(screen.queryByRole("region", { name: "Compare replies" })).toBeNull();
    expect((screen.getByRole("button", { name: "Pick two to compare" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a reload that drops a picked take before Compare disables it", async () => {
    const { reload } = await setup(await twoAgents());
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    reload("opus");
    expect((screen.getByRole("button", { name: "Pick two to compare" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Test again opens the test for that agent and badge", async () => {
    const { navigate } = await setup(await twoAgents());
    await userEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: "Test again" }));
    expect(navigate).toHaveBeenCalledWith({ view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review" });
  });

  it("the lit agent's row is marked as the one the view is about", async () => {
    await setup(await twoAgents(), { lit: "opus" });
    const [codexRow, opusRow] = screen.getAllByRole("listitem");
    expect(opusRow.className).toContain("lit");
    expect(opusRow.getAttribute("aria-current")).toBe("true");
    expect(codexRow.className).not.toContain("lit");
  });
});
