// Which pastes are image pastes (KTD5 of the paste-images plan), which are video pastes
// (KTD5 of the video plan), and which are a reply's file pastes (KTD7 of the reply artifacts
// plan). Shared by the rich box and its flow-test stub, so both take the same pastes.

import { hasVideoExtension } from "../domain/videos";

/**
 * The files a paste carries whose type `keep` accepts, from its files or, failing that, its
 * items. The filter runs before the fall-back, so items are read only when no file passes.
 */
function pastedFiles(data: DataTransfer, keep: (type: string) => boolean = () => true): File[] {
  const files = Array.from(data.files ?? []).filter((f) => keep(f.type));
  if (files.length) return files;
  return Array.from(data.items ?? [])
    .filter((i) => i.kind === "file" && keep(i.type))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
}

/** The image files a paste carries. */
function pastedImages(data: DataTransfer): File[] {
  return pastedFiles(data, (type) => type.startsWith("image/"));
}

/**
 * Whether HTML holds any text. Parsed in an inert document, never in the live page, where a
 * clipboard `<img onerror>` would load and run.
 */
export function htmlHasText(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body?.textContent ?? "").trim() !== "";
}

/**
 * Whether a paste carries real text: plain text other than a lone address, or HTML with text
 * in it. An Office or iWork copy puts a picture of the text beside the text; the text wins.
 * Plain text made only of `names`, one per line, is not real text either: a Finder copy can
 * bring the copied files' names as text beside the files.
 */
export function pasteHasText(data: DataTransfer, names: ReadonlySet<string> = new Set()): boolean {
  const text = data.getData("text/plain").trim();
  const onlyNames = text.split(/\s*[\r\n]+\s*/).every((line) => names.has(line));
  if (text !== "" && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text) && !onlyNames) return true;
  const html = data.getData("text/html");
  return html !== "" && htmlHasText(html);
}

/** The images to take from a paste: its image files, when it carries no real text. */
export function imagePaste(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = pastedImages(data);
  return files.length && !pasteHasText(data) ? files : [];
}

/** Whether a pasted file is a video, by its type or its extension. Rust decides what is added. */
function isVideo(file: File): boolean {
  return file.type.startsWith("video/") || hasVideoExtension(file.name);
}

/**
 * The files to add by path from a paste (R3): every file it carries, pictures included, when
 * at least one is a video and the paste carries no real text. Only names and sizes leave the
 * page; Rust matches them against the paths on the clipboard. Empty for any other paste,
 * which keeps today's path.
 */
export function videoPaste(data: DataTransfer | null): { name: string; size: number }[] {
  if (!data) return [];
  const files = pastedFiles(data);
  if (!files.some(isVideo) || pasteHasText(data, new Set(files.map((f) => f.name)))) return [];
  return files.map((f) => ({ name: f.name, size: f.size }));
}

/** Whether a pasted file stays inline in a text item: a PNG, a JPEG or a video (reply artifacts KTD7). */
function staysInline(file: File): boolean {
  return file.type === "image/png" || file.type === "image/jpeg" || isVideo(file);
}

/**
 * The files to hand a reply's editor from a paste into one of its text items (reply artifacts
 * KTD7): every file the paste carries, when at least one is not a PNG, a JPEG or a video and
 * the paste carries no real text. Only names and sizes leave the page, as a video paste's do,
 * and Rust sorts each by content into an item. Empty for any other paste, which stays inline.
 */
export function filePaste(data: DataTransfer | null): { name: string; size: number }[] {
  if (!data) return [];
  const files = pastedFiles(data);
  if (files.every(staysInline) || pasteHasText(data, new Set(files.map((f) => f.name)))) return [];
  return files.map((f) => ({ name: f.name, size: f.size }));
}
