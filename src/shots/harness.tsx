// The screenshot harness (U3, KTD6, KTD7, R19, R20): renders one manifest shot as the real
// app over the sample folder, runs its steps, and reports when the page has settled.
// src/shots/main.tsx calls `startShot` on shots.html; the tests call it in jsdom.
//
// The providers mount in src/App.tsx's order around AppShell, with two swaps (KTD6): the
// window frame is a fixed `maximized` context instead of WindowFrameProvider, whose mount
// would write data-window="normal" with no Tauri bridge; and storage and Jev Mode are the
// sample's MemoryStorage and FakeJev, answering as the shot scripts it. No
// `window.__TAURI_INTERNALS__` is defined, so the window-frame and window-key code makes
// no plugin calls.
//
// The page signals on <html>: data-shot="ready" once its steps have run, no badge
// placeholder is still loading (aria-busy), fonts are loaded, every image has decoded, every
// video shows a frame and the DOM has gone 300 ms without a change (KTD7). Anything else (an id missing from the
// manifest, a step that finds nothing, a page that never settles) sets data-shot-error to
// a message naming the shot, and the ready flag is never set.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Jev } from "../jev/jev";
import type { Storage } from "../storage/storage";
import { AppShell } from "../ui/AppShell";
import { FolderGate, type DataFolderStatus } from "../ui/FolderGate";
import { JevProvider } from "../ui/jevContext";
import { pendingStorageKey } from "../ui/pendingTests";
import { FolderProvider } from "../ui/useFolderState";
import { WindowFrameContext } from "../ui/windowFrame";
import { SAMPLE_FOLDER, sampleFolder, sampleJev, sampleStorage } from "./seed";
import { SHOTS, type SampleImage, type Shot, type Step, type Target } from "./shots";
import pastedSample from "./pasted-sample.png";
import sampleClip from "./sample-clip.webm";
import sampleReport from "./sample-report.pdf";

/** Each sample picture's address, served by Vite. */
const SAMPLE_IMAGE_URLS: Record<SampleImage, string> = { "pasted-sample": pastedSample };

export interface ShotOptions {
  /** How long a step waits for its target, in ms. */
  stepTimeout?: number;
  /** How long the page may take to mount and then to settle, in ms. */
  settleTimeout?: number;
  /** How long the DOM must go without a change to count as settled, in ms (KTD7). */
  quietMs?: number;
}

const DEFAULTS: Required<ShotOptions> = { stepTimeout: 5000, settleTimeout: 10000, quietMs: 300 };

/**
 * Renders the shot named by `?shot=` in `search` into `root`. Resolves once the page has
 * reported ready or an error, to a function that unmounts it.
 */
export async function startShot(root: HTMLElement, search: string, shots: readonly Shot[] = SHOTS, options: ShotOptions = {}): Promise<() => void> {
  const opts = { ...DEFAULTS, ...options };
  const html = document.documentElement;
  html.removeAttribute("data-shot");
  html.removeAttribute("data-shot-error");
  // Square corners, as a maximized window draws them (KTD6).
  html.setAttribute("data-window", "maximized");

  const id = new URLSearchParams(search).get("shot");
  const shot = id ? shots.find((s) => s.id === id) : undefined;
  if (!shot) {
    return fail(root, id ? `No shot named "${id}" in src/shots/shots.ts.` : "Open this page with ?shot=<id>, an id from src/shots/shots.ts.");
  }

  const sample = await sampleFolder(shot.seed);
  // Every load starts clean: a browser context keeps local storage from one shot to the next.
  try {
    localStorage.clear();
    if (sample.pending.length > 0) localStorage.setItem(pendingStorageKey(SAMPLE_FOLDER), JSON.stringify(sample.pending));
  } catch {
    // Blocked storage shows no waiting tests, as in the app.
  }

  const storage = sampleStorage(sample);
  // The Video key's picker adds the sample clip, served by Vite (the video plan's KTD12).
  storage.useSampleClip(sampleClip);
  // The File key's picker adds the sample PDF and a Markdown file, and every PDF item reads from it.
  storage.useSamplePdf(sampleReport);
  const reactRoot = createRoot(root);
  reactRoot.render(
    <StrictMode>
      <ShotApp shot={shot} storage={storage} jev={sampleJev(shot.jev, shot.jevAnswers, shot.jevLevels)} />
    </StrictMode>,
  );
  const stop = () => reactRoot.unmount();

  try {
    await waitFor(() => document.querySelector(".shell, .gate"), "the app never mounted", opts.settleTimeout);
    for (const [i, step] of (shot.steps ?? []).entries()) await runStep(step, i + 1, opts.stepTimeout);
    await settle(opts.quietMs, opts.settleTimeout);
    html.setAttribute("data-shot", "ready");
  } catch (e) {
    const message = `Shot "${shot.id}": ${e instanceof Error ? e.message : String(e)}`;
    html.setAttribute("data-shot-error", message);
    console.error(message);
  }
  return stop;
}

