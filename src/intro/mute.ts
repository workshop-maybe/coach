// The intro's mute, remembered on this computer (R21). It lives in the webview's local
// storage, guarded like `src/ui/pendingTests.ts`: storage that is missing or throws reads
// as sound on and drops the write, since losing it costs only the choice.

export const MUTE_STORAGE_KEY = "andamio-desktop:intro-muted";

function defaultStore(): globalThis.Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Whether the viewer muted the intro. False when nothing is stored or storage fails. */
export function readMuted(store: globalThis.Storage | null = defaultStore()): boolean {
  try {
    return store?.getItem(MUTE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Remember the viewer's mute for every later replay. */
export function writeMuted(muted: boolean, store: globalThis.Storage | null = defaultStore()): void {
  try {
    store?.setItem(MUTE_STORAGE_KEY, String(muted));
  } catch {
    // Storage full or blocked: the choice lasts only this run.
  }
}
