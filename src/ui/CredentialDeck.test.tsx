// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { loadFolder } from "../domain/folder";
import { renderApp, review, snapshot, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; these flows type into a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(writeText).mockReset();
});
afterEach(cleanup);

async function walk(name: string, target: string, task: string) {
  await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), name);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Learning target" }), target);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  if (task) await userEvent.type(screen.getByRole("textbox", { name: "Task" }), task);
}

describe("CredentialDeck", () => {
  it("asks one thing per card: its name, one thing its holder can do, then the task", async () => {
    renderApp(storageWith(), { view: "deck", deck: "credential" });
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

  it("closing mid-deck writes nothing", async () => {
    const storage = storageWith();
    const before = await snapshot(storage);
    renderApp(storage, { view: "deck", deck: "credential" });
    await walk("Code review", "I can find bugs", "Review it");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("button", { name: "Create a credential" })).toBeTruthy();
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
});