/** The app as src/App.tsx mounts it, over the shot's sample folder and Jev Mode. */
function ShotApp({ shot, storage, jev }: { shot: Shot; storage: Storage; jev: Jev }) {
  const route = shot.route;
  // "intro" is a first run (no folder ever remembered); "gate" is a remembered folder gone
  // missing, which shows the gate with its error and no intro.
  const status: DataFolderStatus =
    route === "intro" ? { status: "none" } : route === "gate" ? { status: "missing", remembered: SAMPLE_FOLDER } : { status: "ready", folder: SAMPLE_FOLDER };
  return (
    <WindowFrameContext.Provider value="maximized">
      <JevProvider jev={jev}>
        <FolderGate getFolder={() => Promise.resolve(status)} pickFolder={() => Promise.resolve(SAMPLE_FOLDER)}>
          {(folder, changeFolder) => (
            <FolderProvider key={folder} storage={storage} folder={folder}>
              <AppShell onChangeFolder={() => void changeFolder()} initialRoute={typeof route === "string" ? undefined : route} />
            </FolderProvider>
          )}
        </FolderGate>
      </JevProvider>
    </WindowFrameContext.Provider>
  );
}

/** Shows `message` in place of the app and flags it on <html>. Never sets the ready flag. */
function fail(root: HTMLElement, message: string): () => void {
  const line = document.createElement("p");
  line.setAttribute("role", "alert");
  line.textContent = message;
  root.replaceChildren(line);
  document.documentElement.setAttribute("data-shot-error", message);
  console.error(message);
  return () => root.replaceChildren();
}

// ---------------------------------------------------------------------------
// Steps

const norm = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** A button's accessible name, as far as the app's buttons need: its aria-label, else its text. */
const nameOf = (el: Element) => norm(el.getAttribute("aria-label")) || norm(el.textContent);

function firstMatch(selector: string, keep: (el: HTMLElement) => boolean): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(keep) ?? null;
}

function find(target: Target): HTMLElement | null {
  if ("selector" in target) return document.querySelector<HTMLElement>(target.selector);
  if ("button" in target) return firstMatch('button, [role="button"]', (el) => nameOf(el) === target.button);
  if ("label" in target) {
    const labelled = firstMatch("[aria-label]", (el) => norm(el.getAttribute("aria-label")) === target.label);
    if (labelled) return labelled;
    const label = [...document.querySelectorAll("label")].find((l) => norm(l.textContent) === target.label);
    return (label?.control as HTMLElement | null | undefined) ?? null;
  }
  // The innermost element whose whole text is the target's.
  const matches = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) => norm(el.textContent) === target.text);
  return matches.find((el) => ![...el.children].some((child) => norm(child.textContent) === target.text)) ?? null;
}

const describeTarget = (target: Target) => {
  const [[kind, value]] = Object.entries(target);
  return `${kind} "${value}"`;
};

const isEnabled = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";

