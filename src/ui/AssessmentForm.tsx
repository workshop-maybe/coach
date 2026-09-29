// Records one assessment (R14-R16). The user pastes the agent's hand-back and chooses
// met or not met. The app never infers the result (R15). The draft lives in this
// component's state, so a folder reload or a failed save never clears it (KTD6).

import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { assignmentVersion } from "../domain/hash";
import { recordAssessment } from "../domain/operations";
import { credentialKey as keyOf, type AssessmentResult } from "../domain/types";
import { describeError, useFolder } from "./useFolderState";

export interface AssessmentFormProps {
  /** `collection/slug`. When given, the credential is fixed; otherwise the user picks one. */
  credentialKey?: string;
  /** When given, the agent is fixed; otherwise the user picks one. */
  profileSlug?: string;
  /** `ink` when the form sits inside a view that already has its one orange primary action. */
  submitVariant?: "primary" | "ink";
  onDone(): void;
  onCancel(): void;
}

export function AssessmentForm({ credentialKey, profileSlug, submitVariant = "primary", onDone, onCancel }: AssessmentFormProps) {
  const { state, storage, apply } = useFolder();
  const id = useId();
  const [profile, setProfile] = useState(profileSlug ?? "");
  const [credential, setCredential] = useState(credentialKey ?? "");
  const [handBack, setHandBack] = useState("");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  const profiles = state?.profiles ?? [];
  const collections = state?.collections ?? [];
  const credentials = state?.credentials ?? [];
  const chosenProfile = profiles.find((p) => p.slug === profile);
  const chosenCredential = credentials.find((c) => keyOf(c) === credential);

  const task = chosenCredential?.task;
  const rubric = chosenCredential?.rubric;
  useEffect(() => {
    if (task === undefined || rubric === undefined) {
      setVersion(null);
      return;
    }
    let live = true;
    void assignmentVersion(task, rubric).then((v) => live && setVersion(v));
    return () => {
      live = false;
    };
  }, [task, rubric]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!state) return;
    if (!chosenProfile) return setError("Choose an agent before saving.");
    if (!chosenCredential) return setError("Choose a credential before saving.");
    if (result === null) return setError("Choose met or not met before saving.");
    if (handBack.trim() === "") return setError("Paste the agent's hand-back before saving.");
    setSaving(true);
    try {
      const next = await recordAssessment(storage, state, {
        profileSlug: chosenProfile.slug,
        collectionSlug: chosenCredential.collectionSlug,
        credentialSlug: chosenCredential.slug,
        result,
        note,
        handBack,
      });
      apply(next);
      setError(null);
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel assessment-form" aria-label="Record result" onSubmit={save} noValidate>
      <h2>Record result</h2>
      <dl className="facts">
        {profileSlug !== undefined ? (
          <div>
            <dt>Agent</dt>
            <dd>{chosenProfile?.name ?? profileSlug}</dd>
          </div>
        ) : null}
        {credentialKey !== undefined ? (
          <div>
            <dt>Credential</dt>
            <dd>{chosenCredential?.name ?? credentialKey}</dd>
          </div>
        ) : null}
      </dl>

      {profileSlug === undefined && (
        <div className="field">
          <label htmlFor={`${id}-agent`}>Agent</label>
          <select id={`${id}-agent`} value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="">Choose an agent</option>
            {profiles.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {credentialKey === undefined && (
        <div className="field">
          <label htmlFor={`${id}-credential`}>Credential</label>
          <select id={`${id}-credential`} value={credential} onChange={(e) => setCredential(e.target.value)}>
            <option value="">Choose a credential</option>
            {collections.map((col) => (
              <optgroup key={col.slug} label={col.name}>
                {credentials
                  .filter((c) => c.collectionSlug === col.slug)
                  .map((c) => (
                    <option key={keyOf(c)} value={keyOf(c)}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

      {version && <p className="muted">Records against assignment version {version}</p>}

      <div className="field">
        <label htmlFor={`${id}-handback`}>Hand-back</label>
        <textarea
          id={`${id}-handback`}
          rows={8}
          required
          value={handBack}
          onChange={(e) => setHandBack(e.target.value)}
          placeholder="Paste the agent's whole reply here."
        />
      </div>

      <fieldset className="field result-choice">
        <legend>Result</legend>
        <label>
          <input
            type="radio"
            name={`${id}-result`}
            value="met"
            checked={result === "met"}
            onChange={() => setResult("met")}
          />{" "}
          Met
        </label>
        <label>
          <input
            type="radio"
            name={`${id}-result`}
            value="not_met"
            checked={result === "not_met"}
            onChange={() => setResult("not_met")}
          />{" "}
          Not met
        </label>
      </fieldset>

      <div className="field">
        <label htmlFor={`${id}-note`}>Note (optional)</label>
        <textarea id={`${id}-note`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button type="submit" className={submitVariant} disabled={saving || !state}>
          Save result
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
