// The film's sound: what it schedules on a Web Audio context, and when. A fake context records
// each source's start, offset and stop on its own clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FPS, SOUND_PLAYS } from "../timeline";
import { createFilmSound } from "./filmSound";
import { BED_SRC, BED_VOLUME, CUE_VOLUME } from "./index";

interface Started {
  src: string;
  when: number;
  offset: number;
  stop: number;
  volume: number;
}

/** A Web Audio context whose clock is `clock.now`, decoding each file to a buffer named for it. */
function fakeContext(failing: string[] = []) {
  const started: Started[] = [];
  const clock = { now: 0 };
  const master = { gain: { value: 1 }, connect: vi.fn() };
  const ctx = {
    get currentTime() {
      return clock.now;
    },
    destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    decodeAudioData: vi.fn(async (data: ArrayBuffer) => ({ src: new TextDecoder().decode(data) })),
    createGain: vi.fn(),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null as null | { src: string },
        gain: 0,
        connect: vi.fn((g: { gain: { value: number } }) => {
          source.gain = g.gain.value;
          return { connect: vi.fn() };
        }),
        start: vi.fn((when: number, offset: number) => started.push({ src: source.buffer!.src, when, offset, stop: Infinity, volume: source.gain })),
        stop: vi.fn((at: number) => (started[started.length - 1].stop = at)),
      };
      return source;
    }),
  };
  // The first gain is the master; each source then gets its own.
  let gains = 0;
  ctx.createGain = vi.fn(() => (gains++ === 0 ? master : { gain: { value: 1 }, connect: vi.fn(() => ({ connect: vi.fn() })) }));
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        return ctx;
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (src: string) => {
      if (failing.includes(src)) throw new Error("not found");
      return { arrayBuffer: async () => new TextEncoder().encode(src).buffer };
    }),
  );
  return { ctx, clock, master, started };
}

/** Lets the loads, the resume and the scheduling settle. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  vi.spyOn(performance, "now").mockReturnValue(1000);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the film's sound", () => {
  it("is null where there is no Web Audio, so the film plays silent", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(createFilmSound(false)).toBeNull();
  });

  it("schedules nothing until started", async () => {
    const { started } = fakeContext();
    createFilmSound(false);
    await settle();
    expect(started).toEqual([]);
  });

  it("resumes the context inside start, then plays every sound at its frame for its window", async () => {
    const { ctx, started } = fakeContext();
    const sound = createFilmSound(false)!;
    await settle();
    sound.start();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    await settle();
    expect(started).toHaveLength(SOUND_PLAYS.length);
    const bed = started.find((s) => s.src === BED_SRC)!;
    expect(bed).toMatchObject({ when: 0, offset: 0, stop: SOUND_PLAYS[0].frames / FPS, volume: BED_VOLUME });
    const cue = SOUND_PLAYS[1];
    const first = started.filter((s) => s.src !== BED_SRC).sort((a, b) => a.when - b.when)[0];
    expect(first.when).toBeCloseTo(cue.frame / FPS);
    expect(first.stop).toBeCloseTo((cue.frame + cue.frames) / FPS);
    expect(first.volume).toBe(CUE_VOLUME);
  });

  it("lines sound that loads late up with where the film has got to", async () => {
    const { started, clock } = fakeContext();
    const sound = createFilmSound(false)!;
    sound.start();
    // Two seconds of film pass on both clocks before the files are in.
    clock.now = 2;
    vi.mocked(performance.now).mockReturnValue(3000);
    await settle();
    const bed = started.find((s) => s.src === BED_SRC)!;
    expect(bed.when).toBeCloseTo(2);
    expect(bed.offset).toBeCloseTo(2);
    // Cues already over are dropped.
    const over = SOUND_PLAYS.filter((p) => p.kind !== "bed" && (p.frame + p.frames) / FPS <= 2).length;
    expect(started).toHaveLength(SOUND_PLAYS.length - over);
  });

  it("leaves a sound that fails to load silent and plays the rest", async () => {
    const { started } = fakeContext([BED_SRC]);
    const sound = createFilmSound(false)!;
    sound.start();
    await settle();
    expect(started.some((s) => s.src === BED_SRC)).toBe(false);
    expect(started).toHaveLength(SOUND_PLAYS.length - 1);
  });

  it("mutes and unmutes everything through one gain, starting from the remembered mute", async () => {
    const { master } = fakeContext();
    const sound = createFilmSound(true)!;
    expect(master.gain.value).toBe(0);
    sound.setMuted(false);
    expect(master.gain.value).toBe(1);
    sound.setMuted(true);
    expect(master.gain.value).toBe(0);
  });

  it("closes the context and schedules nothing after close", async () => {
    const { ctx, started } = fakeContext();
    const sound = createFilmSound(false)!;
    sound.start();
    sound.close();
    await settle();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(started).toEqual([]);
  });
});
