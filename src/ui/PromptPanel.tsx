// Generates one of the five built-in prompts (R8) as editable text with one-click copy (R9).
// The edited text is this panel's own state: a folder reload never regenerates it, only a
// job or agent change or Reset does (KTD6). After a test prompt, the user can record the
// result for the same agent and credential (F2).

import { useEffect, useId, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { PROMPT_JOBS, buildPrompt, type PromptJob } from "../domain/prompts";
import { credentialKey as keyOf } from "../domain/types";
import { AssessmentForm } from "./AssessmentForm";
import { describeError, useFolder } from "./useFolderState";

export interface PromptPanelProps {
  /** `collection/slug` of the credential the prompt is for. */
  credentialKey: string;
  /** Job to open on. Defaults to "test". */
  initialJob?: PromptJob;
  /** Pre-selected agent profile for the test job. */
  profileSlug?: string;
  onClose(): void;
}

type CopyStatus = { kind: "idle" } | { kind: "copied" } | { kind: "error"; message: string };

export function PromptPanel({ credentialKey, initialJob = "test", profileSlug, onClose }: PromptPanelProps) {
  const { state } = useFolder();
  const id = useId();
  const [job, setJob] = useState<PromptJob>(initialJob);
  const [profile, setProfile] = useState(profileSlug ?? "");
  // Null until generated. Regenerated only by an explicit user action, never by a reload.
  const [text, setText] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyStatus>({ kind: "idle" });
  const [recording, setRecording] = useState(false);

  const credential = state?.credentials.find((c) => keyOf(c) === credentialKey);
  const agent = state?.profiles.find((p) => p.slug === profile);
  const info = PROMPT_JOBS.find((j) => j.job === job) ?? PROMPT_JOBS[0];
  const blocked = job === "test" && credential !== undefined && credential.task.trim() === "";

  function generate(nextJob: PromptJob, nextProfile: string) {
    if (!credential) return;
    const p = state?.profiles.find((x) => x.slug === nextProfile);
    setText(buildPrompt(nextJob, credential, p));
    setCopy({ kind: "idle" });
  }

  // First fill, once the folder and credential are available.
  useEffect(() => {
    if (text === null && credential) setText(buildPrompt(job, credential, agent));
  }, [text, credential, job, agent]);

  async function onCopy() {
    if (text === null) return;
    try {
      await writeText(text);
      setCopy({ kind: "copied" });
    } catch (e) {
      setCopy({ kind: "error", message: describeError(e) });
    }
  }

  return (
    <section className="panel prompt-panel" aria-label="Prompt">
      <div className="panel-head">
        <h2>{credential ? `Prompt for ${credential.name}` : "Prompt"}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {!state ? (
        <p className="muted">Loading…</p>
      ) : !credential ? (
        <p className="muted">This credential could not be found. It may have been removed from the folder.</p>
      ) : (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-job`}>Prompt job</label>
              <select
                id={`${id}-job`}
                value={job}
                onChange={(e) => {
                  const next = e.target.value as PromptJob;
                  setJob(next);
                  setRecording(false);
                  generate(next, profile);
                }}
              >
                {PROMPT_JOBS.map((j) => (
                  <option key={j.job} value={j.job}>
                    {j.label}
                  </option>
                ))}
              </select>
            </div>
            {info.needsProfile && (
              <div className="field">
                <label htmlFor={`${id}-agent`}>Agent</label>
                <select
                  id={`${id}-agent`}
                  value={profile}
                  onChange={(e) => {
                    setProfile(e.target.value);
                    setRecording(false);
                    generate(job, e.target.value);
                  }}
                >
                  <option value="">Choose an agent</option>
                  {state.profiles.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {text === null ? null : blocked ? (
            <p className="blocked-note">
              This credential has no task yet. Write a task before testing an agent with it.
            </p>
          ) : (
            <>
              <div className="field">
                <label htmlFor={`${id}-text`}>Prompt text</label>
                <textarea
                  id={`${id}-text`}
                  className="prompt-text"
                  rows={16}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setCopy({ kind: "idle" });
                  }}
                />
              </div>
              <div className="actions">
                <button type="button" className="primary" onClick={() => void onCopy()}>
                  Copy
                </button>
                <button type="button" onClick={() => generate(job, profile)}>
                  Reset
                </button>
                {job === "test" && !recording && (
                  <button type="button" onClick={() => setRecording(true)}>
                    Record result
                  </button>
                )}
                <span className="copy-status" role="status">
                  {copy.kind === "copied" ? "Copied" : ""}
                </span>
              </div>
              {copy.kind === "error" && (
                <p className="form-error" role="alert">
                  Could not copy: {copy.message}
                </p>
              )}
            </>
          )}

          {recording && job === "test" && (
            <AssessmentForm
              credentialKey={credentialKey}
              profileSlug={profile === "" ? undefined : profile}
              onDone={() => setRecording(false)}
              onCancel={() => setRecording(false)}
            />
          )}
        </>
      )}
    </section>
  );
}
