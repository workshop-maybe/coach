// Exports one collection as the andamio-cli layout plus JSON (R24, KTD7). The rubric stays
// out unless the user ticks the box. The folder is picked through the Rust dialog, which
// approves it as the export root (KTD1).

import { useId, useState } from "react";
import { pickExportFolder } from "./exportFolder";
import { exportCollection, exportMessage } from "./exportAll";
import { describeError, useFolder } from "./useFolderState";

export interface ExportDialogProps {
  collectionSlug: string;
  onClose(): void;
}

type Outcome = { kind: "idle" } | { kind: "done"; message: string } | { kind: "error"; message: string };

export function ExportDialog({ collectionSlug, onClose }: ExportDialogProps) {
  const { state, storage, apply } = useFolder();
  const id = useId();
  const [includeRubric, setIncludeRubric] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const collection = state?.collections.find((c) => c.slug === collectionSlug);

  async function run() {
    if (!state || !collection) return;
    setBusy(true);
    setOutcome({ kind: "idle" });
    try {
      const folder = await pickExportFolder();
      if (!folder) return;
      const result = await exportCollection(storage, state, collection.slug, { includeRubric });
      if (result.state !== state) apply(result.state);
      setOutcome({ kind: "done", message: exportMessage({ ...result, skipped: [] }, folder) });
    } catch (e) {
      setOutcome({ kind: "error", message: `Export failed: ${describeError(e)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel export-dialog" aria-label="Export">
      <div className="panel-head">
        <h2>{collection ? `Export ${collection.name}` : "Export"}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {!state ? (
        <p className="muted">Loading…</p>
      ) : !collection ? (
        <p className="muted">This collection could not be found.</p>
      ) : (
        <>
          <p className="muted">
            Writes Markdown in the andamio-cli layout and one JSON file for the collection.
          </p>
          <div className="checkbox">
            <input
              id={`${id}-rubric`}
              type="checkbox"
              checked={includeRubric}
              onChange={(e) => setIncludeRubric(e.target.checked)}
            />
            <label htmlFor={`${id}-rubric`}>Include rubric</label>
          </div>
          <div className="actions">
            <button type="button" className="ink" onClick={() => void run()} disabled={busy}>
              Choose folder and export
            </button>
          </div>
          {outcome.kind === "done" && <p role="status">{outcome.message}</p>}
          {outcome.kind === "error" && (
            <p className="form-error" role="alert">
              {outcome.message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
