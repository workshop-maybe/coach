// Tests waiting on a reply (KTD5, R17). They live in the webview's local storage, keyed
// by data folder, so nothing new is written to the folder. Losing one loses only the
// reminder, never a result. A copy of the same agent and credential replaces the last.

import { useCallback, useEffect, useState } from "react";
import type { AgentSetup, Slug } from "../domain/types";

export interface PendingTest {
  profileSlug: Slug;
  credentialKey: string;
  /** ISO 8601 time the prompt was copied. */
  copiedAt: string;
  /** The credential's assignment version when copied. */
  assignmentVersion: string;
  /** The agent's setup when copied. */
  setup: AgentSetup;
}

export function pendingStorageKey(folder: string): string {
  return `andamio-desktop:pending-tests:${folder}`;
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

/** Waiting tests for a folder, newest first. Unreadable storage reads as none. */
export function readPending(folder: string, store = defaultStore()): PendingTest[] {
  try {
    const text = store?.getItem(pendingStorageKey(folder));
    if (!text) return [];
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPending).sort((a, b) => (a.copiedAt < b.copiedAt ? 1 : a.copiedAt > b.copiedAt ? -1 : 0));
  } catch {
    return [];
  }
}

function write(folder: string, list: PendingTest[], store: globalThis.Storage | null): void {
  try {
    store?.setItem(pendingStorageKey(folder), JSON.stringify(list));
  } catch {
    // Blocked storage loses the reminder only.
  }
}

const same = (a: Pick<PendingTest, "profileSlug" | "credentialKey">, profileSlug: Slug, credentialKey: string) =>
  a.profileSlug === profileSlug && a.credentialKey === credentialKey;

export function addPending(folder: string, entry: PendingTest, store = defaultStore()): void {
  const rest = readPending(folder, store).filter((p) => !same(p, entry.profileSlug, entry.credentialKey));
  write(folder, [entry, ...rest], store);
}

/** Drops a waiting test, after its reply is recorded or when it is dismissed. */
export function removePending(folder: string, profileSlug: Slug, credentialKey: string, store = defaultStore()): void {
  write(folder, readPending(folder, store).filter((p) => !same(p, profileSlug, credentialKey)), store);
}

/** The folder's waiting tests as React state, with add and remove that keep it current. */
export function usePendingTests(folder: string) {
  const [pending, setPending] = useState<PendingTest[]>(() => readPending(folder));
  useEffect(() => setPending(readPending(folder)), [folder]);
  const add = useCallback(
    (entry: PendingTest) => {
      addPending(folder, entry);
      setPending(readPending(folder));
    },
    [folder],
  );
  const remove = useCallback(
    (profileSlug: Slug, credentialKey: string) => {
      removePending(folder, profileSlug, credentialKey);
      setPending(readPending(folder));
    },
    [folder],
  );
  return { pending, add, remove };
}
