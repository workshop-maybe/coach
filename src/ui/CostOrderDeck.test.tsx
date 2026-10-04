// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { COST_ORDER_PATH, loadFolder, profilePath } from "../domain/folder";
import { COST_ORDER_UNREADABLE } from "../domain/operations";
import type { AgentProfile } from "../domain/types";
import { opus, renderApp, review, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const codex: AgentProfile = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt" };
const sonnet: AgentProfile = { ...opus, slug: "sonnet", name: "Sonnet agent", model: "sonnet" };

const deck = () => screen.getByRole("region", { name: "Order by cost" });
const rows = () => within(screen.getByRole("list", { name: "Agents, cheapest first" })).getAllByRole("listitem");
const rowNames = () => rows().map((r) => r.querySelector(".cost-order-name")?.textContent);

describe("CostOrderDeck", () => {
  it("with no cost order, lists the agents by name, each not placed yet, and saving places them all", async () => {
    const storage = storageWith({ profiles: [sonnet, opus, codex] });
    renderApp(storage, { view: "deck", deck: "cost-order" });
    expect(await screen.findByRole("heading", { name: "Cheapest first" })).toBeTruthy();
    expect(rowNames()).toEqual(["Codex agent", "Opus agent", "Sonnet agent"]);
    expect(within(deck()).getAllByText("Not placed yet")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Save the order" }));
    await waitFor(async () => expect((await loadFolder(storage)).costOrder).toEqual(["codex", "opus", "sonnet"]));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeTruthy();
  });

  it("moves an agent up, disables the keys at the ends, and saves the new order", async () => {
    const storage = storageWith({ profiles: [sonnet, opus, codex], costOrder: ["sonnet", "codex", "opus"] });
    renderApp(storage, { view: "deck", deck: "cost-order" });
    await screen.findByRole("heading", { name: "Cheapest first" });
    expect(rowNames()).toEqual(["Sonnet agent", "Codex agent", "Opus agent"]);
    expect((screen.getByRole("button", { name: "Move Sonnet agent up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Opus agent down" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Move Codex agent up" }));
    expect(rowNames()).toEqual(["Codex agent", "Sonnet agent", "Opus agent"]);
    await userEvent.click(screen.getByRole("button", { name: "Save the order" }));
    await waitFor(async () => expect((await loadFolder(storage)).costOrder).toEqual(["codex", "sonnet", "opus"]));
  });

  it("keeps focus on the moved agent, on its other key once the pressed one disables, and says its new place", async () => {
    renderApp(storageWith({ profiles: [sonnet, opus, codex], costOrder: ["sonnet", "codex", "opus"] }), { view: "deck", deck: "cost-order" });
    await screen.findByRole("heading", { name: "Cheapest first" });
    screen.getByRole("button", { name: "Move Codex agent up" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Codex agent down" })));
    expect(screen.getByText("Codex agent, 1 of 3")).toBeTruthy();
  });

  it("an agent added after the order was saved comes last, not placed yet", async () => {
    renderApp(storageWith({ profiles: [sonnet, opus, codex], costOrder: ["sonnet", "opus"] }), { view: "deck", deck: "cost-order" });
    await screen.findByRole("heading", { name: "Cheapest first" });
    expect(rowNames()).toEqual(["Sonnet agent", "Opus agent", "Codex agent"]);
    expect(within(rows()[2]).getByText("Not placed yet")).toBeTruthy();
    expect(within(rows()[0]).queryByText("Not placed yet")).toBeNull();
  });

  it("a file changed on disk shows Changed on disk, and Keep mine saves over it", async () => {
    const storage = storageWith({ profiles: [sonnet, opus], costOrder: ["sonnet", "opus"] });
    renderApp(storage, { view: "deck", deck: "cost-order" });
    await screen.findByRole("heading", { name: "Cheapest first" });
    await storage.writeText("data", COST_ORDER_PATH, '{"agents":["opus"]}\n');
    await userEvent.click(screen.getByRole("button", { name: "Save the order" }));
    expect(await screen.findByRole("heading", { name: "Changed on disk" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(async () => expect((await loadFolder(storage)).costOrder).toEqual(["sonnet", "opus"]));
  });

  it("an unreadable cost-order.json is never written over, and the deck says why", async () => {
    const storage = storageWith({ profiles: [sonnet, opus] });
    await storage.writeText("data", COST_ORDER_PATH, "{ not json");
    renderApp(storage, { view: "deck", deck: "cost-order" });
    await screen.findByRole("heading", { name: "Cheapest first" });
    await userEvent.click(screen.getByRole("button", { name: "Save the order" }));
    expect((await within(deck()).findByRole("alert")).textContent).toBe(COST_ORDER_UNREADABLE);
    expect(await storage.readText("data", COST_ORDER_PATH)).toBe("{ not json");
  });

  it("an agent trashed while the deck is open drops out of the list", async () => {
    const storage = storageWith({ profiles: [sonnet, opus], costOrder: ["sonnet", "opus"] });
    renderApp(storage, { view: "deck", deck: "cost-order" });
    await screen.findByRole("heading", { name: "Cheapest first" });
    await storage.moveFile("data", profilePath("sonnet"), "trash/x/agents/sonnet.json");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(rowNames()).toEqual(["Opus agent"]));
  });

  it("opened with a router resume, saving navigates back to the router with it", async () => {
    const storage = storageWith({ profiles: [sonnet, opus], credentials: [review] });
    renderApp(storage, { view: "deck", deck: "cost-order", returnTo: { job: "Review the diff", picked: "eng/review" } });
    await screen.findByRole("heading", { name: "Cheapest first" });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Order by cost" })).toBeNull());
    expect(screen.queryByRole("heading", { name: "Home" })).toBeNull();
  });
});

describe("Home's agent list in cost order (router R10, R11)", () => {
  it("lists agents cheapest first, unplaced ones last, and Order by cost opens the deck", async () => {
    renderApp(storageWith({ profiles: [sonnet, opus, codex], costOrder: ["sonnet", "codex"] }));
    const agents = await screen.findByRole("region", { name: "Agents" });
    const names = within(agents)
      .getAllByRole("button")
      .map((b) => b.querySelector(".agent-card-name")?.textContent)
      .filter(Boolean);
    expect(names).toEqual(["Sonnet agent", "Codex agent", "Opus agent"]);
    await userEvent.click(within(agents).getByRole("button", { name: "Order by cost" }));
    expect(await screen.findByRole("region", { name: "Order by cost" })).toBeTruthy();
  });
});
