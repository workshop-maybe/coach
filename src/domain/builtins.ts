// Built-in collections (KTD1): real collection folders under src/collections/, in the data
// folder's own format, read as text at build time. Adding one copies its files as they are.

import { parseCollection } from "./folder";
import type { Collection, Slug } from "./types";

export interface BuiltIn {
  /** The folder's name. */
  slug: Slug;
  collection: Collection;
  /** Each credential file's text, keyed by credential slug, exactly as it is copied. */
  credentials: Record<Slug, string>;
}

const COLLECTIONS = import.meta.glob<string>("../collections/*/collection.json", { query: "?raw", import: "default", eager: true });
const CREDENTIALS = import.meta.glob<string>("../collections/*/credentials/*.md", { query: "?raw", import: "default", eager: true });

/** The order the built-ins are offered in. */
const ORDER: readonly Slug[] = ["cardano-dev-skills", "course-authoring", "nostr-relays", "bounded-programs"];

function load(slug: Slug): BuiltIn {
  const json = COLLECTIONS[`../collections/${slug}/collection.json`];
  if (json === undefined) throw new Error(`Built-in collection "${slug}" has no collection.json.`);
  const prefix = `../collections/${slug}/credentials/`;
  const credentials: Record<Slug, string> = {};
  for (const [path, text] of Object.entries(CREDENTIALS)) {
    if (path.startsWith(prefix)) credentials[path.slice(prefix.length, -".md".length)] = text;
  }
  return { slug, collection: parseCollection(json, slug), credentials };
}

export const BUILT_INS: readonly BuiltIn[] = ORDER.map(load);
