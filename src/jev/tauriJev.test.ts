import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineBreaksRequest, SecondOpinionRequest } from "../domain/jevRequest";
import { JEV_ERROR_KINDS, JEV_OFF, JevError, isUsable, toJevError, type JevStatus } from "./jev";
import { TauriJev } from "./tauriJev";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const ON: JevStatus = { on: true, hasKey: true, storage: "keychain", hint: "c0de" };

const secondOpinion: SecondOpinionRequest = {
  kind: "secondOpinion",
  state: {
    task: "Review the diff.",
    rubric_points: ["Finds the bug"],
    rubric_notes: "",
    rubric: "- Finds the bug",
    learning_targets: ["I can find a bug in a diff"],
    reply: "Done",
  },
  questions: {
    p1: {
      type: "noul",
      instructions: { point: "Finds the bug", question: "Does the `reply` meet the `point`?" },
      criteria: { true: { what: "names the bug", examples: [{ reply_opening: "The bug is on line 4." }] }, false: "only asserts it" },
    },
    t1: { type: "noul", instructions: { target: "I can find a bug in a diff", question: "Does `reply` show the work `target` describes?" } },
    overall: { type: "noul", instructions: "Does the `reply` meet the rubric?" },
  },
};

const lineBreaks: LineBreaksRequest = {
  kind: "lineBreaks",
  state: "L001| a long line that\nL002| wrapped here",
  questions: { L002: { type: "noul", instructions: "Does L002 continue L001?" } },
};

beforeEach(() => {
  invoke.mockReset();
});

describe("TauriJev", () => {
  const jev = new TauriJev();

  it("reads status with no arguments", async () => {
    invoke.mockResolvedValueOnce(JEV_OFF);
    expect(await jev.status()).toEqual(JEV_OFF);
    expect(invoke).toHaveBeenCalledWith("jev_status");
    expect(invoke.mock.calls[0]).toHaveLength(1);
  });

  it("sends the key as `key` and returns the status", async () => {
    invoke.mockResolvedValueOnce(ON);
    expect(await jev.setKey("ts-live-abcdefc0de")).toEqual(ON);
    expect(invoke).toHaveBeenCalledWith("jev_set_key", { key: "ts-live-abcdefc0de" });
  });

  it("clears the key with no arguments", async () => {
    invoke.mockResolvedValueOnce(JEV_OFF);
    expect(await jev.clearKey()).toEqual(JEV_OFF);
    expect(invoke.mock.calls).toEqual([["jev_clear_key"]]);
  });

  it("turns Jev Mode on or off as `on`", async () => {
    invoke.mockResolvedValueOnce(ON).mockResolvedValueOnce({ ...ON, on: false });
    expect(await jev.setOn(true)).toEqual(ON);
    expect((await jev.setOn(false)).on).toBe(false);
    expect(invoke.mock.calls).toEqual([
      ["jev_set_on", { on: true }],
      ["jev_set_on", { on: false }],
    ]);
  });

  it("sends either request shape as `request` and returns the answers", async () => {
    invoke
      .mockResolvedValueOnce({ answers: { p1: 0.9, t1: 0.4, overall: 0.7 }, model: "jev-1.13.0" })
      .mockResolvedValueOnce({ answers: { L002: 0.95 }, model: "jev-1.13.0" });
    expect(await jev.ask(secondOpinion)).toEqual({ answers: { p1: 0.9, t1: 0.4, overall: 0.7 }, model: "jev-1.13.0" });
    expect(await jev.ask(lineBreaks)).toEqual({ answers: { L002: 0.95 }, model: "jev-1.13.0" });
    expect(invoke.mock.calls).toEqual([
      ["jev_ask", { request: secondOpinion }],
      ["jev_ask", { request: lineBreaks }],
    ]);
  });

  it("passes the model that answered through unchanged (KTD3)", async () => {
    invoke.mockResolvedValueOnce({ answers: { p1: 0.9, t1: 0.4, overall: 0.7 }, model: "jev-1.14.2" });
    expect(await jev.ask(secondOpinion)).toEqual({ answers: { p1: 0.9, t1: 0.4, overall: 0.7 }, model: "jev-1.14.2" });
  });

  it("passes a native error's kind, status and retry-after through as a JevError", async () => {
    invoke.mockRejectedValueOnce({ kind: "rateLimited", status: null, retryAfter: 7 });
    const e = await jev.ask(lineBreaks).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(JevError);
    expect(e).toMatchObject({ kind: "rateLimited", status: null, retryAfter: 7 });

    invoke.mockRejectedValueOnce({ kind: "other", status: 422, retryAfter: null });
    await expect(jev.ask(lineBreaks)).rejects.toMatchObject({ kind: "other", status: 422, retryAfter: null });
  });

  it("passes every native error kind through, from every command", async () => {
    const calls = [() => jev.status(), () => jev.setKey("k"), () => jev.clearKey(), () => jev.setOn(true), () => jev.ask(secondOpinion)];
    for (const kind of JEV_ERROR_KINDS) {
      for (const call of calls) {
        invoke.mockRejectedValueOnce({ kind, status: null, retryAfter: null });
        await expect(call()).rejects.toMatchObject({ kind, status: null, retryAfter: null });
      }
    }
  });

  it("reads a plain-string rejection from Tauri as kind other, without keeping its text", async () => {
    invoke.mockRejectedValueOnce("invalid args `key` for command `jev_set_key`: ts-live-secret");
    const e = (await jev.setKey("ts-live-secret").catch((x: unknown) => x)) as JevError;
    expect(e).toBeInstanceOf(JevError);
    expect(e).toMatchObject({ kind: "other", status: null, retryAfter: null });
    expect(e.message).not.toContain("secret");
    expect(JSON.stringify(e)).not.toContain("secret");
  });
});

describe("toJevError", () => {
  it("reads anything that is not a native error as kind other", () => {
    for (const rejection of ["boom", new TypeError("window.__TAURI_INTERNALS__ is undefined"), null, undefined, 42, {}, { kind: "teapot" }, { kind: 5 }]) {
      const e = toJevError(rejection);
      expect(e).toBeInstanceOf(JevError);
      expect(e).toMatchObject({ kind: "other", status: null, retryAfter: null });
    }
  });

  it("keeps status and retry-after only when they are numbers", () => {
    expect(toJevError({ kind: "overloaded", status: "529", retryAfter: "3" })).toMatchObject({ kind: "overloaded", status: null, retryAfter: null });
    expect(toJevError({ kind: "overloaded" })).toMatchObject({ status: null, retryAfter: null });
  });

  it("returns a JevError unchanged", () => {
    const e = new JevError("keyRefused");
    expect(toJevError(e)).toBe(e);
  });
});

describe("JevError", () => {
  it("is an Error that carries its kind and nothing else", () => {
    const e = new JevError("unreachable");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("JevError");
    expect(e).toMatchObject({ kind: "unreachable", status: null, retryAfter: null });
    expect(new JevError("rateLimited", { retryAfter: 30 }).retryAfter).toBe(30);
    expect(new JevError("other", { status: 500 }).status).toBe(500);
  });
});

describe("isUsable", () => {
  it("is true only when Jev Mode is on and a key is held", () => {
    expect(isUsable(ON)).toBe(true);
    expect(isUsable({ ...ON, hasKey: false, storage: null, hint: null })).toBe(false);
    expect(isUsable({ ...ON, on: false })).toBe(false);
    expect(isUsable(JEV_OFF)).toBe(false);
  });
});
