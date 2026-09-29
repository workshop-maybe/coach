// Turns stored badge settings into renderer input: fingerprints, palette tokens,
// titles and art (see the badge plan, High-Level Technical Design). Settings may come
// from the saved collection or from an unsaved draft, so the preview updates before Save.

import type { Collection, Credential } from "../domain/types";
import type { Storage } from "../storage/storage";
import { badgeFingerprints, defaultPaletteIndex } from "./fingerprint";
import { PALETTES, lightInterior, withCustomRings } from "./palettes";
import type { BadgeRenderInput } from "./render";
import { resolveBadgeSettings, resolvedTitles, type ResolvedBadgeSettings } from "./settings";

/** Palette tokens for resolved settings: the chosen preset or the fingerprint default, with custom rings on top (KTD7). */
export function tokensFor(resolved: Pick<ResolvedBadgeSettings, "palette" | "colors">, outerHex: string) {
  const preset = PALETTES.find((p) => p.slug === resolved.palette) ?? PALETTES[defaultPaletteIndex(outerHex)];
  const palette = resolved.colors ? withCustomRings(preset, resolved.colors.ring, resolved.colors.innerRing) : preset;
  return lightInterior(palette);
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
): Promise<BadgeInputResult> {
  const resolved = resolveBadgeSettings(collection, credential.slug);
  const { outerHex, innerHex } = await badgeFingerprints(collection.slug, credential.slug);
  const titles = resolvedTitles(credential.name, collection.name, resolved);
  let artDataUri: string | undefined;
  let artMissing = false;
  if (resolved.art) {
    try {
      artDataUri = (await storage.readDataUri("data", resolved.art)) ?? undefined;
    } catch {
      artDataUri = undefined;
    }
    artMissing = artDataUri === undefined;
  }
  return {
    input: { mainTitle: titles.main, eyebrowTitle: titles.eyebrow, outerHex, innerHex, tokens: tokensFor(resolved, outerHex), artDataUri },
    artMissing,
  };
}