/** Sets a React-controlled field's value the way typing would. */
function setValue(el: HTMLElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function runStep(step: Step, n: number, timeout: number): Promise<void> {
  const label = `step ${n}`;
  if ("click" in step) {
    const el = await waitFor(() => {
      const found = find(step.click);
      return found && isEnabled(found) ? found : null;
    }, `${label} found no enabled ${describeTarget(step.click)} to click`, timeout);
    el.click();
  } else if ("fill" in step) {
    const el = await waitFor(() => find(step.fill), `${label} found no ${describeTarget(step.fill)} to fill`, timeout);
    el.focus();
    setValue(el, step.value);
  } else if ("paste" in step) {
    const into = step.into ?? { selector: ".rich-input" };
    const el = await waitFor(() => find(into), `${label} found no ${describeTarget(into)} to paste into`, timeout);
    el.focus();
    const data = new DataTransfer();
    data.setData("text/plain", step.paste);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  } else if ("pasteImage" in step) {
    const into = step.into ?? { selector: ".rich-input" };
    const el = await waitFor(() => find(into), `${label} found no ${describeTarget(into)} to paste into`, timeout);
    // At the end of the box, where a person would add a picture to what is written.
    (el as HTMLElement & { editor?: { commands: { focus(at: string): void } } }).editor?.commands.focus("end");
    el.focus();
    const blob = await (await fetch(SAMPLE_IMAGE_URLS[step.pasteImage])).blob();
    const data = new DataTransfer();
    data.items.add(new File([blob], "Screenshot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  } else if ("focusEnd" in step) {
    const el = await waitFor(() => find(step.focusEnd), `${label} found no ${describeTarget(step.focusEnd)} to focus`, timeout);
    (el as HTMLElement & { editor?: { commands: { focus(at: string): void } } }).editor?.commands.focus("end");
  } else if ("scroll" in step) {
    const el = await waitFor(() => find(step.scroll), `${label} found no ${describeTarget(step.scroll)} to scroll to`, timeout);
    // To the middle of the window, as far as the page scrolls: a target scrolled to an
    // edge would sit under home's pinned doors. jsdom has no scrolling, so no method.
    el.scrollIntoView?.({ block: "center", inline: "nearest" });
  } else {
    await waitFor(() => find(step.waitFor), `${label}: ${describeTarget(step.waitFor)} never appeared`, timeout);
  }
  // Let React commit before the next step looks.
  await sleep(0);
}

// ---------------------------------------------------------------------------
// Settling (KTD7). Timers only: Date is fixed in the screenshot run, timers are not.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until `get` returns something, or rejects with `message` after `timeout` ms. */
async function waitFor<T>(get: () => T | null | undefined, message: string, timeout: number): Promise<T> {
  let timedOut = false;
  const timer = setTimeout(() => (timedOut = true), timeout);
  try {
    for (;;) {
      const value = get();
      if (value) return value;
      if (timedOut) throw new Error(message);
      await sleep(25);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves once the DOM has gone `ms` without a change. */
function quiet(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      observer.disconnect();
      resolve();
    };
    let timer = setTimeout(done, ms);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, ms);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}

const busy = () => document.querySelector('[aria-busy="true"]') !== null;

/** An image the browser has decoded. jsdom decodes nothing, so there every image counts. */
const decoded = (img: HTMLImageElement) => typeof img.decode !== "function" || img.complete;

/**
 * A video with enough data to play, or one that failed. With less, Chromium draws its
 * loading spinner over the frame. jsdom plays nothing, so there every video counts.
 */
const showsFrame = (video: HTMLVideoElement) => !("requestVideoFrameCallback" in video) || video.readyState >= 4 || video.error !== null;

/** How long a player's loading spinner may take to leave after the video is ready, in ms. */
const VIDEO_SPINNER_MS = 2000;

/**
 * Asks each video still without a frame to load one. A player with preload "metadata" may
 * stop before its first frame, which would leave a blank box in the picture.
 */
function loadFirstFrames() {
  for (const video of document.querySelectorAll("video")) {
    if (!showsFrame(video) && video.preload !== "auto") video.preload = "auto";
  }
}

async function settle(quietMs: number, timeout: number): Promise<void> {
  let timedOut = false;
  const timer = setTimeout(() => (timedOut = true), timeout);
  try {
    for (;;) {
      if (timedOut) {
        const why = busy() ? "a badge placeholder is still loading" : "the page kept changing";
        throw new Error(`the page never settled: ${why}`);
      }
      if (busy()) {
        await sleep(25);
        continue;
      }
      await document.fonts?.ready;
      await Promise.all([...document.images].map((img) => (typeof img.decode === "function" ? img.decode().catch(() => undefined) : undefined)));
      loadFirstFrames();
      await quiet(quietMs);
      const videos = [...document.querySelectorAll("video")];
      if (!busy() && [...document.images].every(decoded) && videos.every(showsFrame)) {
        // Chromium's loading spinner leaves only at the end of its animation cycle.
        if (videos.length > 0 && "requestVideoFrameCallback" in videos[0]) await sleep(VIDEO_SPINNER_MS);
        return;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
