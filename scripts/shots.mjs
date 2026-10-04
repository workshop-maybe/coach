// The screenshot command (U4, KTD6, KTD7, R3, R19, R20): `npm run site:shots` renders every
// shot in src/shots/shots.ts from the real UI to site/public/shots/<id>.png, and
// `npm run site:shots -- --only <id>` reshoots one (repeat --only for more).
//
// It starts the shots-only Vite config on a free port (never 1420, so `npm run tauri dev`
// can keep running), reads the manifest through Vite's SSR loader, and drives shots.html in
// one headless Chromium context with KTD7's settings: a 1100 × 760 window at device scale 2,
// en-US in UTC, a fixed Date (timers keep running), reduced motion, animations stopped and
// the caret hidden, and the pointer parked off-screen before each capture.
//
// For each shot it waits for the harness's ready flag, checks the shot's `expect`, then
// captures the window or the shot's clip. A shot fails when its page throws, reports an
// error, never reports ready, or lacks its `expect`; a failed shot's picture is left as it
// was. The command writes a picture only when its bytes changed, never deletes a file, and
// exits non-zero naming every failed shot.
//
// Plain Node ESM: the repo has no TypeScript loader for scripts, and Vite loads the manifest.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "site", "public", "shots");

// KTD7.
const VIEWPORT = { width: 1100, height: 760 };
const SCALE = 2;
/** After every seeded date, so nothing in the sample reads as in the future. */
const FIXED_NOW = new Date("2026-10-01T09:00:00.000Z");

const READY_TIMEOUT = 20_000;
const EXPECT_TIMEOUT = 3_000;

/** A port nothing is listening on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** A PNG's pixel size, from its header. */
function pngSize(buffer) {
  return `${buffer.readUInt32BE(16)}×${buffer.readUInt32BE(20)}`;
}

/** Waits for the harness to report ready or an error. Resolves to the error, or null when ready. */
async function harnessOutcome(page, timeout) {
  const handle = await page.waitForFunction(
    () => {
      const html = document.documentElement;
      const error = html.getAttribute("data-shot-error");
      if (error !== null) return { error };
      return html.getAttribute("data-shot") === "ready" ? { error: null } : null;
    },
    null,
    { timeout, polling: 50 },
  );
  return (await handle.jsonValue()).error;
}

/** The clip rectangle for a shot, in CSS pixels, grown by its pad and kept inside the window. */
async function clipBox(page, clip) {
  const box = await page.locator(clip.selector).first().boundingBox();
  if (!box) return null;
  const pad = clip.pad ?? 0;
  const left = Math.max(0, Math.floor(box.x - pad));
  const top = Math.max(0, Math.floor(box.y - pad));
  const right = Math.min(VIEWPORT.width, Math.ceil(box.x + box.width + pad));
  const bottom = Math.min(VIEWPORT.height, Math.ceil(box.y + box.height + pad));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Renders one shot. Resolves to { png } or { problems }. */
async function render(context, base, shot) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const problems = [];
  try {
    await page.goto(`${base}?shot=${encodeURIComponent(shot.id)}`);
    let error;
    try {
      error = await harnessOutcome(page, READY_TIMEOUT);
    } catch {
      problems.push(`never reported ready within ${READY_TIMEOUT / 1000} s`);
      return { problems: [...problems, ...errors.map((e) => `page error: ${e}`)] };
    }
    if (error) problems.push(error);

    const want = "text" in shot.expect ? `text "${shot.expect.text}"` : `selector ${shot.expect.selector}`;
    const target = "text" in shot.expect ? page.getByText(shot.expect.text, { exact: true }) : page.locator(shot.expect.selector);
    const found = await target
      .first()
      .waitFor({ state: "visible", timeout: EXPECT_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (!found) problems.push(`expected ${want} on screen, and it is not there`);

    let clip;
    if (shot.clip) {
      clip = await clipBox(page, shot.clip);
      if (!clip) problems.push(`clip selector ${shot.clip.selector} matches nothing on screen`);
    }

    // Park the pointer off-screen so nothing shows a hover state (KTD7).
    await page.mouse.move(-10, -10);
    if (errors.length > 0) problems.push(...errors.map((e) => `page error: ${e}`));
    if (problems.length > 0) return { problems };

    const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide", scale: "device", ...(clip ? { clip } : {}) });
    // An error thrown while capturing still fails the shot.
    if (errors.length > 0) return { problems: errors.map((e) => `page error: ${e}`) };
    return { png };
  } finally {
    await page.close();
  }
}

/** Writes the picture only when its bytes changed. Resolves to what happened. */
async function save(id, png) {
  const path = join(OUT, `${id}.png`);
  const before = await readFile(path).catch(() => null);
  if (before && before.equals(png)) return "unchanged";
  await writeFile(path, png);
  return before ? "updated" : "new";
}

async function main() {
  const { values } = parseArgs({ options: { only: { type: "string", multiple: true } } });
  const only = values.only ?? [];

  const port = await freePort();
  const server = await createServer({
    configFile: join(ROOT, "vite.shots.config.ts"),
    root: ROOT,
    logLevel: "warn",
    // No file watcher: a run renders the code as it was when it started.
    server: { host: "127.0.0.1", port, strictPort: true, watch: null },
  });
  let browser;
  const failed = [];
  try {
    await server.listen();
    const { SHOTS } = await server.ssrLoadModule("/src/shots/shots.ts");
    const unknown = only.filter((id) => !SHOTS.some((s) => s.id === id));
    if (unknown.length > 0) throw new Error(`No shot named ${unknown.map((id) => `"${id}"`).join(", ")} in src/shots/shots.ts.`);
    const shots = only.length > 0 ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    // Date is fixed; timers keep running, so the app's own delays still land (KTD7).
    await context.clock.setFixedTime(FIXED_NOW);
    const base = `http://127.0.0.1:${port}/shots.html`;

    // Warm up: a cold dependency cache can re-optimize and reload the first page Vite serves.
    const warm = await context.newPage();
    await warm.goto(`${base}?shot=${encodeURIComponent(shots[0].id)}`);
    await harnessOutcome(warm, READY_TIMEOUT).catch(() => undefined);
    await warm.close();

    await mkdir(OUT, { recursive: true });
    console.log(`Rendering ${shots.length} shot${shots.length === 1 ? "" : "s"} to ${relative(ROOT, OUT)}/`);
    for (const shot of shots) {
      const result = await render(context, base, shot);
      if (result.problems) {
        failed.push({ id: shot.id, problems: result.problems });
        console.log(`  ✗ ${shot.id}`);
        for (const p of result.problems) console.log(`      ${p}`);
        continue;
      }
      const what = await save(shot.id, result.png);
      console.log(`  ✓ ${shot.id}  ${what}  ${pngSize(result.png)}`);
    }
  } finally {
    await browser?.close();
    await server.close();
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} shot${failed.length === 1 ? "" : "s"} failed: ${failed.map((f) => f.id).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
