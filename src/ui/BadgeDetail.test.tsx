// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { credentialPath, loadFolder } from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import { BUILT_IN_HANDOFF } from "../domain/handoffs";
import { buildMatrix } from "../domain/matrix";
import { checkCriteriaPrompt, refinePrompt, reviewAssignmentPrompt } from "../domain/prompts";
import type { MemoryStorage } from "../storage/memory";
import { holdersOf, parseParam } from "./EditDecks";
import { opus, renderApp, result, review, snapshot, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; these flows type into a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

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
/** The folder's actions in the top bar: all three on a page, none on a pane (R8). */
const FOLDER_ACTIONS = ["Change folder", "Reload", "Export"];
const barActions = () => FOLDER_ACTIONS.filter((name) => within(screen.getByRole("banner")).queryByRole("button", { name }) !== null);
const editDeck = () => screen.getByRole("region", { name: "Edit Code review" });
/** The button that opens a take in a reply row: the row's latest, or an older take's. */
const takeHead = (el: HTMLElement) => el.querySelector<HTMLButtonElement>("button.take-head")!;
const openedPart = async (name: RegExp) => within(await screen.findByRole("list", { name: "Parts" })).getByRole("button", { name });
const openPart = async (name: RegExp) => {
  await screen.findByRole("list", { name: "Parts" });
  await userEvent.click(within(parts()).getByRole("button", { name }));
};

/** A badge page's two columns on a wide window, which stack on a narrow one. */
const mainColumn = () => document.querySelector<HTMLElement>(".detail-split > .detail-main")!;
const sideColumn = () => document.querySelector<HTMLElement>(".detail-split > .detail-side")!;

describe("BadgeDetail's two columns", () => {
  it("puts the badge and its parts on one side, and its replies, holders and Move to trash on the other", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] }), badge);
    const replies = await screen.findByRole("region", { name: "Replies" });
    expect(mainColumn()).not.toBeNull();
    expect(mainColumn().querySelector(".detail-head svg.cast-cartridge")).not.toBeNull();
    expect(within(mainColumn()).getByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
    expect(within(mainColumn()).getByRole("list", { name: "Parts" })).toBeTruthy();
    expect(sideColumn().contains(replies)).toBe(true);
    expect(within(sideColumn()).getByRole("region", { name: "Holders" })).toBeTruthy();
    expect(within(sideColumn()).getByRole("button", { name: "Move to trash" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    expect(document.querySelectorAll("button.primary")).toHaveLength(1);
  });

  it("a badge nobody has tried has only its holders and Move to trash beside it", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), badge);
    await screen.findByText("Nobody holds it yet");
    expect(within(sideColumn()).getByText("Nobody holds it yet")).toBeTruthy();
    expect(within(sideColumn()).getByRole("button", { name: "Move to trash" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Replies" })).toBeNull();
  });

  it("once two handoffs have run, their rows sit in the side column", async () => {
    const one = { collectionSlug: "eng", credentialSlug: "review", id: "20260902T090000Z", text: "{{task}}\n" };
    renderApp(
      storageWith({
        credentials: [review],
        profiles: [opus, codex],
        handoffs: [one],
        assessments: [await result(opus, review, { handoff: { id: one.id, text: "B" } }), await result(codex, review, { result: "not_met" })],
      }),
      badge,
    );
    await screen.findByRole("region", { name: "Replies" });
    expect(sideColumn().querySelector(".handoff-runs")).not.toBeNull();
    expect(mainColumn().querySelector(".handoff-runs")).toBeNull();
  });
});

