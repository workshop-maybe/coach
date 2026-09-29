// Edits one credential: name, learning targets, task and rubric (R2-R4, F1).
// The draft and the file text it opened with live here, so a folder reload never
// resets them (KTD6). Saves are explicit and refused when the file changed on disk.

import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { credentialPath, loadFolder } from "../domain/folder";
import { updateCredential } from "../domain/operations";
import type { Credential, FolderState } from "../domain/types";
import { ChangedOnDiskError } from "../storage/storage";
import { PromptPanel } from "./PromptPanel";
import { CHANGED_ON_DISK_MESSAGE, describeError, useFolder } from "./useFolderState";

// ---------------------------------------------------------------------------
// Draft plus opening base text, shared with the profile and collection editors.

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

// ---------------------------------------------------------------------------
// Credential editor

type CredentialDraft = Pick<Credential, "name" | "learningTargets" | "task" | "rubric">;

function splitKey(key: string): [string, string] {
  const i = key.indexOf("/");
  return [key.slice(0, i), key.slice(i + 1)];
}

export interface CredentialEditorProps {
  /** `collection/slug`. Key the editor by it so another credential gets a fresh draft. */
  credentialKey: string;
}

export function CredentialEditor({ credentialKey }: CredentialEditorProps) {
  const { storage } = useFolder();
  const [collectionSlug, slug] = splitKey(credentialKey);
  const path = credentialPath(collectionSlug, slug);
  const find = (s: FolderState) => s.credentials.find((c) => c.collectionSlug === collectionSlug && c.slug === slug) ?? null;
  const d = useDraftWithBase<CredentialDraft>(path, (s) => {
    const c = find(s);
    return c && { name: c.name, learningTargets: [...c.learningTargets], task: c.task, rubric: c.rubric };
  });
  const taskHint = useId();
  const [showPrompts, setShowPrompts] = useState(false);

  if (d.draft === null) {
    return (
      <section className="editor">
        <EditorStatus d={d} />
        <p className="muted">This credential is not in the folder. It may have been moved or deleted outside the app.</p>
      </section>
    );
  }
  const draft = d.draft;
  const set = (patch: Partial<CredentialDraft>) => d.edit({ ...draft, ...patch });
  const targets = draft.learningTargets;
  const setTarget = (i: number, text: string) => set({ learningTargets: targets.map((t, j) => (j === i ? text : t)) });
  const moveTarget = (i: number, by: -1 | 1) => {
    const next = [...targets];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set({ learningTargets: next });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.name.trim() === "") {
      d.setError("Give the credential a name before saving.");
      return;
    }
    void d.save(async (dr, base, s) => {
      // Slug, collection and any hand-added sections come from the stored credential.
      const stored = find(s);
      if (!stored) throw new Error("This credential is not in the folder.");
      return updateCredential(storage, s, { ...stored, ...dr, learningTargets: dr.learningTargets.map((t) => t.trim()).filter((t) => t !== "") }, base);
    });
  };

  return (
    <section className="editor" aria-label={`Credential ${draft.name || slug}`}>
      <div className="editor-head">
        <h2>{draft.name.trim() || "Untitled credential"}</h2>
        <button type="button" onClick={() => setShowPrompts(true)}>
          Prompts
        </button>
      </div>
      {showPrompts && <PromptPanel credentialKey={credentialKey} onClose={() => setShowPrompts(false)} />}
      <EditorStatus d={d} />
      <form onSubmit={onSubmit}>
        <label className="field">
          <span>Credential name</span>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>

        <fieldset className="field">
          <legend>Learning targets</legend>
          {targets.length === 0 ? (
            <p className="muted">No learning targets yet. Add what someone who holds this credential can do.</p>
          ) : (
            <ol className="rows">
              {targets.map((t, i) => (
                <li key={i} className="row">
                  <input
                    aria-label={`Learning target ${i + 1}`}
                    value={t}
                    placeholder="I can…"
                    onChange={(e) => setTarget(i, e.target.value)}
                  />
                  <button type="button" aria-label={`Move learning target ${i + 1} up`} disabled={i === 0} onClick={() => moveTarget(i, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move learning target ${i + 1} down`}
                    disabled={i === targets.length - 1}
                    onClick={() => moveTarget(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove learning target ${i + 1}`}
                    onClick={() => set({ learningTargets: targets.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}
          <button type="button" onClick={() => set({ learningTargets: [...targets, ""] })}>
            Add learning target
          </button>
        </fieldset>

        <div className="field">
          <label htmlFor={`${taskHint}-task`}>Task</label>
          <span className="field-hint" id={taskHint}>
            What the agent is asked to do. It goes into the test prompt.
          </span>
          <textarea
            id={`${taskHint}-task`}
            rows={6}
            aria-describedby={taskHint}
            value={draft.task}
            onChange={(e) => set({ task: e.target.value })}
          />
        </div>

        <label className="field">
          <span>Rubric</span>
          <span className="field-hint">Only you see this</span>
          <textarea rows={6} value={draft.rubric} onChange={(e) => set({ rubric: e.target.value })} />
        </label>

        <SaveBar d={d} />
      </form>
    </section>
  );
}
