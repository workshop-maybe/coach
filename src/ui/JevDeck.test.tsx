// @vitest-environment jsdom
// The Jev Mode deck (U3, KTD6): one beat whose forward action follows Jev Mode's state, a
// key field that keeps no key once it is sent, and a plain account of what leaves the machine.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JEV_OFF, JevError, type JevStatus } from "../jev/jev";
import { FAKE_ON, FakeJev } from "../jev/fakeJev";
import { AppShell, type Route } from "./AppShell";
import { JevProvider } from "./jevContext";
import { FOLDER, storageWith } from "./testFolder";
import { FolderProvider } from "./useFolderState";

const opener = vi.hoisted(() => ({ openUrl: vi.fn((_url: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

beforeEach(() => opener.openUrl.mockClear());
afterEach(cleanup);

const KEY = "ts-live-0123456789abcdef";
const OFF_WITH_KEY: JevStatus = { ...FAKE_ON, on: false };
const TERMS = "https://docs.typesafe.ai/legal";

/** The app over an empty folder, with Jev Mode served by `fake`, open on the Jev Mode deck. */
async function openDeck(fake: FakeJev, initialRoute: Route = { view: "deck", deck: "jev" }) {
  const user = userEvent.setup();
  render(
    <JevProvider jev={fake}>
      <FolderProvider storage={storageWith()} folder={FOLDER}>
        <AppShell onChangeFolder={() => {}} initialRoute={initialRoute} />
      </FolderProvider>
    </JevProvider>,
  );
  if (initialRoute.view === "deck") await screen.findByRole("region", { name: "Jev Mode" });
  return { user, press: (name: string) => user.click(screen.getByRole("button", { name })) };
}

const deck = () => screen.getByRole("region", { name: "Jev Mode" });
const keyField = () => screen.queryByLabelText("TypeSafe API key") as HTMLInputElement | null;
const forward = () => deck().querySelector<HTMLButtonElement>("button.primary")!;
const heading = () => within(deck()).getByRole("heading", { level: 2 }).textContent;

async function expectHome() {
  expect(await screen.findByRole("button", { name: "Try a first test" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Jev Mode" })).toBeNull();
}

describe("the top bar", () => {
  it("opens the Jev Mode deck from home", async () => {
    const { press } = await openDeck(new FakeJev(), { view: "home" });
    await screen.findByRole("button", { name: "Try a first test" });
    await press("Jev Mode");
    expect(await screen.findByRole("region", { name: "Jev Mode" })).toBeTruthy();
  });
});

describe("off with no key", () => {
  it("entering a key and choosing Turn on Jev Mode stores the key, turns Jev Mode on and returns home (F1)", async () => {
    const fake = new FakeJev();
    const { user } = await openDeck(fake);
    expect(heading()).toBe("Your TypeSafe key");
    expect(forward().textContent).toBe("Turn on Jev Mode");
    await user.type(keyField()!, KEY);
    await user.click(forward());
    await expectHome();
    expect(fake.calls.map((c) => c.method)).toEqual(["status", "setKey"]);
    expect(fake.holdsKey(KEY)).toBe(true);
    expect(fake.current.on).toBe(true);
  });

  it("a key held for this session only keeps the deck open on the line that says so", async () => {
    const fake = new FakeJev();
    fake.queue("setKey", { on: true, hasKey: true, storage: "session", hint: "cdef" });
    const { user } = await openDeck(fake);
    await user.type(keyField()!, KEY);
    await user.click(forward());
    expect(await within(deck()).findByText(/won't be remembered/)).toBeTruthy();
    expect(heading()).toBe("Jev Mode is on");
  });

  it("puts focus in a masked key field with autocomplete and spellcheck off", async () => {
    await openDeck(new FakeJev());
    const field = keyField()!;
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.type).toBe("password");
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
  });

  it("keeps the forward action disabled while the key is empty or only whitespace", async () => {
    const { user } = await openDeck(new FakeJev());
    expect(forward().disabled).toBe(true);
    await user.type(keyField()!, "   ");
    expect(forward().disabled).toBe(true);
    await user.type(keyField()!, "k");
    expect(forward().disabled).toBe(false);
  });

  it("stores a key pasted with a trailing newline trimmed, and Enter sends it", async () => {
    const fake = new FakeJev();
    const setKey = vi.spyOn(fake, "setKey");
    const { user } = await openDeck(fake);
    await user.click(keyField()!);
    await user.paste(`  ${KEY}\n`);
    await user.keyboard("{Enter}");
    await expectHome();
    expect(setKey).toHaveBeenCalledWith(KEY);
  });

  it("keeps no key text once it is sent, even when storing it fails", async () => {
    const fake = new FakeJev();
    fake.queue("setKey", new JevError("keychain"));
    const { user } = await openDeck(fake);
    await user.type(keyField()!, KEY);
    await user.click(forward());
    expect(await within(deck()).findByRole("alert")).toBeTruthy();
    expect(keyField()!.value).toBe("");
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it("a store failure shows one line and leaves Jev Mode off", async () => {
    const fake = new FakeJev();
    fake.queue("setKey", new JevError("keychain"));
    const { user } = await openDeck(fake);
    await user.type(keyField()!, KEY);
    await user.click(forward());
    const alerts = await within(deck()).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toBe("The keychain didn't allow it, so nothing changed.");
    expect(fake.current).toEqual(JEV_OFF);
    expect(heading()).toBe("Your TypeSafe key");
  });

  it("a key the app can't take says so and leaves Jev Mode off", async () => {
    const fake = new FakeJev();
    const { user } = await openDeck(fake);
    await user.type(keyField()!, "bad key é");
    await user.click(forward());
    expect((await within(deck()).findByRole("alert")).textContent).toBe("That doesn't look like a TypeSafe key.");
    expect(fake.current).toEqual(JEV_OFF);
  });

  it("an unreadable settings file says nothing changed", async () => {
    const fake = new FakeJev();
    fake.queue("setKey", new JevError("settings"));
    const { user } = await openDeck(fake);
    await user.type(keyField()!, KEY);
    await user.click(forward());
    expect((await within(deck()).findByRole("alert")).textContent).toBe("The app's settings couldn't be read, so nothing changed.");
  });

  it("closing the deck drops a typed key", async () => {
    const { user, press } = await openDeck(new FakeJev());
    await user.type(keyField()!, KEY);
    await press("Close");
    await expectHome();
    expect(document.body.innerHTML).not.toContain(KEY);
    await press("Jev Mode");
    await screen.findByRole("region", { name: "Jev Mode" });
    expect(keyField()!.value).toBe("");
  });
});

describe("off with a key", () => {
  it("offers Turn on Jev Mode with no key field, and the quiet actions", async () => {
    await openDeck(new FakeJev(OFF_WITH_KEY));
    expect(heading()).toBe("Jev Mode is off");
    expect(forward().textContent).toBe("Turn on Jev Mode");
    expect(keyField()).toBeNull();
    expect(within(deck()).getByRole("button", { name: "Use a new key" })).toBeTruthy();
    expect(within(deck()).getByRole("button", { name: "Remove the key" })).toBeTruthy();
  });

  it("Turn on Jev Mode turns it on without asking for the key, and returns home", async () => {
    const fake = new FakeJev(OFF_WITH_KEY);
    const { user } = await openDeck(fake);
    await user.click(forward());
    await expectHome();
    expect(fake.calls).toEqual([{ method: "status" }, { method: "setOn", on: true }]);
    expect(fake.current.on).toBe(true);
  });

  it("a key gone missing meanwhile asks for the key again", async () => {
    const fake = new FakeJev(OFF_WITH_KEY);
    const { user } = await openDeck(fake);
    // Queued once the deck is open, so the first status read is not the one that takes it.
    fake.queue("setOn", new JevError("keyMissing"));
    fake.queue("status", JEV_OFF);
    await user.click(forward());
    expect((await within(deck()).findByRole("alert")).textContent).toBe("The key is gone. Paste it again.");
    await waitFor(() => expect(heading()).toBe("Your TypeSafe key"));
    expect(keyField()).toBeTruthy();
  });
});

describe("on", () => {
  it("offers Turn off Jev Mode with the key's hint and the quiet actions", async () => {
    await openDeck(new FakeJev(FAKE_ON));
    expect(heading()).toBe("Jev Mode is on");
    expect(forward().textContent).toBe("Turn off Jev Mode");
    expect(within(deck()).getByText("Your key ends in c0de.")).toBeTruthy();
    expect(within(deck()).getByRole("button", { name: "Use a new key" })).toBeTruthy();
    expect(within(deck()).getByRole("button", { name: "Remove the key" })).toBeTruthy();
  });

  it("Turn off Jev Mode keeps the key, and turning it on again asks for no key", async () => {
    const fake = new FakeJev(FAKE_ON);
    const { press, user } = await openDeck(fake);
    await user.click(forward());
    await expectHome();
    expect(fake.current).toEqual({ ...FAKE_ON, on: false });
    await press("Jev Mode");
    await screen.findByRole("region", { name: "Jev Mode" });
    expect(heading()).toBe("Jev Mode is off");
    expect(keyField()).toBeNull();
    await user.click(forward());
    await expectHome();
    expect(fake.current).toEqual(FAKE_ON);
    expect(fake.calls.filter((c) => c.method === "setKey")).toEqual([]);
  });

  it("a short key shows no hint", async () => {
    await openDeck(new FakeJev({ ...FAKE_ON, hint: null }));
    expect(heading()).toBe("Jev Mode is on");
    expect(within(deck()).queryByText(/ends in/)).toBeNull();
    expect(within(deck()).getByText("Your key is saved.")).toBeTruthy();
  });

  it("a session key says it won't be remembered", async () => {
    await openDeck(new FakeJev({ ...FAKE_ON, storage: "session" }));
    expect(within(deck()).getByText(/won't be remembered after you quit/)).toBeTruthy();
  });

  it("a keychain key says nothing about being forgotten", async () => {
    await openDeck(new FakeJev(FAKE_ON));
    expect(within(deck()).queryByText(/won't be remembered/)).toBeNull();
  });
});

describe("on with the key missing", () => {
  it("asks for the key again, and the key turns Jev Mode back on", async () => {
    const fake = new FakeJev({ on: true, hasKey: false, storage: null, hint: null });
    const { user } = await openDeck(fake);
    expect(heading()).toBe("Your TypeSafe key");
    expect(within(deck()).getByText("The key is gone. Paste it again.")).toBeTruthy();
    expect(forward().textContent).toBe("Turn on Jev Mode");
    await user.type(keyField()!, KEY);
    await user.click(forward());
    await expectHome();
    expect(fake.holdsKey(KEY)).toBe(true);
    expect(fake.current.on).toBe(true);
  });
});

describe("Remove the key", () => {
  it("clears the key, leaves Jev Mode off and returns home", async () => {
    const fake = new FakeJev(FAKE_ON);
    const { press } = await openDeck(fake);
    await press("Remove the key");
    await expectHome();
    expect(fake.calls.map((c) => c.method)).toEqual(["status", "clearKey"]);
    expect(fake.current).toEqual(JEV_OFF);
  });

  it("a failed removal says so and changes nothing", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("clearKey", new JevError("keychain"));
    const { press } = await openDeck(fake);
    await press("Remove the key");
    expect((await within(deck()).findByRole("alert")).textContent).toBe("The keychain didn't allow it, so nothing changed.");
    expect(fake.current).toEqual(FAKE_ON);
    expect(heading()).toBe("Jev Mode is on");
  });
});

describe("Use a new key", () => {
  it("swaps the beat to the key field with Replace the key as its one forward action", async () => {
    const { press } = await openDeck(new FakeJev(FAKE_ON));
    await press("Use a new key");
    expect(heading()).toBe("A new key");
    expect(forward().textContent).toBe("Replace the key");
    expect(forward().disabled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(keyField()));
    expect(within(deck()).queryByRole("button", { name: "Turn off Jev Mode" })).toBeNull();
  });

  it("replaces the stored key and leaves Jev Mode on when it was on", async () => {
    const fake = new FakeJev(FAKE_ON);
    const { press, user } = await openDeck(fake);
    await press("Use a new key");
    await user.type(keyField()!, KEY);
    await user.click(forward());
    await expectHome();
    expect(fake.holdsKey(KEY)).toBe(true);
    expect(fake.current).toEqual({ on: true, hasKey: true, storage: "keychain", hint: "cdef" });
    expect(fake.calls.map((c) => c.method)).toEqual(["status", "setKey"]);
  });

  it("replaces the stored key and leaves Jev Mode off when it was off", async () => {
    const fake = new FakeJev(OFF_WITH_KEY);
    const { press, user } = await openDeck(fake);
    await press("Use a new key");
    await user.type(keyField()!, KEY);
    await user.click(forward());
    await expectHome();
    expect(fake.holdsKey(KEY)).toBe(true);
    expect(fake.current).toEqual({ on: false, hasKey: true, storage: "keychain", hint: "cdef" });
    expect(fake.calls).toEqual([{ method: "status" }, { method: "setKey" }, { method: "setOn", on: false }]);
  });

  it("Back returns to the state before and changes nothing", async () => {
    const fake = new FakeJev(OFF_WITH_KEY);
    const { press, user } = await openDeck(fake);
    await press("Use a new key");
    await user.type(keyField()!, KEY);
    await press("Back");
    expect(heading()).toBe("Jev Mode is off");
    expect(forward().textContent).toBe("Turn on Jev Mode");
    expect(fake.calls).toEqual([{ method: "status" }]);
    expect(fake.current).toEqual(OFF_WITH_KEY);
    expect(document.body.innerHTML).not.toContain(KEY);
    await press("Use a new key");
    expect(keyField()!.value).toBe("");
  });

  it("a store failure keeps the old key and says so", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("setKey", new JevError("keychain"));
    const { press, user } = await openDeck(fake);
    await press("Use a new key");
    await user.type(keyField()!, KEY);
    await user.click(forward());
    expect((await within(deck()).findByRole("alert")).textContent).toBe("The keychain didn't allow it, so nothing changed.");
    expect(fake.current).toEqual(FAKE_ON);
    expect(keyField()!.value).toBe("");
  });
});

describe("what the deck says leaves the machine", () => {
  it.each([
    ["off with no key", JEV_OFF],
    ["off with a key", OFF_WITH_KEY],
    ["on", FAKE_ON],
  ])("names TypeSafe, what each use sends, and links to its terms (%s)", async (_, status) => {
    await openDeck(new FakeJev(status));
    const d = within(deck());
    expect(d.getByText(/TypeSafe's Jev model/)).toBeTruthy();
    expect(d.getByText(/Nothing is sent until you ask\./)).toBeTruthy();
    expect(
      d.getByText(
        "A second opinion sends the reply, the badge's task, rubric and learning targets, and the openings of a few earlier replies on this badge with your notes on them.",
      ),
    ).toBeTruthy();
    expect(d.queryByText("A second opinion sends the reply, the badge's task and its rubric.")).toBeNull();
    // Comparing sends two replies at a time (jev-in-compare R17, KTD17).
    expect(d.getByText("A comparison sends two replies at a time, with the badge's task, rubric and learning targets.")).toBeTruthy();
    expect(d.getByText("A cleanup sends only the text you pasted.")).toBeTruthy();
    expect(d.getByText("A routing ask sends the job, and the names, tasks and learning targets of your badges.")).toBeTruthy();
    expect(d.getByText(/TypeSafe keeps what it receives under/)).toBeTruthy();
    expect(d.getByRole("link", { name: "its terms" }).getAttribute("href")).toBe(TERMS);
  });

  it("opens the terms in the system browser on a click or a middle-click, and the window stays put", async () => {
    await openDeck(new FakeJev());
    const link = within(deck()).getByRole("link", { name: "its terms" });
    expect(fireEvent.click(link)).toBe(false);
    expect(opener.openUrl.mock.calls).toEqual([[TERMS]]);
    expect(fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
    expect(opener.openUrl.mock.calls).toEqual([[TERMS], [TERMS]]);
  });

  it("keeps the webview's own menu and drag off the terms link", async () => {
    await openDeck(new FakeJev());
    const link = within(deck()).getByRole("link", { name: "its terms" });
    expect(fireEvent.contextMenu(link)).toBe(false);
    expect(fireEvent.dragStart(link)).toBe(false);
    expect(fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 }))).toBe(false);
    expect(opener.openUrl).not.toHaveBeenCalled();
  });
});

describe("while status loads", () => {
  it("shows no state until Jev Mode's status is known", async () => {
    let resolve!: (s: JevStatus) => void;
    const fake = new FakeJev(FAKE_ON);
    fake.queue("status", new Promise<JevStatus>((r) => (resolve = r)));
    render(
      <JevProvider jev={fake}>
        <FolderProvider storage={storageWith()} folder={FOLDER}>
          <AppShell onChangeFolder={() => {}} initialRoute={{ view: "deck", deck: "jev" }} />
        </FolderProvider>
      </JevProvider>,
    );
    await screen.findByRole("banner");
    expect(screen.queryByRole("region", { name: "Jev Mode" })).toBeNull();
    resolve(FAKE_ON);
    expect(await screen.findByRole("heading", { name: "Jev Mode is on" })).toBeTruthy();
  });
});
