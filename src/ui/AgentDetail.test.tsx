// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadFolder, profilePath, serializeProfile } from "../domain/folder";
import { FLAG_REASONS } from "../domain/matrix";
import type { MemoryStorage } from "../storage/memory";
import { opus, renderApp, result, review, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

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
    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Keep this setup" })).toBeTruthy();
    const names = within(screen.getByRole("list", { name: "Parts" }))
      .getAllByRole("button")
      .map((b) => b.querySelector(".part-name")?.textContent);
    expect(names).toEqual(["Name", "Repo", "Notes", "Parameters"]);
  });

  it("a locked agent offers Make a new agent like this", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] }), agent);
    expect(await screen.findByRole("button", { name: "Make a new agent like this" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep this setup" })).toBeNull();
    expect(within(screen.getByRole("radiogroup", { name: "Harness" })).getByRole("radio", { checked: true }).getAttribute("aria-disabled")).toBe("true");
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

  it("an agent with no badges offers to test it", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), agent);
    const badges = await screen.findByRole("region", { name: "Badges" });
    await userEvent.click(await within(badges).findByRole("button", { name: "Test it" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Which badge" })).toBeTruthy());
  });
});
