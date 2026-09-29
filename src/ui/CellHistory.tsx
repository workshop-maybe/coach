// One matrix cell (R18): every result newest first, each hand-back collapsed until
// expanded, the reason for each flag on the latest result, and the actions to test the
// agent again or record a result.

import { useState } from "react";
import { FLAG_REASONS, type Cell } from "../domain/matrix";
import type { AgentProfile, AgentSetup, Credential } from "../domain/types";
import { AssessmentForm } from "./AssessmentForm";
import { PromptPanel } from "./PromptPanel";

export interface CellHistoryProps {
  cell: Cell;
  profile: AgentProfile;
  credential: Credential;
  onClose(): void;
}

export function setupLine(setup: AgentSetup): string {
  const parts = [setup.harness, setup.model, setup.effort].map((s) => (s.trim() === "" ? "(none)" : s));
  return parts.join(" · ");
}

export function resultLabel(result: "met" | "not_met" | "untested"): string {
  return result === "met" ? "Met" : result === "not_met" ? "Not met" : "Untested";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

type Mode = "history" | "prompt" | "record";

export function CellHistory({ cell, profile, credential, onClose }: CellHistoryProps) {
  const [mode, setMode] = useState<Mode>("history");
  const latest = cell.latest;

  return (
    <section className="panel cell-history" aria-label="Cell history">
      <div className="panel-head">
        <h2>
          {profile.name} · {credential.name}
        </h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <p>
        Latest: <strong>{resultLabel(cell.status)}</strong>
      </p>

      {latest && cell.flags.length > 0 && (
        <div className="flag-reasons">
          <ul>
            {cell.flags.map((f) => (
              <li key={f}>{FLAG_REASONS[f]}</li>
            ))}
          </ul>
          {cell.flags.includes("setup_mismatch") && (
            <dl className="facts setup-compare">
              <div>
                <dt>Recorded setup</dt>
                <dd>{setupLine(latest.setup)}</dd>
              </div>
              <div>
                <dt>Current setup</dt>
                <dd>{setupLine(profile)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      <div className="actions">
        <button type="button" onClick={() => setMode("prompt")}>
          New test prompt
        </button>
        <button type="button" onClick={() => setMode("record")}>
          Record result
        </button>
      </div>

      {mode === "prompt" && (
        <PromptPanel
          credentialKey={cell.credentialKey}
          initialJob="test"
          profileSlug={profile.slug}
          onClose={() => setMode("history")}
        />
      )}
      {mode === "record" && (
        <AssessmentForm
          credentialKey={cell.credentialKey}
          profileSlug={profile.slug}
          onDone={() => setMode("history")}
          onCancel={() => setMode("history")}
        />
      )}

      <h3>History</h3>
      {cell.history.length === 0 ? (
        <p className="muted">No results yet.</p>
      ) : (
        <ol className="history">
          {cell.history.map((a) => {
            const label = resultLabel(a.result);
            const date = formatDate(a.recordedAt);
            return (
              <li key={a.fileStem} aria-label={`${label} result, ${date}`}>
                <p className="history-head">
                  <strong>{label}</strong> <span className="muted">{date}</span>
                </p>
                {a.note.trim() !== "" && <p className="history-note">{a.note}</p>}
                <details>
                  <summary>Hand-back</summary>
                  <pre className="handback">{a.handBack}</pre>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
