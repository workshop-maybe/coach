// The screenshot harness's sample folder (U3, KTD6, R20, AE4): it loads cleanly through
// the domain's own loader, every result matches its credential's current assignment, the
// waiting test reaches What needs you, and nothing in it looks like a real key or a path
// outside the sample folder.
import { describe, expect, it } from "vitest";
import { calibrationOf } from "../domain/calls";
import { loadFolder } from "../domain/folder";
import { assignmentVersion } from "../domain/hash";
import { defaultHandoff, isHandoffLocked } from "../domain/handoffs";
import { buildMatrix } from "../domain/matrix";
import { PRESETS } from "../domain/presets";
import { JEV_MODEL } from "../domain/jevRequest";
import { OVERALL_ID, pointId } from "../domain/secondOpinion";
import { credentialKey } from "../domain/types";
import { FAKE_ANSWER, FAKE_ON } from "../jev/fakeJev";
import { JEV_OFF } from "../jev/jev";
import { needsYou } from "../ui/needsYou";
import { pendingStorageKey, readPending } from "../ui/pendingTests";
import { SAMPLE, SAMPLE_FOLDER, SAMPLE_READING, sampleFolder, sampleJev, sampleStorage } from "./seed";
import { SHOTS } from "./shots";

/** A web storage holding only what the seed asks the harness to put there. */
function storeWith(entries: Record<string, string>): globalThis.Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

async function loadSample(variant: "empty" | "full" | "judged") {
  const sample = await sampleFolder(variant);
  const storage = sampleStorage(sample);
  const state = await loadFolder(storage);
  return { sample, storage, state };
}

/** Runs that look like an API key: a known key prefix, or a long run of mixed letters and digits. */
const KEY_LIKE = [/\b(?:sk|pk|rk|ts|tsk|api|key)[-_][A-Za-z0-9_-]{6,}/i, /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{20,}\b/];

function keyLike(text: string): string[] {
  return KEY_LIKE.flatMap((re) => [...text.matchAll(new RegExp(re, "g"))].map((m) => m[0]));
}