describe("BadgeDetail", () => {
  it("shows the badge, its six parts, and only the agents that met it as holders", async () => {
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
    expect(names).toEqual(["Name", "Learning targets", "Task", "Rubric", "Look", "Handoffs"]);
    const holders = screen.getByRole("region", { name: "Holders" });
    expect(await within(holders).findByRole("button", { name: /Opus agent/ })).toBeTruthy();
    expect(within(holders).queryByRole("button", { name: /Codex agent/ })).toBeNull();
    // Holders are small machines, named in text beside them.
    expect(within(holders).getByRole("button", { name: /Opus agent/ }).querySelector("svg.cast-machine-mini")).not.toBeNull();
  });

  it("the Handoffs part shows how many the badge has, or Skeleton when it has none", async () => {
    const handoff = (id: string) => ({ collectionSlug: "eng", credentialSlug: "review", id, text: "{{task}}\n" });
    renderApp(storageWith({ credentials: [review] }), badge);
    expect((await openedPart(/Handoffs/)).querySelector(".part-value")?.textContent).toBe("Skeleton");
    cleanup();
    renderApp(storageWith({ credentials: [review], handoffs: [handoff("20260901T090000Z")] }), badge);
    expect((await openedPart(/Handoffs/)).querySelector(".part-value")?.textContent).toBe("1 handoff");
    cleanup();
    renderApp(storageWith({ credentials: [review], handoffs: [handoff("20260901T090000Z"), handoff("20260902T090000Z")] }), badge);
    expect((await openedPart(/Handoffs/)).querySelector(".part-value")?.textContent).toBe("2 handoffs");
  });

  it("Covers AE1, F1. A single-handoff badge lists every agent that ran it, Not met included, without opening a holder", async () => {
    const storage = storageWith({
      credentials: [review],
      profiles: [opus, codex],
      assessments: [await result(opus, review, { handBack: "Opus reply" }), await result(codex, review, { result: "not_met", handBack: "Codex reply" })],
    });
    renderApp(storage, badge);
    const replies = await screen.findByRole("region", { name: "Replies" });
    expect(within(replies).getByText("Skeleton")).toBeTruthy();
    const rows = within(replies).getAllByRole("listitem");
    expect(rows.map((li) => li.getAttribute("aria-label")).sort()).toEqual(["Codex agent", "Opus agent"]);
    expect(within(replies).getByText(/Codex reply/)).toBeTruthy();
  });

  it("an agent's older take sits under its latest one and opens as its own view", async () => {
    const older = await result(opus, review, { fileStem: "20260801T090000Z", recordedAt: "2026-08-01T09:00:00.000Z", result: "not_met", handBack: "First try" });
    renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [older, await result(opus, review)] }), badge);
    const [row] = within(await screen.findByRole("region", { name: "Replies" })).getAllByRole("listitem");
    const [take] = within(row).getAllByRole("listitem");
    expect(row.querySelector(".take-meta")?.textContent).toContain("Met");
    expect(take.textContent).toContain("Not met");
    expect(within(take).queryByText("First try")).toBeNull();
    await userEvent.click(takeHead(take));
    expect(await screen.findByRole("heading", { name: "Opus agent", level: 2 })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Reply" })).getByText("First try")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Parts" })).toBeNull();
  });

  it("Covers R16. Closing a reply comes back to the badge with its agent lit, its take focused and the picks kept", async () => {
    const storage = storageWith({
      credentials: [review],
      profiles: [opus, codex],
      assessments: [await result(opus, review, { handBack: "Opus reply" }), await result(codex, review, { fileStem: "20260902T090000Z", recordedAt: "2026-09-02T09:00:00.000Z", handBack: "Codex reply" })],
    });
    renderApp(storage, badge);
    const replies = await screen.findByRole("region", { name: "Replies" });
    await userEvent.click(within(replies).getByRole("checkbox", { name: /Pick Opus agent/ }));
    const codexRow = within(replies).getAllByRole("listitem").find((li) => li.getAttribute("aria-label") === "Codex agent")!;
    await userEvent.click(takeHead(codexRow));
    expect(await screen.findByRole("heading", { name: "Codex agent", level: 2 })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
    const back = await screen.findByRole("region", { name: "Replies" });
    const lit = within(back).getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "true")!;
    expect(lit.getAttribute("aria-label")).toBe("Codex agent");
    await waitFor(() => expect(document.activeElement).toBe(takeHead(lit)));
    expect((within(back).getByRole("checkbox", { name: /Pick Opus agent/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(back).getByRole("checkbox", { name: /Pick Codex agent/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("each take shows the machine it ran on, and memory changes", async () => {
    const ctx = (memory: string, capturedAt: string) => ({ machineId: "laptop", machine: "Laptop", memory, capturedAt });
    const first = await result(opus, review, { fileStem: "20260801T090000Z", recordedAt: "2026-08-01T09:00:00.000Z", context: ctx("aaaaaaaaaaaa", "2026-08-01T09:00:00.000Z") });
    const same = await result(opus, review, { fileStem: "20260802T090000Z", recordedAt: "2026-08-02T09:00:00.000Z", context: ctx("aaaaaaaaaaaa", "2026-08-02T09:00:00.000Z") });
    const changed = await result(opus, review, { fileStem: "20260803T090000Z", recordedAt: "2026-08-03T09:00:00.000Z", context: ctx("bbbbbbbbbbbb", "2026-08-03T09:00:00.000Z") });
    const notRead = await result(opus, review, { fileStem: "20260804T090000Z", recordedAt: "2026-08-04T09:00:00.000Z", context: ctx("not-read", "2026-08-04T09:00:00.000Z") });
    const unknown = await result(opus, review, { fileStem: "20260805T090000Z", recordedAt: "2026-08-05T09:00:00.000Z" });
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [first, same, changed, notRead, unknown] });
    renderApp(storage, badge);
    const replies = await screen.findByRole("region", { name: "Replies" });
    const lines = [...replies.querySelectorAll(".take-meta")].map((p) => p.textContent?.split(" · ").slice(2).join(" · "));
    expect(lines).toEqual(["context unknown", "Laptop · memory not read", "Laptop · memory changed", "Laptop", "Laptop"]);
  });

  it("opening a holder lights its reply on the same page while one handoff has run", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus, codex], assessments: [await result(opus, review), await result(codex, review)] }), badge);
    await userEvent.click(await within(await screen.findByRole("region", { name: "Holders" })).findByRole("button", { name: /Codex agent/ }));
    await waitFor(() => {
      const replies = screen.getByRole("region", { name: "Replies" });
      const lit = within(replies).getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "true");
      expect(lit?.getAttribute("aria-label")).toBe("Codex agent");
    });
  });

  it("a badge with no results shows no replies", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), badge);
    expect(await screen.findByText("Nobody holds it yet")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Replies" })).toBeNull();
  });

  it("Covers R17. Compare opens the two picked replies in the full window, and Escape comes back to the badge with both picked and Compare focused", async () => {
    renderApp(
      storageWith({
        credentials: [review],
        profiles: [opus, codex],
        assessments: [await result(opus, review, { handBack: "Opus reply" }), await result(codex, review, { handBack: "Codex reply" })],
      }),
      badge,
    );
    await screen.findByRole("region", { name: "Replies" });
    for (const box of screen.getAllByRole("checkbox")) await userEvent.click(box);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const compare = await screen.findByRole("region", { name: "Compare replies" });
    expect(within(compare).getAllByRole("article")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Code review", level: 2 })).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Compare" })));
    expect(screen.getAllByRole("checkbox").map((b) => (b as HTMLInputElement).checked)).toEqual([true, true]);
  });

  describe("handoffs on results", () => {
    const handoff = (id: string) => ({ collectionSlug: "eng", credentialSlug: "review", id, text: "{{task}}\n" });
    const handoffs = [handoff("20260901T090000Z"), handoff("20260902T090000Z")];

    it("Covers R20. Each holder shows the handoff that earned it, and one recorded before handoffs shows the skeleton", async () => {
      const storage = storageWith({
        credentials: [review],
        profiles: [opus, codex],
        handoffs,
        assessments: [await result(opus, review, { handoff: { id: "20260902T090000Z", text: "Review the attached diff." } }), await result(codex, review)],
      });
      renderApp(storage, badge);
      const holders = await screen.findByRole("region", { name: "Holders" });
      const latest = async (name: RegExp) => (await within(holders).findByRole("button", { name })).querySelector(".detail-holder-latest")?.textContent;
      expect(await latest(/Opus agent/)).toContain("Handoff B");
      expect(await latest(/Codex agent/)).toContain("Skeleton");
    });

    it("an opened reply keeps the text that ran, collapsed under it", async () => {
      const ran = await result(opus, review, { handoff: { id: "20260902T090000Z", text: "Second framing" } });
      renderApp(storageWith({ credentials: [review], profiles: [opus], handoffs, assessments: [ran] }), badge);
      const [row] = within(await screen.findByRole("region", { name: "Replies" })).getAllByRole("listitem");
      expect(row.querySelector("details")).toBeNull();
      await userEvent.click(takeHead(row));
      const ranWith = (await screen.findByText("Handoff B", { selector: "summary" })).closest("details")!;
      expect(ranWith.open).toBe(false);
      expect(ranWith.querySelector("pre")?.textContent).toBe("Second framing");
    });

    it("A result recorded before handoffs shows the built-in prompt as the skeleton in its opened reply", async () => {
      renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] }), badge);
      const [row] = within(await screen.findByRole("region", { name: "Replies" })).getAllByRole("listitem");
      await userEvent.click(takeHead(row));
      const ranWith = (await screen.findByText("Skeleton", { selector: "summary" })).closest("details")!;
      expect(ranWith.querySelector("pre")?.textContent).toBe(BUILT_IN_HANDOFF);
    });

    it("Covers AE2. A written handoff that has not run leaves the replies in place", async () => {
      renderApp(storageWith({ credentials: [review], profiles: [opus], handoffs, assessments: [await result(opus, review)] }), badge);
      const replies = await screen.findByRole("region", { name: "Replies" });
      expect(within(replies).getAllByRole("listitem")).toHaveLength(1);
    });

    it("Covers AE3. Once two handoffs have run, the badge lists each with its agents and Met count, and no reply rows", async () => {
      const own = { collectionSlug: "eng", credentialSlug: "review", id: "20260902T090000Z", text: BUILT_IN_HANDOFF.replace("## Task", "Be strict about tests.\n\n## Task") };
      const storage = storageWith({
        credentials: [review],
        profiles: [opus, codex],
        handoffs: [handoffs[0], own],
        assessments: [await result(opus, review, { handoff: { id: own.id, text: "B" } }), await result(codex, review, { result: "not_met" })],
      });
      renderApp(storage, badge);
      const replies = await screen.findByRole("region", { name: "Replies" });
      const rows = within(replies).getAllByRole("button");
      expect(rows.map((b) => [...b.children].map((c) => c.textContent))).toEqual([
        ["S", "Skeleton", "1 agent · 0 met"],
        ["B", "Handoff B", "Be strict about tests.", "1 agent · 1 met"],
      ]);
      expect(replies.querySelector(".reply")).toBeNull();
      await userEvent.click(rows[1]);
      expect(await screen.findByRole("heading", { name: "Handoff B" })).toBeTruthy();
    });

    it("Covers AE6. Once two handoffs have run, opening a holder opens the handoff that earned it with its row lit", async () => {
      const storage = storageWith({
        credentials: [review],
        profiles: [opus, codex],
        handoffs,
        assessments: [await result(opus, review, { handoff: { id: "20260902T090000Z", text: "B" } }), await result(codex, review)],
      });
      renderApp(storage, badge);
      await userEvent.click(await within(await screen.findByRole("region", { name: "Holders" })).findByRole("button", { name: /Opus agent/ }));
      expect(await screen.findByRole("heading", { name: "Handoff B" })).toBeTruthy();
      const lit = (await screen.findAllByRole("listitem")).find((li) => li.getAttribute("aria-current") === "true");
      expect(lit?.getAttribute("aria-label")).toBe("Opus agent");
    });
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

  it("Save waits for a real change to the task or rubric", async () => {
    renderApp(storageWith({ credentials: [review] }), { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "task" });
    const box = await screen.findByRole("textbox", { name: "Task" });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(box, "!");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.type(box, "{Backspace}");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the task card copies the review and handoff-note prompts, and the rubric card checks criteria", async () => {
    renderApp(storageWith({ credentials: [review] }), { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "task" });
    await userEvent.click(await screen.findByRole("button", { name: "Review this assignment" }));
    expect(writeText).toHaveBeenLastCalledWith(reviewAssignmentPrompt(review));
    await userEvent.click(screen.getByRole("button", { name: "Write a refine prompt" }));
    expect(writeText).toHaveBeenLastCalledWith(refinePrompt(review));
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

  it("Keep mine writes only the edited part over what is on disk now", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "task" });
    const box = await screen.findByRole("textbox", { name: "Task" });
    storage.seed({ [credentialPath("eng", "review")]: serializeCredentialMd({ ...review, name: "Their name", rubric: "Their rubric." }) });
    await userEvent.clear(box);
    await userEvent.type(box, "Mine.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
    await screen.findByRole("list", { name: "Parts" });
    expect(await saved(storage)).toMatchObject({ task: "Mine.", name: "Their name", rubric: "Their rubric." });
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

  it("a target's detail moves to the rubric from the targets card", async () => {
    const storage = storageWith({ credentials: [{ ...review, learningTargets: ["I can find at least one bug in a diff."], rubric: "Finds it." }] });
    renderApp(storage, badge);
    await openPart(/^Learning targets/);
    await userEvent.click(await screen.findByRole("button", { name: "Move to the rubric: At least one bug in a diff" }));
    const line = screen.getByRole("textbox", { name: "New learning target" });
    await userEvent.type(line, "I can review a PR (tests, types, docs).");
    await userEvent.click(screen.getByRole("button", { name: "Move to the rubric" }));
    expect((line as HTMLInputElement).value).toBe("I can review a PR.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    expect(await saved(storage)).toMatchObject({
      learningTargets: ["I can find a bug in a diff.", "I can review a PR."],
      rubric: "Finds it.\n\n- At least one bug in a diff\n- Tests, types, docs",
    });
  });

  it("moving a target's detail on a held badge warns that holders will re-test", async () => {
    const held = { ...review, learningTargets: ["I can find at least one bug in a diff."] };
    const storage = storageWith({ credentials: [held], profiles: [opus], assessments: [await result(opus, held)] });
    renderApp(storage, badge);
    await openPart(/^Learning targets/);
    await userEvent.click(await screen.findByRole("button", { name: /^Move to the rubric/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Holders will re-test" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    expect(await saved(storage)).toMatchObject({ learningTargets: ["I can find a bug in a diff."], rubric: "- At least one bug in a diff" });
  });

  it("Keep mine after a move adds the moved line to the rubric on disk now", async () => {
    const held = { ...review, learningTargets: ["I can find at least one bug in a diff."] };
    const storage = storageWith({ credentials: [held] });
    renderApp(storage, { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "targets" });
    await userEvent.click(await screen.findByRole("button", { name: /^Move to the rubric/ }));
    storage.seed({ [credentialPath("eng", "review")]: serializeCredentialMd({ ...held, rubric: "Their rubric." }) });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
    await screen.findByRole("list", { name: "Parts" });
    expect(await saved(storage)).toMatchObject({ learningTargets: ["I can find a bug in a diff."], rubric: "Their rubric.\n\n- At least one bug in a diff" });
  });

  it("two skills in a new target are asked about, with nothing to move", async () => {
    renderApp(storageWith({ credentials: [review] }), badge);
    await openPart(/^Learning targets/);
    await userEvent.type(await screen.findByRole("textbox", { name: "New learning target" }), "I can fix a bug and explain why it happened.");
    expect(screen.getByText("Two skills, or one workflow?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Move to the rubric/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
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

// Writing the task and rubric in a pane (U6, R7, R18, R19, R20). The flows above still
// save as before; these cover the pane, the first focus and Escape keeping changed text.
describe("BadgeDetail's writing panes", () => {
  it("Covers R18. Editing the task fills the window with focus in the box, and the re-test warning is a page again", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] });
    renderApp(storage, badge);
    await screen.findByRole("list", { name: "Parts" });
    expect(barActions()).toEqual(FOLDER_ACTIONS);
    await openPart(/^Task/);
    const box = await screen.findByRole("textbox", { name: "Task" });
    expect(editDeck().classList.contains("pane")).toBe(true);
    expect(barActions()).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(box));

    await userEvent.type(box, " Twice.");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Holders will re-test" })).toBeTruthy();
    expect(editDeck().classList.contains("pane")).toBe(false);
    expect(barActions()).toEqual(FOLDER_ACTIONS);
  });

  it("Covers R20. Escape on an edited task keeps the deck and the text, and Save still writes it", async () => {
    const storage = storageWith({ credentials: [review] });
    const before = await snapshot(storage);
    renderApp(storage, badge);
    await openPart(/^Task/);
    const box = (await screen.findByRole("textbox", { name: "Task" })) as HTMLTextAreaElement;
    await userEvent.type(box, " Twice.");
    // The first Escape leaves the box (R19); the next would leave the deck, but the text changed.
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "The task" })).toBeTruthy();
    expect(box.value).toBe("Review the attached diff. Twice.");
    expect(await snapshot(storage)).toEqual(before);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("list", { name: "Parts" })).toBeTruthy();
    expect((await saved(storage)).task).toBe("Review the attached diff. Twice.");
  });

  it("with no change to the task, Escape out of the box and once more returns to the badge", async () => {
    const storage = storageWith({ credentials: [review] });
    const before = await snapshot(storage);
    renderApp(storage, badge);
    await openPart(/^Task/);
    const box = await screen.findByRole("textbox", { name: "Task" });
    await waitFor(() => expect(document.activeElement).toBe(box));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "The task" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("list", { name: "Parts" })).toBeTruthy();
    expect(barActions()).toEqual(FOLDER_ACTIONS);
    expect(await snapshot(storage)).toEqual(before);
  });

  it("Covers R20. Escape on the re-test warning after a change keeps the deck, and Back finds the text", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] });
    const before = await snapshot(storage);
    renderApp(storage, badge);
    await openPart(/^Task/);
    await userEvent.type(await screen.findByRole("textbox", { name: "Task" }), " Twice.");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Holders will re-test" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "Holders will re-test" })).toBeTruthy();
    expect(await snapshot(storage)).toEqual(before);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement).value).toBe("Review the attached diff. Twice.");
    // Back on the task card, the text is still a change: Next still warns, and Escape still keeps it.
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.keyboard("{Escape}{Escape}");
    expect(screen.getByRole("heading", { name: "The task" })).toBeTruthy();
    expect(await snapshot(storage)).toEqual(before);
  });

  it("Covers R18. Editing the rubric fills the window with focus in the box, and Save writes it as before", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, badge);
    await openPart(/^Rubric/);
    const box = await screen.findByRole("textbox", { name: "Rubric" });
    expect(editDeck().classList.contains("pane")).toBe(true);
    expect(barActions()).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(box));
    await userEvent.type(box, "Finds the off-by-one.");
    await userEvent.keyboard("{Escape}{Escape}");
    expect(screen.getByRole("heading", { name: "What good looks like" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("list", { name: "Parts" })).toBeTruthy();
    expect(barActions()).toEqual(FOLDER_ACTIONS);
    expect((await saved(storage)).rubric).toBe("Finds the off-by-one.");
  });
});

describe("edit helpers", () => {
  it("holdersOf reads each agent's latest result from the matrix, a flagged met still holding", async () => {
    const state = await loadFolder(
      storageWith({
        credentials: [review],
        profiles: [opus, codex],
        assessments: [
          await result(opus, review),
          await result(opus, review, { fileStem: "20260902T090000Z", recordedAt: "2026-09-02T09:00:00.000Z", result: "not_met" }),
          await result(codex, review, { assignmentVersion: "an-older-version" }),
        ],
      }),
    );
    const matrix = await buildMatrix(state);
    expect(holdersOf(matrix, state.profiles, "eng/review").map((p) => p.slug)).toEqual(["codex"]);
  });

  it("parseParam splits a line at the first equals sign", () => {
    expect(parseParam("context = 200k")).toEqual(["context", "200k"]);
    expect(parseParam("url=http://x?a=b")).toEqual(["url", "http://x?a=b"]);
    expect(parseParam("flag")).toEqual(["flag", ""]);
    expect(parseParam(" = x")).toBeNull();
  });
});
