// The user guide site (U2, KTD1, KTD2): plain Astro with React, so cast pieces from
// src/cast render to static HTML, and MDX for the pages. The npm scripts run Astro from
// inside site/, which makes it the root, so the site builds into site/dist and never into
// the app's dist/ that Tauri ships. They `cd site` rather than pass `--root site`: when
// Astro 7 detects a coding agent it moves dev and preview into a background process
// started inside the root, and passes the relative --root again, which then reads
// site/site. Nothing here hydrates: the site ships no React to the browser.

import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";

export default defineConfig({
  integrations: [react(), mdx()],
  // Caches go in the repo's one node_modules, so site/ never grows a second one (KTD2).
  cacheDir: "../node_modules/.astro-site",
  vite: { cacheDir: "../node_modules/.vite-site" },
  // Off the app's 1420 and 1421, so the guide runs beside `npm run tauri dev`.
  server: { port: 4321 },
  // The toolbar is a dev-only overlay that reaches for astro.build; the guide fetches nothing (R17).
  devToolbar: { enabled: false },
});
