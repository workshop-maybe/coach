// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { loadFolder } from "../domain/folder";
import { findPreset, presetCredential } from "../domain/presets";
import { renderApp, review, snapshot, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; these flows type into a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(writeText).mockReset();
});
afterEach(cleanup);

/** The folder's actions in the top bar: all three on a page, none on a pane (R8). */
const FOLDER_ACTIONS = ["Change folder", "Reload", "Export"];
const barActions = () => FOLDER_ACTIONS.filter((name) => within(screen.getByRole("banner")).queryByRole("button", { name }) !== null);
const createDeck = () => screen.getByRole("region", { name: "Create a credential" });

async function walk(name: string, target: string, task: string) {
  await userEvent.click(await screen.findByRole("button", { name: "Build your own" }));
  await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), name);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Learning target" }), target);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  if (task) await userEvent.type(screen.getByRole("textbox", { name: "Task" }), task);
}

describe("CredentialDeck", () => {
  it("asks one thing per card: where to start, its name, one thing its holder can do, then the task", async () => {
    renderApp(storageWith(), { view: "deck", deck: "credential" });
    expect(await screen.findByRole("heading", { name: "Where to start" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Build your own" }));
    expect(await screen.findByRole("heading", { name: "What is it called" })).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Code review");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "One thing its holder can do" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Answered" }).textContent).toContain("Code review");
    await userEvent.type(screen.getByRole("textbox", { name: "Learning target" }), "I can find bugs");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "The task" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Make the badge" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("three beats create a credential, and the first one in an empty folder creates My credentials", async () => {
    const storage = storageWith();
    renderApp(storage, { view: "deck", deck: "credential" });
    await walk("Code review", "I can find bugs in a diff", "Review the attached diff");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));

    expect(await screen.findByRole("heading", { name: "Code review" })).toBeTruthy();
    expect(await screen.findByRole("img", { name: "Badge for Code review" })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(state.collections.map((c) => c.name)).toEqual(["My credentials"]);
    expect(state.credentials).toHaveLength(1);
    expect(state.credentials[0]).toMatchObject({
      name: "Code review",
      collectionSlug: state.collections[0].slug,
      learningTargets: ["I can find bugs in a diff"],
      task: "Review the attached diff",
    });
  });

  it("goes into the folder's first collection when one exists", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, { view: "deck", deck: "credential" });
    await walk("Write docs", "I can explain a module", "Document the module");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    await screen.findByRole("button", { name: "Test it on an agent" });
    const state = await loadFolder(storage);
    expect(state.collections.map((c) => c.slug)).toEqual(["eng"]);
    expect(state.credentials.map((c) => c.name).sort()).toEqual(["Code review", "Write docs"]);
  });

  it("a target with a list offers to move it to the rubric, and the credential keeps both", async () => {
    const storage = storageWith();
    renderApp(storage, { view: "deck", deck: "credential" });
    await userEvent.click(await screen.findByRole("button", { name: "Build your own" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), "Code review");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const box = screen.getByRole("textbox", { name: "Learning target" }) as HTMLInputElement;
    await userEvent.type(box, "I can review a PR (tests, types, docs).");
    await userEvent.click(screen.getByRole("button", { name: "Move to the rubric" }));
    expect(box.value).toBe("I can review a PR.");
    expect(screen.getByRole("status").textContent).toBe("Moved to the rubric");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Task" }), "Review the diff");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    await screen.findByRole("button", { name: "Test it on an agent" });
    const [saved] = (await loadFolder(storage)).credentials;
    expect(saved).toMatchObject({ learningTargets: ["I can review a PR."], rubric: "- Tests, types, docs" });
  });

  it("a target kept as written moves on and saves as written", async () => {
    const storage = storageWith();
    renderApp(storage, { view: "deck", deck: "credential" });
    await walk("Code review", "I can add at least one reviewer to a PR.", "Review it");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    await screen.findByRole("button", { name: "Test it on an agent" });
    const [saved] = (await loadFolder(storage)).credentials;
    expect(saved).toMatchObject({ learningTargets: ["I can add at least one reviewer to a PR."], rubric: "" });
  });

  it("closing mid-deck writes nothing", async () => {
    const storage = storageWith();
    const before = await snapshot(storage);
    renderApp(storage, { view: "deck", deck: "credential" });
    await walk("Code review", "I can find bugs", "Review it");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("button", { name: "Create a credential" })).toBeTruthy();
    expect(await snapshot(storage)).toEqual(before);
  });

  it("Covers R18. The task card fills the window with focus in the box, and the cards before it are pages", async () => {
    renderApp(storageWith(), { view: "deck", deck: "credential" });
    await userEvent.click(await screen.findByRole("button", { name: "Build your own" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), "Code review");
    expect(createDeck().classList.contains("pane")).toBe(false);
    expect(barActions()).toEqual(FOLDER_ACTIONS);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Learning target" }), "I can find bugs");
    expect(createDeck().classList.contains("pane")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "The task" })).toBeTruthy();
    expect(createDeck().classList.contains("pane")).toBe(true);
    expect(barActions()).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Task" })));
  });

  it("Covers R20. Once a task is written, Escape steps back a card but never leaves, and the task is kept", async () => {
    const storage = storageWith();
    const before = await snapshot(storage);
    renderApp(storage, { view: "deck", deck: "credential" });
    await walk("Code review", "I can find bugs", "Review the diff");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "The task" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "One thing its holder can do" })).toBeTruthy();
    expect(barActions()).toEqual(FOLDER_ACTIONS);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "One thing its holder can do" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((screen.getByRole("textbox", { name: "Task" }) as HTMLTextAreaElement).value).toBe("Review the diff");
    expect(await snapshot(storage)).toEqual(before);
  });

  it("Suggest a task copies the suggest prompt with what is known so far", async () => {
    renderApp(storageWith(), { view: "deck", deck: "credential" });
    await walk("Code review", "I can find bugs in a diff", "");
    await userEvent.click(screen.getByRole("button", { name: "Suggest a task" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const prompt = vi.mocked(writeText).mock.calls[0][0];
    expect(prompt).toContain("# Code review");
    expect(prompt).toContain("I can find bugs in a diff");
    expect(await screen.findByText(/Copied/)).toBeTruthy();
  });

  it("Test it on an agent opens the test with the new credential picked", async () => {
    renderApp(storageWith(), { view: "deck", deck: "credential" });
    await walk("Code review", "I can find bugs", "Review the diff");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    await userEvent.click(await screen.findByRole("button", { name: "Test it on an agent" }));
    expect(await screen.findByRole("heading", { name: "Who takes it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create an agent" })).toBeTruthy();
  });

  it("starting from a preset shows its targets on one card and makes the whole credential", async () => {
    const storage = storageWith();
    renderApp(storage, { view: "deck", deck: "credential" });
    await userEvent.click(await screen.findByRole("button", { name: "Tighten a learning target" }));
    expect(await screen.findByRole("heading", { name: "Tighten a learning target" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Learning targets" })).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));

    expect(await screen.findByRole("button", { name: "Test it on an agent" })).toBeTruthy();
    const state = await loadFolder(storage);
    const preset = presetCredential(findPreset("tighten-a-learning-target")!, state.collections[0].slug);
    expect(state.collections.map((c) => c.name)).toEqual(["My credentials"]);
    expect(state.credentials).toEqual([preset]);
  });

  it("Back from a preset returns to where to start, and your own still works", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, { view: "deck", deck: "credential" });
    await userEvent.click(await screen.findByRole("button", { name: "Run a Nostr relay" }));
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Where to start" })).toBeTruthy();
    await walk("Write docs", "I can explain a module", "Document the module");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    await screen.findByRole("button", { name: "Test it on an agent" });
    const state = await loadFolder(storage);
    expect(state.credentials.map((c) => c.name).sort()).toEqual(["Code review", "Write docs"]);
  });

  it("a preset made twice gets its own file", async () => {
    const storage = storageWith();
    for (let i = 0; i < 2; i++) {
      cleanup();
      renderApp(storage, { view: "deck", deck: "credential" });
      await userEvent.click(await screen.findByRole("button", { name: "Rate your own confidence" }));
      await userEvent.click(await screen.findByRole("button", { name: "Make the badge" }));
      await screen.findByRole("button", { name: "Test it on an agent" });
    }
    const state = await loadFolder(storage);
    expect(state.credentials.map((c) => c.slug).sort()).toEqual(["rate-your-own-confidence", "rate-your-own-confidence-2"]);
  });
});
