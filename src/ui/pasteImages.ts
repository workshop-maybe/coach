// Which pastes are image pastes (KTD5 of the paste-images plan). Shared by the rich box and
// its flow-test stub, so both take the same pastes.

/** The image files a paste carries, from its files or, failing that, its items. */
export function pastedImages(data: DataTransfer): File[] {
  const files = Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (files.length) return files;
  return Array.from(data.items ?? [])
    .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
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
 */
export function pasteHasText(data: DataTransfer): boolean {
  const text = data.getData("text/plain").trim();
  if (text !== "" && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text)) return true;
  const html = data.getData("text/html");
  return html !== "" && htmlHasText(html);
}

/** The images to take from a paste: its image files, when it carries no real text. */
export function imagePaste(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = pastedImages(data);
  return files.length && !pasteHasText(data) ? files : [];
}
