// @vitest-environment jsdom
// The Jev deep dive's UI cross-check (docs/plans/2026-10-04-1503-docs-jev-deep-dive-plan.md,
// KTD9). site/src/deep-dive/examples.ts builds the second-opinion case study from the
// app's domain functions in the order src/ui/TestDeck.tsx calls them. This test drives the
// real test deck through the same scenario, with FakeJev answering as the case study's
// illustrative answers, and checks that the request the judge pane sends and the result it
// saves are the ones the guide shows. The reply box is the textarea stand-in the deck's own
// flow tests use, which applies the same paste fixes.
//
// The compare and router case studies get the same check (fix plan KTD11): the real compare
// view sends the head-to-head the guide shows and saves its files, and the real router deck
// sends the routing ask the guide shows and saves its routing record.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ROUTING_DIR, assessmentPath, headToHeadDir, loadFolder, rejudgedDir } from "../../src/domain/folder";
import { JEV_MODEL } from "../../src/domain/jevRequest";
import { credentialKey } from "../../src/domain/types";
import { FAKE_ON, FakeJev } from "../../src/jev/fakeJev";
import { SAMPLE, sampleFolder, sampleStorage } from "../../src/shots/seed";
import { CASE_CALLS, CASE_MISSED_POINT, CASE_REASON, CASE_REPLY, COMPARE_MISSED_POINT, COMPARE_REASON, ROUTER_JOB } from "../../src/shots/shots";
import { firePaste } from "../../src/test/paste";
import { AppShell, type Route } from "../../src/ui/AppShell";
import { JevProvider } from "../../src/ui/jevContext";
import { FOLDER } from "../../src/ui/testFolder";
import { FolderProvider } from "../../src/ui/useFolderState";
import { compareCase, routerCase, secondOpinionCase } from "../src/deep-dive/examples";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; the deck's flow tests use this stand-in too.
vi.mock("../../src/ui/RichText", () => import("../../src/ui/richTextStub"));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

/** Each flow drives a whole view through many steps; a busy test run can take longer than the default 5 seconds. */
const FLOW_TIMEOUT = 20_000;

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
  }, FLOW_TIMEOUT);
});

/** The app over a sample folder with Jev Mode from `jev`, on a route. */
function renderApp(storage: ReturnType<typeof sampleStorage>, jev: FakeJev, initialRoute: Route) {
  render(
    <JevProvider jev={jev}>
      <FolderProvider storage={storage} folder={FOLDER}>
        <AppShell onChangeFolder={() => {}} initialRoute={initialRoute} />
      </FolderProvider>
    </JevProvider>,
  );
}

/** The text of the one file a folder holds under `dir`. */
async function onlyFile(storage: ReturnType<typeof sampleStorage>, dir: string): Promise<string> {
  const paths = await storage.listFiles("data", dir);
  expect(paths).toHaveLength(1);
  return (await storage.readText("data", paths[0]))!;
}

describe("Jev in compare's case study, through the compare view", () => {
  it("sends the head-to-head the guide shows, and saves the head-to-head, the two Mets and the re-judge the guide shows", async () => {
    const guide = await compareCase();
    const storage = sampleStorage(await sampleFolder("full"));
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", { ...guide.answers });
    const [claude, codex] = guide.takes.map((t) => ({ profileSlug: t.take.profileSlug, fileStem: t.take.fileStem }));
    renderApp(storage, jev, { view: "item", item: "compare", credentialKey: guide.key, takes: [claude, codex], picks: [claude, codex] });

    // Compare with Jev says what it sends, sends the one head-to-head, and the grid marks points 3 and 4.
    expect(await screen.findByText(guide.plan.countLine!)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Compare with Jev" }));
    await waitFor(() => expect(screen.getAllByText("Better than Codex")).toHaveLength(2));
    expect(jev.asks).toEqual([guide.plan.pairs[0].request]);
    const credential = guide.state.credentials.find((c) => credentialKey(c) === guide.key)!;
    const savedPair = JSON.parse(await onlyFile(storage, headToHeadDir(credential.collectionSlug, credential.slug)));
    expect({ ...savedPair, asked_at: "" }).toEqual({ ...JSON.parse(guide.headToHeadFile), asked_at: "" });

    // Met under both saves at once.
    const record = (name: string) => screen.getByRole("article", { name: new RegExp(`^${name},`) });
    await userEvent.click(within(record("Claude Code")).getByRole("button", { name: "Met" }));
    await within(record("Claude Code")).findByRole("button", { name: "Change to Not yet" });
    await userEvent.click(within(record("Codex")).getByRole("button", { name: "Met" }));
    await within(record("Codex")).findByRole("button", { name: "Change to Not yet" });
    expect(await storage.readText("data", assessmentPath(codex.profileSlug, credential.collectionSlug, credential.slug, codex.fileStem))).toBe(guide.codexResultFile);

    // Change to Not yet under Codex's reply opens the step: the missed point, the reason, Save.
    await userEvent.click(within(record("Codex")).getByRole("button", { name: "Change to Not yet" }));
    await within(record("Codex")).findByText("Which points did it miss");
    await userEvent.click(within(record("Codex")).getByRole("button", { name: COMPARE_MISSED_POINT }));
    await userEvent.click(within(record("Codex")).getByRole("button", { name: "Next" }));
    await userEvent.type(within(record("Codex")).getByRole("textbox", { name: "Reason" }), COMPARE_REASON);
    await userEvent.click(within(record("Codex")).getByRole("button", { name: "Save" }));
    await within(record("Codex")).findByText("Changed from Met");
    const rejudge = await onlyFile(storage, rejudgedDir(codex.profileSlug, credential.collectionSlug, credential.slug));
    // The app stamps the re-judge with the clock; the guide fixes it.
    const stamp = /^judged_at: .*$/m;
    expect(rejudge.replace(stamp, "")).toBe(guide.rejudgeFile.replace(stamp, ""));
  }, FLOW_TIMEOUT);
});

describe("the router's case study, through the router deck", () => {
  it("sends the routing ask the guide shows, and saves the routing record the guide shows", async () => {
    const guide = await routerCase();
    const storage = sampleStorage(await sampleFolder("full"));
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", { ...guide.answers });
    renderApp(storage, jev, { view: "deck", deck: "router" });

    fireEvent.change(await screen.findByRole("textbox", { name: "Job" }), { target: { value: ROUTER_JOB } });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    await screen.findByText("Go-to for Say how sure you are");
    expect(jev.asks).toEqual(guide.plan.batches.map((b) => b.request));

    await userEvent.click(screen.getByRole("button", { name: "Check an answer key" }));
    await screen.findByText("Cheapest agent holding Check an answer key");
    await userEvent.click(screen.getByRole("button", { name: "Take Codex" }));
    await waitFor(async () => expect(await storage.listFiles("data", ROUTING_DIR)).toHaveLength(1));
    expect(await onlyFile(storage, ROUTING_DIR)).toBe(guide.recordFile);
  }, FLOW_TIMEOUT);
});
