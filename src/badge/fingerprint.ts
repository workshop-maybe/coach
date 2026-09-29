// Badge fingerprints (KTD2): SHA-256 digests of namespaced slugs. Slugs never
// change, so a credential's rings never change when its name or content does.
// Uses Web Crypto so the same code runs in the Tauri webview and in Node tests.

import { sha256Hex } from "../domain/hash";

/** Outer ring bytes, matching credential-badges' 224 ticks. */
const OUTER_BYTES = 28;

/** Number of credential-badges palettes. */
const PALETTE_COUNT = 10;

// Slugs never change, so a collection's fingerprint can be computed once and kept.
const collectionCache = new Map<string, Promise<string>>();

/** The first 28 bytes (56 hex) of sha256("andamio-desktop/collection:" + slug). */
export function collectionFingerprint(collectionSlug: string): Promise<string> {
  let hex = collectionCache.get(collectionSlug);
  if (!hex) {
    hex = sha256Hex(`andamio-desktop/collection:${collectionSlug}`).then((h) => h.slice(0, OUTER_BYTES * 2));
    collectionCache.set(collectionSlug, hex);
  }
  return hex;
}

/** Outer ring: the collection (56 hex). Inner ring: collection and credential (64 hex). */
export async function badgeFingerprints(
  collectionSlug: string,
  credentialSlug: string,
): Promise<{ outerHex: string; innerHex: string }> {
  const [outerHex, innerHex] = await Promise.all([
    collectionFingerprint(collectionSlug),
    sha256Hex(`andamio-desktop/credential:${collectionSlug}/${credentialSlug}`),
  ]);
  return { outerHex, innerHex };
}

/** The fingerprint's default palette index, mirroring credential-badges' `palette_for`. */
export function defaultPaletteIndex(outerHex: string): number {
  return parseInt(outerHex.slice(0, 8), 16) % PALETTE_COUNT;
}
