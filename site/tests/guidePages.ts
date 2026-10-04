/// <reference types="node" />
// The guide's pages as the guide's checks read them (content.test.ts and deepDive.test.ts):
// each .md or .mdx file under site/src/content/guide, by its entry id, as source.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { filesUnder } from "../../src/test/files";

const GUIDE = join(__dirname, "..", "src", "content", "guide");

/** The guide's pages as the collection reads them: each .md or .mdx file under content/guide. */
export function guidePages(): { id: string; text: string }[] {
  return filesUnder(GUIDE)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => ({ id: relative(GUIDE, f).replace(/\.mdx?$/, "").split("\\").join("/"), text: readFileSync(f, "utf8") }));
}
