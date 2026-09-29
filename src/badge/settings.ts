// Badge settings (KTD3): parsed from collection.json's `badge` and
// `badgeOverrides`, then resolved for one credential. Resolution order per field
// is the credential override, then the collection, then the default. Palette and
// colors resolve as a pair from the most specific level that sets either.
// Turning the result into render tokens happens elsewhere.

import type { Collection, Slug } from "../domain/types";

export interface BadgeColors {
  ring: string;
  innerRing: string;
}

export interface BadgeTitle {
  main?: string;
  eyebrow?: string;
}

export interface BadgeSettings {
  /** A palette preset slug. */
  palette?: string;
  /** Custom ring hues (KTD7). */
  colors?: BadgeColors;
  /** Folder-relative art path. `null` means "no art", even if the collection has some. */
  art?: string | null;
  title?: BadgeTitle;
}

/** Effective settings for one credential. `null` means the default. */
export interface ResolvedBadgeSettings {
  palette: string | null;
  colors: BadgeColors | null;
  art: string | null;
  /** Only non-empty titles; a missing field takes its default. */
  title: BadgeTitle;
}

const KNOWN_FIELDS = new Set(["palette", "colors", "art", "title"]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFolderRelative(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path)) return false;
  return !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

function readSettings(raw: unknown): BadgeSettings {
  if (!isPlainObject(raw)) throw new Error("Badge settings must be an object.");
  const unknown = Object.keys(raw).find((k) => !KNOWN_FIELDS.has(k));
  if (unknown !== undefined) throw new Error(`Unknown badge field "${unknown}".`);

  const settings: BadgeSettings = {};
  if (raw.palette !== undefined) {
    if (typeof raw.palette !== "string") throw new Error('"palette" must be a preset name.');
    settings.palette = raw.palette;
  }
  if (raw.colors !== undefined) {
    const c = raw.colors;
    if (!isPlainObject(c) || typeof c.ring !== "string" || typeof c.innerRing !== "string") {
      throw new Error('"colors" must have "ring" and "innerRing" hex colors.');
    }
    if (!HEX_COLOR.test(c.ring) || !HEX_COLOR.test(c.innerRing)) {
      throw new Error('"colors" must be hex colors such as #1A2B3C.');
    }
    settings.colors = { ring: c.ring, innerRing: c.innerRing };
  }
  if (raw.art !== undefined) {
    if (raw.art !== null && (typeof raw.art !== "string" || !isFolderRelative(raw.art))) {
      throw new Error('"art" must be a path inside the data folder, or null for no art.');
    }
    settings.art = raw.art;
  }
  if (raw.title !== undefined) {
    const t = raw.title;
    if (!isPlainObject(t)) throw new Error('"title" must be an object with "main" and "eyebrow".');
    const title: BadgeTitle = {};
    for (const key of ["main", "eyebrow"] as const) {
      if (t[key] === undefined) continue;
      if (typeof t[key] !== "string") throw new Error(`"title.${key}" must be text.`);
      title[key] = t[key];
    }
    settings.title = title;
  }
  return settings;
}

/** Validates one `badge` value or one `badgeOverrides` entry. */
export function parseBadgeSettings(raw: unknown): { settings: BadgeSettings } | { invalid: true; message: string } {
  try {
    return { settings: readSettings(raw) };
  } catch (err) {
    return { invalid: true, message: err instanceof Error ? err.message : String(err) };
  }
}

/** The effective settings for one credential of a collection (KTD3). */
export function resolveBadgeSettings(collection: Collection, credentialSlug: Slug): ResolvedBadgeSettings {
  const base = collection.badge ?? {};
  const over = collection.badgeOverrides?.[credentialSlug] ?? {};

  const colorLevel = over.palette !== undefined || over.colors !== undefined ? over : base;
  const art = "art" in over && over.art !== undefined ? over.art : (base.art ?? null);

  const title: BadgeTitle = {};
  for (const key of ["main", "eyebrow"] as const) {
    const value = over.title?.[key] || base.title?.[key];
    if (value) title[key] = value;
  }

  return {
    palette: colorLevel.palette ?? null,
    colors: colorLevel.colors ? { ...colorLevel.colors } : null,
    art,
    title,
  };
}

/** Plate text: the resolved titles, else the credential name and the collection name. */
export function resolvedTitles(
  credentialName: string,
  collectionName: string,
  resolved: Pick<ResolvedBadgeSettings, "title">,
): { main: string; eyebrow: string } {
  return { main: resolved.title.main || credentialName, eyebrow: resolved.title.eyebrow || collectionName };
}
