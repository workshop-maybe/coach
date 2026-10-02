import { describe, expect, it } from "vitest";
import { loadFolder } from "../domain/folder";
import { buildMatrix } from "../domain/matrix";
import type { Handoff } from "../domain/types";
import { replyRoute } from "./replyRoute";
import { opus, result, review, storageWith } from "./testFolder";

const codex = { ...opus, slug: "codex", name: "Codex agent", model: "gpt-5" };
const a: Handoff = { id: "a", collectionSlug: "eng", credentialSlug: "review", text: "# A\n\n{{task}}\n" };

async function route(assessments: Awaited<ReturnType<typeof result>>[], slug = opus.slug) {
  const state = await loadFolder(storageWith({ credentials: [review], profiles: [opus, codex], handoffs: [a], assessments }));
  return replyRoute(await buildMatrix(state), state, "eng/review", slug);
}

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
