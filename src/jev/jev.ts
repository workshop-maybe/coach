// The Jev port (KTD5): the one way the UI reaches TypeSafe's Jev model. Components never
// call Tauri for Jev; they use `useJev()` (src/ui/jevContext.tsx), which wraps whichever
// port the app was given. `TauriJev` calls the native commands; `FakeJev` stands in for
// tests. Every method rejects with a `JevError`, never with text. The shapes mirror the
// command contract at the top of src-tauri/src/jev.rs.

import type { JevAnswers, JevRequest } from "../domain/jevRequest";

export type {
  JevAnswers,
  JevCriteria,
  JevRequest,
  LineBreaksRequest,
  SecondOpinionRequest,
} from "../domain/jevRequest";

/** Jev Mode as the native side last saved it. Jev is usable when `on && hasKey`. */
export interface JevStatus {
  /** The switch as saved. */
  on: boolean;
  /** A key is held now. */
  hasKey: boolean;
  /** Where the key is held: the OS keychain, or memory for this run where Linux has no Secret Service. Null with no key. */
  storage: "keychain" | "session" | null;
  /** The key's last four characters, for display. Null with no key, or for a key under 12 characters. */
  hint: string | null;
}

/** Jev Mode off, with no key. What the UI reads before status loads, after it fails, and with no provider. */
export const JEV_OFF: JevStatus = { on: false, hasKey: false, storage: null, hint: null };

/** True when an ask can be sent: Jev Mode is on and a key is held. */
export function isUsable(status: JevStatus): boolean {
  return status.on && status.hasKey;
}

/** Every way a Jev call can fail. Each gets its own line in the UI (KTD20). */
export const JEV_ERROR_KINDS = [
  /** Jev Mode is off; nothing was read or sent. */
  "off",
  /** No key to send, or `setOn(true)` with none. Ask for the key again. */
  "keyMissing",
  /** TypeSafe answered 401. */
  "keyRefused",
  /** TypeSafe answered 429. */
  "rateLimited",
  /** TypeSafe answered 529. */
  "overloaded",
  /** Over the question cap or token budget (refused before sending), or 413. */
  "tooLong",
  /** No connection, or no complete answer within 20 seconds. */
  "unreachable",
  /** Any other status, a redirect, a malformed request or answer, or a failure outside Jev's own checks. */
  "other",
  /** The OS key store refused or failed (a Deny, a dismissed unlock prompt). */
  "keychain",
  /** Empty after trimming, over 512 characters, or not printable ASCII. */
  "invalidKey",
  /** settings.json exists but can't be read, so nothing was changed. */
  "settings",
] as const;

export type JevErrorKind = (typeof JEV_ERROR_KINDS)[number];

/**
 * A failed Jev call. It carries only its kind and two numbers: nothing from TypeSafe,
 * the HTTP library, Tauri or the key, so it is safe to log or show.
 */
export class JevError extends Error {
  readonly kind: JevErrorKind;
  /** For "other" only: the HTTP status TypeSafe answered with when it wasn't a success. Null otherwise. */
  readonly status: number | null;
  /** For "rateLimited" and "overloaded" only: whole seconds from Retry-After, when sent. Null otherwise. */
  readonly retryAfter: number | null;

  constructor(kind: JevErrorKind, opts: { status?: number | null; retryAfter?: number | null } = {}) {
    super(`Jev: ${kind}`);
    this.name = "JevError";
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryAfter = opts.retryAfter ?? null;
  }
}

const KINDS: ReadonlySet<string> = new Set(JEV_ERROR_KINDS);

const numberOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * Reads any rejection as a JevError. A native `{ kind, status, retryAfter }` keeps its
 * fields; anything else (a plain string from Tauri, a missing bridge, an unknown kind)
 * is kind "other". The rejection's text is dropped, since Tauri's own messages can quote
 * an argument.
 */
export function toJevError(e: unknown): JevError {
  if (e instanceof JevError) return e;
  if (typeof e === "object" && e !== null && "kind" in e && typeof e.kind === "string" && KINDS.has(e.kind)) {
    const fields = e as { kind: JevErrorKind; status?: unknown; retryAfter?: unknown };
    return new JevError(fields.kind, { status: numberOrNull(fields.status), retryAfter: numberOrNull(fields.retryAfter) });
  }
  return new JevError("other");
}

/** The port. Every method rejects with a JevError. */
export interface Jev {
  /** Reads Jev Mode's saved switch and whether a key is held. Never reads the key store. */
  status(): Promise<JevStatus>;
  /** Trims and stores the key, and turns Jev Mode on. Makes no network call. */
  setKey(key: string): Promise<JevStatus>;
  /** Deletes the key and turns Jev Mode off. Changes nothing unless the delete succeeds. */
  clearKey(): Promise<JevStatus>;
  /** Turns Jev Mode on or off. Off keeps the key; on with no key rejects as "keyMissing". */
  setOn(on: boolean): Promise<JevStatus>;
  /** Sends one request and resolves to a probability for every question id, and the model that answered. Never retried. */
  ask(request: JevRequest): Promise<JevAnswers>;
}
