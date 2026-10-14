// @vitest-environment jsdom
// Renaming a collection (collections plan U6, R3): one card, the name only, saved against
// the text it opened with.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { collectionPath, credentialPath, loadFolder, serializeCollection } from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import type { Collection } from "../domain/types";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { renderApp, review, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const mine: Collection = {
  slug: "my-credentials",
  name: "My credentials",
  description: "",
  // An order that lists a badge with no file, as an unfinished copy's does: a rename keeps it.
  order: ["review", "ghost"],
  codes: { review: 1, ghost: 2 },
};
const client: Collection = { slug: "client", name: "Client work", description: "", order: [], codes: {} };

/** My credentials holding Code review, beside an empty Client work. */
function folder() {
  const storage = storageWith();
  storage.seed({
    [collectionPath(mine.slug)]: serializeCollection(mine),
    [credentialPath(mine.slug, review.slug)]: serializeCredentialMd({ ...review, collectionSlug: mine.slug }),
    [collectionPath(client.slug)]: serializeCollection(client),
  });
  return storage;
}

const onDisk = (storage: ReturnType<typeof storageWith>, slug = mine.slug) => JSON.parse(storage.file(collectionPath(slug))!);

async function rename(to: string) {
  const name = (await screen.findByRole("textbox", { name: "Name" })) as HTMLInputElement;
  await userEvent.clear(name);
  await userEvent.type(name, to);
  await userEvent.click(screen.getByRole("button", { name: "Rename the collection" }));
}

describe("Rename a collection", () => {
  it("renaming My credentials to Daily work changes its name only, lights it on Home, and a badge route still resolves", async () => {
    const storage = folder();
    const before = onDisk(storage);
    renderApp(storage, { view: "deck", deck: "edit-collection", collectionSlug: mine.slug, part: "name" });
    expect(await screen.findByRole("heading", { name: "What is it called" })).toBeTruthy();
    await rename("Daily work");

    const heading = await screen.findByRole("heading", { name: "Daily work", level: 3 });
    expect(heading.closest(".collection-group")?.classList.contains("lit")).toBe(true);
    expect(onDisk(storage)).toEqual({ ...before, name: "Daily work" });
    const state = await loadFolder(storage);
    expect(state.collections.map((c) => [c.slug, c.name])).toEqual([
      ["client", "Client work"],
      ["my-credentials", "Daily work"],
    ]);

    // A badge route opened before the rename names the same badge.
    cleanup();
    renderApp(storage, { view: "item", item: "badge", credentialKey: "my-credentials/review" });
    expect(await screen.findByRole("heading", { name: "Code review" })).toBeTruthy();
  });

  it("the forward action waits for a new name, and Close goes home with nothing saved", async () => {
    const storage = folder();
    const before = storage.file(collectionPath(mine.slug));
    renderApp(storage, { view: "deck", deck: "edit-collection", collectionSlug: mine.slug, part: "name" });
    const forward = await screen.findByRole("button", { name: "Rename the collection" });
    expect((forward as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Home", level: 1 })).toBeTruthy();
    expect(storage.file(collectionPath(mine.slug))).toBe(before);
  });

  it("a rename while collection.json changed on disk shows the conflict card: Use theirs saves nothing, Keep mine keeps both", async () => {
    const storage = folder();
    renderApp(storage, { view: "deck", deck: "edit-collection", collectionSlug: mine.slug, part: "name" });
    await screen.findByRole("heading", { name: "What is it called" });
    const theirs = serializeCollection({ ...mine, description: "Changed elsewhere." });
    storage.seed({ [collectionPath(mine.slug)]: theirs });
    await rename("Daily work");
    await userEvent.click(await screen.findByRole("button", { name: "Use theirs" }));
    expect(await screen.findByRole("heading", { name: "Home", level: 1 })).toBeTruthy();
    expect(storage.file(collectionPath(mine.slug))).toBe(theirs);

    await userEvent.click(await screen.findByRole("button", { name: "Rename My credentials" }));
    await screen.findByRole("heading", { name: "What is it called" });
    storage.seed({ [collectionPath(mine.slug)]: serializeCollection({ ...mine, description: "Changed again." }) });
    await rename("Daily work");
    await userEvent.click(await screen.findByRole("button", { name: "Keep mine" }));
    await screen.findByRole("heading", { name: "Daily work", level: 3 });
    expect(onDisk(storage)).toMatchObject({ name: "Daily work", description: "Changed again.", order: mine.order, codes: mine.codes });
  });

  it("open while the folder reloads without the collection, shows Not in the folder", async () => {
    const storage = folder();
    renderApp(storage, { view: "deck", deck: "edit-collection", collectionSlug: client.slug, part: "name" });
    await screen.findByRole("heading", { name: "What is it called" });
    storage.remove(collectionPath(client.slug));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    const region = await screen.findByRole("region", { name: "Badges" });
    await waitFor(() => expect(within(region).queryByRole("heading", { name: "Client work" })).toBeNull());
  });
});

describe("The task edit", () => {
  it("offers Suggest a task, which copies a prompt asking for one assignment for the badge's targets (KTD9)", async () => {
    const storage = storageWith({ credentials: [{ ...review, task: "" }] });
    renderApp(storage, { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part: "task" });
    await userEvent.click(await screen.findByRole("button", { name: "Suggest a task" }));
    const copied = vi.mocked(writeText).mock.lastCall?.[0] ?? "";
    expect(copied).toContain(review.learningTargets[0]);
    expect(copied).toMatch(/exactly one assignment/i);
  });
});
