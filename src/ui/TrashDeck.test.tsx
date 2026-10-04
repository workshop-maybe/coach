// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { collectionPath, loadFolder } from "../domain/folder";
import { addPending, readPending } from "./pendingTests";
import { FOLDER, heldReply, opus, renderApp, result, review, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const trashed = (storage: ReturnType<typeof storageWith>) => Object.keys(storage.files()).filter((p) => p.startsWith("trash/"));

describe("Move to trash", () => {
  it("an agent moves to the trash with its results after one card, and home no longer shows it", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)] });
    renderApp(storage, { view: "item", item: "agent", profileSlug: "opus" });
    await userEvent.click(await screen.findByRole("button", { name: "Move to trash" }));
    expect(await screen.findByRole("heading", { name: "Move Opus agent to trash" })).toBeTruthy();
    expect(screen.getByText("Its result goes with it.")).toBeTruthy();
    expect(screen.queryByText(/pulled with no result/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Move to trash" }));
    await screen.findAllByRole("button", { name: /Create an agent/ });
    expect(screen.queryByRole("button", { name: /Opus agent/ })).toBeNull();
    const state = await loadFolder(storage);
    expect(state.profiles).toEqual([]);
    expect(state.assessments).toEqual([]);
    expect(trashed(storage)).toHaveLength(2);
  });

  it("a credential moves to the trash after one card, and Back leaves it where it was", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, { view: "item", item: "badge", credentialKey: "eng/review" });
    await userEvent.click(await screen.findByRole("button", { name: "Move to trash" }));
    expect(await screen.findByRole("heading", { name: "Move Code review to trash" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Code review" })).toBeTruthy();
    expect(trashed(storage)).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Move to trash" }));
    await userEvent.click(await screen.findByRole("button", { name: "Move to trash" }));
    await screen.findByRole("region", { name: "Agents" });
    expect((await loadFolder(storage)).credentials).toEqual([]);
    expect(trashed(storage).map((p) => p.replace(/^trash\/\d{8}T\d{6}Z\//, ""))).toEqual(["collections/eng/collection.json", "collections/eng/credentials/review.md"]);
  });

  it("a collection changed on disk stops the move: Use theirs moves nothing, Keep mine moves it", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, { view: "deck", deck: "trash", item: { kind: "badge", credentialKey: "eng/review" } });
    await screen.findByRole("heading", { name: "Move Code review to trash" });
    storage.seed({ [collectionPath("eng")]: `${storage.file(collectionPath("eng"))}\n` });
    await userEvent.click(screen.getByRole("button", { name: "Move to trash" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use theirs" }));
    expect(await screen.findByRole("heading", { name: "Code review" })).toBeTruthy();
    expect(trashed(storage)).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Move to trash" }));
    storage.seed({ [collectionPath("eng")]: `${storage.file(collectionPath("eng"))}\n` });
    await userEvent.click(await screen.findByRole("button", { name: "Move to trash" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
    await screen.findAllByRole("button", { name: /Create a credential/ });
    expect((await loadFolder(storage)).credentials).toEqual([]);
  });

  it("Covers GAP-9. Trashing a plugged agent says its handoff is pulled with no result, and the plug is gone afterward", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    addPending(FOLDER, { profileSlug: "opus", credentialKey: "eng/review", copiedAt: "2026-09-30T09:00:00.000Z", assignmentVersion: "v", setup: { harness: opus.harness, model: opus.model, effort: opus.effort } });
    renderApp(storage, { view: "deck", deck: "trash", item: { kind: "agent", profileSlug: "opus" } });
    expect(await screen.findByText("Its handoff is pulled with no result.")).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "Move to trash" }));
    await screen.findAllByRole("button", { name: /Create an agent/ });
    expect(readPending(FOLDER)).toEqual([]);
  });

  it("trashing a badge plugged into an agent says that handoff is pulled with no result, and the plug is gone afterward", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    addPending(FOLDER, { profileSlug: "opus", credentialKey: "eng/review", copiedAt: "2026-09-30T09:00:00.000Z", assignmentVersion: "v", setup: { harness: opus.harness, model: opus.model, effort: opus.effort } });
    renderApp(storage, { view: "deck", deck: "trash", item: { kind: "badge", credentialKey: "eng/review" } });
    expect(await screen.findByText("Opus agent's handoff is pulled with no result.")).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "Move to trash" }));
    await screen.findAllByRole("button", { name: /Create a credential/ });
    expect(readPending(FOLDER)).toEqual([]);
  });
  describe("counts held replies beside results", () => {
    const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5" };
    const docs = { ...review, slug: "docs", name: "Write docs", task: "Document the module." };
    const line = async (opts: Parameters<typeof storageWith>[0], item: { kind: "agent"; profileSlug: string } | { kind: "badge"; credentialKey: string }) => {
      renderApp(storageWith(opts), { view: "deck", deck: "trash", item });
      await screen.findByRole("heading", { name: /^Move .* to trash$/ });
      return screen.getAllByText(/(goes|go) with it\.$|has no results\.$/).map((p) => p.textContent);
    };

    it("an agent with a result and a held reply names both", async () => {
      expect(await line({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)], held: [await heldReply(opus, review)] }, { kind: "agent", profileSlug: "opus" })).toEqual([
        "Its result and its held reply go with it.",
      ]);
    });

    it("a badge with two results and two held replies from different agents counts each", async () => {
      const assessments = [await result(opus, review), await result(codex, review, { result: "not_met" })];
      const held = [await heldReply(opus, review), await heldReply(codex, review)];
      expect(await line({ credentials: [review], profiles: [opus, codex], assessments, held }, { kind: "badge", credentialKey: "eng/review" })).toEqual([
        "Its 2 results and 2 held replies go with it.",
      ]);
    });

    it("an agent with only held replies names them, and counts none on other agents", async () => {
      const held = [await heldReply(opus, review), await heldReply(opus, docs), await heldReply(codex, review)];
      expect(await line({ credentials: [review, docs], profiles: [opus, codex], held }, { kind: "agent", profileSlug: "opus" })).toEqual(["Its 2 held replies go with it."]);
    });

    it("an agent with one held reply and two results names the held reply as its", async () => {
      const assessments = [await result(opus, review), await result(opus, docs)];
      expect(await line({ credentials: [review, docs], profiles: [opus], assessments, held: [await heldReply(opus, docs)] }, { kind: "agent", profileSlug: "opus" })).toEqual([
        "Its 2 results and its held reply go with it.",
      ]);
    });

    it("an agent with nothing keeps the plain line", async () => {
      expect(await line({ credentials: [review], profiles: [opus] }, { kind: "agent", profileSlug: "opus" })).toEqual(["It has no results."]);
    });
  });
});
