// The stage the five scenes share: the composition's size, where the text sits, where
// your setup stands in each scene, and the line written on the first badge. Each scene
// starts where the one before it left off, so the cuts between them never show.

import type { Pose } from "../pieces/motion";
import { SCENES, type Scene, type SceneId } from "../timeline";

/** The composition's fixed size: 16:9, for the in-app player and the trailer alike. */
export const INTRO_WIDTH = 1920;
export const INTRO_HEIGHT = 1080;

/** The text: left edge, each row's top, and the type size. */
export const TEXT = { x: 140, rows: [138, 218], size: 64 };

/** Your setup's pose in each scene, once it has moved into place. */
export const YOU = {
  agents: { x: 240, y: 470, s: 1.9 },
  judgment: { x: 592, y: 452, s: 2.3 },
  good: { x: 1180, y: 600, s: 1.6 },
  badges: { x: 768, y: 580, s: 1.2 },
} satisfies Record<string, Pose>;

/** Your three setups in the badges scene: yours in the middle. */
export const TRIO: readonly Pose[] = [{ ...YOU.badges, x: 200 }, YOU.badges, { ...YOU.badges, x: 1336 }];

/** Encoder angles: as the first scene finds them, and as you set them by hand. */
export const ANGLES_BEFORE = [-80, 30, 110] as const;
export const ANGLES_SET = [-20, 75, -110] as const;

/** What the setup's screen says once its dials are set. */
export const SETTINGS = ["harness  local", "model    your pick", "effort   high"] as const;
/** The settings as the screen's lines, built once. */
export const SETTINGS_LINES = SETTINGS.map((text) => ({ text }));

/** What good looks like, written on the first badge's label a row at a time. */
export const LINE = ["every claim", "cites the", "line it", "came from"] as const;
export const LINE_LENGTH = LINE.reduce((n, row) => n + row.length, 0);

export function scene(id: SceneId): Scene {
  return SCENES.find((s) => s.id === id)!;
}
