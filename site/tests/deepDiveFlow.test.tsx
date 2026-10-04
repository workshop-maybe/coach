// @vitest-environment jsdom
// The Jev deep dive's UI cross-check (docs/plans/2026-10-04-1503-docs-jev-deep-dive-plan.md,
// KTD9). site/src/deep-dive/examples.ts builds the second-opinion case study from the
// app's domain functions in the order src/ui/TestDeck.tsx calls them. This test drives the
// real test deck through the same scenario, with FakeJev answering as the case study's
// illustrative answers, and checks that the request the judge pane sends and the result it
// saves are the ones the guide shows. The reply box is the textarea stand-in the deck's own
// flow tests use, which applies the same paste fixes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadFolder } from "../../src/domain/folder";
import { JEV_MODEL } from "../../src/domain/jevRequest";
import { credentialKey } from "../../src/domain/types";
import { FAKE_ON, FakeJev } from "../../src/jev/fakeJev";
import { SAMPLE, sampleFolder, sampleStorage } from "../../src/shots/seed";
import { CASE_CALLS, CASE_MISSED_POINT, CASE_REASON, CASE_REPLY } from "../../src/shots/shots";
import { firePaste } from "../../src/test/paste";
import { AppShell } from "../../src/ui/AppShell";
import { JevProvider } from "../../src/ui/jevContext";
import { FOLDER } from "../../src/ui/testFolder";
import { FolderProvider } from "../../src/ui/useFolderState";
import { secondOpinionCase } from "../src/deep-dive/examples";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; the deck's flow tests use this stand-in too.
vi.mock("../../src/ui/RichText", () => import("../../src/ui/richTextStub"));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the second-opinion case study, through the judge pane", () => {
  it("sends the request the guide shows and saves the result the guide shows", async () => {
    const guide = await secondOpinionCase();
    const storage = sampleStorage(await sampleFolder("judged"));
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", { answers: { ...CASE_CALLS }, model: JEV_MODEL });
    const route = { view: "deck", deck: "test", profileSlug: SAMPLE.agents.claude, credentialKey: SAMPLE.badges.answerKey } as const;
    render(
      <JevProvider jev={jev}>
        <FolderProvider storage={storage} folder={FOLDER}>
          <AppShell onChangeFolder={() => {}} initialRoute={route} />
        </FolderProvider>
      </JevProvider>,
    );
    const button = (name: string) => screen.getByRole("button", { name });

    // Hand it over, then paste the reply and go on to judge it.
    await screen.findByRole("heading", { name: "Hand it over" });
    await userEvent.click(button("Copy"));
    await screen.findByRole("heading", { name: "What came back" });
    firePaste(screen.getByRole("textbox", { name: "Reply" }), { "text/plain": CASE_REPLY });
    await userEvent.click(button("Next"));
    await screen.findByRole("heading", { name: "Did it meet it" });

    // Not yet, then Check with Jev: the reading arrives seen after the verdict.
    await userEvent.click(button("Not yet"));
    await userEvent.click(await screen.findByRole("button", { name: "Check with Jev" }));
    const reading = await screen.findByRole("region", { name: "Jev's reading" });
    expect(jev.asks).toEqual([guide.request]);
    expect(within(reading).getByText("Jev matched your verdict 7 of 8 times on this badge, and couldn't call 1")).toBeTruthy();

    // The missed point, the reason, and Save.
    await userEvent.click(button("Next"));
    await screen.findByRole("heading", { name: "Which points did it miss" });
    await userEvent.click(button(CASE_MISSED_POINT));
    await userEvent.click(button("Next"));
    await screen.findByRole("heading", { name: "What did Jev miss" });
    await userEvent.type(screen.getByRole("textbox", { name: "Reason" }), CASE_REASON);
    await userEvent.click(button("Save"));
    await screen.findByText(/does not hold it/);

    const state = await loadFolder(storage);
    const before = new Set(guide.state.assessments.map((a) => `${a.profileSlug}/${a.fileStem}`));
    const saved = state.assessments.filter((a) => credentialKey(a) === SAMPLE.badges.answerKey && !before.has(`${a.profileSlug}/${a.fileStem}`));
    expect(saved).toHaveLength(1);
    const [ui] = saved;
    // The app stamps the ask and the save with the clock; the guide fixes both.
    expect({ ...ui.jev, askedAt: "" }).toEqual({ ...guide.saved.jev, askedAt: "" });
    expect(ui.missedPoints).toEqual(guide.saved.missedPoints);
    expect(ui.note).toBe(guide.saved.note);
    expect(ui.result).toBe(guide.saved.result);
    expect(ui.handBack).toBe(guide.saved.handBack);
  });
});
