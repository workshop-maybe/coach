// The intro's sound files (KTD8), imported through Vite so each ships as its own file in
// the app bundle and the trailer render finds it. Placeholders until James's soundscape
// replaces them under the same names: see README.md in this folder.

import type { SoundKind } from "../timeline";
import bed from "./bed.mp3";
import check from "./check.wav";
import line from "./line.wav";
import pull from "./pull.wav";
import reply from "./reply.wav";
import seat from "./seat.wav";

/** The score under the whole film. */
export const BED_SRC: string = bed;

/** One file per kind of cue in the timeline. */
export const CUE_SRC: Readonly<Record<SoundKind, string>> = { line, reply, pull, seat, check };

/** The bed's volume, 0 to 1. The files are already mixed soft; this sets the default level. */
export const BED_VOLUME = 0.5;
/** Each cue's volume, 0 to 1. */
export const CUE_VOLUME = 0.6;
