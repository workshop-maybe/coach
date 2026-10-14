import { describe, expect, it } from "vitest";
import { FPS, REPLY_FRAMES, SCENES, SOUND_CUES, STILLS, TOTAL_FRAMES, sceneAt, settledAt, wordFrames } from "./timeline";

describe("the intro timeline", () => {
  it("runs the five scenes in the story's order", () => {
    expect(SCENES.map((s) => s.id)).toEqual(["agents", "judgment", "good", "badges", "horizon"]);
  });

  it("leaves no gap or overlap between scenes", () => {
    SCENES.slice(1).forEach((scene, i) => {
      const prev = SCENES[i];
      expect(scene.start).toBe(prev.start + prev.length);
    });
  });

  it("is under a minute long", () => {
    expect(TOTAL_FRAMES / FPS).toBeLessThan(60);
  });

  it("holds each still inside its scene, after the last word has risen", () => {
    SCENES.forEach((scene) => {
      const still = scene.start + scene.still;
      expect(still).toBeLessThan(scene.start + scene.length);
      expect(still).toBeGreaterThanOrEqual(settledAt(scene));
    });
    expect(STILLS).toHaveLength(SCENES.length);
  });

  it("holds the last still on the film's final frame, where the sheet arrives", () => {
    expect(STILLS[STILLS.length - 1]).toBe(TOTAL_FRAMES - 1);
  });

  it("gives every row a start frame", () => {
    SCENES.forEach((scene) => expect(scene.rowAt).toHaveLength(scene.rows.length));
  });

  it("never says machine", () => {
    SCENES.forEach((scene) => expect(scene.rows.join(" ").toLowerCase()).not.toContain("machine"));
  });

  it("finds the scene at a frame, and keeps frames past the end on the last scene", () => {
    expect(sceneAt(0).id).toBe("agents");
    expect(sceneAt(240).id).toBe("judgment");
    expect(sceneAt(TOTAL_FRAMES + 30).id).toBe("horizon");
  });

  it("starts each word of a row a few frames after the last", () => {
    const [first, second] = wordFrames(SCENES[0], 0);
    expect(second - first).toBeGreaterThan(0);
  });

  it("sends replies faster and faster", () => {
    const gaps = REPLY_FRAMES.slice(1).map((f, i) => f - REPLY_FRAMES[i]);
    expect(gaps[gaps.length - 1]).toBeLessThan(gaps[0]);
  });

  it("orders its sound cues by frame, all inside the film", () => {
    const frames = SOUND_CUES.map((c) => c.frame);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
    frames.forEach((f) => expect(f).toBeLessThan(TOTAL_FRAMES));
  });
});
