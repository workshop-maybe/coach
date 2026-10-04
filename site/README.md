# The Andamio Desktop user guide

A static Astro site in the app's world: warm paper, ink rules, Inter and Fragment Mono, square corners, and the hand-inked cast from `src/cast/`. It reads the app's own tokens and fonts, ships no JavaScript framework to readers, and fetches nothing from another host. Search is Pagefind, built from the site's own files.

The site redeploys from `main`, so it always describes the latest app. The plan behind it is `docs/plans/2026-10-03-2017-feat-user-guide-site-plan.md`.

## Commands

Run these from the repo root. The site shares the root `node_modules`, so there is nothing to install inside `site/`.

```bash
npm run site:dev      # live preview at localhost:4321 (no search: the index exists only after a build)
npm run site:build    # the guide's checks, then the Astro build, then the Pagefind index, into site/dist
npm run site:preview  # serve site/dist, search included
npm run site:shots    # render every screenshot from the real app
npm run site:shots -- --only home   # reshoot one (repeat --only for more)
```

Under a coding agent, Astro runs dev and preview in the background. Stop them with `cd site && npx astro dev stop` or `npx astro preview stop`.

## Add a page

Pages are MDX files in `src/content/guide/<part>/`. The four parts are `getting-started`, `ideas`, `how-to` and `help`, and `src/parts.ts` names them. A page's address is its path without the extension, such as `/how-to/hand-off-a-test/`.

Frontmatter:

```yaml
---
title: Hand off a test
part: how-to
order: 30
description: Copy a badge's handoff into your assistant and bring back its reply.
---
```

- The layout prints `title` as the heading, so a page writes no `#` heading of its own.
- `order` sorts pages within a part. Quote a `description` that contains a colon.
- Pages use two components without importing them:
  - `<UI>Make the agent</UI>` for an exact label in the app. A label with a name in it uses escaped braces: `<UI>Pull \{agent\}'s handoff</UI>`. Badge, preset and agent names go in *italics*; macOS labels go in **bold**.
  - `<Shot id="home" alt="…" />` for a screenshot, placed right after the step it shows. Alt text is required.
- Link to other pages by their address, such as `[Your data](/help/your-data/)`.
- Write for someone who knows their AI assistant but not this app: second person, short sentences, the app's own words (CONCEPTS.md), no hype, no heading periods, and never the word "machine".

`npm test` and `npm run site:build` run `tests/content.test.ts`, which fails when:
- a `<UI>` label matches no string, template literal or JSX text in `src/ui/`, `src/domain/` or `src/jev/`;
- a picture or internal link points at nothing;
- a screenshot in the manifest is used by no page, or a PNG has no manifest entry;
- a heading ends in a period, a page says "machine", or frontmatter is missing.

What the check can't see, so check it by hand when it changes:
- a label renamed in only one of several places in the source;
- text that comes from Rust, such as the "folder no longer exists" notice from `src-tauri/src/files.rs` (When something breaks describes it without quoting it);
- the part of a link after `#`: renaming the headings Jev Mode, Changed on disk or The trash breaks links to them silently.

The "machine" check reads code blocks too, which is why Your data describes a result file's fields in prose rather than quoting its front matter.

## Add a screenshot

Screenshots are data in `src/shots/shots.ts`. Each one opens the real app in a dev-only harness page (`shots.html`) over the sample folder in `src/shots/seed.ts`, then the command captures it at 1100×760 and a device scale of 2.

1. Add an entry:
   - `id` names the picture;
   - `page` names the guide page that shows it;
   - `route` says where the app opens, or `"gate"` for the first-run screen;
   - `seed` picks the folder, `"empty"` or `"full"`;
   - `jev` is `"off"` (How to pages) or `"on"`;
   - `expect` is text or a selector that must be on screen, so a wrong route fails instead of photographing the "Not in the folder" card;
   - optional `steps` (`click`, `fill`, `paste`, `waitFor`, `scroll`) and an optional `clip`.
2. List the id under its route kind in `COVERAGE`, the screen the shot opens at. A new route kind fails the type check until it has a shot or is marked `NOT_PICTURED`.
3. Run `npm run site:shots -- --only <id>` and look at the picture.
4. Use it on its page with `<Shot id="<id>" alt="…" />`.

Things that make a shot misbehave:
- After a step that waits on a timer, such as the 1400 ms landing after Met, end with a `waitFor`.
- A screen that focuses its heading as it opens undoes a `scroll` step. Wait for something that appears only after the data loads, then scroll.
- Sample text pasted in a step must not look like a path or a key: the seed tests reject `/Users/`, `~/` and runs of 20 or more letters and digits.

A shot comes out byte-identical every time on the same machine and Playwright version. Another OS renders text slightly differently, so a feature PR reshoots only the screens it changed, with `--only`.

## Deploy

The repo carries `wrangler.jsonc` for Cloudflare Workers static assets: it serves `site/dist` with no Worker script, and a missing page gets the guide's own 404 page. Vercel's free Hobby plan is for non-commercial use only and can't deploy a private repo owned by an organization. An Andamio Vercel Pro team serves the same `site/dist` just as well.

To connect Cloudflare:
1. Create a Worker from this GitHub repo, with production branch `main`.
2. Build command: `npm ci && npm run site:build`, run from the repo root. Deploy command: `npx wrangler deploy`.
3. Build variables:
   - `NODE_VERSION`: `22.12` or later (Astro 7 needs it).
   - `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`: `1` (the builder never takes screenshots).
4. Build watch paths: `site/*`, `src/*`, `package.json` and `package-lock.json`. The site's checks read the app's source.
5. Leave preview builds of other branches off. Only `main` deploys.
6. Choose the address before the first tester gets a link.

A failing check fails the build, and the last good site stays live.

## Defaults to revisit

- The layout asks search engines not to index the site (`<meta name="robots" content="noindex">` in `src/layouts/Guide.astro`) until a public download exists. Deleting that line lifts it.
- The npm scripts set `ASTRO_TELEMETRY_DISABLED=1`, so Astro's CLI sends no usage data from developer machines or the builder.
