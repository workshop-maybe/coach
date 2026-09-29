// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { credentialPath, loadFolder } from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import { checkCriteriaPrompt, refineHandoffNote, reviewAssignmentPrompt } from "../domain/prompts";
import type { MemoryStorage } from "../storage/memory";
import { holdersOf, parseParam } from "./EditDecks";
import { opus, renderApp, result, review, snapshot, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(writeText).mockReset();
});
afterEach(cleanup);

const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5" };
const badge = { view: "item", item: "badge", credentialKey: "eng/review" } as const;

async function saved(storage: MemoryStorage, slug = "review") {
  const state = await loadFolder(storage);
  return state.credentials.find((c) => c.slug === slug)!;
}

const parts = () => screen.getByRole("list", { name: "Parts" });
const openPart = async (name: RegExp) => {
  await screen.findByRole("list", { name: "Parts" });
  await userEvent.click(within(parts()).getByRole("button", { name }));
};

describe("BadgeDetail", () => {
  it("shows the badge, its five parts, and only the agents that met it as holders", async () => {
    const storage = storageWith({
      credentials: [review],
      profiles: [opus, codex],
      assessments: [await result(opus, review), await result(codex, review, { result: "not_met" })],
    });
    renderApp(storage, badge);
    expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
    expect(document.querySelector(".detail-head svg.cast-cartridge")).not.toBeNull();
    const names = within(parts())
      .getAllByRole("button")
      .map((b) => b.querySelector(".part-name")?.textContent);
    expect(names).toEqual(["Name", "Learning targets", "Task", "Rubric", "Look"]);
    const holders = screen.getByRole("region", { name: "Holders" });
    expect(await within(holders).findByRole("button", { name: /Opus agent/ })).toBeTruthy();
    expect(within(holders).queryByRole("button", { name: /Codex agent/ })).toBeNull();
    // Holders are small machines, named in text beside them.
    expect(within(holders).getByRole("button", { name: /Opus agent/ }).querySelector("svg.cast-machine-mini")).not.toBeNull();
  });

  it("opening a holder shows its history, newest first", async () => {
    const older = await result(opus, review, { fileStem: "20260801T090000Z", recordedAt: "2026-08-01T09:00:00.000Z", result: "not_met", handBack: "First try" });
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [older, await result(opus, review)] });
    renderApp(storage, badge);
    const holder = await screen.findByRole("button", { name: /Opus agent/ });
    await userEvent.click(holder);
    const history = screen.getByRole("region", { name: "Opus agent results" });
    const items = within(history).getAllByRole("listitem");
    expect(items[0].textContent).toContain("Met");
    expect(items[1].textContent).toContain("Not met");
    expect(items[1].textContent).toContain("First try");
  });

  it("editing the task saves through updateCredential and returns to the badge", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, badge);
    await openPart(/^Task/);
    expect(await screen.findByRole("heading", { name: "The task" })).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "Task" });
    await userEvent.clear(box);
    await userEvent.type(box, "Review the diff twice.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("list", { name: "Parts" })).toBeTruthy();
    expect((await saved(storage)).task).toBe("Review the diff twice.");
  });

  it("the task card copies the review and handoff-note prompts, and the rubric card checks criteria", async () => {
    renderApp(storageWith({ credentials: [review] }), { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "task" });
    await userEvent.click(await screen.findByRole("button", { name: "Review this assignment" }));
    expect(writeText).toHaveBeenLastCalledWith(reviewAssignmentPrompt(review));
    await userEvent.click(screen.getByRole("button", { name: "Write a handoff note" }));
    expect(writeText).toHaveBeenLastCalledWith(refineHandoffNote(review));
    cleanup();

    renderApp(storageWith({ credentials: [review] }), { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "rubric" });
    await userEvent.type(await screen.findByRole("textbox", { name: "Rubric" }), "Finds the bug.");
    await userEvent.click(screen.getByRole("button", { name: "Check my criteria" }));
    expect(writeText).toHaveBeenLastCalledWith(checkCriteriaPrompt({ ...review, rubric: "Finds the bug." }));
  });

  it("a conflict shows Use theirs or Keep mine, and Keep mine writes mine", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "task" });
    const box = await screen.findByRole("textbox", { name: "Task" });
    storage.seed({ [credentialPath("eng", "review")]: serializeCredentialMd({ ...review, task: "Theirs." }) });
    await userEvent.clear(box);
    await userEvent.type(box, "Mine.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Changed on disk" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use theirs" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await screen.findByRole("list", { name: "Parts" });
    expect((await saved(storage)).task).toBe("Mine.");
  });

  it("Use theirs leaves the file on disk as it is", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "name" });
    const box = await screen.findByRole("textbox", { name: "Name" });
    storage.seed({ [credentialPath("eng", "review")]: serializeCredentialMd({ ...review, name: "Their name" }) });
    await userEvent.type(box, " mine");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use theirs" }));
    expect(await screen.findByRole("heading", { name: "Their name", level: 2 })).toBeTruthy();
    expect((await saved(storage)).name).toBe("Their name");
  });

  it("targets add one line at a time, each settling above the next", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, badge);
    await openPart(/^Learning targets/);
    expect(await screen.findByRole("heading", { name: "What its holder can do" })).toBeTruthy();
    const settledLines = () => within(screen.getByRole("list", { name: "Learning targets" })).getAllByRole("listitem").map((li) => li.firstChild?.textContent);
    expect(settledLines()).toEqual(["I can find bugs in a diff."]);
    const line = screen.getByRole("textbox", { name: "New learning target" });
    await userEvent.type(line, "I can explain a fix.{Enter}");
    expect(settledLines()).toEqual(["I can find bugs in a diff.", "I can explain a fix."]);
    expect((line as HTMLInputElement).value).toBe("");
    const list = screen.getByRole("list", { name: "Learning targets" });
    expect(list.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.type(line, "I can write a test.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    expect((await saved(storage)).learningTargets).toEqual(["I can find bugs in a diff.", "I can explain a fix.", "I can write a test."]);
  });

  it("a palette tap, then skipping art and title, saves the credential's badge override", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, badge);
    await openPart(/^Look/);
    expect(await screen.findByRole("heading", { name: "Colors" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Pine Gold" }));
    expect(await screen.findByRole("heading", { name: "Art" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Answered" }).textContent).toContain("Pine Gold");
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("heading", { name: "Title" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    const state = await loadFolder(storage);
    expect(state.collections[0].badgeOverrides?.review).toEqual({ palette: "04-pine-gold" });
    expect(within(parts()).getByRole("button", { name: /^Look/ }).textContent).toContain("Pine Gold");
  });

  it("closing an edit deck writes nothing and returns to the badge", async () => {
    const storage = storageWith({ credentials: [review] });
    const before = await snapshot(storage);
    renderApp(storage, badge);
    await openPart(/^Name/);
    await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), " changed");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("list", { name: "Parts" })).toBeTruthy();
    expect(await snapshot(storage)).toEqual(before);
  });

  it("Covers AE6. Adding the first rubric to a held badge warns first, then lists a re-test", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] });
    renderApp(storage, badge);
    await openPart(/^Rubric/);
    await userEvent.type(await screen.findByRole("textbox", { name: "Rubric" }), "Finds the off-by-one.");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Holders will re-test" })).toBeTruthy();
    expect(screen.getByText(/first rubric counts as a change/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Holders" })).getByText("Opus agent")).toBeTruthy();
    expect((await saved(storage)).rubric).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    expect((await saved(storage)).rubric).toBe("Finds the off-by-one.");

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    const needs = await screen.findByRole("region", { name: "What needs you" });
    const [row] = within(needs).getAllByRole("button");
    expect(row.textContent).toContain("Re-test Opus agent");
  });

  it("a rubric on a badge nobody holds saves without a warning", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "rubric" });
    await userEvent.type(await screen.findByRole("textbox", { name: "Rubric" }), "Finds it.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    expect((await saved(storage)).rubric).toBe("Finds it.");
  });

  it("Covers AE5. After a task edit the holder keeps the badge, marked task changed", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] });
    renderApp(storage, { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "task" });
    const box = await screen.findByRole("textbox", { name: "Task" });
    await userEvent.type(box, " Twice.");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    const holders = await screen.findByRole("region", { name: "Holders" });
    await waitFor(() => expect(within(holders).getByRole("button", { name: /Opus agent/ }).textContent).toContain("task changed"));
  });
});

describe("edit helpers", () => {
  it("holdersOf reads each agent's latest result", async () => {
    const state = await loadFolder(
      storageWith({
        credentials: [review],
        profiles: [opus],
        assessments: [await result(opus, review), await result(opus, review, { fileStem: "20260902T090000Z", recordedAt: "2026-09-02T09:00:00.000Z", result: "not_met" })],
      }),
    );
    expect(holdersOf(state, "eng/review")).toEqual([]);
  });

  it("parseParam splits a line at the first equals sign", () => {
    expect(parseParam("context = 200k")).toEqual(["context", "200k"]);
    expect(parseParam("url=http://x?a=b")).toEqual(["url", "http://x?a=b"]);
    expect(parseParam("flag")).toEqual(["flag", ""]);
    expect(parseParam(" = x")).toBeNull();
  });
});
