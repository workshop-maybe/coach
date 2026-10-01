// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SKELETON_PATH, handoffPath, loadFolder } from "../domain/folder";
import { BUILT_IN_HANDOFF, defaultHandoff, handoffsFor } from "../domain/handoffs";
import type { Handoff } from "../domain/types";
import type { MemoryStorage } from "../storage/memory";
import { backToTest } from "./HandoffDecks";
import { opus, renderApp, result, review, snapshot, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("./RichText", () => import("./richTextStub"));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const KEY = "eng/review";
const A = "20260901T090000Z";
const B = "20260902T090000Z";
const handoff = (id: string, text: string): Handoff => ({ collectionSlug: "eng", credentialSlug: "review", id, text });
const handoffA = handoff(A, "Handoff A\n\n{{task}}\n");
const handoffB = handoff(B, "Handoff B\n\n{{task}}\n");
const box = { view: "deck", deck: "handoffs", credentialKey: KEY } as const;

const field = () => screen.getByRole("textbox", { name: "Handoff" }) as HTMLTextAreaElement;

async function retype(text: string) {
  await userEvent.clear(field());
  await userEvent.click(field());
  await userEvent.paste(text);
}

async function read(storage: MemoryStorage, path: string) {
  return storage.readText("data", path);
}

describe("the handoffs deck", () => {
  it("opens from the badge's Handoffs part and draws the box with one button per handoff, the default marked", async () => {
    const storage = storageWith({ credentials: [review], handoffs: [handoffA, handoffB] });
    renderApp(storage, { view: "item", item: "badge", credentialKey: KEY });
    await userEvent.click(within(await screen.findByRole("list", { name: "Parts" })).getByRole("button", { name: /Handoffs/ }));

    expect(await screen.findByRole("heading", { name: "Handoffs" })).toBeTruthy();
    expect(document.querySelector(".deck svg.cast-handoff-box")).not.toBeNull();
    const choices = within(screen.getByRole("list", { name: "Handoffs" })).getAllByRole("button");
    expect(choices.map((b) => b.textContent)).toEqual(["A", "B · default"]);
    expect(screen.getByRole("button", { name: "Write a new handoff" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit the skeleton" })).toBeTruthy();
  });

  it("says the skeleton is the default when the badge has no handoffs", async () => {
    renderApp(storageWith({ credentials: [review] }), box);
    expect(await screen.findByText("This badge uses the skeleton")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Handoffs" })).toBeNull();
  });

  it("home has no door to the skeleton", async () => {
    renderApp(storageWith({ credentials: [review] }));
    await screen.findByRole("region", { name: "Badges" });
    expect(screen.queryByRole("button", { name: /skeleton/i })).toBeNull();
  });
});

describe("the handoff editor", () => {
  it("is a plain mono text field naming the three slots", async () => {
    renderApp(storageWith({ credentials: [review], handoffs: [handoffA] }), box);
    await userEvent.click(await screen.findByRole("button", { name: "A · default" }));
    expect(await screen.findByRole("heading", { name: "Handoff A" })).toBeTruthy();
    expect(field().tagName).toBe("TEXTAREA");
    expect(field().classList.contains("handoff-text")).toBe(true);
    expect(field().value).toBe(handoffA.text);
    const slots = document.querySelector(".handoff-slots")!.textContent!;
    for (const slot of ["{{name}}", "{{learning_targets}}", "{{task}}"]) expect(slots).toContain(slot);
  });

  it("saves a handoff with no result in place, with no warning, and returns to the box", async () => {
    const storage = storageWith({ credentials: [review], handoffs: [handoffA, handoffB] });
    renderApp(storage, box);
    await userEvent.click(await screen.findByRole("button", { name: "A" }));
    await retype("Edited A\n\n{{task}}\n");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Handoffs" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "This handoff has results" })).toBeNull();
    expect(await read(storage, handoffPath("eng", "review", A))).toBe("Edited A\n\n{{task}}\n");
    expect(handoffsFor(await loadFolder(storage), KEY)).toHaveLength(2);
  });

  it("Covers F4 / AE2. A handoff with a result warns, then saves as a new handoff that becomes the default", async () => {
    const ran = await result(opus, review, { handoff: { id: B, text: "filled B" } });
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [ran], handoffs: [handoffA, handoffB] });
    renderApp(storage, box);
    await userEvent.click(await screen.findByRole("button", { name: "B · default" }));
    await retype("Better B\n\n{{task}}\n");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("heading", { name: "This handoff has results" })).toBeTruthy();
    // Back keeps what was typed.
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(field().value).toBe("Better B\n\n{{task}}\n");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save as a new handoff" }));

    expect(await screen.findByRole("heading", { name: "Handoffs" })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(await read(storage, handoffPath("eng", "review", B))).toBe(handoffB.text);
    expect(state.assessments[0].handoff?.id).toBe(B);
    const own = handoffsFor(state, KEY);
    expect(own).toHaveLength(3);
    expect(defaultHandoff(state, KEY)).toEqual({ id: own[2].id, text: "Better B\n\n{{task}}\n" });
    expect(screen.getByRole("button", { name: "C · default" })).toBeTruthy();
  });

  it("a new handoff starts with the skeleton's text", async () => {
    const skeleton = "My skeleton\n\n{{task}}\n";
    const storage = storageWith({ credentials: [review], skeleton });
    renderApp(storage, box);
    await userEvent.click(await screen.findByRole("button", { name: "Write a new handoff" }));
    expect(await screen.findByRole("heading", { name: "Write a handoff" })).toBeTruthy();
    expect(field().value).toBe(skeleton);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "A · default" })).toBeTruthy();
    const own = handoffsFor(await loadFolder(storage), KEY);
    expect(own.map((h) => h.text)).toEqual([skeleton]);
  });

  it("saving without {{task}} names the task slot and writes nothing", async () => {
    const storage = storageWith({ credentials: [review], handoffs: [handoffA] });
    renderApp(storage, box);
    await userEvent.click(await screen.findByRole("button", { name: "A · default" }));
    const before = await snapshot(storage);
    await retype("No slot here\n");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toContain("{{task}}");
    expect(screen.getByRole("heading", { name: "Handoff A" })).toBeTruthy();
    expect(await snapshot(storage)).toEqual(before);
  });

  it("a locked handoff without {{task}} shows the error on the text card, before the warning", async () => {
    const ran = await result(opus, review, { handoff: { id: A, text: "filled A" } });
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [ran], handoffs: [handoffA] });
    renderApp(storage, box);
    await userEvent.click(await screen.findByRole("button", { name: "A · default" }));
    await retype("No slot here\n");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect((await screen.findByRole("alert")).textContent).toContain("{{task}}");
    expect(screen.getByRole("heading", { name: "Handoff A" })).toBeTruthy();
  });

  it("saving a badge handoff that holds its rubric shows the error and writes nothing", async () => {
    const secret = { ...review, rubric: "Finds the off-by-one." };
    const storage = storageWith({ credentials: [secret] });
    renderApp(storage, { view: "deck", deck: "edit-handoff", credentialKey: KEY, handoff: "new" });
    expect(await screen.findByRole("heading", { name: "Write a handoff" })).toBeTruthy();
    const before = await snapshot(storage);
    await retype("{{task}}\n\nFinds the off-by-one.\n");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/rubric/);
    expect(await snapshot(storage)).toEqual(before);
  });

  it("Covers AE1. The skeleton opens from the box with the built-in text and saves handoffs/skeleton.md", async () => {
    const storage = storageWith({ credentials: [review] });
    renderApp(storage, box);
    await userEvent.click(await screen.findByRole("button", { name: "Edit the skeleton" }));
    expect(await screen.findByRole("heading", { name: "The skeleton" })).toBeTruthy();
    expect(field().value).toBe(BUILT_IN_HANDOFF);
    await retype("Edited skeleton\n\n{{task}}\n");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Handoffs" })).toBeTruthy();
    expect(await read(storage, SKELETON_PATH)).toBe("Edited skeleton\n\n{{task}}\n");
    expect(defaultHandoff(await loadFolder(storage), KEY)).toEqual({ id: "skeleton", text: "Edited skeleton\n\n{{task}}\n" });
  });

  it("the skeleton saves only once changed, so an untouched folder keeps the built-in one", async () => {
    renderApp(storageWith({ credentials: [review] }), { view: "deck", deck: "edit-handoff", credentialKey: KEY, handoff: "skeleton" });
    expect(await screen.findByRole("heading", { name: "The skeleton" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a handoff opened from the test returns to the test after saving", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, { view: "deck", deck: "edit-handoff", credentialKey: KEY, handoff: "new", returnTo: { profileSlug: "opus", credentialKey: KEY } });
    expect(await screen.findByRole("heading", { name: "Write a handoff" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
  });

  it("a file changed on disk meanwhile turns into the conflict card", async () => {
    const storage = storageWith({ credentials: [review], handoffs: [handoffA] });
    renderApp(storage, box);
    await userEvent.click(await screen.findByRole("button", { name: "A · default" }));
    await retype("Mine\n\n{{task}}\n");
    storage.seed({ [handoffPath("eng", "review", A)]: "Theirs\n\n{{task}}\n" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Changed on disk" })).toBeTruthy();
    expect(await read(storage, handoffPath("eng", "review", A))).toBe("Theirs\n\n{{task}}\n");
  });
});

describe("backToTest", () => {
  it("returns to the test with the handoff it saved", () => {
    expect(backToTest({ profileSlug: "opus", credentialKey: KEY }, "skeleton")).toEqual({
      view: "deck",
      deck: "test",
      profileSlug: "opus",
      credentialKey: KEY,
      handoffId: "skeleton",
    });
  });

  it("keeps the test's own pick when nothing was saved", () => {
    expect(backToTest({ credentialKey: KEY, handoffId: A })).toEqual({ view: "deck", deck: "test", credentialKey: KEY, handoffId: A });
  });
});
