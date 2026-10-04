// Pasted images (see docs/plans/2026-10-04-0033-feat-paste-images-into-rich-boxes-plan.md).
// A pasted image is a PNG or JPEG file beside the file its box saves to, and the box's
// Markdown refers to it by bare file name. These helpers are shared by the image node, the
// storage stand-ins, export and the previews, so every layer agrees on what a ref may be.

/** The largest pasted image, in bytes (KTD4). Rust holds the same cap. */
export const PASTED_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const NOT_AN_IMAGE = "That file is not a JPEG or PNG image.";
export const IMAGE_TOO_LARGE = "That image is larger than 10 MB.";
export const ONLY_PNG_OR_JPEG = "Only PNG and JPEG images can be pasted.";

/**
 * Whether a Markdown image src names a PNG or JPEG in the same folder (KTD2): one path
 * segment with no separator, colon, angle bracket, quote or control character, no `..`,
 * ending .png, .jpg or .jpeg. Only such a name is ever read; anything else stays inert.
 */
export function isLocalImageName(src: string): boolean {
  if (/[/\\:<>"\u0000-\u001f\u007f]/.test(src) || src.includes("..") || src.startsWith(".")) return false;
  return /^.+\.(png|jpe?g)$/i.test(src);
}

/** Whether `uri` is a base64 PNG or JPEG data URI, the only image source the app sets. */
export function isImageDataUri(uri: string): boolean {
  return uri.startsWith("data:image/png;base64,") || uri.startsWith("data:image/jpeg;base64,");
}

/** The extension an image's magic bytes call for, or null when it is not a PNG or JPEG. */
export function imageExtension(bytes: Uint8Array): "png" | "jpg" | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

/** Base64 of `bytes`, in chunks so a large image never overflows the argument list. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The bytes inside a base64 data URI. */
export function dataUriToBytes(uri: string): Uint8Array {
  const binary = atob(uri.slice(uri.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The folder part of a root-relative path; "" for a file at the root. */
export function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

// A Markdown image: `![alt](src "title")`, where src may be wrapped in <...>.
const IMAGE = String.raw`(!\[(?:\\.|[^\]\\])*\]\(\s*)(<(?:\\.|[^>\\\n])*>|[^\s)]+)((?:\s+"(?:\\.|[^"\\])*")?\s*\))`;
const IMAGE_REF = new RegExp(IMAGE, "g");
const IMAGES_ONLY = new RegExp(String.raw`^\s*(?:${IMAGE}\s*)+$`);

/** Whether a line holds nothing but Markdown images. */
export function isImagesOnlyLine(line: string): boolean {
  return IMAGES_ONLY.test(line);
}

/** The src as written: without its angle brackets, with backslash escapes resolved. */
function srcOf(raw: string): string {
  const inner = raw.startsWith("<") ? raw.slice(1, -1) : raw;
  return inner.replace(/\\(.)/g, "$1");
}

/** Every bare-name image a Markdown text refers to, in order, once each. */
export function localImageNames(markdown: string): string[] {
  const names: string[] = [];
  for (const m of markdown.matchAll(IMAGE_REF)) {
    const src = srcOf(m[2]);
    if (isLocalImageName(src) && !names.includes(src)) names.push(src);
  }
  return names;
}

/** `markdown` with each bare-name ref in `renamed` pointed at `assets/<new name>` (KTD9). */
export function withAssetsRefs(markdown: string, renamed: ReadonlyMap<string, string>): string {
  return markdown.replace(IMAGE_REF, (whole, head: string, raw: string, tail: string) => {
    const to = renamed.get(srcOf(raw));
    return to === undefined ? whole : `${head}assets/${to}${tail}`;
  });
}
