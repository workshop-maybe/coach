// @vitest-environment jsdom
// Add a collection (collections plan U4, R7-R11): a first card offering an empty one and each
// built-in, one card for what was picked, and a quiet request link when a repo is set.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BUILT_INS } from "../domain/builtins";
import { collectionPath, credentialPath, loadFolder, serializeCollection } from "../domain/folder";
import { addBuiltinCollection, trashCredential } from "../domain/operations";
import type { MemoryStorage } from "../storage/memory";
import { renderApp, storageWith } from "./testFolder";

const opener = vi.hoisted(() => ({ openUrl: vi.fn((_url: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

const repo = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("./collectionRequest", async (importOriginal) => {
  const real = await importOriginal<typeof import("./collectionRequest")>();
  return {
    ...real,
    get COLLECTION_REQUESTS_REPO() {
      return repo.value;
    },
  };
});

const fetchSpy = vi.fn();

beforeEach(() => {
  opener.openUrl.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  repo.value = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Nothing in the deck reaches the network.
  expect(fetchSpy).not.toHaveBeenCalled();
});

const nostr = BUILT_INS.find((b) => b.slug === "nostr-relays")!;
const [firstBadge, secondBadge] = nostr.collection.order;

async function openDeck(storage: MemoryStorage) {
  renderApp(storage, { view: "deck", deck: "collection" });
  await screen.findByRole("region", { name: "Add a collection" });
  return userEvent.setup();
}

const deck = () => screen.getByRole("region", { name: "Add a collection" });
const heading = () => within(deck()).getByRole("heading", { level: 2 }).textContent;
const choice = (name: string) => within(deck()).getByRole("button", { name: new RegExp(`^${name}`) });

async function expectHome() {
  expect(await screen.findByRole("heading", { name: "Home", level: 1 })).toBeTruthy();
}

describe("the first card", () => {
  it("offers an empty one and each built-in", async () => {
    await openDeck(storageWith());
    expect(heading()).toBe("Add a collection");
    expect(choice("Start an empty one")).toBeTruthy();
    for (const b of BUILT_INS) expect(choice(b.collection.name)).toBeTruthy();
  });

  it("shows no request link while no repo is set (AE5)", async () => {
    await openDeck(storageWith());
    expect(within(deck()).queryByRole("link", { name: "Request a collection" })).toBeNull();
  });

  it("opens the request page in the browser when a repo is set", async () => {
    repo.value = "workshop-maybe/andamio-collections";
    const user = await openDeck(storageWith());
    await user.click(within(deck()).getByRole("link", { name: "Request a collection" }));
    expect(opener.openUrl).toHaveBeenCalledWith(
      "https://github.com/workshop-maybe/andamio-collections/issues/new?template=request-a-collection.yml&title=Collection%3A+",
    );
    expect(heading()).toBe("Add a collection");
  });
});

describe("adding a built-in", () => {
  it("shows its description and badges, and Add the collection copies it and goes home", async () => {
    const storage = storageWith();
    const user = await openDeck(storage);
    await user.click(choice("Nostr relays"));
    expect(heading()).toBe("Nostr relays");
    expect(within(deck()).getByText(nostr.collection.description)).toBeTruthy();
    const names = within(within(deck()).getByRole("list", { name: "Badges" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(names).toHaveLength(2);
    await user.click(within(deck()).getByRole("button", { name: "Add the collection" }));
    await expectHome();
    expect(JSON.parse(storage.file(collectionPath("nostr-relays"))!).from).toBe("nostr-relays");
    expect(storage.file(credentialPath("nostr-relays", firstBadge))).toBe(nostr.credentials[firstBadge]);
    expect(storage.file(credentialPath("nostr-relays", secondBadge))).toBe(nostr.credentials[secondBadge]);
  });

  it("an added built-in shows as added and does nothing, and is addable again once its collection is gone (AE3)", async () => {
    const storage = storageWith();
    const added = await addBuiltinCollection(storage, await loadFolder(storage), "course-authoring");
    const user = await openDeck(storage);
    const writes = storage.writes.length;
    const course = choice("Course authoring");
    expect(course.getAttribute("aria-disabled")).toBe("true");
    expect(course.textContent).toContain("Added");
    await user.click(course);
    expect(heading()).toBe("Add a collection");
    expect(storage.writes.length).toBe(writes);
    cleanup();

    // The collection goes to the trash, every file under it.
    for (const path of await storage.listFiles("data", `collections/${added.slug}`)) await storage.moveFile("data", path, `trash/x/${path}`);
    const again = await openDeck(storage);
    expect(choice("Course authoring").getAttribute("aria-disabled")).toBeNull();
    await again.click(choice("Course authoring"));
    expect(within(deck()).getByRole("button", { name: "Add the collection" })).toBeTruthy();
  });

  it("a copy missing only a badge the user trashed still shows as added, and nothing is written", async () => {
    const storage = storageWith();
    const added = await addBuiltinCollection(storage, await loadFolder(storage), "nostr-relays");
    await trashCredential(storage, added.state, "nostr-relays", secondBadge);
    const user = await openDeck(storage);
    const writes = storage.writes.length;
    expect(choice("Nostr relays").getAttribute("aria-disabled")).toBe("true");
    await user.click(choice("Nostr relays"));
    expect(heading()).toBe("Add a collection");
    expect(storage.writes.length).toBe(writes);
  });

  it("a copy whose add stopped partway is offered again, and Add the collection writes only the missing badge", async () => {
    const storage = storageWith();
    await storage.writeText("data", collectionPath("nostr-relays"), serializeCollection({ ...nostr.collection, slug: "nostr-relays", from: "nostr-relays" }));
    await storage.writeText("data", credentialPath("nostr-relays", firstBadge), nostr.credentials[firstBadge]);
    const user = await openDeck(storage);
    expect(choice("Nostr relays").getAttribute("aria-disabled")).toBeNull();
    const writeSpy = vi.spyOn(storage, "writeText");
    await user.click(choice("Nostr relays"));
    await user.click(within(deck()).getByRole("button", { name: "Add the collection" }));
    await expectHome();
    expect(writeSpy.mock.calls.map(([, path]) => path)).toEqual([credentialPath("nostr-relays", secondBadge)]);
    expect((await loadFolder(storage)).collections.map((c) => c.slug)).toEqual(["nostr-relays"]);
  });
});

describe("starting an empty one", () => {
  it("asks its name, and Make the collection creates it and goes home", async () => {
    const storage = storageWith();
    const user = await openDeck(storage);
    await user.click(choice("Start an empty one"));
    expect(heading()).toBe("What is it called");
    const make = within(deck()).getByRole("button", { name: "Make the collection" }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    await user.type(within(deck()).getByLabelText("Name"), "Client work");
    await user.click(make);
    await expectHome();
    expect(JSON.parse(storage.file(collectionPath("client-work"))!)).toMatchObject({ name: "Client work", order: [], codes: {} });
  });
});
