# The Coach user guide

A static Astro site in the app's world: warm paper, ink rules, Inter and Fragment Mono, square corners, and the hand-inked cast from `src/cast/`. It reads the app's own tokens and fonts, ships no JavaScript framework to readers, and fetches nothing from another host. Search is Pagefind, built from the site's own files.

The site isn't hosted yet. Its pages describe the app on `main`.

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

Pages are MDX files in `src/content/guide/<part>/`. The five parts are `getting-started`, `ideas`, `how-to`, `help` and `jev`, and `src/parts.ts` names them. A page's address is its path without the extension, such as `/how-to/hand-off-a-test/`.

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
- Pages use four components without importing them:
  - `<UI>Make the agent</UI>` for an exact label in the app. A label with a name in it uses escaped braces: `<UI>Pull \{agent\}'s handoff</UI>`. Badge, preset and agent names go in *italics*; macOS labels go in **bold**.
  - `<Shot id="home" alt="…" />` for a screenshot, placed right after the step it shows. Alt text is required.
  - `<Source file="src/domain/calls.ts" symbol="callOf" />` for an excerpt of the app's code, read from the file when the site builds, so it is always current. `to="…"` shows a run of declarations from `symbol` to it. TypeScript is found by name anywhere in the file; Rust by its item line, above `#[cfg(test)]`.
  - `<Example file="second-opinion/request.json" />` for one of the Jev deep dive's generated examples (see below).
- Link to other pages by their address, such as `[Your data](/help/your-data/)`.
- Write for someone who knows their AI assistant but not this app: second person, short sentences, the app's own words (CONCEPTS.md), no hype, no heading periods, and never the word "machine".

`npm test` and `npm run site:build` run `tests/content.test.ts`, which fails when:
- a `<UI>` label matches no string, template literal or JSX text in `src/ui/`, `src/domain/`, `src/jev/` or `src/intro/`;
- a picture or internal link points at nothing;
- a screenshot in the manifest is used by no page, or a PNG has no manifest entry;
- a heading ends in a period, a page says "machine", or frontmatter is missing.

What the check can't see, so check it by hand when it changes:
- a label renamed in only one of several places in the source;
- text that comes from Rust, such as the "folder no longer exists" notice from `src-tauri/src/files.rs` (When something breaks describes it without quoting it);
- the part of a link after `#`: renaming the headings Jev Mode, Changed on disk or The trash breaks links to them silently.

The "machine" check reads code blocks too, which is why Your data describes a result file's fields in prose rather than quoting its front matter.

## The Jev deep dive

The `jev` part, Jev under the hood, explains how Jev works inside the app. Its code blocks and data come from the app, not from the page:

- `<Source>` excerpts are read from the source at build time. A symbol that no longer resolves fails the build.
- `<Example>` files live in `src/deep-dive/examples/`. `src/deep-dive/examples.ts` builds every one of them with the app's own code, from the sample folder in `src/shots/seed.ts` and the case-study scenarios in `src/shots/shots.ts` (`CASE_REPLY`, `CASE_CALLS`, `TERMINAL_REPLY`). Only Jev's answers there are made up, and the pages say so. After a change to the code they come from, run `npm run site:examples` to rewrite them, and read the diff.
- Numbers a page states in prose are tied to the constant or example they come from by a table in `tests/deepDive.test.ts`. A changed constant fails it, naming the page to update.
- `tests/deepDiveFlow.test.tsx` drives the real judge pane over the same scenario and checks it sends the case study's request and saves its result, and `tests/deepDiveReply.test.tsx` checks the real reply box holds the case studies' texts unchanged, and that a request reads back a paste the box escapes as it was pasted. A request sends a reply without the editor's escapes (`src/domain/readerText.ts`), but a scenario reply still avoids characters the editor escapes, such as square brackets, so the reply a page shows is also the text the box stores.

`tests/deepDive.test.ts` fails when an excerpt doesn't resolve or runs over 60 lines, when an excerpt or example says "machine", names a home folder or holds something key-shaped, when an example drifts from its file, or when a page shows an example the generator doesn't build or the generator builds one no page shows. A new Jev feature gets its own pages in the part, a mechanism page and a case study, and its scenario beside the others.

## Add a screenshot

Screenshots are data in `src/shots/shots.ts`. Each one opens the real app in a dev-only harness page (`shots.html`) over the sample folder in `src/shots/seed.ts`, then the command captures it at 1100×760 and a device scale of 2.

1. Add an entry:
   - `id` names the picture;
   - `page` names the guide page that shows it;
   - `route` says where the app opens: a route, `"intro"` for a first run's title card, or `"gate"` for the folder gate as a missing folder shows it, with no intro. Shots run with reduced motion, so the intro shows its stills and a shot steps through them with `Next`;
   - `seed` picks the folder, `"empty"` or `"full"`;
   - `jev` is `"off"` (How to pages) or `"on"`;
   - `expect` is text or a selector that must be on screen, so a wrong route fails instead of photographing the "Not in the folder" card;
   - optional `steps` (`click`, `fill`, `paste`, `pasteImage`, `focusEnd`, `waitFor`, `scroll`) and an optional `clip`.
2. List the id under its route kind in `COVERAGE`, the screen the shot opens at. A new route kind fails the type check until it has a shot or is marked `NOT_PICTURED`.
3. Run `npm run site:shots -- --only <id>` and look at the picture.
4. Use it on its page with `<Shot id="<id>" alt="…" />`.

Things that make a shot misbehave:
- After a step that waits on a timer, such as the 700 ms the dots run after Copy, end with a `waitFor`.
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
4. Build watch paths: `site/*`, `src/*`, `src-tauri/*`, `package.json` and `package-lock.json`. The site's checks read the app's source, and the Jev deep dive quotes `src-tauri/src/jev.rs` and `src-tauri/src/lib.rs`.
5. Leave preview builds of other branches off. Only `main` deploys.
6. Choose the address before the first tester gets a link.

A failing check fails the build, and the last good site stays live.

## Defaults to revisit

- The layout asks search engines not to index the site (`<meta name="robots" content="noindex">` in `src/layouts/Guide.astro`) until a public download exists. Deleting that line lifts it.
- The npm scripts set `ASTRO_TELEMETRY_DISABLED=1`, so Astro's CLI sends no usage data from developer machines or the builder.
