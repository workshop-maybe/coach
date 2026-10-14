// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { JEV_MODEL, type LineBreaksRequest } from "../domain/jevRequest";
import { JEV_OFF, JevError, type Jev, type JevStatus } from "../jev/jev";
import { FAKE_ANSWER, FAKE_ON, FakeJev } from "../jev/fakeJev";
import { JevProvider, useJev } from "./jevContext";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(cleanup);

const KEY = "ts-live-0123456789abcdef";

const pasteCleanup: LineBreaksRequest = {
  kind: "lineBreaks",
  state: "L001| a line that\nL002| wrapped\nL003| here",
  questions: {
    L002: { type: "noul", instructions: "Does L002 continue L001?" },
    L003: { type: "noul", instructions: "Does L003 continue L002?" },
  },
};

function within(jev: Jev) {
  return renderHook(() => useJev(), {
    wrapper: ({ children }: { children: ReactNode }) => <JevProvider jev={jev}>{children}</JevProvider>,
  });
}

async function loaded(jev: Jev) {
  const hook = within(jev);
  await waitFor(() => expect(hook.result.current.phase).not.toBe("loading"));
  return hook;
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useJev outside a provider", () => {
  it("reads as off", () => {
    const { result } = renderHook(() => useJev());
    expect(result.current.usable).toBe(false);
    expect(result.current.status).toEqual(JEV_OFF);
  });

  it("sends nothing: every action rejects as off and refresh does nothing", async () => {
    const { result } = renderHook(() => useJev());
    await expect(result.current.ask(pasteCleanup)).rejects.toMatchObject({ kind: "off" });
    await expect(result.current.setKey(KEY)).rejects.toBeInstanceOf(JevError);
    await expect(result.current.setOn(true)).rejects.toMatchObject({ kind: "off" });
    await expect(result.current.clearKey()).rejects.toMatchObject({ kind: "off" });
    await expect(result.current.refresh()).resolves.toBeUndefined();
    expect(result.current.status).toEqual(JEV_OFF);
  });
});

describe("JevProvider status", () => {
  it("is not usable while status is loading", async () => {
    const fake = new FakeJev(FAKE_ON);
    const pending = deferred<JevStatus>();
    fake.queue("status", pending.promise);
    const { result } = within(fake);
    expect(result.current.phase).toBe("loading");
    expect(result.current.usable).toBe(false);
    expect(result.current.status).toEqual(JEV_OFF);

    await act(async () => pending.resolve(FAKE_ON));
    expect(result.current.phase).toBe("ready");
    expect(result.current.usable).toBe(true);
  });

  it("is usable when on with a key held, and shows where the key is and its hint", async () => {
    const { result } = await loaded(new FakeJev({ on: true, hasKey: true, storage: "session", hint: "cdef" }));
    expect(result.current.usable).toBe(true);
    expect(result.current.status).toEqual({ on: true, hasKey: true, storage: "session", hint: "cdef" });
  });

  it("is not usable when on with no key, or with a key while off", async () => {
    const noKey = await loaded(new FakeJev({ on: true, hasKey: false, storage: null, hint: null }));
    expect(noKey.result.current.phase).toBe("ready");
    expect(noKey.result.current.usable).toBe(false);

    const switchedOff = await loaded(new FakeJev({ ...FAKE_ON, on: false }));
    expect(switchedOff.result.current.usable).toBe(false);
    expect(switchedOff.result.current.status.hasKey).toBe(true);
  });

  it("reads as off by default, as on a first run", async () => {
    const fake = new FakeJev();
    const { result } = await loaded(fake);
    expect(result.current.status).toEqual(JEV_OFF);
    expect(result.current.usable).toBe(false);
    expect(fake.calls).toEqual([{ method: "status" }]);
  });

  it("reads a status error as off", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("status", new JevError("other"));
    const { result } = await loaded(fake);
    expect(result.current.phase).toBe("failed");
    expect(result.current.status).toEqual(JEV_OFF);
    expect(result.current.usable).toBe(false);
  });

  it("reads a port that throws something other than a JevError as off", async () => {
    const broken: Jev = {
      status: async () => {
        throw new TypeError("no Tauri bridge");
      },
      setKey: async () => JEV_OFF,
      clearKey: async () => JEV_OFF,
      setOn: async () => JEV_OFF,
      ask: async () => ({ answers: {} }),
    };
    const { result } = await loaded(broken);
    expect(result.current.phase).toBe("failed");
    expect(result.current.usable).toBe(false);
  });

  it("refresh picks up a status changed outside, keeping the last one until it lands", async () => {
    const fake = new FakeJev(FAKE_ON);
    const { result } = await loaded(fake);
    const pending = deferred<JevStatus>();
    fake.queue("status", pending.promise);

    let refreshed!: Promise<void>;
    act(() => {
      refreshed = result.current.refresh();
    });
    expect(result.current.usable).toBe(true);

    await act(async () => {
      pending.resolve({ ...FAKE_ON, on: false });
      await refreshed;
    });
    expect(result.current.usable).toBe(false);
    expect(result.current.status.on).toBe(false);
  });

  it("a refresh that fails reads as off, and the next good one recovers", async () => {
    const fake = new FakeJev(FAKE_ON);
    const { result } = await loaded(fake);
    fake.queue("status", new JevError("other"));
    await act(() => result.current.refresh());
    expect(result.current.phase).toBe("failed");
    expect(result.current.usable).toBe(false);

    await act(() => result.current.refresh());
    expect(result.current.phase).toBe("ready");
    expect(result.current.usable).toBe(true);
  });
});

