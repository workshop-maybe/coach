// Videos in rich boxes (see docs/plans/2026-10-04-0732-feat-video-in-rich-boxes-plan.md).
// A video is an MP4, M4V, MOV or WebM file beside the file its box saves to, written with
// the image syntax and referred to by bare file name. Rust copies the bytes (KTD5), so the
// page only ever holds names and URLs; these helpers are what every layer agrees a ref is.

import { isBareName, localRefNames } from "./images";

/** The extensions a video may have, in any case (KTD1). */
export const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm"] as const;

/** The largest video, in bytes (KTD6). Rust holds the same cap. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

// Refusals from `add_files` and `copy_video`, word for word as Rust sends them, so the guide
// can quote them. A too-large picture reuses IMAGE_TOO_LARGE from ./images.

/** Every dropped or pasted path Rust did not approve or match. It never names the path. */
export const FILE_NOT_APPROVED = "That file can't be added. Drag it from Finder or use the Video key.";
export const ONLY_VIDEOS_AND_IMAGES = "Only MP4, MOV, M4V and WebM videos, and PNG and JPEG images, can be added.";
export const VIDEO_TOO_LARGE = "That video is larger than 100 MB.";

/** A different file already holds the content-addressed name; it is never overwritten. */
export function alreadyNamed(name: string): string {
  return `A different file is already named ${name}.`;
}

const VIDEO_NAME = /^.+\.(mp4|m4v|mov|webm)$/i;

/** Whether a name ends in a video extension, in any case. */
export function hasVideoExtension(name: string): boolean {
  return VIDEO_NAME.test(name);
}

/**
 * Whether a Markdown image src names a video in the same folder (KTD2): one path segment by
 * the image rule, ending .mp4, .m4v, .mov or .webm. Only such a name is ever asked for a URL.
 */
export function isLocalVideoName(src: string): boolean {
  return isBareName(src) && VIDEO_NAME.test(src);
}

/** Every bare-name video a Markdown text refers to, in order, once each. */
export function localVideoNames(markdown: string): string[] {
  return localRefNames(markdown, isLocalVideoName);
}

export type Platform = "mac" | "linux" | "windows";

/**
 * The platform a webview's user agent names. Anything not Windows or a Mac reads as Linux,
 * whose path (a blob fetched from the scheme) plays wherever fetch works.
 */
export function platformOf(userAgent: string): Platform {
  if (/Windows/.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "mac";
  return "linux";
}

/** This webview's platform. */
export function currentPlatform(): Platform {
  return platformOf(typeof navigator === "undefined" ? "" : navigator.userAgent);
}

/**
 * Whether a URL may be a `<video>`'s src on `platform` (KTD2). On macOS and Linux the media
 * scheme is `media://localhost/`; `http(s)://media.localhost/` there is a loopback address
 * another local process could answer, so only Windows, where Tauri maps the scheme to it,
 * takes it. A `blob:` URL is one the page made itself.
 */
export function isAllowedVideoUrl(url: string, platform: Platform = currentPlatform()): boolean {
  if (url.startsWith("blob:")) return true;
  if (platform === "windows") return url.startsWith("http://media.localhost/") || url.startsWith("https://media.localhost/");
  return url.startsWith("media://localhost/");
}
