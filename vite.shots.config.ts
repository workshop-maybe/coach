// The screenshot harness's own Vite config (U3, U4, KTD6, R19). It serves shots.html, never
// builds anything, and stays out of the app's way: its own dependency cache, and a port
// other than the app's 1420 (`npm run tauri dev` can hold that one while shots render).
// scripts/shots.mjs starts it through Vite's API on a free port it picks; run by hand
// (`npx vite --config vite.shots.config.ts`) it takes 1430 or the next free port.
//
// The Tauri clipboard and opener plugins resolve to harmless stubs (src/shots/plugins.ts),
// so a Copy in a shot's steps succeeds without a Tauri bridge. Standalone on purpose: it
// does not extend vite.config.ts, whose server is pinned to 1420 with a strict port.

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const stubs = fileURLToPath(new URL("./src/shots/plugins.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  cacheDir: "node_modules/.vite-shots",
  clearScreen: false,
  resolve: {
    alias: [
      { find: /^@tauri-apps\/plugin-clipboard-manager$/, replacement: stubs },
      { find: /^@tauri-apps\/plugin-opener$/, replacement: stubs },
    ],
  },
  // Crawl the harness, not index.html, so the first shot doesn't trigger a dependency re-optimize and a reload.
  optimizeDeps: { entries: ["shots.html"] },
  server: {
    host: "127.0.0.1",
    port: 1430,
    strictPort: false,
    watch: { ignored: ["**/src-tauri/**", "**/site/**", "**/dist/**", "**/docs/**"] },
  },
});