describe("JevProvider actions", () => {
  it("setting a key turns Jev Mode on and shows its hint, and never records the key", async () => {
    const fake = new FakeJev();
    const { result } = await loaded(fake);
    let status!: JevStatus;
    await act(async () => {
      status = await result.current.setKey(`  ${KEY}\n`);
    });
    expect(status).toEqual({ on: true, hasKey: true, storage: "keychain", hint: "cdef" });
    expect(result.current.status).toEqual(status);
    expect(result.current.usable).toBe(true);
    expect(fake.holdsKey(KEY)).toBe(true);
    expect(fake.calls).toEqual([{ method: "status" }, { method: "setKey" }]);
    expect(JSON.stringify(fake)).not.toContain(KEY);
    expect(JSON.stringify(result.current)).not.toContain(KEY);
  });

  it("gives a short key no hint", async () => {
    const { result } = await loaded(new FakeJev());
    await act(() => result.current.setKey("short-key"));
    expect(result.current.status).toMatchObject({ hasKey: true, hint: null });
  });

  it("refuses an empty, overlong or non-ASCII key and changes nothing", async () => {
    const fake = new FakeJev();
    const { result } = await loaded(fake);
    for (const bad of ["   ", "x".repeat(513), "ключ-0123456789"]) {
      await act(() => expect(result.current.setKey(bad)).rejects.toMatchObject({ kind: "invalidKey" }));
    }
    expect(result.current.status).toEqual(JEV_OFF);
    expect(fake.holdsKey("ключ-0123456789")).toBe(false);
  });

  it("turning off keeps the key, turning on again needs no key, and clearing the key turns it off", async () => {
    const fake = new FakeJev();
    const { result } = await loaded(fake);
    await act(() => result.current.setKey(KEY));

    await act(() => result.current.setOn(false));
    expect(result.current.usable).toBe(false);
    expect(result.current.status).toMatchObject({ on: false, hasKey: true, hint: "cdef" });
    expect(fake.holdsKey(KEY)).toBe(true);

    await act(() => result.current.setOn(true));
    expect(result.current.usable).toBe(true);

    await act(() => result.current.clearKey());
    expect(result.current.status).toEqual(JEV_OFF);
    expect(result.current.usable).toBe(false);
    expect(fake.holdsKey(KEY)).toBe(false);
    expect(fake.current).toEqual(JEV_OFF);
  });

  it("refuses to turn on with no key", async () => {
    const { result } = await loaded(new FakeJev());
    await act(() => expect(result.current.setOn(true)).rejects.toMatchObject({ kind: "keyMissing" }));
    expect(result.current.status).toEqual(JEV_OFF);
  });

  it("a failed change keeps the status, and the next call goes through", async () => {
    const fake = new FakeJev();
    const { result } = await loaded(fake);
    fake.queue("setKey", new JevError("keychain"));
    await act(() => expect(result.current.setKey(KEY)).rejects.toMatchObject({ kind: "keychain" }));
    expect(result.current.status).toEqual(JEV_OFF);
    expect(fake.holdsKey(KEY)).toBe(false);

    await act(() => result.current.setKey(KEY));
    expect(result.current.usable).toBe(true);
  });

  it("a status read that lands after a change never replaces it", async () => {
    const fake = new FakeJev();
    const slow = deferred<JevStatus>();
    fake.queue("status", slow.promise);
    const { result } = within(fake);
    await act(() => result.current.setKey(KEY));
    expect(result.current.usable).toBe(true);

    await act(async () => slow.resolve(JEV_OFF));
    expect(result.current.usable).toBe(true);
    expect(result.current.phase).toBe("ready");
  });
});

