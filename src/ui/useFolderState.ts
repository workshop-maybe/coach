// Folder state for the UI (KTD6). The provider loads the data folder on mount, reloads it
// when the window regains focus or on demand, and only ever swaps `state`. Drafts live in
// the editors' own component state, so a reload never resets them.

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { loadFolder } from "../domain/folder";
import type { FolderState } from "../domain/types";
import { ChangedOnDiskError, type Storage } from "../storage/storage";

export interface FolderContextValue {
  /** Absolute path of the data folder, for display. */
  folder: string;
  storage: Storage;
  /** Null until the first load finishes (or when it failed). */
  state: FolderState | null;
  loading: boolean;
  /** Re-reads the whole folder and swaps `state`. Never throws; failures become the notice. */
  reload(): Promise<void>;
  /** Replaces `state` with one an operation returned. */
  apply(next: FolderState): void;
  notice: string | null;
  setNotice(message: string | null): void;
}

export const CHANGED_ON_DISK_MESSAGE = "Changed on disk: reload or keep editing";

/** A user-facing message for an error from a load or save. */
export function describeError(e: unknown): string {
  if (e instanceof ChangedOnDiskError) return CHANGED_ON_DISK_MESSAGE;
  if (e instanceof Error) return e.message;
  return String(e);
}

const FolderContext = createContext<FolderContextValue | null>(null);

export interface FolderProviderProps {
  storage: Storage;
  folder: string;
  children?: ReactNode;
}

export function FolderProvider({ storage, folder, children }: FolderProviderProps) {
  const [state, setState] = useState<FolderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  // Only the latest load may set state, so a slow earlier load never overwrites a newer one.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const next = await loadFolder(storage);
      if (ticket === latest.current) setState(next);
    } catch (e) {
      if (ticket === latest.current) setNotice(describeError(e));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [storage]);

  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      latest.current++; // Drop any load still in flight.
    };
  }, [reload]);

  const apply = useCallback((next: FolderState) => setState(next), []);

  const value = useMemo<FolderContextValue>(
    () => ({ folder, storage, state, loading, reload, apply, notice, setNotice }),
    [folder, storage, state, loading, reload, apply, notice],
  );

  return createElement(FolderContext.Provider, { value }, children);
}

export function useFolder(): FolderContextValue {
  const value = useContext(FolderContext);
  if (!value) throw new Error("useFolder must be used inside a FolderProvider");
  return value;
}
