// Slugs are entity ids and filenames (KTD3). Set once at creation, never changed.

import type { Slug } from "./types";

/** Used when a name has no ASCII letters or digits. */
const FALLBACK = "untitled";

/** Lowercase ASCII, single hyphens between words, never empty. */
export function slugify(name: string): Slug {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || FALLBACK;
}

/** The slug for a name, with -2, -3, ... appended until it is not taken. */
export function uniqueSlug(name: string, taken: Iterable<Slug>): Slug {
  const used = new Set(taken);
  const base = slugify(name);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
