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

  it("Escape in the compare closes the compare and keeps the handoff open", async () => {
    open(await multi());
    await screen.findByRole("heading", { name: "Handoff A" });
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByRole("region", { name: "Compare replies" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Compare replies" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Handoff A" })).toBeTruthy();
  });

  it("lights the agent the route names", async () => {
    open(await multi(), { lit: "opus" });
    await screen.findByRole("heading", { name: "Handoff A" });
    const lit = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "true");
    expect(lit?.getAttribute("aria-label")).toBe("Opus agent");
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
