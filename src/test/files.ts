// A recursive file listing for the tests that read the repo's own files: the brand check
// (src/theme/brand.test.ts) and the user guide's content and privacy checks (site/tests).

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every file under `root` whose name passes `keep`, skipping `exempt` folders (paths
 * relative to `root`). A missing root lists nothing.
 */
export function filesUnder(root: string, keep: (name: string) => boolean = () => true, exempt: readonly string[] = []): string[] {
  if (!existsSync(root)) return [];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return exempt.includes(relative(root, path)) ? [] : walk(path);
      return keep(e.name) ? [path] : [];
    });
  return walk(root);
}
