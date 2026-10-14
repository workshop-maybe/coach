// The webview's local storage, guarded like `src/ui/pendingTests.ts`: null when it is
// missing or throws on access, so callers can read and write through it without crashing.

export function defaultStore(): globalThis.Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
