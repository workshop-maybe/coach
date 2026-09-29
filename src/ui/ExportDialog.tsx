// Exports one collection as the andamio-cli layout plus JSON (R24, KTD7). The rubric stays
// out unless the user ticks the box. The folder is picked through the Rust dialog, which
// approves it as the export root (KTD1).

import { useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildBadgeInput } from "../badge/resolve";
import { renderBadgeSvg } from "../badge/render";
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
      const folder = await invoke<string | null>("pick_export_folder");
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
      const badges = new Map<string, string>();
      for (const slug of saved.order) {
        const credential = current.credentials.find((c) => c.collectionSlug === saved.slug && c.slug === slug);
        if (!credential) continue;
        const { input } = await buildBadgeInput(storage, saved, credential);
        badges.set(slug, renderBadgeSvg(input));
      }
      const files = buildExport(saved, current.credentials, { includeRubric, badges });
      await writeExport(storage, files);
      const count = files.size;
      setOutcome({ kind: "done", message: `Exported ${count} ${count === 1 ? "file" : "files"} to ${folder}` });
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
            <button type="button" className="primary" onClick={() => void run()} disabled={busy}>
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
