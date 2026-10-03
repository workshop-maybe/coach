// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BUILT_IN_HANDOFF } from "../domain/handoffs";
import type { Assessment, Handoff } from "../domain/types";
import type { Route } from "./routes";
import { opus, renderApp, result, review, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5" };
const a: Handoff = { id: "a", collectionSlug: "eng", credentialSlug: "review", text: "# A strict test\n\n{{task}}\n" };
const day = (n: number) => ({ fileStem: `2026090${n}T090000Z`, recordedAt: `2026-09-0${n}T09:00:00.000Z` });

/** A badge on which the skeleton and handoff A have both run. */
async function multi(): Promise<Assessment[]> {
  return [
    await result(opus, review, { ...day(1), handBack: "Opus on the skeleton" }),
    await result(opus, review, { ...day(2), handoff: { id: "a", text: "Filled A" }, handBack: "Opus on A" }),
    await result(codex, review, { ...day(3), handoff: { id: "a", text: "Filled A" }, result: "not_met", handBack: "Codex on A" }),
  ];
}

function open(assessments: Assessment[], route: Partial<Extract<Route, { item: "handoff" }>> = {}) {
  return renderApp(storageWith({ credentials: [review], profiles: [opus, codex], handoffs: [a], assessments }), {
    view: "item",
    item: "handoff",
    credentialKey: "eng/review",
    handoffId: "a",
    ...route,
  });
}

describe("HandoffDetail", () => {
  it("Covers F2. A handoff opens with its name, its text and every agent that ran it", async () => {
    open(await multi());
    expect(await screen.findByRole("heading", { name: "Handoff A" })).toBeTruthy();
    expect(screen.getByText(/# A strict test/)).toBeTruthy();
    const replies = within(screen.getByRole("region", { name: "Replies" }));
    expect(replies.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Codex agent", "Opus agent"]);
    expect(replies.queryByText(/Opus on the skeleton/)).toBeNull();
  });

  it("the skeleton's handoff is labeled as the current skeleton", async () => {
    open(await multi(), { handoffId: "skeleton" });
    expect(await screen.findByRole("heading", { name: "Skeleton" })).toBeTruthy();
    expect(screen.getByText("The current skeleton")).toBeTruthy();
    expect(screen.getByText(BUILT_IN_HANDOFF.split("\n")[0], { exact: false })).toBeTruthy();
  });

  it("Close and Escape go back to the badge, not home", async () => {
    open(await multi());
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Code review" })).toBeTruthy();
    cleanup();
    open(await multi());
    await screen.findByRole("heading", { name: "Handoff A" });
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "Code review" })).toBeTruthy();
  });

  it("Covers R17. Compare on a handoff page opens the full window, and Escape comes back to that handoff with both picked and Compare focused", async () => {
    open(await multi());
    await screen.findByRole("heading", { name: "Handoff A" });
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const compare = await screen.findByRole("region", { name: "Compare replies" });
    const panes = within(compare).getAllByRole("article");
    expect(within(panes[0]).getByText("Codex on A")).toBeTruthy();
    expect(within(panes[1]).getByText("Opus on A")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Handoff A" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "Handoff A", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Compare" })));
    expect(screen.getAllByRole("checkbox").map((b) => (b as HTMLInputElement).checked)).toEqual([true, true]);
  });

  it("the compare of two takes on an older run comes back to that run's page, not the agents' latest", async () => {
    const assessments = [
      await result(opus, review, { ...day(1), handBack: "Opus on the skeleton" }),
      await result(codex, review, { ...day(2), handBack: "Codex on the skeleton" }),
      await result(opus, review, { ...day(3), handoff: { id: "a", text: "Filled A" }, handBack: "Opus on A" }),
      await result(codex, review, { ...day(4), handoff: { id: "a", text: "Filled A" }, handBack: "Codex on A" }),
    ];
    open(assessments, { handoffId: "skeleton" });
    await screen.findByRole("heading", { name: "Skeleton" });
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    await screen.findByRole("region", { name: "Compare replies" });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Skeleton", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Compare" })));
  });

  it("lights the agent the route names", async () => {
    open(await multi(), { lit: "opus" });
    await screen.findByRole("heading", { name: "Handoff A" });
    const lit = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "true");
    expect(lit?.getAttribute("aria-label")).toBe("Opus agent");
  });

  it("Covers R16. A take opened on a handoff that is not its agent's latest closes back to that handoff, its row lit and focused, picks kept", async () => {
    open(await multi(), { handoffId: "skeleton" });
    await screen.findByRole("heading", { name: "Skeleton" });
    const replies = screen.getByRole("region", { name: "Replies" });
    const box = within(replies).getByRole("checkbox", { name: /Pick Opus agent/ });
    await userEvent.click(box);
    await userEvent.click(box.parentElement!.querySelector<HTMLButtonElement>("button.take-head")!);
    expect(await screen.findByRole("heading", { name: "Opus agent", level: 2 })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Reply" })).getByText("Opus on the skeleton")).toBeTruthy();
    await userEvent.keyboard("{Escape}");

    expect(await screen.findByRole("heading", { name: "Skeleton", level: 2 })).toBeTruthy();
    const back = screen.getByRole("region", { name: "Replies" });
    const lit = within(back).getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "true")!;
    expect(lit.getAttribute("aria-label")).toBe("Opus agent");
    expect(document.activeElement).toBe(lit.querySelector("button.take-head"));
    expect((within(back).getByRole("checkbox", { name: /Pick Opus agent/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("a handoff with no results on the badge is not found once the matrix loads", async () => {
    open([await result(opus, review, { ...day(1) })]);
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
  });

  it("an unknown badge is not found", async () => {
    open(await multi(), { credentialKey: "eng/gone" });
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
  });

  it("its main action starts a test with this handoff picked", async () => {
    open(await multi());
    await userEvent.click(await screen.findByRole("button", { name: "Test it on an agent" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Handoff A" })).toBeNull());
  });
});