describe("JevProvider ask", () => {
  it("passes the request through and resolves to the queued answers", async () => {
    const fake = new FakeJev(FAKE_ON);
    const { result } = await loaded(fake);
    fake.queue("ask", { answers: { L002: 0.97, L003: 0.04 } });
    await act(() => expect(result.current.ask(pasteCleanup)).resolves.toEqual({ answers: { L002: 0.97, L003: 0.04 } }));
    expect(fake.asks).toEqual([pasteCleanup]);
  });

  it("answers every requested id when nothing is queued", async () => {
    const { result } = await loaded(new FakeJev(FAKE_ON));
    await act(() => expect(result.current.ask(pasteCleanup)).resolves.toEqual({ answers: { L002: FAKE_ANSWER, L003: FAKE_ANSWER }, model: JEV_MODEL }));
  });

  it("serves queued answers and errors per call, in order", async () => {
    const fake = new FakeJev(FAKE_ON);
    const { result } = await loaded(fake);
    fake.queue("ask", { answers: { L002: 1, L003: 0 } });
    fake.queue("ask", new JevError("rateLimited", { retryAfter: 12 }));
    fake.queue("ask", new JevError("unreachable"));
    await act(() => expect(result.current.ask(pasteCleanup)).resolves.toEqual({ answers: { L002: 1, L003: 0 } }));
    await act(() => expect(result.current.ask(pasteCleanup)).rejects.toMatchObject({ kind: "rateLimited", retryAfter: 12 }));
    await act(() => expect(result.current.ask(pasteCleanup)).rejects.toMatchObject({ kind: "unreachable", retryAfter: null }));
    expect(fake.asks).toHaveLength(3);
  });

  it("a refused key reads as one error and leaves Jev Mode as it was", async () => {
    const fake = new FakeJev(FAKE_ON);
    const { result } = await loaded(fake);
    fake.queue("ask", new JevError("keyRefused"));
    await act(() => expect(result.current.ask(pasteCleanup)).rejects.toMatchObject({ kind: "keyRefused" }));
    expect(result.current.usable).toBe(true);
  });

  it("an ask that finds the key gone re-reads status, so Jev is no longer offered and the deck asks for the key", async () => {
    const fake = new FakeJev(FAKE_ON);
    const { result } = await loaded(fake);
    fake.queue("ask", new JevError("keyMissing"));
    await act(() => expect(result.current.ask(pasteCleanup)).rejects.toMatchObject({ kind: "keyMissing" }));
    await waitFor(() => expect(result.current.usable).toBe(false));
    expect(result.current.status).toMatchObject({ on: true, hasKey: false, storage: null, hint: null });
  });

  it("the fake refuses an ask while off or with no key, as the native side does", async () => {
    const off = new FakeJev();
    const offHook = await loaded(off);
    await act(() => expect(offHook.result.current.ask(pasteCleanup)).rejects.toMatchObject({ kind: "off" }));

    const keyless = new FakeJev({ on: true, hasKey: false, storage: null, hint: null });
    const keylessHook = await loaded(keyless);
    await act(() => expect(keylessHook.result.current.ask(pasteCleanup)).rejects.toMatchObject({ kind: "keyMissing" }));
  });

  it("records no ask when none is sent", async () => {
    const fake = new FakeJev(FAKE_ON);
    await loaded(fake);
    expect(fake.asks).toEqual([]);
  });
});

describe("the app's Jev provider", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  async function renderApp(handlers: Record<string, () => unknown>) {
    invoke.mockImplementation(async (cmd: string) => {
      const handler = handlers[cmd];
      if (!handler) throw `unhandled command ${cmd}`;
      return handler();
    });
    const { default: App } = await import("../App");
    render(<App />);
  }

  it("reads Jev status once at start, alongside the folder gate", async () => {
    await renderApp({ get_data_folder: () => ({ status: "missing", remembered: "/gone" }), jev_status: () => JEV_OFF });
    await screen.findByRole("button", { name: "Choose folder" });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "jev_status")).toEqual([["jev_status"]]);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "jev_ask")).toBe(false);
  });

  it("still opens the gate when Jev status can't be read", async () => {
    await renderApp({
      get_data_folder: () => ({ status: "missing", remembered: "/gone" }),
      jev_status: () => {
        throw "command jev_status not found";
      },
    });
    await screen.findByRole("button", { name: "Choose folder" });
    expect(invoke).toHaveBeenCalledWith("jev_status");
  });
});
