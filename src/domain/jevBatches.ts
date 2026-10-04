// Jev asks that go as several requests behind one press (Jev Mode KTD17, KTD19; router
// KTD5): each request goes once the one before it has answered, and a rate-limited or
// overloaded one waits and is tried again. The result is all or nothing: a request that still
// fails ends the ask, and nothing the earlier ones answered is used.

import { JevError, toJevError } from "../jev/jev";
import type { JevAnswers } from "./jevRequest";

/** How many times a rate-limited or overloaded request is tried again before the ask fails. */
export const BATCH_RETRIES = 3;
/** The first wait before a retry without a Retry-After; each later wait doubles it. */
export const BACKOFF_MS = 1000;
/**
 * The longest a request waits before a retry. The press that started the ask stays disabled
 * while it runs, so a longer Retry-After fails the ask at once with its retryable line instead.
 */
export const MAX_WAIT_MS = 30_000;

export interface BatchOptions<R> {
  /** Waits this many milliseconds before a retry. Defaults to a timer; tests pass one that doesn't sleep. */
  wait?(ms: number): Promise<void>;
  /** Checked before each request and after each answer or wait: true stops the ask, which then resolves to null. */
  cancelled?(): boolean;
  /** Reads one request's answer, given with its place among the requests, before the next request goes; throws to end the ask. */
  check?(request: R, answers: JevAnswers, index: number): void;
}

/**
 * Sends the requests one at a time and returns each one's answers, in order. Rejects with the
 * JevError that ends it: any failure but a rate limit or an overload at once, those after
 * `BATCH_RETRIES` retries, or one whose wait would pass `MAX_WAIT_MS`. Null once cancelled.
 */
export async function askBatches<R>(
  requests: readonly R[],
  ask: (request: R) => Promise<JevAnswers>,
  { wait = sleep, cancelled = () => false, check }: BatchOptions<R> = {},
): Promise<JevAnswers[] | null> {
  const all: JevAnswers[] = [];
  for (const [index, request] of requests.entries()) {
    for (let retry = 0; ; retry++) {
      if (cancelled()) return null;
      let got: JevAnswers;
      try {
        got = await ask(request);
      } catch (e) {
        const error = toJevError(e);
        const busy = error.kind === "rateLimited" || error.kind === "overloaded";
        const ms = error.retryAfter !== null ? error.retryAfter * 1000 : BACKOFF_MS * 2 ** retry;
        if (!busy || retry >= BATCH_RETRIES || ms > MAX_WAIT_MS) throw error;
        await wait(ms);
        continue;
      }
      if (cancelled()) return null;
      if (typeof got !== "object" || got === null) throw new JevError("other");
      check?.(request, got, index);
      all.push(got);
      break;
    }
  }
  return all;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
