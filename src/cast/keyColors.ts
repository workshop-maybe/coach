// A lit trig key's colors (KTD5): the ring hues the badge renderer actually draws for
// the credential, resolved the same way `buildBadgeInput` does. Async, because the
// default palette comes from the fingerprint; a key shows plain ink until it first
// resolves. Resolved colors are kept for the session, so a key drawn again (a remount,
// a page flip) lights at once.

import { useEffect, useState } from "react";
import { badgeFingerprints } from "../badge/fingerprint";
import { tokensFor } from "../badge/resolve";
import { resolveBadgeSettings } from "../badge/settings";
import type { Collection, Slug } from "../domain/types";

export interface KeyColors {
  /** The outer ring hue: the key's face. */
  prim: string;
  /** The inner ring hue: the key's light. */
  sec: string;
}

export async function keyColors(collection: Collection, credentialSlug: Slug): Promise<KeyColors> {
  const { outerHex } = await badgeFingerprints(collection.slug, credentialSlug);
  const tokens = tokensFor(resolveBadgeSettings(collection, credentialSlug), outerHex);
  return { prim: tokens.prim, sec: tokens.sec };
}

/** Resolved colors, keyed by every input that changes them (`colorsKey`). */
const resolved = new Map<string, KeyColors>();

/** The collection slug, the credential slug and the badge settings that apply to it. */
function colorsKey(collection: Collection, credentialSlug: Slug): string {
  return JSON.stringify([collection.slug, credentialSlug, collection.badge ?? null, collection.badgeOverrides?.[credentialSlug] ?? null]);
}

/** The key's colors, or null until they resolve (or when there is no collection). */
export function useKeyColors(collection: Collection | null, credentialSlug: Slug): KeyColors | null {
  const [colors, setColors] = useState<KeyColors | null>(null);
  const deps = collection ? colorsKey(collection, credentialSlug) : null;
  const cached = deps === null ? undefined : resolved.get(deps);

  useEffect(() => {
    if (!collection || deps === null) return setColors(null);
    const hit = resolved.get(deps);
    if (hit) return setColors(hit);
    let live = true;
    keyColors(collection, credentialSlug)
      .then((c) => {
        resolved.set(deps, c);
        if (live) setColors(c);
      })
      .catch(() => {
        // A key that cannot resolve its colors stays ink.
      });
    return () => {
      live = false;
    };
    // `deps` captures every input that changes the colors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);

  if (!collection) return null;
  return cached ?? colors;
}
