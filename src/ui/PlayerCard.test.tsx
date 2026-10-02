// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadFolder } from "../domain/folder";
import { setupName } from "./PlayerCard";
import { opus, renderApp, result, review, snapshot, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
const dial = (name: string) => screen.getByRole("radiogroup", { name });
const checked = (name: string) => within(dial(name)).getByRole("radio", { checked: true });
const encoder = (d: string) => document.querySelector(`svg.cast-machine [data-dial="${d}"]`)!;
const angle = (d: string) => encoder(d).getAttribute("data-angle");

describe("setupName", () => {
  it("names an agent for its setup, with a number when that name is taken", () => {
    const setup = { harness: "claude-code", model: "opus", effort: "high" };
    expect(setupName(setup, [])).toBe("Claude Code, opus, high");
    expect(setupName(setup, ["Claude Code, opus, high"])).toBe("Claude Code, opus, high 2");
    expect(setupName(setup, ["claude code, opus, high", "Claude Code, opus, high 2"])).toBe("Claude Code, opus, high 3");
  });

  it("names a pinned version after its model", () => {
    expect(setupName({ harness: "claude-code", model: "opus-5.5", effort: "high" }, [])).toBe("Claude Code, opus 5.5, high");
  });
});

describe("PlayerCard", () => {
  it("is one card: a machine, its dials and one button", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    expect(await screen.findByRole("heading", { name: "Claude Code, opus, high" })).toBeTruthy();
    expect(document.querySelectorAll("svg.cast-machine [data-dial]")).toHaveLength(3);
    expect(screen.getAllByRole("radiogroup").map((g) => g.getAttribute("aria-label"))).toEqual(["Harness", "Model", "Version", "Effort"]);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Make the agent" })).toBeTruthy();
  });

  it("arrow keys move through a dial's values, and the name follows", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    checked("Effort").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(checked("Effort").textContent).toBe("xhigh");
    expect(heading()).toBe("Claude Code, opus, xhigh");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(checked("Effort").textContent).toBe("medium");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("medium"));
  });

  it("clicking an encoder turns its dial, and Shift turns it back", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    fireEvent.click(encoder("effort"));
    expect(checked("Effort").textContent).toBe("xhigh");
    expect(heading()).toBe("Claude Code, opus, xhigh");
    fireEvent.click(encoder("effort"), { shiftKey: true });
    fireEvent.click(encoder("effort"), { shiftKey: true });
    expect(checked("Effort").textContent).toBe("medium");

    fireEvent.click(encoder("harness"));
    expect(checked("Harness").textContent).toBe("Codex");
    expect(checked("Model").textContent).toBe("gpt-6-astra");
    expect(heading()).toBe("Codex, gpt-6-astra, medium");
  });

  it("changing a dial turns that encoder, and only that one", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    const [harness, model, effort] = [angle("harness"), angle("model"), angle("effort")];
    await userEvent.click(screen.getByRole("button", { name: "Next model" }));
    expect(angle("model")).not.toBe(model);
    expect([angle("harness"), angle("effort")]).toEqual([harness, effort]);
  });

  it("switching the harness resets the model to that harness's first model", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    await userEvent.click(screen.getByRole("button", { name: "Next model" }));
    expect(checked("Model").textContent).toBe("sonnet");
    await userEvent.click(screen.getByRole("button", { name: "Next harness" }));
    expect(checked("Harness").textContent).toBe("Codex");
    expect(checked("Model").textContent).toBe("gpt-6-astra");
    expect(heading()).toBe("Codex, gpt-6-astra, high");
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

  it("a model typed on an earlier agent joins that harness's dial, before Other", async () => {
    renderApp(storageWith({ profiles: [{ ...opus, model: "my-model" }] }), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    const models = within(dial("Model")).getAllByRole("radio").map((r) => r.textContent);
    expect(models.slice(-2)).toEqual(["my-model", "Other"]);
    await userEvent.click(within(dial("Model")).getByRole("radio", { name: "my-model" }));
    expect(heading()).toBe("Claude Code, my-model, high");
    expect(screen.queryByRole("textbox", { name: "Model, other" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next harness" }));
    expect(within(dial("Model")).queryByRole("radio", { name: "my-model" })).toBeNull();
  });

  it("a model with versions shows a Version dial that starts at latest", async () => {
    const storage = storageWith();
    renderApp(storage, { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    expect(checked("Version").textContent).toBe("latest");
    await userEvent.click(within(dial("Version")).getByRole("radio", { name: "5.5" }));
    expect(heading()).toBe("Claude Code, opus 5.5, high");
    await userEvent.click(screen.getByRole("button", { name: "Make the agent" }));
    await screen.findByRole("region", { name: "Agents" });
    expect((await loadFolder(storage)).profiles).toEqual([expect.objectContaining({ name: "Claude Code, opus 5.5, high", model: "opus-5.5" })]);
  });

  it("changing the model starts its version at latest again", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    await userEvent.click(within(dial("Version")).getByRole("radio", { name: "4.8" }));
    await userEvent.click(screen.getByRole("button", { name: "Next model" }));
    expect(checked("Model").textContent).toBe("sonnet");
    expect(checked("Version").textContent).toBe("latest");
    expect(heading()).toBe("Claude Code, sonnet, high");
  });

  it("a model without known versions, or typed under Other, shows no Version dial", async () => {
    renderApp(storageWith(), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    await userEvent.click(within(dial("Model")).getByRole("radio", { name: "Other" }));
    expect(screen.queryByRole("radiogroup", { name: "Version" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next harness" }));
    expect(checked("Harness").textContent).toBe("Codex");
    expect(screen.queryByRole("radiogroup", { name: "Version" })).toBeNull();
  });

  it("an agent pinned to a version opens with its model and version checked", async () => {
    renderApp(storageWith({ profiles: [{ ...opus, model: "opus-4.7" }] }), { view: "item", item: "agent", profileSlug: "opus" });
    await screen.findByRole("button", { name: "Keep this setup" });
    expect(checked("Model").textContent).toBe("opus");
    expect(checked("Version").textContent).toBe("4.7");
  });

  it("a pinned version never shows up as a remembered model", async () => {
    renderApp(storageWith({ profiles: [{ ...opus, model: "opus-5.5" }] }), { view: "deck", deck: "agent" });
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    expect(within(dial("Model")).queryByRole("radio", { name: "opus-5.5" })).toBeNull();
  });

  it("an agent with a custom effort opens with that effort checked", async () => {
    renderApp(storageWith({ profiles: [{ ...opus, effort: "ultra" }] }), { view: "item", item: "agent", profileSlug: "opus" });
    await screen.findByRole("button", { name: "Keep this setup" });
    expect(checked("Effort").textContent).toBe("ultra");
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
    expect(within(agents).getByRole("button", { name: /Claude Code, opus, xhigh/ })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(state.profiles).toEqual([
      expect.objectContaining({ name: "Claude Code, opus, xhigh", harness: "claude-code", model: "opus", effort: "xhigh", repo: "", params: {} }),
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
    fireEvent.click(encoder("effort"));
    expect(checked("Effort").textContent).toBe("medium");

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

describe("PlayerCard in first-test mode", () => {
  const firstTest = { view: "deck", deck: "agent", firstTest: true } as const;

  it("Make the agent makes the agent and the first badge, then opens the test at Hand it over", async () => {
    const storage = storageWith();
    renderApp(storage, firstTest);
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    await userEvent.click(screen.getByRole("button", { name: "Make the agent" }));

    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(state.profiles.map((p) => p.name)).toEqual(["Claude Code, opus, high"]);
    expect(state.credentials.map((c) => c.name)).toEqual(["Name what matters next"]);
  });

  it("Close before Make the agent writes nothing and goes home", async () => {
    const storage = storageWith();
    const before = await snapshot(storage);
    renderApp(storage, firstTest);
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Home", level: 1 })).toBeTruthy();
    expect(await snapshot(storage)).toEqual(before);
  });

  it("a failed badge save shows on the card, and a retry makes the badge without a second agent", async () => {
    const storage = storageWith();
    const real = storage.writeText.bind(storage);
    let failed = false;
    vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
      if (!failed && path.endsWith(".md")) {
        failed = true;
        throw new Error("disk full");
      }
      return real(root, path, text);
    });
    renderApp(storage, firstTest);
    await screen.findByRole("heading", { name: "Claude Code, opus, high" });
    await userEvent.click(screen.getByRole("button", { name: "Make the agent" }));
    expect((await screen.findByRole("alert")).textContent).toContain("disk full");
    // The card keeps its title once the made agent is in the folder, and its dials hold still.
    expect(heading()).toBe("Claude Code, opus, high");
    expect(dial("Harness").getAttribute("aria-disabled")).toBe("true");
    expect((screen.getByRole("button", { name: "Next effort" }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Make the agent" }));
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(state.profiles).toHaveLength(1);
    expect(state.credentials.map((c) => c.name)).toEqual(["Name what matters next"]);
  });
});
