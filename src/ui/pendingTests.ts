// Tests waiting on a reply (KTD5, R17). They live in the webview's local storage, keyed
// by data folder, so nothing new is written to the folder. Losing one loses only the
// reminder, never a result. A copy of the same agent and credential replaces the last.
// A waiting test is the agent's plug (KTD6): the handoff it holds until the test ends.

import { useCallback, useEffect, useRef, useState } from "react";
import { isTestContext } from "../domain/context";
import { credentialKey, type AgentSetup, type FolderState, type HandoffTemplate, type Slug, type TestContext } from "../domain/types";

export interface PendingTest {
  profileSlug: Slug;
  credentialKey: string;
  /** ISO 8601 time the prompt was copied. */
  copiedAt: string;
  /** The credential's assignment version when copied. */
  assignmentVersion: string;
  /** The agent's setup when copied. */
  setup: AgentSetup;
  /** The machine and memory the test started with. Absent when it couldn't be read. */
  context?: TestContext;
  /** The handoff copied: its id ("skeleton" or a file stem) and the filled text. Absent on tests saved before handoffs. */
  handoff?: HandoffTemplate;
}

export function pendingStorageKey(folder: string): string {
  return `coach:pending-tests:${folder}`;
}

function defaultStore(): globalThis.Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isPending(v: unknown): v is PendingTest {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const setup = p.setup as Record<string, unknown> | null | undefined;
  return (
    typeof p.profileSlug === "string" &&
    typeof p.credentialKey === "string" &&
    typeof p.copiedAt === "string" &&
    typeof p.assignmentVersion === "string" &&
    typeof setup === "object" &&
    setup !== null &&
    typeof setup.harness === "string" &&
    typeof setup.model === "string" &&
    typeof setup.effort === "string"
  );
}

function isHandoff(v: unknown): v is HandoffTemplate {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return typeof h.id === "string" && h.id !== "" && typeof h.text === "string";
}

/** A valid entry, with a malformed context or handoff dropped so the reminder survives. */
function clean(p: PendingTest): PendingTest {
  const { context, handoff, ...rest } = p;
  return {
    ...rest,
    ...(context !== undefined && isTestContext(context) ? { context } : {}),
    ...(handoff !== undefined && isHandoff(handoff) ? { handoff } : {}),
  };
}

const newestFirst = (a: PendingTest, b: PendingTest) => (a.copiedAt < b.copiedAt ? 1 : a.copiedAt > b.copiedAt ? -1 : 0);

/** Waiting tests for a folder, newest first. Unreadable storage reads as none. */
export function readPending(folder: string, store = defaultStore()): PendingTest[] {
  try {
    const text = store?.getItem(pendingStorageKey(folder));
    if (!text) return [];
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPending).map(clean).sort(newestFirst);
  } catch {
    return [];
  }
}

/** The agent's plug: its waiting test, or the newest when one saved before handoffs holds several. */
export function plugFor(pending: PendingTest[], profileSlug: Slug): PendingTest | undefined {
  let plug: PendingTest | undefined;
  for (const p of pending) {
    if (p.profileSlug === profileSlug && (!plug || p.copiedAt > plug.copiedAt)) plug = p;
  }
  return plug;
}

/**
 * The waiting tests whose agent and badge are both in the folder. Readers use it so a plug
 * left by something gone never shows. Storage keeps them; trashing removes them there.
 */
export function livePlugs(pending: PendingTest[], state: Pick<FolderState, "profiles" | "credentials">): PendingTest[] {
  const profiles = new Set(state.profiles.map((p) => p.slug));
  const keys = new Set(state.credentials.map(credentialKey));
  return pending.filter((p) => profiles.has(p.profileSlug) && keys.has(p.credentialKey));
}

/** Saves the list and returns it as a fresh read would. Blocked storage keeps `unchanged`. */
function write(folder: string, list: PendingTest[], unchanged: PendingTest[], store: globalThis.Storage | null): PendingTest[] {
  if (!store) return unchanged;
  let text: string;
  try {
    text = JSON.stringify(list);
    store.setItem(pendingStorageKey(folder), text);
  } catch {
    // Blocked storage loses the reminder only.
    return unchanged;
  }
  return (JSON.parse(text) as unknown[]).filter(isPending).map(clean).sort(newestFirst);
}

const same = (a: Pick<PendingTest, "profileSlug" | "credentialKey">, profileSlug: Slug, credentialKey: string) =>
  a.profileSlug === profileSlug && a.credentialKey === credentialKey;

/** Adds a waiting test, replacing any for the same agent and credential. Returns the folder's list. */
export function addPending(folder: string, entry: PendingTest, store = defaultStore()): PendingTest[] {
  const current = readPending(folder, store);
  const rest = current.filter((p) => !same(p, entry.profileSlug, entry.credentialKey));
  return write(folder, [entry, ...rest], current, store);
}

/** Drops a waiting test, after its reply is recorded or when it is dismissed. Returns the folder's list. */
export function removePending(folder: string, profileSlug: Slug, credentialKey: string, store = defaultStore()): PendingTest[] {
  const current = readPending(folder, store);
  return write(folder, current.filter((p) => !same(p, profileSlug, credentialKey)), current, store);
}

/** The folder's waiting tests as React state, with add and remove that keep it current. */
export function usePendingTests(folder: string) {
  const [pending, setPending] = useState<PendingTest[]>(() => readPending(folder));
  const readFor = useRef(folder);
  useEffect(() => {
    if (readFor.current === folder) return;
    readFor.current = folder;
    setPending(readPending(folder));
  }, [folder]);
  const add = useCallback((entry: PendingTest) => setPending(addPending(folder, entry)), [folder]);
  const remove = useCallback(
    (profileSlug: Slug, credentialKey: string) => setPending(removePending(folder, profileSlug, credentialKey)),
    [folder],
  );
  return { pending, add, remove };
}
