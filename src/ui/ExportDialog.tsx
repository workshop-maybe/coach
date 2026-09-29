// Exports one collection as the andamio-cli layout plus JSON (R24, KTD7). The rubric stays
// out unless the user ticks the box. The folder is picked through the Rust dialog, which
// approves it as the export root (KTD1).

import { useId, useState } from "react";
import { pickExportFolder } from "./exportFolder";
import { renderBadgeFor } from "../badge/resolve";
import { buildExport, writeExport } from "../domain/export";
import { collectionPath, loadFolder, parseCollection, saveCollection } from "../domain/folder";
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
      // Codes for credentials added by hand exist only in memory until saved. Save them
      // first so the exported module codes match the folder and stay stable (KTD7).
      const path = collectionPath(collection.slug);
      if (state.errors.some((e) => e.path === path)) {
        throw new Error(`${path} could not be read. Fix it before exporting.`);
      }
      const base = state.raw[path] ?? null;
      const onDisk = base === null ? null : parseCollection(base, collection.slug);
      let current = state;
      if (!onDisk || collection.order.some((s) => !(s in onDisk.codes))) {
        await saveCollection(storage, collection, base);
        current = await loadFolder(storage);
        apply(current);
      }
      const saved = current.collections.find((c) => c.slug === collection.slug) ?? collection;
      const credentials = saved.order.flatMap((slug) =>
        current.credentials.filter((c) => c.collectionSlug === saved.slug && c.slug === slug),
      );
      const rendered = await Promise.all(credentials.map((c) => renderBadgeFor(storage, saved, c)));
      const badges = new Map(credentials.map((c, i) => [c.slug, rendered[i].svg] as const));
      const withoutArt = rendered.filter((r) => r.artMissing).length;
      const files = buildExport(saved, current.credentials, { includeRubric, badges });
      await writeExport(storage, files);
      const count = files.size;
      const artNote =
        withoutArt === 0
          ? ""
          : ` ${withoutArt} ${withoutArt === 1 ? "badge was" : "badges were"} exported without art because the image could not be read.`;
      setOutcome({ kind: "done", message: `Exported ${count} ${count === 1 ? "file" : "files"} to ${folder}.${artNote}` });
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
