// The trailer render (KTD15): `npm run intro:render` writes the first-run intro, picture and
// sound, to out/intro/intro.mp4 (gitignored). It is the same film the app plays: the picture
// is `Intro` from src/intro/Intro.tsx, captured frame by frame, and the sound is the
// timeline's SOUND_PLAYS, mixed at the volumes the app uses.
//
// It serves src/intro/render/index.html through Vite on a free port, opens it in headless
// Chromium at INTRO_WIDTH × INTRO_HEIGHT, and for every frame draws it with
// window.__introFrame and pipes a screenshot to ffmpeg. ffmpeg trims, delays and mixes each
// sound file onto the picture and encodes H.264 video with 48 kHz stereo AAC audio.
//
// Needs ffmpeg on the PATH (`brew install ffmpeg` on a Mac). Plain Node ESM, like shots.mjs.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "out", "intro", "intro.mp4");
const PAGE = "/src/intro/render/index.html";

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

/** A Vite asset URL for a file in the repo ("/src/intro/sound/bed.mp3") as a path on disk. */
const onDisk = (url) => join(ROOT, decodeURIComponent(url.replace(/^\//, "").replace(/\?.*$/, "")));

/** ffmpeg's arguments: the frames on stdin, then each sound, mixed onto them. */
function ffmpegArgs({ fps, totalFrames, plays, srcOf, volumeOf }) {
  const seconds = totalFrames / fps;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-"];
  const filters = [];
  plays.forEach((play, i) => {
    args.push("-i", onDisk(srcOf(play.kind)));
    const delay = Math.round((play.frame / fps) * 1000);
    filters.push(
      `[${i + 1}:a]atrim=0:${(play.frames / fps).toFixed(4)},asetpts=PTS-STARTPTS,volume=${volumeOf(play.kind)},adelay=${delay}:all=1[s${i}]`,
    );
  });
  const inputs = plays.map((_, i) => `[s${i}]`).join("");
  filters.push(`${inputs}amix=inputs=${plays.length}:normalize=0:duration=longest,apad,atrim=0:${seconds},aresample=48000,aformat=channel_layouts=stereo[audio]`);
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v",
    "-map",
    "[audio]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    String(seconds),
    "-movflags",
    "+faststart",
    OUT,
  );
  return args;
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: false,
    root: ROOT,
    plugins: [react()],
    cacheDir: "node_modules/.vite-intro",
    logLevel: "warn",
    clearScreen: false,
    optimizeDeps: { entries: [PAGE.slice(1)] },
    server: { host: "127.0.0.1", port, strictPort: true, watch: null },
  });
  let browser;
  try {
    await server.listen();
    const { FPS, TOTAL_FRAMES, SOUND_PLAYS } = await server.ssrLoadModule("/src/intro/timeline.ts");
    const { INTRO_WIDTH, INTRO_HEIGHT } = await server.ssrLoadModule("/src/intro/scenes/stage.ts");
    const { BED_SRC, CUE_SRC, BED_VOLUME, CUE_VOLUME } = await server.ssrLoadModule("/src/intro/sound/index.ts");

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: INTRO_WIDTH, height: INTRO_HEIGHT }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}${PAGE}`);
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-ready") && typeof window.__introFrame === "function", null, {
      timeout: 30_000,
    });

    await mkdir(join(ROOT, "out", "intro"), { recursive: true });
    const ffmpeg = spawn(
      "ffmpeg",
      ffmpegArgs({
        fps: FPS,
        totalFrames: TOTAL_FRAMES,
        plays: SOUND_PLAYS,
        srcOf: (kind) => (kind === "bed" ? BED_SRC : CUE_SRC[kind]),
        volumeOf: (kind) => (kind === "bed" ? BED_VOLUME : CUE_VOLUME),
      }),
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    const done = new Promise((resolve, reject) => {
      ffmpeg.on("error", (e) => reject(e.code === "ENOENT" ? new Error("ffmpeg is not on the PATH. Install it (brew install ffmpeg) and run again.") : e));
      ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
    });

    console.log(`Rendering ${TOTAL_FRAMES} frames at ${INTRO_WIDTH}×${INTRO_HEIGHT}, ${FPS} fps`);
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      await page.evaluate((n) => window.__introFrame(n), frame);
      if (errors.length > 0) throw new Error(`The intro page threw at frame ${frame}: ${errors[0]}`);
      const png = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
      if (!ffmpeg.stdin.write(png)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
      if ((frame + 1) % 150 === 0) console.log(`  ${frame + 1} / ${TOTAL_FRAMES}`);
    }
    ffmpeg.stdin.end();
    await done;
    console.log(`Wrote ${relative(ROOT, OUT)}`);
  } finally {
    await browser?.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
