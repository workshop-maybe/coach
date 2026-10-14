// The intro's timeline as data (KTD3): five scenes, their text, when each word rises,
// the sound cues, and the frame each scene holds as a still under reduced motion.
// The composition, the stills, the sound and the tests all read this one list.

export const FPS = 30;

export type SceneId = "agents" | "judgment" | "good" | "badges" | "horizon";

export type SoundKind = "line" | "reply" | "pull" | "seat" | "check";

export interface SoundCue {
  frame: number;
  kind: SoundKind;
}

export interface Scene {
  id: SceneId;
  /** First frame of the scene. */
  start: number;
  /** Length in frames. */
  length: number;
  /** The scene's one line of text, set in up to two rows. */
  rows: readonly string[];
  /** Frame, relative to the scene, at which each row starts to rise. */
  rowAt: readonly number[];
  /** The frame, relative to the scene, held as its still. */
  still: number;
}

/** Frames between one word and the next as a row rises. */
export const WORD_STEP = 3;
/** Frames a word takes to rise. */
export const WORD_RISE = 14;

export const SCENES: readonly Scene[] = [
  {
    id: "agents",
    start: 0,
    length: 240,
    rows: ["Your agents answer in seconds.", "You're left guessing which ones got it right."],
    rowAt: [34, 118],
    still: 200,
  },
  {
    id: "judgment",
    start: 240,
    length: 210,
    rows: ["This app has no AI inside.", "It holds your own judgment."],
    rowAt: [30, 100],
    still: 180,
  },
  {
    id: "good",
    start: 450,
    length: 240,
    rows: ["Slow down.", "Say what good looks like."],
    rowAt: [30, 110],
    // Held while the line sits written on the label, before the cartridge leaves for the slot.
    still: 180,
  },
  {
    id: "badges",
    start: 690,
    length: 240,
    rows: ["Your agents earn badges.", "You know which one to reach for."],
    rowAt: [30, 110],
    still: 210,
  },
  {
    id: "horizon",
    start: 930,
    length: 270,
    rows: ["Other people are out there testing too,", "finding the limits together."],
    rowAt: [40, 104],
    still: 269,
  },
];

/** The whole intro's length in frames. */
export const TOTAL_FRAMES = SCENES.reduce((end, s) => Math.max(end, s.start + s.length), 0);

/** The scene playing at an absolute frame. Frames past the end belong to the last scene. */
export function sceneAt(frame: number): Scene {
  return SCENES.find((s) => frame >= s.start && frame < s.start + s.length) ?? SCENES[SCENES.length - 1];
}

/** Absolute frame at which each word of a row starts to rise. */
export function wordFrames(scene: Scene, row: number): number[] {
  const words = scene.rows[row].split(" ");
  return words.map((_, i) => scene.start + scene.rowAt[row] + i * WORD_STEP);
}

/** The absolute frame by which a scene's last word has fully risen. */
export function settledAt(scene: Scene): number {
  const last = scene.rows.length - 1;
  const frames = wordFrames(scene, last);
  return frames[frames.length - 1] + WORD_RISE;
}

/** Absolute still frame for each scene, in order. */
export const STILLS: readonly number[] = SCENES.map((s) => s.start + s.still);

/** The first scene's reply records leave the setup faster and faster. */
export const REPLY_COUNT = 22;
export const REPLY_FRAMES: readonly number[] = Array.from({ length: REPLY_COUNT }, (_, i) =>
  Math.round(52 + 150 * Math.pow(i / REPLY_COUNT, 0.62)),
);

/** Cues beyond each row's line sound and the first scene's replies. */
const EXTRA_CUES: readonly SoundCue[] = [
  { frame: 940, kind: "pull" },
  { frame: 670, kind: "seat" },
  { frame: 800, kind: "check" },
];

/** Every sound cue in the intro, in frame order. */
export const SOUND_CUES: readonly SoundCue[] = [
  ...SCENES.flatMap((s) => s.rowAt.map((at): SoundCue => ({ frame: s.start + at, kind: "line" }))),
  ...REPLY_FRAMES.map((frame): SoundCue => ({ frame, kind: "reply" })),
  ...EXTRA_CUES,
].sort((a, b) => a.frame - b.frame);

/**
 * Frames each kind of cue stays mounted. A sound file longer than its window is cut off
 * when the window ends. Short windows keep few cues mounted at once, inside the Player's
 * shared audio tags.
 */
export const CUE_FRAMES: Readonly<Record<SoundKind, number>> = {
  line: 18,
  reply: 4,
  pull: 15,
  seat: 9,
  check: 18,
};

/**
 * Audio tags the Player shares among the composition's sounds (`numberOfSharedAudioTags`).
 * Mounting more at once than this throws, so it holds headroom over `maxConcurrentAudio()`.
 */
export const SHARED_AUDIO_TAGS = 6;

/**
 * The most audio elements mounted at once: the score bed plus the cues whose windows meet.
 * Windows count as closed, since a cue that starts on the frame another ends can register
 * its tag before the other lets go of its own.
 */
export function maxConcurrentAudio(cues: readonly SoundCue[] = SOUND_CUES): number {
  let most = 0;
  for (let f = 0; f < TOTAL_FRAMES; f++) {
    const mounted = cues.filter((c) => f >= c.frame && f <= c.frame + CUE_FRAMES[c.kind]).length;
    most = Math.max(most, mounted);
  }
  return most + 1;
}
