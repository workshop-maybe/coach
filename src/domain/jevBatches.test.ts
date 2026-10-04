import { describe, expect, it, vi } from "vitest";
import { JevError } from "../jev/jev";
import { askBatches, BACKOFF_MS, BATCH_RETRIES } from "./jevBatches";
import type { JevAnswers } from "./jevRequest";

const noWait = async () => {};

describe("askBatches (router KTD5)", () => {
  it("sends each request once the one before has answered, and returns each one's answers in order", async () => {
    let open = 0;
    let most = 0;
    const ask = async (n: number): Promise<JevAnswers> => {
      most = Math.max(most, ++open);
      await Promise.resolve();
      open--;
      return { answers: { [`m${n}`]: n / 10 } };
    };
    expect(await askBatches([1, 2, 3], ask, { wait: noWait })).toEqual([{ answers: { m1: 0.1 } }, { answers: { m2: 0.2 } }, { answers: { m3: 0.3 } }]);
    expect(most).toBe(1);
  });

  it("a check that throws ends the ask before the next request goes", async () => {
    const ask = vi.fn(async (): Promise<JevAnswers> => ({ answers: {} }));
    const check = () => {
      throw new JevError("other");
    };
    await expect(askBatches([1, 2], ask, { wait: noWait, check })).rejects.toMatchObject({ kind: "other" });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("retries an overloaded request with backoff, then fails, and reads a non-object answer as other", async () => {
    const wait = vi.fn(noWait);
    await expect(askBatches([1], () => Promise.reject(new JevError("overloaded")), { wait })).rejects.toMatchObject({ kind: "overloaded" });
    expect(wait.mock.calls).toEqual([[BACKOFF_MS], [BACKOFF_MS * 2], [BACKOFF_MS * 4]]);
    expect(BATCH_RETRIES).toBe(3);
    await expect(askBatches([1], async () => null as unknown as JevAnswers, { wait: noWait })).rejects.toMatchObject({ kind: "other" });
  });

  it("resolves to null once cancelled, sending nothing more", async () => {
    let cancelled = false;
    const ask = vi.fn(async (): Promise<JevAnswers> => {
      cancelled = true;
      return { answers: {} };
    });
    expect(await askBatches([1, 2], ask, { wait: noWait, cancelled: () => cancelled })).toBeNull();
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