/** Absolute or home-relative paths that are not the sample folder or inside it. */
function strayPaths(text: string): string[] {
  const paths = [...text.matchAll(/\/(?:Users|home|private|tmp|Volumes)\/[^\s"'`),\]]*|~\/[^\s"'`),\]]*|\b[A-Za-z]:\\[^\s"'`]*/g)].map((m) => m[0]);
  return paths.filter((p) => p !== SAMPLE_FOLDER && !p.startsWith(`${SAMPLE_FOLDER}/`));
}

describe("the full sample folder", () => {
  it("loads through the domain loader with no load errors or warnings", async () => {
    const { state } = await loadSample("full");
    expect(state.errors).toEqual([]);
    expect(state.warnings).toEqual([]);
  });

  it("holds three presets and one hand-built credential in one collection", async () => {
    const { state } = await loadSample("full");
    expect(state.collections).toHaveLength(1);
    const presetNames = PRESETS.map((p) => /^# (.*)$/m.exec(p.markdown)![1]);
    const names = state.credentials.map((c) => c.name);
    expect(names.slice(0, 3)).toEqual(["Name what matters next", "Say how sure you are", "Check an answer key"]);
    expect(names).toHaveLength(4);
    expect(presetNames).not.toContain(names[3]);
    expect(state.credentials.every((c) => c.collectionSlug === state.collections[0].slug)).toBe(true);
  });

  it("holds two agents with different setups", async () => {
    const { state } = await loadSample("full");
    expect(state.profiles).toHaveLength(2);
    const [a, b] = state.profiles;
    expect(`${a.harness}|${a.model}|${a.effort}`).not.toBe(`${b.harness}|${b.model}|${b.effort}`);
  });

  it("dates every result, holds two takes on one badge and one saved Jev reading", async () => {
    const { state } = await loadSample("full");
    expect(state.assessments.length).toBeGreaterThanOrEqual(3);
    for (const a of state.assessments) expect(a.recordedAt).toMatch(/^2026-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
    const perBadge = new Map<string, number>();
    for (const a of state.assessments) perBadge.set(credentialKey(a), (perBadge.get(credentialKey(a)) ?? 0) + 1);
    expect(Math.max(...perBadge.values())).toBeGreaterThanOrEqual(2);
    expect(state.assessments.filter((a) => a.jev)).toHaveLength(1);
  });

  it("gives the saved reading its learning targets and examples sent, and one Not met result the points it missed", async () => {
    const { state } = await loadSample("full");
    const reading = state.assessments.find((a) => a.jev)?.jev;
    expect(reading?.targets?.map((t) => t.probability)).toEqual([0.86, 0.62]);
    expect(reading?.examplesSent).toBe(0);
    const missed = state.assessments.filter((a) => a.missedPoints);
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ result: "not_met", profileSlug: SAMPLE.agents.codex });
    expect(missed[0].missedPoints?.map((p) => p.slice(0, 16))).toEqual(["Questions 2 and ", "No wrong answer "]);
  });

  it("matches every result's assignment version to its credential, so nothing reads task changed", async () => {
    const { state } = await loadSample("full");
    for (const a of state.assessments) {
      const credential = state.credentials.find((c) => credentialKey(c) === credentialKey(a))!;
      expect(credential, `${a.profileSlug} on ${credentialKey(a)}`).toBeDefined();
      expect(a.assignmentVersion).toBe(await assignmentVersion(credential.task, credential.rubric));
      if (a.jev) expect(a.jev.assignmentVersion).toBe(a.assignmentVersion);
    }
    const matrix = await buildMatrix(state);
    const flagged = [...matrix.cells.values()].filter((c) => c.flags.length > 0);
    expect(flagged).toEqual([]);
  });

  it("puts its waiting test into What needs you", async () => {
    const { sample, state } = await loadSample("full");
    const store = storeWith({ [pendingStorageKey(SAMPLE_FOLDER)]: JSON.stringify(sample.pending) });
    const pending = readPending(SAMPLE_FOLDER, store);
    expect(pending).toHaveLength(1);
    const credential = state.credentials.find((c) => credentialKey(c) === pending[0].credentialKey)!;
    expect(pending[0].assignmentVersion).toBe(await assignmentVersion(credential.task, credential.rubric));
    const items = needsYou(state, await buildMatrix(state), pending);
    expect(items[0]).toMatchObject({ kind: "reply", profileSlug: pending[0].profileSlug, credentialKey: pending[0].credentialKey });
  });

  it("holds a bake-off on Check an answer key: both agents' replies held, stamped like results, listed after the waiting test", async () => {
    const { sample, state } = await loadSample("full");
    expect(state.held.map((h) => [h.profileSlug, h.fileStem])).toEqual([
      [SAMPLE.agents.claude, SAMPLE.held.claudeAnswerKey],
      [SAMPLE.agents.codex, SAMPLE.held.codexAnswerKey],
    ]);
    const answerKey = state.credentials.find((c) => credentialKey(c) === SAMPLE.badges.answerKey)!;
    for (const h of state.held) {
      expect(credentialKey(h)).toBe(SAMPLE.badges.answerKey);
      expect(h.assignmentVersion).toBe(await assignmentVersion(answerKey.task, answerKey.rubric));
      expect(h.heldAt < "2026-10-01T09:00:00.000Z").toBe(true);
    }
    const store = storeWith({ [pendingStorageKey(SAMPLE_FOLDER)]: JSON.stringify(sample.pending) });
    const items = needsYou(state, await buildMatrix(state), readPending(SAMPLE_FOLDER, store));
    expect(items.slice(0, 2).map((i) => i.kind)).toEqual(["reply", "held"]);
    expect(items[1]).toMatchObject({ credentialKey: SAMPLE.badges.answerKey, takes: [{ fileStem: SAMPLE.held.claudeAnswerKey }, { fileStem: SAMPLE.held.codexAnswerKey }] });
  });

  it("gives Write a release note one handoff of its own, its default, which no result has run", async () => {
    const { state } = await loadSample("full");
    expect(state.handoffs.map((h) => `${credentialKey(h)}/${h.id}`)).toEqual([`${SAMPLE.badges.releaseNote}/${SAMPLE.handoffs.releaseNote}`]);
    expect(defaultHandoff(state, SAMPLE.badges.releaseNote).id).toBe(SAMPLE.handoffs.releaseNote);
    expect(isHandoffLocked(state, SAMPLE.badges.releaseNote, SAMPLE.handoffs.releaseNote)).toBe(false);
  });

  it("answers a context read with the sample machine", async () => {
    const { storage } = await loadSample("full");
    expect(await storage.readContext("", "claude-code")).toEqual(SAMPLE_READING);
  });
});

describe("the empty sample folder", () => {
  it("loads as a folder with nothing in it and nothing waiting", async () => {
    const { sample, state } = await loadSample("empty");
    expect(state.errors).toEqual([]);
    expect(state.credentials).toEqual([]);
    expect(state.profiles).toEqual([]);
    expect(state.assessments).toEqual([]);
    expect(sample.pending).toEqual([]);
  });
});

describe("the judged sample folder", () => {
  it("holds every file of the full folder as it is, and adds only results", async () => {
    const full = await sampleFolder("full");
    const judged = await sampleFolder("judged");
    for (const [path, text] of Object.entries(full.files)) expect(judged.files[path], path).toBe(text);
    const added = Object.keys(judged.files).filter((path) => !(path in full.files));
    expect(added).toHaveLength(8);
    for (const path of added) expect(path).toMatch(/^assessments\/[^/]+\/my-credentials\/check-an-answer-key\/[^/]+\.md$/);
    expect(judged.pending).toEqual(full.pending);
  });

  it("loads cleanly, and its readings on Check an answer key fit the cut-offs to 40/75 with a record of 7 of 8 and 1 can't call", async () => {
    const { state } = await loadSample("judged");
    expect(state.errors).toEqual([]);
    expect(state.warnings).toEqual([]);
    expect(calibrationOf(state, SAMPLE.badges.answerKey, JEV_MODEL)).toEqual({
      pair: { low: 40, high: 75 },
      fitted: true,
      judged: 9,
      trackRecord: { matches: 7, calls: 8, cantCalls: 1 },
    });
  });

  it("matches every result's assignment version to its credential", async () => {
    const { state } = await loadSample("judged");
    for (const a of state.assessments) {
      const c = state.credentials.find((x) => credentialKey(x) === credentialKey(a))!;
      expect(a.assignmentVersion, a.fileStem).toBe(await assignmentVersion(c.task, c.rubric));
    }
  });
});

describe("Jev Mode in the sample (AE4)", () => {
  it("is off with no key, or on with FakeJev's sample hint", () => {
    expect(sampleJev("off").current).toEqual(JEV_OFF);
    expect(sampleJev("on").current).toEqual(FAKE_ON);
    expect(FAKE_ON.hint).toMatch(/^[a-z0-9]{4}$/);
  });

  it("answers a shot's scripted ids as scripted, and every other id with the fake's default", async () => {
    const request = {
      kind: "secondOpinion",
      questions: { [pointId(0)]: {}, [pointId(1)]: {}, [OVERALL_ID]: {} },
    } as unknown as Parameters<ReturnType<typeof sampleJev>["ask"]>[0];
    const scripted = await sampleJev("on", { [pointId(0)]: 0.91, [OVERALL_ID]: 0.84 }).ask(request);
    expect(scripted.answers).toEqual({ [pointId(0)]: 0.91, [pointId(1)]: FAKE_ANSWER, [OVERALL_ID]: 0.84 });
    expect((await sampleJev("on").ask(request)).answers).toEqual({ [pointId(0)]: FAKE_ANSWER, [pointId(1)]: FAKE_ANSWER, [OVERALL_ID]: FAKE_ANSWER });
  });
});

describe("what the sample shows (R20, AE4)", () => {
  it("finds a key prefix and a long mixed token, and passes slugs, stamps and versions", () => {
    expect(keyLike("sk-ant-api03-abcdefgh")).not.toEqual([]);
    expect(keyLike("token Ab3dEf6hIj9kLm2nOp5q")).not.toEqual([]);
    expect(keyLike("check-an-answer-key 20260927T112000Z 1a2b3c4d5e6f my-credentials/say-how-sure-you-are")).toEqual([]);
  });

  it("finds a path outside the sample folder", () => {
    expect(strayPaths("/Users/you/Andamio/agents/a.json and /Users/you/Andamio")).toEqual([]);
    expect(strayPaths("open /Users/jane/code or ~/notes or C:\\Users\\jane")).toHaveLength(3);
  });

  it("holds no key-like string and no path outside the sample folder, in the seed or the manifest", async () => {
    for (const variant of ["empty", "full", "judged"] as const) {
      const sample = await sampleFolder(variant);
      const texts = [...Object.entries(sample.files).flat(), JSON.stringify(sample.pending), JSON.stringify(SAMPLE_READING)];
      for (const text of texts) {
        expect(keyLike(text), text.slice(0, 80)).toEqual([]);
        expect(strayPaths(text), text.slice(0, 80)).toEqual([]);
      }
    }
    const manifest = JSON.stringify(SHOTS);
    expect(keyLike(manifest)).toEqual([]);
    expect(strayPaths(manifest)).toEqual([]);
  });
});
