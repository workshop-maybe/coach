// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadFolder } from "../domain/folder";
import { setupName } from "./PlayerCard";
import { opus, renderApp, result, review, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
const dial = (name: string) => screen.getByRole("radiogroup", { name });
const checked = (name: string) => within(dial(name)).getByRole("radio", { checked: true });

describe("setupName", () => {
  it("names an agent for its setup, with a number when that name is taken", () => {
    const setup = { harness: "claude-code", model: "opus", effort: "high" };
    expect(setupName(setup, [])).toBe("Claude Code, opus, high");
    expect(setupName(setup, ["Claude Code, opus, high"])).toBe("Claude Code, opus, high 2");
    expect(setupName(setup, ["claude code, opus, high", "Claude Code, opus, high 2"])).toBe("Claude Code, opus, high 3");
  });
});

describe("PlayerCard", () => {
  it("is one card: a person, three dials and one button", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    expect(await screen.findByRole("heading", { name: "Claude Code, opus, high" })).toBeTruthy();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Make the agent" })).toBeTruthy();
  });

  it("arrow keys move through a dial's values, and the name follows", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    checked("Effort").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(checked("Effort").textContent).toBe("max");
    expect(heading()).toBe("Claude Code, opus, max");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(checked("Effort").textContent).toBe("medium");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("medium"));
  });

  it("switching the harness resets the model to that harness's first model", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    await userEvent.click(screen.getByRole("button", { name: "Next model" }));
    expect(checked("Model").textContent).toBe("sonnet");
    await userEvent.click(screen.getByRole("button", { name: "Next harness" }));
    expect(checked("Harness").textContent).toBe("Codex");
    expect(checked("Model").textContent).toBe("gpt-5-codex");
    expect(heading()).toBe("Codex, gpt-5-codex, high");
  });

  it("Other turns a dial into one line to type on the same card", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    await userEvent.click(screen.getByRole("button", { name: "Previous harness" }));
    expect(checked("Harness").textContent).toBe("Other");
    const make = screen.getByRole("button", { name: "Make the agent" }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    await userEvent.type(screen.getByRole("textbox", { name: "Harness, other" }), "aider");
    await userEvent.type(screen.getByRole("textbox", { name: "Model, other" }), "local-7b");
    expect(heading()).toBe("aider, local-7b, high");
    expect(make.disabled).toBe(false);
  });

  it("a taken name gets a number", async () => {
    renderApp(storageWith({ profiles: [{ ...opus, name: "Claude Code, opus, high" }] }), { view: "deck", deck: "agent" });
    expect(await screen.findByRole("heading", { name: "Claude Code, opus, high 2" })).toBeTruthy();
  });

  it("making the agent creates the profile and goes home, where it stands on the shelf", async () => {
    const storage = storageWith();
    renderApp(storage, { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    await userEvent.click(screen.getByRole("button", { name: "Next effort" }));
    await userEvent.click(screen.getByRole("button", { name: "Make the agent" }));
    const agents = await screen.findByRole("region", { name: "Agents" });
    expect(within(agents).getByRole("button", { name: /Claude Code, opus, max/ })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(state.profiles).toEqual([
      expect.objectContaining({ name: "Claude Code, opus, max", harness: "claude-code", model: "opus", effort: "max", repo: "", params: {} }),
    ]);
  });

  it("an agent with results is locked and offers a new agent like it", async () => {
    const withRepo = { ...opus, effort: "medium", repo: "~/code/app", params: { temp: "0" } };
    const storage = storageWith({ credentials: [review], profiles: [withRepo], assessments: [await result(withRepo, review)] });
    renderApp(storage, { view: "item", item: "agent", profileSlug: "opus" });
    expect(await screen.findByRole("heading", { name: "Opus agent" })).toBeTruthy();
    expect(dial("Harness").getAttribute("aria-disabled")).toBe("true");
    expect(checked("Effort").textContent).toBe("medium");
    expect((screen.getByRole("button", { name: "Next effort" }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Make a new agent like this" }));
    expect(await screen.findByRole("heading", { name: "Claude Code, opus, medium" })).toBeTruthy();
    expect(dial("Harness").getAttribute("aria-disabled")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next effort" }));
    await userEvent.click(screen.getByRole("button", { name: "Make the agent" }));
    // The new agent opens, not the one it was made from.
    expect(await screen.findByRole("heading", { name: "Claude Code, opus, high", level: 2 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep this setup" })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(state.profiles.find((p) => p.slug !== "opus")).toMatchObject({ name: "Claude Code, opus, high", effort: "high", repo: "~/code/app", params: { temp: "0" } });
    expect(state.profiles.find((p) => p.slug === "opus")).toMatchObject({ effort: "medium" });
  });
});
