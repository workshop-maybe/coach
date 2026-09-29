// Edits an agent profile (R5-R7, F3). Once a profile has results its harness, model and
// effort are read-only (KTD10), and a different setup starts as an unsaved duplicate.
// New and duplicated profiles are written only when the user saves.

import { useEffect, useId, useState } from "react";
import { profilePath } from "../domain/folder";
import { createProfile, duplicateProfileDraft, isSetupLocked, updateProfile } from "../domain/operations";
import { FLAG_REASONS, buildMatrix, cellKey, type Cell, type Matrix } from "../domain/matrix";
import { credentialKey, type AgentProfile, type Collection, type Credential, type FolderState } from "../domain/types";
import { Badge } from "./Badge";
import { EditorStatus, SaveBar, useDraftWithBase } from "./useDraftWithBase";
import { describeError, useFolder } from "./useFolderState";

export type ProfileFields = Omit<AgentProfile, "slug">;

/** The form's shape: params as ordered rows so the user can add and remove them. */
interface ProfileDraft extends Omit<ProfileFields, "params"> {
  params: [string, string][];
}

export const LOCK_MESSAGE = "Locked because this agent has results. Duplicate to try a different setup.";

export const BLANK_PROFILE: ProfileFields = { name: "", harness: "", model: "", effort: "", repo: "", notes: "", params: {} };

function toDraft(fields: ProfileFields): ProfileDraft {
  return { ...fields, params: Object.entries(fields.params) };
}

function fromDraft(draft: ProfileDraft): ProfileFields {
  const params: Record<string, string> = {};
  for (const [k, v] of draft.params) if (k.trim() !== "") params[k.trim()] = v;
  return { ...draft, name: draft.name.trim(), params };
}

// ---------------------------------------------------------------------------

interface FieldsProps {
  draft: ProfileDraft;
  onChange(next: ProfileDraft): void;
  locked: boolean;
}

