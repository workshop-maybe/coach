// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadFolder } from "../domain/folder";
import { handoffRuns } from "../domain/handoffResults";
import { buildMatrix } from "../domain/matrix";
import type { Assessment, Handoff, HeldReply } from "../domain/types";
import { formatDate } from "./format";
import { NavContext } from "./nav";
import { ReplyList } from "./ReplyList";
import type { ReplyListState, Route, TakeRef } from "./routes";
import { heldReply, opus, result, review, storageWith } from "./testFolder";

afterEach(cleanup);

const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5", effort: "medium" };
const a: Handoff = { id: "a", collectionSlug: "eng", credentialSlug: "review", text: "# A\n\n{{task}}\n" };
const ran = { id: "a", text: "Filled handoff A" };

async function setup(assessments: Assessment[], back: ReplyListState = {}, held: HeldReply[] = []) {
  const state = await loadFolder(storageWith({ credentials: [review], profiles: [opus, codex], handoffs: [a], assessments, held }));
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
const heldDay = (n: number) => ({ fileStem: day(n).fileStem, heldAt: day(n).recordedAt });
const take = (slug: string, n: number): TakeRef => ({ profileSlug: slug, fileStem: day(n).fileStem });
/** The take a pick box names, from its label "Pick <agent>, <date>": the agent by name, the day from the date. */
function refFromLabel(box: HTMLInputElement): TakeRef {
  const label = box.getAttribute("aria-label")!;
  const slug = label.startsWith("Pick Opus") ? "opus" : "codex";
  const n = [1, 2, 3, 4, 5].find((d) => label.endsWith(formatDate(day(d).recordedAt)))!;
  return take(slug, n);
}
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
    // A pick box keeps its own look: it is no text field, so it takes no drawn field edge.
    expect(screen.getAllByRole("checkbox").some((b) => b.closest(".field"))).toBe(false);
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

  it("Covers AE4. Any number of takes, held and judged, can be picked, and Compare sends them all in pick order", async () => {
    const { navigate } = await setup(
      [...(await twoAgents()), await result(opus, review, { ...day(3), handoff: ran, handBack: "Third" })],
      {},
      [await heldReply(codex, review, { ...heldDay(4), handoff: ran }), await heldReply(opus, review, { ...heldDay(5), handoff: ran })],
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(5);
    for (const box of boxes) await userEvent.click(box);
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, true, true, true]);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const route = navigate.mock.calls[navigate.mock.calls.length - 1][0] as { takes: TakeRef[] };
    expect(route.takes).toHaveLength(5);
    expect(route.takes).toEqual(boxes.map((b) => refFromLabel(b as HTMLInputElement)));
  });

  it("Covers AE2. A held take is marked Held in its handoff's list, beside judged takes", async () => {
    await setup(await twoAgents(), {}, [await heldReply(codex, review, { ...heldDay(3), handoff: ran, handBack: "Held reply text" })]);
    const codexRow = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-label") === "Codex agent")!;
    expect(within(codexRow).getByText("Held")).toBeTruthy();
    expect(within(codexRow).getByText(/Held reply text/)).toBeTruthy();
    expect(within(codexRow).getByText("Not met")).toBeTruthy();
  });

  it("two held takes by one agent on one day have distinct pick labels", async () => {
    await setup([], {}, [
      await heldReply(codex, review, { fileStem: "20260903T090000Z", heldAt: "2026-09-03T09:00:00.000Z", handoff: ran }),
      await heldReply(codex, review, { fileStem: "20260903T150000Z", heldAt: "2026-09-03T15:00:00.000Z", handoff: ran }),
    ]);
    const labels = screen.getAllByRole("checkbox").map((b) => b.getAttribute("aria-label"));
    expect(new Set(labels).size).toBe(2);
  });

  it("Covers AE5. Compare goes to the compare of the two picked takes, carrying them as the picks", async () => {
    const { navigate } = await setup(await twoAgents());
    await userEvent.click(screen.getByRole("checkbox", { name: /Pick Opus agent/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Pick Codex agent/ }));
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const both = [take("opus", 1), take("codex", 2)];
    expect(navigate).toHaveBeenCalledWith({ view: "item", item: "compare", credentialKey: "eng/review", takes: both, picks: both });
    // Nothing opens in place: the two replies are the compare view's.
    expect(screen.queryByRole("region", { name: "Compare replies" })).toBeNull();
    expect(screen.queryByText(/Line 4 hidden/)).toBeNull();
  });

  it("two takes from one agent go to the compare in the order they were picked", async () => {
    const { navigate } = await setup([
      await result(opus, review, { ...day(1), handoff: ran, result: "not_met", handBack: "First try" }),
      await result(opus, review, { ...day(2), handoff: ran, handBack: "Second try" }),
    ]);
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const both = [take("opus", 2), take("opus", 1)];
    expect(navigate).toHaveBeenCalledWith({ view: "item", item: "compare", credentialKey: "eng/review", takes: both, picks: both });
  });

  it("back from the compare, both takes are still picked and Compare has focus", async () => {
    const both = [take("opus", 1), take("codex", 2)];
    await setup(await twoAgents(), { picks: both, focusCompare: true });
    const compare = screen.getByRole("button", { name: "Compare" });
    expect(document.activeElement).toBe(compare);
    expect(screen.getAllByRole("checkbox").map((b) => (b as HTMLInputElement).checked)).toEqual([true, true]);
    expect(screen.queryAllByRole("listitem").some((li) => li.getAttribute("aria-current") === "true")).toBe(false);
  });

  it("back from the compare with one take gone, the other stays picked, Compare asks for two again and takes no focus", async () => {
    await setup(await twoAgents(), { picks: [take("opus", 9), take("codex", 2)], focusCompare: true });
    const button = screen.getByRole("button", { name: "Pick two to compare" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.activeElement).not.toBe(button);
    expect((screen.getByRole("checkbox", { name: /Pick Codex agent/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("Escape is not the list's: it passes to the item that holds it", async () => {
    await setup(await twoAgents(), { picks: [take("opus", 1), take("codex", 2)], focusCompare: true });
    const seen: boolean[] = [];
    const after = (e: KeyboardEvent) => seen.push(e.defaultPrevented);
    window.addEventListener("keydown", after);
    await userEvent.keyboard("{Escape}");
    window.removeEventListener("keydown", after);
    expect(seen).toEqual([false]);
  });

  it("a reload that drops a picked take before Compare disables it", async () => {
    const { reload } = await setup(await twoAgents());
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    reload("opus");
    expect((screen.getByRole("button", { name: "Pick two to compare" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Test again opens the test for that agent and badge, with the run's handoff lit", async () => {
    const { navigate } = await setup(await twoAgents());
    await userEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: "Test again" }));
    expect(navigate).toHaveBeenCalledWith({ view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review", handoffId: "a" });
  });

  it("the lit agent's row is marked as the one the view is about", async () => {
    await setup(await twoAgents(), { lit: "opus" });
    const [codexRow, opusRow] = screen.getAllByRole("listitem");
    expect(opusRow.className).toContain("lit");
    expect(opusRow.getAttribute("aria-current")).toBe("true");
    expect(codexRow.className).not.toContain("lit");
  });

  it("a reply whose first item is a video previews the video's name", async () => {
    await setup([
      await result(opus, review, {
        ...day(1),
        handoff: ran,
        handBack: "",
        items: [
          { kind: "video", name: "demo.mp4", ref: "video-1a2b3c4d.mp4" },
          { kind: "link", url: "https://example.com" },
        ],
      }),
    ]);
    const row = screen.getAllByRole("listitem")[0];
    expect(row.querySelector(".take-preview")?.textContent).toBe("demo.mp4");
  });
});
