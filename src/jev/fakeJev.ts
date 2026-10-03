// A Jev port for tests (KTD5). With nothing queued it mirrors the native rules that need
// no network: keys are trimmed and checked, setting one turns Jev Mode on, clearing it
// turns Jev Mode off, and an ask is refused while off or with no key. Tests queue what
// the next call of a method returns, fails with or waits on, and read `calls` to see what
// the UI asked for. The budget check is the web view's own, so a test queues "tooLong".
//
// The key is never recorded in `calls` and is held only in a private field, so printing
// the fake never shows it. `holdsKey` answers whether a given key was the one set.

import type { JevAnswers, JevRequest } from "../domain/jevRequest";
import { JEV_OFF, JevError, type Jev, type JevStatus } from "./jev";

export type JevMethod = keyof Jev;

interface Results {
  status: JevStatus;
  setKey: JevStatus;
  clearKey: JevStatus;
  setOn: JevStatus;
  ask: JevAnswers;
}

/** What a queued call does: resolve to a value, reject with a JevError, or settle with a promise the test controls. */
export type FakeOutcome<M extends JevMethod> = Results[M] | JevError | Promise<Results[M]>;

/** One call the UI made. The key passed to `setKey` is not recorded. */
export type FakeJevCall =
  | { method: "status" }
  | { method: "setKey" }
  | { method: "clearKey" }
  | { method: "setOn"; on: boolean }
  | { method: "ask"; request: JevRequest };

/** Jev Mode on with a key in the keychain. */
export const FAKE_ON: JevStatus = { on: true, hasKey: true, storage: "keychain", hint: "c0de" };

/** The probability an ask gives every requested id when no answer is queued. */
export const FAKE_ANSWER = 0.5;

const MAX_KEY_CHARS = 512;
const HINT_MIN_CHARS = 12;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

export class FakeJev implements Jev {
  /** Every call, in order. */
  readonly calls: FakeJevCall[] = [];

  #state: JevStatus;
  #key: string | null = null;
  readonly #queues: { [M in JevMethod]: FakeOutcome<M>[] } = { status: [], setKey: [], clearKey: [], setOn: [], ask: [] };

  /** Starts from a status, off by default. A status with `hasKey` models a key already saved. */
  constructor(initial: JevStatus = JEV_OFF) {
    this.#state = { ...initial };
  }

  /**
   * Queues what the next call of `method` does, ahead of the native rules. A status that
   * resolves becomes the fake's status, as if the native side had saved it. An ask is
   * still refused while off or with no key, before anything queued is used.
   */
  queue<M extends JevMethod>(method: M, outcome: FakeOutcome<M>): void {
    this.#queues[method].push(outcome);
  }

  /** The status the fake holds now, without recording a call. */
  get current(): JevStatus {
    return { ...this.#state };
  }

  /** Every request sent to `ask`, in order, including refused ones. */
  get asks(): JevRequest[] {
    return this.calls.flatMap((c) => (c.method === "ask" ? [c.request] : []));
  }

  /** True when the key held now is exactly `key`, as set after trimming. */
  holdsKey(key: string): boolean {
    return this.#key !== null && this.#key === key;
  }

  status(): Promise<JevStatus> {
    this.calls.push({ method: "status" });
    return this.#change("status", () => this.#state);
  }

  setKey(key: string): Promise<JevStatus> {
    this.calls.push({ method: "setKey" });
    return this.#change("setKey", () => {
      const trimmed = key.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_KEY_CHARS || !PRINTABLE_ASCII.test(trimmed)) {
        throw new JevError("invalidKey");
      }
      this.#key = trimmed;
      return { on: true, hasKey: true, storage: "keychain", hint: trimmed.length >= HINT_MIN_CHARS ? trimmed.slice(-4) : null };
    });
  }

  clearKey(): Promise<JevStatus> {
    this.calls.push({ method: "clearKey" });
    return this.#change("clearKey", () => JEV_OFF);
  }

  setOn(on: boolean): Promise<JevStatus> {
    this.calls.push({ method: "setOn", on });
    return this.#change("setOn", () => {
      if (on && !this.#state.hasKey) throw new JevError("keyMissing");
      return { ...this.#state, on };
    });
  }

  async ask(request: JevRequest): Promise<JevAnswers> {
    this.calls.push({ method: "ask", request });
    if (!this.#state.on) throw new JevError("off");
    if (!this.#state.hasKey) throw new JevError("keyMissing");
    try {
      return await this.#serve("ask", () => ({
        answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, FAKE_ANSWER])),
      }));
    } catch (e) {
      // As natively: an ask that finds no key clears the stored key from settings.
      if (e instanceof JevError && e.kind === "keyMissing") {
        this.#state = { ...this.#state, hasKey: false, storage: null, hint: null };
        this.#key = null;
      }
      throw e;
    }
  }

  /** The next queued outcome for `method`, or the native rule when nothing is queued. */
  async #serve<M extends JevMethod>(method: M, otherwise: () => Results[M]): Promise<Results[M]> {
    const next = this.#queues[method].shift() as FakeOutcome<M> | undefined;
    if (next === undefined) return otherwise();
    if (next instanceof JevError) throw next;
    return await next;
  }

  /** Serves a status-returning call and keeps what it resolved to. */
  async #change(method: "status" | "setKey" | "clearKey" | "setOn", otherwise: () => JevStatus): Promise<JevStatus> {
    const next = { ...(await this.#serve(method, otherwise)) };
    this.#state = next;
    if (!next.hasKey) this.#key = null;
    return { ...next };
  }
}
