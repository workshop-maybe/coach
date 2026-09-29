// Export a collection as the andamio-cli import layout and as JSON (KTD7, R24).
// Module codes come from `collection.codes`, never from position, so a reorder
// never changes which Andamio module a credential re-imports into.

import type { Storage } from "../storage/storage";
import type { Collection, Credential } from "./types";

export interface ExportOptions {
  /** The rubric stays out of every export unless the user opts in (R24). */
  includeRubric: boolean;
  /** Rendered badge SVG by credential slug. Each one is written as `<code>/badge.svg`. */
  badges?: Map<string, string>;
}

interface ModuleJson {
  code: string;
  title: string;
  slts: string[];
  assignment: { title: string; content: string; rubric?: string };
}

/** A YAML double-quoted scalar. JSON string syntax is a valid subset of it. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function outlineMd(credential: Credential, code: string): string {
  const slts = credential.learningTargets.map((t, i) => `${i + 1}. ${t}`);
  return [
    "---",
    `title: ${yamlString(credential.name)}`,
    `code: ${yamlString(code)}`,
    "---",
    "",
    `# ${credential.name}`,
    "",
    "## SLTs",
    "",
    ...slts,
    "",
  ].join("\n");
}

function assignmentMd(credential: Credential, options: ExportOptions): string {
  const parts = [`# ${credential.name}`];
  const task = credential.task.trim();
  if (task) parts.push(task);
  const rubric = credential.rubric.trim();
  if (options.includeRubric && rubric) parts.push(`## Rubric\n\n${rubric}`);
  return `${parts.join("\n\n")}\n`;
}

/**
 * Builds every export file in memory, keyed by export-root-relative path:
 * `<collection-slug>/<code>/outline.md`, `<collection-slug>/<code>/assignment.md`,
 * `<collection-slug>/<code>/badge.svg` (when badges are passed)
 * and `<collection-slug>.json`. Pure.
 */
export function buildExport(
  collection: Collection,
  credentials: Credential[],
  options: ExportOptions,
): Map<string, string> {
  const bySlug = new Map(
    credentials.filter((c) => c.collectionSlug === collection.slug).map((c) => [c.slug, c]),
  );
  const files = new Map<string, string>();
  const modules: ModuleJson[] = [];

  for (const slug of collection.order) {
    const credential = bySlug.get(slug);
    if (!credential) continue;
    const number = collection.codes[slug];
    if (number === undefined) {
      throw new Error(`Credential "${slug}" has no module code in collection "${collection.slug}"`);
    }
    const code = String(number);
    const dir = `${collection.slug}/${code}`;
    files.set(`${dir}/outline.md`, outlineMd(credential, code));
    files.set(`${dir}/assignment.md`, assignmentMd(credential, options));

    const badge = options.badges?.get(slug);
    if (badge !== undefined) files.set(`${dir}/badge.svg`, badge);

    const assignment: ModuleJson["assignment"] = {
      title: credential.name,
      content: credential.task.trim(),
    };
    if (options.includeRubric) assignment.rubric = credential.rubric.trim();
    modules.push({ code, title: credential.name, slts: [...credential.learningTargets], assignment });
  }

  const course = {
    title: collection.name,
    slug: collection.slug,
    description: collection.description,
    modules,
  };
  files.set(`${collection.slug}.json`, `${JSON.stringify({ course }, null, 2)}\n`);
  return files;
}

/** Writes every built file under the export root the user picked. */
export async function writeExport(storage: Storage, files: Map<string, string>): Promise<void> {
  for (const [path, contents] of files) {
    await storage.writeText("export", path, contents);
  }
}
