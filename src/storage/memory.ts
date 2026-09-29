// In-memory Storage for tests. One Map of path -> text per root.

import type { RootKind, Storage } from "./storage";

export class MemoryStorage implements Storage {
  private readonly roots: Record<RootKind, Map<string, string>> = {
    data: new Map(),
    export: new Map(),
  };

  /** Every write, in order, for asserting what the domain layer touched. */
  readonly writes: { root: RootKind; path: string }[] = [];

  constructor(seed: Record<string, string> = {}, root: RootKind = "data") {
    this.seed(seed, root);
  }

  async readText(root: RootKind, path: string): Promise<string | null> {
    return this.roots[root].get(path) ?? null;
  }

  async writeText(root: RootKind, path: string, contents: string): Promise<void> {
    this.roots[root].set(path, contents);
    this.writes.push({ root, path });
  }

  async listFiles(root: RootKind, dir: string): Promise<string[]> {
    const prefix = dir === "" || dir.endsWith("/") ? dir : `${dir}/`;
    return [...this.roots[root].keys()].filter((p) => p.startsWith(prefix)).sort();
  }

  // Test helpers. These bypass `writes` so they model edits made outside the app.

  /** Puts files in place as if they already existed on disk. */
  seed(files: Record<string, string>, root: RootKind = "data"): void {
    for (const [path, text] of Object.entries(files)) this.roots[root].set(path, text);
  }

  /** Current text of a file, or undefined when absent. */
  file(path: string, root: RootKind = "data"): string | undefined {
    return this.roots[root].get(path);
  }

  /** A snapshot of every file in a root. */
  files(root: RootKind = "data"): Record<string, string> {
    return Object.fromEntries(this.roots[root]);
  }

  /** Removes a file, as an outside deletion would. */
  remove(path: string, root: RootKind = "data"): void {
    this.roots[root].delete(path);
  }
}
