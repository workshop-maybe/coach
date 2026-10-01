// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadFolder, profilePath, serializeProfile } from "../domain/folder";
import { FLAG_REASONS } from "../domain/matrix";
import type { MemoryStorage } from "../storage/memory";
import { addPending } from "./pendingTests";
import { FOLDER, opus, renderApp, result, review, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; these flows type into a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const agent = { view: "item", item: "agent", profileSlug: "opus" } as const;
const docs = { ...review, slug: "docs", name: "Write docs", task: "Document the module." };

async function saved(storage: MemoryStorage) {
  return (await loadFolder(storage)).profiles.find((p) => p.slug === "opus")!;
}

const openPart = async (name: RegExp) => {
  const parts = await screen.findByRole("list", { name: "Parts" });
  await userEvent.click(within(parts).getByRole("button", { name }));
};

describe("AgentDetail", () => {
  it("shows the player card in edit mode with its parts", async () => {
    renderApp(storageWith({ profiles: [opus] }), agent);
    expect(await screen.findByRole("heading", { name: "Opus agent", level: 2 })).toBeTruthy();
    expect(screen.getAllByRole("radiogroup").map((g) => g.getAttribute("aria-label"))).toEqual(["Harness", "Model", "Version", "Effort"]);
    expect(screen.getByRole("button", { name: "Keep this setup" })).toBeTruthy();
    const names = within(screen.getByRole("list", { name: "Parts" }))
      .getAllByRole("button")
      .map((b) => b.querySelector(".part-name")?.textContent);
    expect(names).toEqual(["Name", "Repo", "Notes", "Parameters"]);
    // Nothing plugged in, so nothing to pull.
    expect(screen.queryByRole("button", { name: "Pull the handoff" })).toBeNull();
    expect(document.querySelector(".cast-plugged")).toBeNull();
  });

  it("Covers F2. A plugged agent shows its handoff, and Pull the handoff opens what came back", async () => {
    addPending(FOLDER, {
      profileSlug: "opus",
      credentialKey: "eng/review",
      copiedAt: "2026-09-30T09:00:00.000Z",
      assignmentVersion: "v",
      setup: { harness: opus.harness, model: opus.model, effort: opus.effort },
      handoff: { id: "skeleton", text: "Review the attached diff." },
    });
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), agent);
    const pull = await screen.findByRole("button", { name: "Pull the handoff" });
    expect(document.querySelector(".player svg.cast-machine .cast-plugged text")?.textContent).toBe("S");
    await userEvent.click(pull);
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
  });

  it("a locked agent offers Make a new agent like this", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] }), agent);
    expect(await screen.findByRole("button", { name: "Make a new agent like this" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep this setup" })).toBeNull();
    expect(within(screen.getByRole("radiogroup", { name: "Harness" })).getByRole("radio", { checked: true }).getAttribute("aria-disabled")).toBe("true");
  });

  it("Keep this setup saves the dials and returns to the agent", async () => {
    const storage = storageWith({ profiles: [opus] });
    renderApp(storage, agent);
    await screen.findByRole("heading", { name: "Opus agent", level: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Next effort" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep this setup" }));
    await waitFor(async () => expect((await saved(storage)).effort).toBe("xhigh"));
    expect(await screen.findByRole("list", { name: "Parts" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Opus agent", level: 2 })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "What needs you" })).toBeNull();
  });

  it("a new agent like a locked one is its own flow, and closing it returns to the original", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] });
    renderApp(storage, agent);
    await userEvent.click(await screen.findByRole("button", { name: "Make a new agent like this" }));
    expect(await screen.findByRole("button", { name: "Make the agent" })).toBeTruthy();
    // The original agent's parts and badges are not shown beside the new agent's card.
    expect(screen.queryByRole("list", { name: "Parts" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Badges" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Opus agent", level: 2 })).toBeTruthy();
    expect((await loadFolder(storage)).profiles).toHaveLength(1);
  });

  it("making the new agent opens it, with its own parts", async () => {
    const storage = storageWith({ credentials: [review], profiles: [{ ...opus, repo: "~/code/app" }], assessments: [await result(opus, review)] });
    renderApp(storage, agent);
    await userEvent.click(await screen.findByRole("button", { name: "Make a new agent like this" }));
    await userEvent.click(await screen.findByRole("button", { name: "Next effort" }));
    await userEvent.click(screen.getByRole("button", { name: "Make the agent" }));
    expect(await screen.findByRole("heading", { name: "Claude Code, opus, xhigh", level: 2 })).toBeTruthy();
    const parts = screen.getByRole("list", { name: "Parts" });
    expect(within(parts).getByRole("button", { name: /^Name/ }).textContent).toContain("Claude Code, opus, xhigh");
    expect(within(parts).getByRole("button", { name: /^Repo/ }).textContent).toContain("~/code/app");
    expect(within(screen.getByRole("region", { name: "Badges" })).queryByRole("button", { name: /Code review/ })).toBeNull();
  });

  it("renaming saves through updateProfile and returns to the agent", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] });
    renderApp(storage, agent);
    await openPart(/^Name/);
    expect(await screen.findByRole("heading", { name: "What is it called" })).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(box);
    await userEvent.type(box, "Reviewer{Enter}");
    expect(await screen.findByRole("heading", { name: "Reviewer", level: 2 })).toBeTruthy();
    const p = await saved(storage);
    expect(p.name).toBe("Reviewer");
    expect(p.harness).toBe("claude-code");
  });

  it("repo and notes each save from their own card", async () => {
    const storage = storageWith({ profiles: [opus] });
    renderApp(storage, agent);
    await openPart(/^Repo/);
    await userEvent.type(await screen.findByRole("textbox", { name: "Repo" }), "~/code/app");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await openPart(/^Notes/);
    await userEvent.type(await screen.findByRole("textbox", { name: "Notes" }), "Runs with tests on.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    const p = await saved(storage);
    expect(p.repo).toBe("~/code/app");
    expect(p.notes).toBe("Runs with tests on.");
  });

  it("parameters add one line at a time, each settling above the next", async () => {
    const storage = storageWith({ profiles: [{ ...opus, params: { context: "200k" } }] });
    renderApp(storage, agent);
    await openPart(/^Parameters/);
    const line = await screen.findByRole("textbox", { name: "New parameter" });
    await userEvent.type(line, "temperature = 0.2{Enter}");
    const settled = within(screen.getByRole("list", { name: "Parameters" })).getAllByRole("listitem");
    expect(settled.map((li) => li.firstChild?.textContent)).toEqual(["context = 200k", "temperature = 0.2"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove context = 200k" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    expect((await saved(storage)).params).toEqual({ temperature: "0.2" });
  });

  it("a conflict on an agent edit offers Keep mine", async () => {
    const storage = storageWith({ profiles: [opus] });
    renderApp(storage, { view: "deck", deck: "edit-agent", profileSlug: "opus", part: "notes" });
    const box = await screen.findByRole("textbox", { name: "Notes" });
    storage.seed({ [profilePath("opus")]: serializeProfile({ ...opus, notes: "Theirs" }) });
    await userEvent.type(box, "Mine");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
    await screen.findByRole("list", { name: "Parts" });
    expect((await saved(storage)).notes).toBe("Mine");
  });

  it("Keep mine on an agent part keeps the other fields as they are on disk", async () => {
    const storage = storageWith({ profiles: [opus] });
    renderApp(storage, { view: "deck", deck: "edit-agent", profileSlug: "opus", part: "notes" });
    const box = await screen.findByRole("textbox", { name: "Notes" });
    storage.seed({ [profilePath("opus")]: serializeProfile({ ...opus, repo: "~/theirs", notes: "Theirs" }) });
    await userEvent.type(box, "Mine");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
    await screen.findByRole("list", { name: "Parts" });
    expect(await saved(storage)).toMatchObject({ notes: "Mine", repo: "~/theirs" });
  });

  it("Keep mine on the setup card keeps the other fields as they are on disk", async () => {
    const storage = storageWith({ profiles: [opus] });
    renderApp(storage, agent);
    await screen.findByRole("button", { name: "Keep this setup" });
    storage.seed({ [profilePath("opus")]: serializeProfile({ ...opus, notes: "Theirs", model: "sonnet" }) });
    await userEvent.click(screen.getByRole("button", { name: "Next effort" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep this setup" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
    await waitFor(async () => expect((await saved(storage)).effort).toBe("xhigh"));
    expect(await saved(storage)).toMatchObject({ notes: "Theirs", effort: "xhigh" });
  });

  it("shows earned badges, and a flagged one dimmed with the reason", async () => {
    const storage = storageWith({
      credentials: [review, docs],
      profiles: [opus],
      assessments: [await result(opus, review), await result(opus, docs, { setup: { harness: "claude-code", model: "sonnet", effort: "high" } })],
    });
    renderApp(storage, agent);
    const badges = await screen.findByRole("region", { name: "Badges" });
    const fresh = await within(badges).findByRole("button", { name: /Code review/ });
    const stale = within(badges).getByRole("button", { name: /Write docs/ });
    expect(fresh.getAttribute("data-flagged")).toBeNull();
    expect(stale.getAttribute("data-flagged")).toBe("true");
    expect(stale.textContent).toContain(FLAG_REASONS.setup_mismatch);
    await userEvent.click(fresh);
    expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
  });

  it("a not met result earns no badge", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review, { result: "not_met" })] }), agent);
    const badges = await screen.findByRole("region", { name: "Badges" });
    expect(await within(badges).findByRole("button", { name: "Test it" })).toBeTruthy();
    expect(within(badges).queryByRole("button", { name: /Code review/ })).toBeNull();
  });

  it("an agent with no badges offers to test it", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), agent);
    const badges = await screen.findByRole("region", { name: "Badges" });
    await userEvent.click(await within(badges).findByRole("button", { name: "Test it" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Which badge" })).toBeTruthy());
  });

  describe("its machine", () => {
    const keysOn = () => within(screen.getByRole("list", { name: "Earned" }));

    it("Covers AE3. A flagged key sits half raised, and activating it opens the re-test", async () => {
      const storage = storageWith({
        credentials: [review, docs],
        profiles: [opus],
        assessments: [await result(opus, review), await result(opus, docs, { assignmentVersion: "an earlier task" })],
      });
      renderApp(storage, agent);
      const raised = await screen.findByRole("button", { name: "Write docs, re-test" });
      expect(raised.getAttribute("data-key")).toBe("raised");
      expect(document.querySelector('svg.cast-machine [data-credential="eng/docs"]')!.getAttribute("data-key")).toBe("raised");
      expect(document.querySelector('svg.cast-machine [data-credential="eng/review"]')!.getAttribute("data-key")).toBe("lit");
      await userEvent.click(raised);
      expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    });

    it("a lit key opens its badge", async () => {
      renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] }), agent);
      await userEvent.click(await screen.findByRole("button", { name: "Code review" }));
      expect(await screen.findByRole("heading", { name: "Code review", level: 2 })).toBeTruthy();
    });

    it("focusing a key names its credential", async () => {
      renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] }), agent);
      const key = await screen.findByRole("button", { name: "Code review" });
      expect(key.getAttribute("title")).toBe("Code review");
      const caption = document.querySelector(".machine-key-name")!;
      expect(caption.textContent).toBe("");
      key.focus();
      await waitFor(() => expect(caption.textContent).toBe("Code review"));
      key.blur();
      await waitFor(() => expect(caption.textContent).toBe(""));
    });

    it("paging moves between pages of sixteen keys", async () => {
      const many = Array.from({ length: 17 }, (_, i) => ({ ...review, slug: `c${String(i + 1).padStart(2, "0")}`, name: `Credential ${i + 1}` }));
      const assessments = await Promise.all(
        many.map((c, i) => result(opus, c, { recordedAt: `2026-09-${String(i + 1).padStart(2, "0")}T09:00:00.000Z` })),
      );
      renderApp(storageWith({ credentials: many, profiles: [opus], assessments }), agent);
      await screen.findByRole("button", { name: "Credential 1" });
      expect(keysOn().getAllByRole("button")).toHaveLength(16);
      expect(screen.getByRole("button", { name: "Previous page" })).toHaveProperty("disabled", true);
      await userEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(keysOn().getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Credential 17"]);
      expect(document.querySelector('svg.cast-machine .cast-pages')!.getAttribute("data-page")).toBe("1");
      await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
      expect(keysOn().getAllByRole("button")).toHaveLength(16);
      expect(screen.getByRole("button", { name: "Credential 1" })).toBeTruthy();
    });

    it("one page of keys shows no page control", async () => {
      renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] }), agent);
      await screen.findByRole("button", { name: "Code review" });
      expect(screen.queryByRole("group", { name: "Pages" })).toBeNull();
    });
  });
});
