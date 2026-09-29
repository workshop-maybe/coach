// Turns stored badge settings into renderer input: fingerprints, palette tokens,
// titles and art (see the badge plan, High-Level Technical Design). Settings may come
// from the saved collection or from an unsaved draft, so the preview updates before Save.

import type { Collection, Credential } from "../domain/types";
import type { Storage } from "../storage/storage";
import { badgeFingerprints, defaultPaletteIndex } from "./fingerprint";
import { PALETTES, lightInterior, withCustomRings } from "./palettes";
import { renderBadgeSvg, type BadgeRenderInput } from "./render";
import { resolveBadgeSettings, resolvedTitles, type ResolvedBadgeSettings } from "./settings";

/** Palette tokens for resolved settings: the chosen preset or the fingerprint default, with custom rings on top (KTD7). */
export function tokensFor(resolved: Pick<ResolvedBadgeSettings, "palette" | "colors">, outerHex: string) {
  const preset = PALETTES.find((p) => p.slug === resolved.palette) ?? PALETTES[defaultPaletteIndex(outerHex)];
  const palette = resolved.colors ? withCustomRings(preset, resolved.colors.ring, resolved.colors.innerRing) : preset;
  return lightInterior(palette);
}

// Art data URIs, cached per storage so a list of badges sharing one image reads it once.
// A hand edit can replace an art file in place, which no text comparison sees, so the
// folder provider clears the cache on every reload. Exports read art fresh.
const artCache = new WeakMap<Storage, Map<string, Promise<string | null>>>();

export function clearArtCache(storage: Storage): void {
  artCache.delete(storage);
}

function readArt(storage: Storage, path: string): Promise<string | null> {
  let byPath = artCache.get(storage);
  if (!byPath) artCache.set(storage, (byPath = new Map()));
  let uri = byPath.get(path);
  if (!uri) {
    uri = storage.readDataUri("data", path).catch(() => null);
    byPath.set(path, uri);
    // A missing file may appear later, so only successful reads stay cached.
    void uri.then((u) => {
      if (u === null) byPath!.delete(path);
    });
  }
  return uri;
}

export interface BadgeInputResult {
  input: BadgeRenderInput;
  /** Set when the settings name an art file that could not be read. The badge renders without art. */
  artMissing: boolean;
}

/**
 * Builds renderer input for one credential. `collection` may be a draft copy carrying
 * unsaved badge settings. Art is read through storage; a missing or unreadable file
 * renders without art and reports `artMissing`.
 */
export async function buildBadgeInput(
  storage: Storage,
  collection: Collection,
  credential: Pick<Credential, "slug" | "name">,
  options: { freshArt?: boolean } = {},
): Promise<BadgeInputResult> {
  const resolved = resolveBadgeSettings(collection, credential.slug);
  const { outerHex, innerHex } = await badgeFingerprints(collection.slug, credential.slug);
  const titles = resolvedTitles(credential.name, collection.name, resolved);
  let artDataUri: string | undefined;
  let artMissing = false;
  if (resolved.art) {
    const read = options.freshArt ? storage.readDataUri("data", resolved.art).catch(() => null) : readArt(storage, resolved.art);
    artDataUri = (await read) ?? undefined;
    artMissing = artDataUri === undefined;
  }
  return {
    input: { mainTitle: titles.main, eyebrowTitle: titles.eyebrow, outerHex, innerHex, tokens: tokensFor(resolved, outerHex), artDataUri },
    artMissing,
  };
}

/**
 * Renders one credential's badge SVG for saving to disk. Art is read fresh, and
 * `artMissing` tells the caller the badge went out without its art.
 */
export async function renderBadgeFor(
  storage: Storage,
  collection: Collection,
  credential: Pick<Credential, "slug" | "name">,
): Promise<{ svg: string; artMissing: boolean }> {
  const { input, artMissing } = await buildBadgeInput(storage, collection, credential, { freshArt: true });
  return { svg: renderBadgeSvg(input), artMissing };
}