function ProfileFieldset({ draft, onChange, locked }: FieldsProps) {
  const lockId = useId();
  const set = (patch: Partial<ProfileDraft>) => onChange({ ...draft, ...patch });
  const setParam = (i: number, row: [string, string]) => set({ params: draft.params.map((p, j) => (j === i ? row : p)) });
  const setup = (key: "harness" | "model" | "effort", label: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={draft[key]}
        readOnly={locked}
        aria-describedby={locked ? lockId : undefined}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </label>
  );

  return (
    <>
      <label className="field">
        <span>Name</span>
        <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <fieldset className={locked ? "field setup locked" : "field setup"}>
        <legend>Setup</legend>
        {setup("harness", "Harness")}
        {setup("model", "Model")}
        {setup("effort", "Effort")}
        {locked && (
          <p className="field-hint" id={lockId}>
            {LOCK_MESSAGE}
          </p>
        )}
      </fieldset>
      <label className="field">
        <span>Repo</span>
        <input value={draft.repo} placeholder="The folder the agent opens in" onChange={(e) => set({ repo: e.target.value })} />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea rows={3} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      <fieldset className="field">
        <legend>Parameters</legend>
        {draft.params.length === 0 ? (
          <p className="muted">No parameters. Add any setting worth recording, such as a context size or a flag.</p>
        ) : (
          <ul className="rows">
            {draft.params.map(([k, v], i) => (
              <li key={i} className="row">
                <input aria-label={`Parameter ${i + 1} name`} placeholder="name" value={k} onChange={(e) => setParam(i, [e.target.value, v])} />
                <input aria-label={`Parameter ${i + 1} value`} placeholder="value" value={v} onChange={(e) => setParam(i, [k, e.target.value])} />
                <button type="button" aria-label={`Remove parameter ${i + 1}`} onClick={() => set({ params: draft.params.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => set({ params: [...draft.params, ["", ""]] })}>
          Add parameter
        </button>
      </fieldset>
    </>
  );
}

// ---------------------------------------------------------------------------

interface Earned {
  collection: Collection;
  credential: Credential;
  cell: Cell;
}

/** Badges for every credential this agent has met. A flagged met still counts (R14). */
function EarnedBadges({ state, profileSlug }: { state: FolderState; profileSlug: string }) {
  const { setNotice } = useFolder();
  const [matrix, setMatrix] = useState<Matrix | null>(null);

  useEffect(() => {
    let live = true;
    buildMatrix(state).then(
      (m) => live && setMatrix(m),
      (e) => live && setNotice(describeError(e)),
    );
    return () => {
      live = false;
    };
  }, [state, setNotice]);

  const earned: Earned[] = [];
  for (const group of matrix?.columns ?? []) {
    for (const credential of group.credentials) {
      const cell = matrix!.cells.get(cellKey(profileSlug, credentialKey(credential)));
      if (cell?.status === "met") earned.push({ collection: group.collection, credential, cell });
    }
  }

  return (
    <section className="earned-badges" aria-label="Earned badges">
      <h3>Earned badges</h3>
      {!matrix ? (
        <p className="muted">Loading…</p>
      ) : earned.length === 0 ? (
        <p className="muted">No badges yet. Record a met result for this agent to earn one.</p>
      ) : (
        <ul className="badge-earned-list">
          {earned.map(({ collection, credential, cell }) => (
            <li key={credentialKey(credential)} className={cell.flags.length > 0 ? "badge-earned stale" : "badge-earned"}>
              <Badge collection={collection} credential={credential} size={96} />
              <span className="badge-earned-name">{credential.name}</span>
              <span className="badge-earned-collection muted">{collection.name}</span>
              {cell.flags.map((f) => (
                <span key={f} className="badge-earned-reason">
                  {FLAG_REASONS[f]}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export interface ProfileEditorProps {
  profileSlug: string;
  /** Opens an unsaved duplicate draft. Nothing is written until it is saved. */
  onDuplicate(fields: ProfileFields): void;
}

export function ProfileEditor({ profileSlug, onDuplicate }: ProfileEditorProps) {
  const { state, storage } = useFolder();
  const find = (s: FolderState | null) => s?.profiles.find((p) => p.slug === profileSlug) ?? null;
  const d = useDraftWithBase<ProfileDraft>(profilePath(profileSlug), (s) => {
    const p = find(s);
    if (!p) return null;
    const { slug: _slug, ...fields } = p;
    return toDraft(fields);
  });
  const stored = find(state);

  if (!state || !stored || d.draft === null) {
    return (
      <section className="editor">
        <EditorStatus d={d} />
        <p className="muted">This agent is not in the folder. It may have been moved or deleted outside the app.</p>
      </section>
    );
  }
  const locked = isSetupLocked(state, profileSlug);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (d.draft!.name.trim() === "") {
      d.setError("Give the agent a name before saving.");
      return;
    }
    void d.save((dr, base, s) => updateProfile(storage, s, { ...fromDraft(dr), slug: profileSlug }, base));
  };

  return (
    <section className="editor" aria-label={stored.name}>
      <h2>{stored.name}</h2>
      <EditorStatus d={d} />
      <form onSubmit={onSubmit}>
        <ProfileFieldset draft={d.draft} onChange={d.edit} locked={locked} />
        <SaveBar d={d}>
          {locked && (
            <button type="button" onClick={() => onDuplicate(duplicateProfileDraft(state, profileSlug))}>
              Duplicate as new profile
            </button>
          )}
        </SaveBar>
      </form>
      <EarnedBadges state={state} profileSlug={profileSlug} />
    </section>
  );
}

// ---------------------------------------------------------------------------

export interface NewProfileEditorProps {
  initial: ProfileFields;
  onCreated(slug: string): void;
  onCancel(): void;
}

/** An unsaved profile, blank or duplicated. The file is created only on Save. */
export function NewProfileEditor({ initial, onCreated, onCancel }: NewProfileEditorProps) {
  const { state, storage, apply } = useFolder();
  const [draft, setDraft] = useState(() => toDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) return;
    if (draft.name.trim() === "") {
      setError("Give the agent a name before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createProfile(storage, state, fromDraft(draft));
      apply(result.state);
      onCreated(result.slug);
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  };

  return (
    <section className="editor" aria-label="New agent">
      <h2>New agent</h2>
      <p className="muted">Not saved yet. The agent is added to your folder when you save.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={onSubmit}>
        <ProfileFieldset draft={draft} onChange={setDraft} locked={false} />
        <div className="form-actions">
          <button type="submit" className="primary" disabled={saving}>
            Save
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
