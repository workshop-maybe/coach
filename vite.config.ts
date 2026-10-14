/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  // The intro's sounds stay files, never inlined as data URLs, so the Player streams
  // them and the trailer render finds them (KTD8).
  build: {
    assetsInlineLimit: (file: string) => (/\.(m4a|mp3|ogg|wav|webm)$/.test(file) ? false : undefined),
  },

  // Domain tests run in Node. UI tests opt into jsdom with a `// @vitest-environment jsdom` header,
  // which keeps Web Crypto and TextEncoder in the same realm for the version hash.
  // The user guide site's checks run here too (U2, KTD11).
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "site/**/*.test.{ts,tsx}"],
    // ProseMirror's jsdom stand-ins, a no-op in the node environment (KTD11).
    setupFiles: ["src/test/setup.ts"],
    // Vitest stubs CSS imports as empty strings, even with `?raw`. The badge renderer
    // embeds its font CSS as a raw string, so let that one file through.
    css: { include: [/src\/badge\/fonts\.css/] },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
