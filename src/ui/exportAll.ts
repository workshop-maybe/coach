// Export is one action for every collection (KTD8, R19). For each collection it runs
// the steps the old export dialog ran: skip one whose file failed to load, save module
// codes that exist only in memory, render badges, then build without the rubric and
// write. The caller picks the export folder first (Rust approves it as the root).

import { renderBadgeFor } from "../badge/resolve";
import { buildExport, writeExport } from "../domain/export";
import { collectionPath, loadFolder, parseCollection, saveCollection } from "../domain/folder";
import type { FolderState } from "../domain/types";
import type { Storage } from "../storage/storage";

export interface ExportAllResult {
  /** Files written across every collection. */
  files: number;
  /** Badges written without their art because the image could not be read. */
  withoutArt: number;
  /** Collection files that could not be read, so their collections were left out. */
  skipped: string[];
  /** The folder as it is after any module codes were saved. */
  state: FolderState;
}

/**
 * Exports one collection. Throws when its file could not be read. Saves module codes that
 * exist only in memory first, and returns the folder as it is afterwards.
 */
export async function exportCollection(
  storage: Storage,
  state: FolderState,
  slug: string,
  options: { includeRubric: boolean },
): Promise<Omit<ExportAllResult, "skipped">> {
  const path = collectionPath(slug);
  if (state.errors.some((e) => e.path === path)) throw new Error(`${path} could not be read. Fix it before exporting.`);
  const collection = state.collections.find((c) => c.slug === slug);
  if (!collection) throw new Error(`The collection "${slug}" could not be found.`);
  // Codes for credentials added by hand exist only in memory until saved. Save them
  // first so the exported module codes match the folder and stay stable.
  let current = state;
  const base = state.raw[path] ?? null;
  const onDisk = base === null ? null : parseCollection(base, slug);
  if (!onDisk || collection.order.some((s) => !(s in onDisk.codes))) {
    await saveCollection(storage, collection, base);
    current = await loadFolder(storage);
  }
  const saved = current.collections.find((c) => c.slug === slug) ?? collection;
  const credentials = saved.order.flatMap((s) => current.credentials.filter((c) => c.collectionSlug === slug && c.slug === s));
  const rendered = await Promise.all(credentials.map((c) => renderBadgeFor(storage, saved, c)));
  const badges = new Map(credentials.map((c, i) => [c.slug, rendered[i].svg] as const));
  const built = buildExport(saved, current.credentials, { includeRubric: options.includeRubric, badges });
  await writeExport(storage, built);
  return { files: built.size, withoutArt: rendered.filter((r) => r.artMissing).length, state: current };
}

/** Exports every collection without the rubric, leaving out any whose file could not be read. */
export async function exportAll(storage: Storage, state: FolderState): Promise<ExportAllResult> {
  let current = state;
  let files = 0;
  let withoutArt = 0;
  const skipped: string[] = [];
  for (const { slug } of state.collections) {
    const path = collectionPath(slug);
    if (current.errors.some((e) => e.path === path)) {
      skipped.push(path);
      continue;
    }
    const one = await exportCollection(storage, current, slug, { includeRubric: false });
    current = one.state;
    files += one.files;
    withoutArt += one.withoutArt;
  }
  return { files, withoutArt, skipped, state: current };
}

/** One line saying what the export did. */
export function exportMessage(result: Pick<ExportAllResult, "files" | "withoutArt" | "skipped">, folder: string): string {
  const { files, withoutArt, skipped } = result;
  let message = `Exported ${files} ${files === 1 ? "file" : "files"} to ${folder}.`;
  if (withoutArt > 0) {
    message += ` ${withoutArt} ${withoutArt === 1 ? "badge was" : "badges were"} exported without art because the image could not be read.`;
  }
  if (skipped.length > 0) {
    message += ` Skipped ${skipped.join(", ")} because ${skipped.length === 1 ? "it" : "they"} could not be read.`;
  }
  return message;
}
