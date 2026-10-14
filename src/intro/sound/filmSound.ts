// The film's sound in the app (KTD8): the timeline's SOUND_PLAYS through Web Audio. The files
// load and decode while the title card shows. `start` must run inside the Begin key's own
// handler: a webview lets an audio context out of its suspended state only from a user
// gesture, and once out, everything scheduled on it plays. A sound that has not loaded when
// the film starts joins late, at the point the film has reached, and one that fails to load
// stays silent; the film never waits for sound.

import { FPS, SOUND_PLAYS } from "../timeline";
import { BED_SRC, BED_VOLUME, CUE_SRC, CUE_VOLUME } from "./index";

export interface FilmSound {
  /** Starts every sound from the film's first frame. Call from the gesture that starts the film. */
  start(): void;
  setMuted(muted: boolean): void;
  /** Stops everything and lets the context go. */
  close(): void;
}

const srcOf = (kind: (typeof SOUND_PLAYS)[number]["kind"]) => (kind === "bed" ? BED_SRC : CUE_SRC[kind]);

type AudioContextClass = typeof AudioContext;

/** The film's sound, or null where the webview has no Web Audio (the film then plays silent). */
export function createFilmSound(muted: boolean): FilmSound | null {
  const Ctx: AudioContextClass | undefined = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  if (!Ctx) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }

  const master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);

  const buffers = new Map<string, AudioBuffer>();
  const loading = Promise.all(
    [...new Set(SOUND_PLAYS.map((p) => srcOf(p.kind)))].map(async (src) => {
      try {
        const data = await (await fetch(src)).arrayBuffer();
        buffers.set(src, await ctx.decodeAudioData(data));
      } catch {
        // This sound stays silent.
      }
    }),
  );

  let closed = false;
  let started = false;

  /** Schedules every sound not yet over, with the film's first frame at `zero` on the context's clock. */
  const schedule = (zero: number) => {
    const now = ctx.currentTime;
    for (const play of SOUND_PLAYS) {
      const buffer = buffers.get(srcOf(play.kind));
      if (!buffer) continue;
      const at = zero + play.frame / FPS;
      const end = at + play.frames / FPS;
      if (end <= now) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = play.kind === "bed" ? BED_VOLUME : CUE_VOLUME;
      source.connect(gain).connect(master);
      source.start(Math.max(at, now), Math.max(0, now - at));
      source.stop(end);
    }
  };

  return {
    start() {
      if (started || closed) return;
      started = true;
      const begun = performance.now();
      // Synchronous, so it runs inside the gesture.
      const resumed = ctx.resume().catch(() => undefined);
      void Promise.all([resumed, loading]).then(() => {
        if (closed) return;
        // The film's clock started at `begun`; line the sound up with where it is now.
        schedule(ctx.currentTime - (performance.now() - begun) / 1000);
      });
    },
    setMuted(m) {
      master.gain.value = m ? 0 : 1;
    },
    close() {
      if (closed) return;
      closed = true;
      void ctx.close().catch(() => undefined);
    },
  };
}
