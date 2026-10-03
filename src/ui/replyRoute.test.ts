import { describe, expect, it } from "vitest";
import { loadFolder } from "../domain/folder";
import { buildMatrix } from "../domain/matrix";
import type { Assessment, Handoff } from "../domain/types";
import { backFromCompare, backFromReply, replyRoute } from "./replyRoute";
import type { TakeRef } from "./routes";
import { opus, result, review, storageWith } from "./testFolder";

const codex = { ...opus, slug: "codex", name: "Codex agent", model: "gpt-5" };
const a: Handoff = { id: "a", collectionSlug: "eng", credentialSlug: "review", text: "# A\n\n{{task}}\n" };

async function load(assessments: Assessment[], profiles = [opus, codex]) {
  const state = await loadFolder(storageWith({ credentials: [review], profiles, handoffs: [a], assessments }));
  return { state, matrix: await buildMatrix(state) };
}

async function route(assessments: Assessment[], slug = opus.slug) {
  const { state, matrix } = await load(assessments);
  return replyRoute(matrix, state, "eng/review", slug);
}

const day = (n: number) => ({ fileStem: `2026090${n}T090000Z`, recordedAt: `2026-09-0${n}T09:00:00.000Z` });
const take = (slug: string, n: number): TakeRef => ({ profileSlug: slug, fileStem: day(n).fileStem });

describe("replyRoute", () => {
  it("lands on the badge with the agent lit while one handoff has run", async () => {
    expect(await route([await result(opus, review, { handoff: { id: "a", text: "x" } })])).toEqual({
      view: "item",
      item: "badge",
      credentialKey: "eng/review",
      lit: "opus",
    });
  });

  it("lands on the handoff of the agent's latest result once two have run", async () => {
    const early = await result(opus, review, { fileStem: "20260901T090000Z", recordedAt: "2026-09-01T09:00:00.000Z" });
    const late = await result(opus, review, {
      fileStem: "20260902T090000Z",
      recordedAt: "2026-09-02T09:00:00.000Z",
      result: "not_met",
      handoff: { id: "a", text: "x" },
    });
    expect(await route([early, late])).toEqual({ view: "item", item: "handoff", credentialKey: "eng/review", handoffId: "a", lit: "opus" });
  });

  it("lands on the badge for an agent with no result there", async () => {
    const r = await route([await result(codex, review), await result(codex, review, { fileStem: "20260902T090000Z", handoff: { id: "a", text: "x" } })]);
    expect(r).toEqual({ view: "item", item: "badge", credentialKey: "eng/review", lit: "opus" });
  });
});

// The way back from a take's reply view (U5, R16, KTD7), worked out from the take as it is now.
describe("backFromReply", () => {
  it("goes to the badge with the agent lit and its take named while one handoff has run, keeping the picks", async () => {
    const { state, matrix } = await load([await result(opus, review, day(1)), await result(codex, review, day(2))]);
    expect(backFromReply(matrix, state, "eng/review", take("opus", 1), [take("codex", 2)])).toEqual({
      view: "item",
      item: "badge",
      credentialKey: "eng/review",
      lit: "opus",
      litTake: day(1).fileStem,
      picks: [take("codex", 2)],
    });
  });

  it("goes to the handoff page of the take's own run once two have run, not the run of the agent's latest", async () => {
    const { state, matrix } = await load([
      await result(opus, review, day(1)),
      await result(opus, review, { ...day(2), handoff: { id: "a", text: "x" } }),
    ]);
    expect(backFromReply(matrix, state, "eng/review", take("opus", 1))).toEqual({
      view: "item",
      item: "handoff",
      credentialKey: "eng/review",
      handoffId: "skeleton",
      lit: "opus",
      litTake: day(1).fileStem,
    });
    expect(backFromReply(matrix, state, "eng/review", take("opus", 2))).toMatchObject({ item: "handoff", handoffId: "a" });
  });

  it("goes to the badge while the matrix is still building", async () => {
    const { state } = await load([await result(opus, review, day(1)), await result(opus, review, { ...day(2), handoff: { id: "a", text: "x" } })]);
    expect(backFromReply(null, state, "eng/review", take("opus", 1))).toEqual({
      view: "item",
      item: "badge",
      credentialKey: "eng/review",
      lit: "opus",
      litTake: day(1).fileStem,
    });
  });

  it("goes to the badge with nothing lit when the take or its agent is gone, keeping the picks", async () => {
    const both = [await result(opus, review, day(1)), await result(codex, review, { ...day(2), handoff: { id: "a", text: "x" } })];
    const { state, matrix } = await load(both);
    const plain = { view: "item", item: "badge", credentialKey: "eng/review", picks: [take("codex", 2)] };
    expect(backFromReply(matrix, state, "eng/review", take("opus", 3), [take("codex", 2)])).toEqual(plain);
    const agentGone = await load(both, [codex]);
    expect(backFromReply(agentGone.matrix, agentGone.state, "eng/review", take("opus", 1), [take("codex", 2)])).toEqual(plain);
  });
});

// The way back from the compare of two takes (U9, R17, KTD10): the page that lists them now,
// the picks kept and Compare to take the focus.
describe("backFromCompare", () => {
  it("goes to the badge while one handoff has run, keeping the picks and asking for Compare's focus", async () => {
    const { state, matrix } = await load([await result(opus, review, day(1)), await result(codex, review, day(2))]);
    const takes = [take("opus", 1), take("codex", 2)];
    expect(backFromCompare(matrix, state, "eng/review", takes, takes)).toEqual({
      view: "item",
      item: "badge",
      credentialKey: "eng/review",
      picks: takes,
      focusCompare: true,
    });
  });

  it("goes to the handoff page of the takes' run once two have run", async () => {
    const { state, matrix } = await load([
      await result(opus, review, day(1)),
      await result(opus, review, { ...day(2), handoff: { id: "a", text: "x" } }),
      await result(codex, review, { ...day(3), handoff: { id: "a", text: "x" } }),
    ]);
    const takes = [take("opus", 2), take("codex", 3)];
    expect(backFromCompare(matrix, state, "eng/review", takes, takes)).toEqual({
      view: "item",
      item: "handoff",
      credentialKey: "eng/review",
      handoffId: "a",
      picks: takes,
      focusCompare: true,
    });
  });

  it("goes to the badge while the matrix is still building", async () => {
    const { state } = await load([await result(opus, review, day(1)), await result(opus, review, { ...day(2), handoff: { id: "a", text: "x" } })]);
    expect(backFromCompare(null, state, "eng/review", [take("opus", 1), take("opus", 2)])).toEqual({
      view: "item",
      item: "badge",
      credentialKey: "eng/review",
      focusCompare: true,
    });
  });

  it("lets the take still in the folder name the page when the other is gone, and the badge when both are", async () => {
    const { state, matrix } = await load([
      await result(opus, review, day(1)),
      await result(codex, review, { ...day(2), handoff: { id: "a", text: "x" } }),
    ]);
    const kept = [take("opus", 9), take("codex", 2)];
    expect(backFromCompare(matrix, state, "eng/review", kept, kept)).toMatchObject({ item: "handoff", handoffId: "a", picks: kept });
    const gone = [take("opus", 8), take("codex", 9)];
    expect(backFromCompare(matrix, state, "eng/review", gone, gone)).toEqual({
      view: "item",
      item: "badge",
      credentialKey: "eng/review",
      picks: gone,
      focusCompare: true,
    });
  });
});
