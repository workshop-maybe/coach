// Badge fingerprints (KTD2): SHA-256 digests of namespaced slugs. Slugs never
// change, so a credential's rings never change when its name or content does.
// Uses Web Crypto so the same code runs in the Tauri webview and in Node tests.

/** Outer ring bytes, matching credential-badges' 224 ticks. */
const OUTER_BYTES = 28;

/** Number of credential-badges palettes. */
const PALETTE_COUNT = 10;

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The first 28 bytes (56 hex) of sha256("andamio-desktop/collection:" + slug). */
export async function collectionFingerprint(collectionSlug: string): Promise<string> {
  return (await sha256Hex(`andamio-desktop/collection:${collectionSlug}`)).slice(0, OUTER_BYTES * 2);
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
