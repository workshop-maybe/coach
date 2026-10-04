// Export is one action for every collection (KTD8, R19). For each collection it runs
// the steps the old export dialog ran: skip one whose file failed to load, save module
// codes that exist only in memory, render badges, copy task images into each module's
// assets folder, then build without the rubric and write. The caller picks the export
// folder first (Rust approves it as the root).

import { renderBadgeFor } from "../badge/resolve";
import { buildExport, writeExport } from "../domain/export";
import { collectionPath, credentialPath, loadFolder, parseCollection, saveCollection } from "../domain/folder";
import { dataUriToBytes, folderOf, localImageNames, withAssetsRefs } from "../domain/images";
import type { Credential, FolderState } from "../domain/types";
import type { Storage } from "../storage/storage";

export interface ExportAllResult {
  /** Files written across every collection. */
  files: number;
  /** Badges written without their art because the image could not be read. */
  withoutArt: number;
  /** Data-folder paths of task images that could not be copied. Their refs are left as written. */
  imagesNotCopied: string[];
  /** Collection files that could not be read, so their collections were left out. */
  skipped: string[];
  /** The folder as it is after any module codes were saved. */
  state: FolderState;
}

/**
 * Copies each bare-name image the task refers to from the credential's folder into the
 * module's `assets/` folder in the export root (KTD9), where the Andamio CLI uploads it.
 * Returns the task pointed at the copies, how many files were written, and the images
 * that could not be read or saved, whose refs stay as written.
 */
async function copyTaskImages(
  storage: Storage,
  credential: Credential,
  moduleDir: string,
): Promise<{ task: string; copied: number; notCopied: string[] }> {
  const from = folderOf(credentialPath(credential.collectionSlug, credential.slug));
  const renamed = new Map<string, string>();
  const saved = new Set<string>();
  const notCopied: string[] = [];
  for (const name of localImageNames(credential.task)) {
    const path = `${from}/${name}`;
    try {
      const uri = await storage.readDataUri("data", path);
      if (uri === null) throw new Error(`${path} does not exist.`);
      const to = await storage.saveImage("export", `${moduleDir}/assets`, dataUriToBytes(uri));
      saved.add(to);
      renamed.set(name, to.slice(to.lastIndexOf("/") + 1));
    } catch {
      notCopied.push(path);
    }
  }
  return { task: withAssetsRefs(credential.task, renamed), copied: saved.size, notCopied };
}

/**
 * Exports one collection without the rubric. Throws when its file could not be read. Saves module codes that
 * exist only in memory first, and returns the folder as it is afterwards.
 */
async function exportCollection(storage: Storage, state: FolderState, slug: string): Promise<Omit<ExportAllResult, "skipped">> {
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
  // Only the task leaves the app, so only its images are copied. A credential with no
  // module code is left as it is for buildExport to report.
  const images = await Promise.all(
    credentials.map((c) =>
      saved.codes[c.slug] === undefined
        ? { task: c.task, copied: 0, notCopied: [] }
        : copyTaskImages(storage, c, `${saved.slug}/${saved.codes[c.slug]}`),
    ),
  );
  const exported = credentials.map((c, i) => ({ ...c, task: images[i].task }));
  const built = buildExport(saved, exported, { includeRubric: false, badges });
  await writeExport(storage, built);
  return {
    files: built.size + images.reduce((n, r) => n + r.copied, 0),
    withoutArt: rendered.filter((r) => r.artMissing).length,
    imagesNotCopied: [...new Set(images.flatMap((r) => r.notCopied))],
    state: current,
  };
}

/** Exports every collection without the rubric, leaving out any whose file could not be read. */
export async function exportAll(storage: Storage, state: FolderState): Promise<ExportAllResult> {
  let current = state;
  let files = 0;
  let withoutArt = 0;
  const imagesNotCopied: string[] = [];
  const skipped: string[] = [];
  for (const { slug } of state.collections) {
    const path = collectionPath(slug);
    if (current.errors.some((e) => e.path === path)) {
      skipped.push(path);
      continue;
    }
    const one = await exportCollection(storage, current, slug);
    current = one.state;
    files += one.files;
    withoutArt += one.withoutArt;
    imagesNotCopied.push(...one.imagesNotCopied);
  }
  return { files, withoutArt, imagesNotCopied, skipped, state: current };
}

/** One line saying what the export did. */
export function exportMessage(
  result: Pick<ExportAllResult, "files" | "withoutArt" | "imagesNotCopied" | "skipped">,
  folder: string,
): string {
  const { files, withoutArt, imagesNotCopied, skipped } = result;
  let message = `Exported ${files} ${files === 1 ? "file" : "files"} to ${folder}.`;
  if (withoutArt > 0) {
    message += ` ${withoutArt} ${withoutArt === 1 ? "badge was" : "badges were"} exported without art because the image could not be read.`;
  }
  if (imagesNotCopied.length > 0) {
    const n = imagesNotCopied.length;
    message += ` ${n} ${n === 1 ? "image" : "images"} could not be copied: ${imagesNotCopied.join(", ")}.`;
  }
  if (skipped.length > 0) {
    message += ` Skipped ${skipped.join(", ")} because ${skipped.length === 1 ? "it" : "they"} could not be read.`;
  }
  return message;
}
