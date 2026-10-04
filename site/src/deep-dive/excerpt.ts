// The deep dive's code excerpts (KTD1, KTD8 of docs/plans/2026-10-04-1503-docs-jev-deep-dive-plan.md):
// a page names a file and a symbol, and the guide shows that declaration as the source has
// it now, with its doc comment. Pasted excerpts drift; these are read at build time, so
// they are always current. site/tests/deepDive.test.ts checks every one a page cites.
//
// TypeScript is read through the TypeScript parser, so a declaration is found wherever it
// is, a function nested in a component included. Rust is read by rustfmt's layout: the
// item's line, its `///` comments and `#[…]` attributes above it, down to the closing brace
// at its own indent, and never past `#[cfg(test)]`.
//
// Plain TypeScript with no Astro imports, so the component and the test share it.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

/** One excerpt as a page shows it. */
export interface Excerpt {
  /** Repo-relative path, as the caption names it. */
  file: string;
  /** The declaration, dedented, with its doc comment. */
  text: string;
  /** First and last line in the file, counting from 1. */
  start: number;
  end: number;
}

/** The most lines one excerpt may show, doc comment included. A longer one should cite a smaller symbol. */
export const MAX_EXCERPT_LINES = 60;

/**
 * The repo root: the nearest folder at or above `from` holding both `site/` and
 * `src-tauri/`. Astro runs from site/ and vitest from the root, and a bundled component's
 * own URL points at a build chunk, so the working directory is the one reliable start.
 */
export function repoRoot(from: string = process.cwd()): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "site")) && existsSync(join(dir, "src-tauri"))) return dir;
    if (dirname(dir) === dir) throw new Error(`No repo root above ${from}: no folder holds both site/ and src-tauri/.`);
  }
}

/** The excerpt for `symbol` in a file under the repo, through `to` when given (both inclusive). Throws when either is missing or declared more than once. */
export function excerpt(file: string, symbol: string, to?: string, root: string = repoRoot()): Excerpt {
  const path = join(root, file);
  if (!existsSync(path)) throw new Error(`${file} does not exist.`);
  return excerptFromText(file, readFileSync(path, "utf8"), symbol, to);
}

/** As `excerpt`, over text in hand. */
export function excerptFromText(file: string, text: string, symbol: string, to?: string): Excerpt {
  const find = file.endsWith(".rs") ? rustItem : tsDeclaration;
  const first = find(file, text, symbol);
  const last = to ? find(file, text, to) : first;
  if (last.end < first.start) throw new Error(`${file}: ${to} comes before ${symbol}.`);
  const lines = text.split("\n").slice(first.start - 1, last.end);
  return { file, text: dedent(lines).join("\n"), start: first.start, end: last.end };
}

/**
 * What a page must never show (R16): the word the guide doesn't use, a home folder, a
 * TypeSafe key's prefix, or a run of letters and digits shaped like a key. Each problem
 * is one line.
 */
export function forbiddenIn(text: string): string[] {
  const problems: string[] = [];
  for (const m of text.matchAll(/\bmachines?\b/gi)) problems.push(`says "${m[0]}"`);
  if (text.includes("/Users/")) problems.push("names a home folder (/Users/)");
  if (/(^|[\s"'`(])~\//.test(text)) problems.push("names a home folder (~/)");
  if (/\bts-(?:live|test)-/.test(text)) problems.push("holds a TypeSafe key's prefix (ts-live- or ts-test-)");
  for (const [run] of text.matchAll(/[A-Za-z0-9]{20,}/g)) {
    if (/\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run)) problems.push(`holds a key-shaped run (${run.slice(0, 6)}…)`);
  }
  return problems;
}

// ---------------------------------------------------------------------------

interface Span {
  start: number;
  end: number;
}

/** A TypeScript declaration by name: a function, a const or let, a type, an interface, a class or a method. */
function tsDeclaration(file: string, text: string, symbol: string): Span {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: ts.Node[] = [];
  const named = (name: ts.Node | undefined) => !!name && ts.isIdentifier(name) && name.text === symbol;
  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isMethodDeclaration(node)) &&
      named(node.name)
    ) {
      found.push(node);
    } else if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => named(d.name))) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found.length !== 1) throw new Error(`${file}: ${symbol} is declared ${found.length} times; an excerpt needs exactly one.`);
  const node = found[0];
  const line = (pos: number) => source.getLineAndCharacterOfPosition(pos).line + 1;
  return { start: line(node.getStart(source, true)), end: line(node.getEnd()) };
}

/** A Rust item by name, above the file's tests: `fn`, `const`, `static`, `struct`, `enum`, `trait` or `type`. */
function rustItem(file: string, text: string, symbol: string): Span {
  const all = text.split("\n");
  const testsAt = all.findIndex((l) => l.trim() === "#[cfg(test)]");
  const lines = testsAt < 0 ? all : all.slice(0, testsAt);
  const name = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const item = new RegExp(`^(\\s*)(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:fn|const|static|struct|enum|trait|type)\\s+${name}\\b`);
  const hits = lines.flatMap((l, i) => (item.test(l) ? [i] : []));
  if (hits.length !== 1) throw new Error(`${file}: ${symbol} is declared ${hits.length} times above its tests; an excerpt needs exactly one.`);
  const at = hits[0];
  const indent = item.exec(lines[at])![1];

  let start = at;
  while (start > 0 && /^\s*(?:\/\/\/|#\[)/.test(lines[start - 1])) start--;

  let end = at;
  if (!/[;,]\s*$/.test(lines[at])) {
    end = lines.findIndex((l, i) => i > at && l.startsWith(`${indent}}`));
    if (end < 0) throw new Error(`${file}: ${symbol} has no closing brace at its own indent.`);
  }
  return { start: start + 1, end: end + 1 };
}

/** The lines with the indent they all share taken off. */
function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim() !== "").map((l) => l.length - l.trimStart().length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut));
}
