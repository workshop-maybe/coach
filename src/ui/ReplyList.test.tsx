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
import type { Route } from "./routes";
import { opus, result, review, storageWith } from "./testFolder";

afterEach(cleanup);

const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5", effort: "medium" };
const a: Handoff = { id: "a", collectionSlug: "eng", credentialSlug: "review", text: "# A\n\n{{task}}\n" };
const ran = { id: "a", text: "Filled handoff A" };

async function setup(assessments: Assessment[], lit?: string) {
  const state = await loadFolder(storageWith({ credentials: [review], profiles: [opus, codex], handoffs: [a], assessments }));
  const matrix = await buildMatrix(state);
  const run = handoffRuns(matrix, state, "eng/review").runs[0];
  const navigate = vi.fn<(r: Route) => void>();
  render(
    <NavContext.Provider value={{ route: { view: "home" }, navigate }}>
      <ReplyList credentialKey="eng/review" run={run} state={state} matrix={matrix} lit={lit} />
    </NavContext.Provider>,
  );
  return { navigate };
}

const day = (n: number) => ({ fileStem: `2026090${n}T090000Z`, recordedAt: `2026-09-0${n}T09:00:00.000Z` });

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

  it("a closed row shows the reply's opening lines, and opening it shows the whole reply and the text that ran", async () => {
    await setup(await twoAgents());
    const opusRow = screen.getAllByRole("listitem")[1];
    expect(within(opusRow).getByText(/Opus found two bugs/).textContent).not.toContain("Line 4 hidden");
    await userEvent.click(within(opusRow).getByRole("button", { expanded: false }));
    const body = within(opusRow).getByRole("region");
    expect(within(body).getByText(/Line 4 hidden/)).toBeTruthy();
    expect(within(body).getByText("Handoff A")).toBeTruthy();
    expect(within(body).getByText("Filled handoff A")).toBeTruthy();
  });

  it("shows a note only when the result has one", async () => {
    const [first, second] = await twoAgents();
    await setup([{ ...first, note: "Missed the race." }, second]);
    for (const head of screen.getAllByRole("button", { expanded: false })) await userEvent.click(head);
    expect(screen.getAllByText("Missed the race.")).toHaveLength(1);
  });

  it("an agent's older take sits under its row and opens", async () => {
    await setup([
      await result(opus, review, { ...day(1), handoff: ran, result: "not_met", handBack: "First try" }),
      await result(opus, review, { ...day(2), handoff: ran, handBack: "Second try" }),
    ]);
    const older = within(screen.getAllByRole("listitem")[0]).getAllByRole("listitem");
    expect(older).toHaveLength(1);
    await userEvent.click(within(older[0]).getByRole("button", { expanded: false }));
    expect(within(older[0]).getByText("First try")).toBeTruthy();
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

  it("Test again opens the test for that agent and badge", async () => {
    const { navigate } = await setup(await twoAgents());
    await userEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: "Test again" }));
    expect(navigate).toHaveBeenCalledWith({ view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review" });
  });

  it("the lit agent's row is marked as the one the view is about", async () => {
    await setup(await twoAgents(), "opus");
    const [codexRow, opusRow] = screen.getAllByRole("listitem");
    expect(opusRow.className).toContain("lit");
    expect(opusRow.getAttribute("aria-current")).toBe("true");
    expect(codexRow.className).not.toContain("lit");
  });
});
