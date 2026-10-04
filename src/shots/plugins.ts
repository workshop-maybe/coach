// Harmless stand-ins for the Tauri clipboard and opener plugins (U3, KTD6). The shots-only
// Vite config (vite.shots.config.ts) aliases @tauri-apps/plugin-clipboard-manager and
// @tauri-apps/plugin-opener to this file, so a Copy in a shot's steps succeeds without a
// Tauri bridge and a link never opens anything.

/** Stands in for the clipboard plugin's writeText: the copy succeeds and goes nowhere. */
export async function writeText(_text: string): Promise<void> {}

/** Stands in for the opener plugin's openUrl: nothing opens. */
export async function openUrl(_url: string | URL): Promise<void> {}
