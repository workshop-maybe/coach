// The guide's pages as the layout and the front page read them (U2): each entry's id with
// its frontmatter. Kept apart from parts.ts, which stays free of Astro imports.

import { getCollection } from "astro:content";

export async function guidePages() {
  return (await getCollection("guide")).map((entry) => ({ id: entry.id, ...entry.data }));
}
