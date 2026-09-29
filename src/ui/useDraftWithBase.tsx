// Draft plus opening base text, shared by the credential, profile and collection
// editors. The draft and the file text it opened with live in the editor, so a folder
// reload never resets them (KTD6).

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { loadFolder } from "../domain/folder";
import type { FolderState } from "../domain/types";
import { ChangedOnDiskError } from "../storage/storage";
import { CHANGED_ON_DISK_MESSAGE, describeError, useFolder } from "./useFolderState";

export interface DraftWithBase<T> {
  draft: T | null;
  /** The file text the draft was seeded from. Saves are checked against it. */
  base: string | null;
  dirty: boolean;
  /** Replaces the draft and marks it unsaved. */
  edit(next: T): void;
  /** True when the file on disk no longer matches the base while the draft has changes. */
  conflict: boolean;
  /** Discards the draft and re-seeds it from the folder as it is now. */
  reloadFromDisk(): Promise<void>;
  keepEditing(): void;
  /** Discards the draft and re-seeds it from the folder state already loaded. */
  revert(): void;
  /** Runs a save against the base. On success applies the new state and takes its text as the base. */
  save(run: (draft: T, base: string | null, state: FolderState) => Promise<FolderState>): Promise<boolean>;
  /** Takes a file text this app just wrote as the new base, keeping the draft. */
  rebase(next: FolderState): void;
  error: string | null;
  setError(message: string | null): void;
  saving: boolean;
  justSaved: boolean;
}

export function useDraftWithBase<T>(path: string, seed: (state: FolderState) => T | null): DraftWithBase<T> {
  const { state, storage, apply } = useFolder();
  const [base, setBase] = useState<string | null>(() => state?.raw[path] ?? null);
  const [draft, setDraft] = useState<T | null>(() => (state ? seed(state) : null));
  const [dirty, setDirty] = useState(false);
  // The disk text the user chose to keep editing over; undefined when none.
  const [keptOver, setKeptOver] = useState<string | null | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const current = state ? (state.raw[path] ?? null) : base;

  // A clean draft follows the file. A dirty one is never touched by a reload.
  useEffect(() => {
    if (!dirty && state && current !== base) {
      setBase(current);
      setDraft(seed(state));
    }
    // `seed` is a fresh closure each render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, state, current, base]);

  const reseed = (next: FolderState) => {
    setBase(next.raw[path] ?? null);
    setDraft(seed(next));
    setDirty(false);
    setRefused(false);
    setKeptOver(undefined);
    setError(null);
  };

  return {
    draft,
    base,
    dirty,
    edit(next) {
      setDraft(next);
      setDirty(true);
      setJustSaved(false);
    },
    conflict: dirty && (refused || (current !== base && current !== keptOver)),
    async reloadFromDisk() {
      try {
        const next = await loadFolder(storage);
        apply(next);
        reseed(next);
      } catch (e) {
        setError(describeError(e));
      }
    },
    keepEditing() {
      setKeptOver(current);
      setRefused(false);
    },
    revert() {
      if (state) reseed(state);
    },
    async save(run) {
      if (draft === null || state === null) return false;
      setSaving(true);
      setError(null);
      try {
        const next = await run(draft, base, state);
        apply(next);
        reseed(next);
        setJustSaved(true);
        return true;
      } catch (e) {
        if (e instanceof ChangedOnDiskError) {
          setRefused(true);
          setKeptOver(undefined);
        } else {
          setError(describeError(e));
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    rebase(next) {
      setBase(next.raw[path] ?? null);
      setKeptOver(undefined);
      setRefused(false);
    },
    error,
    setError,
    saving,
    justSaved,
  };
}

/** The changed-on-disk choice, the save error and the unsaved marker for an editor. */
export function EditorStatus<T>({ d }: { d: DraftWithBase<T> }) {
  return (
    <>
      {d.conflict && (
        <div className="conflict" role="alert">
          <span>{CHANGED_ON_DISK_MESSAGE}</span>
          <div className="conflict-actions">
            <button type="button" onClick={() => void d.reloadFromDisk()}>
              Reload
            </button>
            <button type="button" onClick={d.keepEditing}>
              Keep editing
            </button>
          </div>
        </div>
      )}
      {d.error && (
        <p className="form-error" role="alert">
          {d.error}
        </p>
      )}
    </>
  );
}

export function SaveBar<T>({ d, label = "Save", children }: { d: DraftWithBase<T>; label?: string; children?: ReactNode }) {
  return (
    <div className="form-actions">
      <button type="submit" className="primary" disabled={d.saving}>
        {label}
      </button>
      {d.dirty ? <span className="unsaved">Unsaved changes</span> : d.justSaved && <span className="muted" role="status">Saved.</span>}
      {children}
    </div>
  );
}

