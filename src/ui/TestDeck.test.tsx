// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { serializeCredentialMd } from "../domain/credential-md";
import { assessmentPath, credentialPath, loadFolder, marksDir, profilePath } from "../domain/folder";
import { BUILT_IN_HANDOFF, fillHandoff } from "../domain/handoffs";
import { assignmentVersion } from "../domain/hash";
import type { JevAnswers } from "../domain/jevRequest";
import type { Credential, Handoff, Mark } from "../domain/types";
import { FAKE_ON, FakeJev } from "../jev/fakeJev";
import { JEV_ERROR_KINDS, JevError } from "../jev/jev";
import type { MemoryStorage } from "../storage/memory";
import { firePaste } from "../test/paste";
import { AppShell, type Route } from "./AppShell";
import { JevProvider } from "./jevContext";
import { addPending, readPending, type PendingTest } from "./pendingTests";
import { SENDING_MS, jevFailure } from "./TestDeck";
import { FOLDER, opus, renderApp, result, review, snapshot, storageWith } from "./testFolder";
import { FolderProvider } from "./useFolderState";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; these flows type into a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(writeText).mockReset();
});
afterEach(cleanup);

const fromBadge = { view: "deck", deck: "test", credentialKey: "eng/review" } as const;

async function takeAndCopy() {
  await userEvent.click(await screen.findByRole("button", { name: "Opus agent" }));
  expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
}

async function pasteAndJudge(reply: string, answer: "Met" | "Not yet") {
  await userEvent.type(screen.getByRole("textbox", { name: "Reply" }), reply);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("heading", { name: "Did it meet it" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: answer }));
}

const machine = () => document.querySelector<SVGSVGElement>(".deck svg.cast-machine:not(.cast-machine-mini)")!;
const box = () => document.querySelector<SVGSVGElement>(".deck svg.cast-handoff-box")!;
const badgeCard = async () => within(await screen.findByRole("region", { name: "Badges" })).getByRole("button", { name: /Code review/ });

/** The folder's actions in the top bar: all four on a page, none on a pane (R8). */
const FOLDER_ACTIONS = ["Change folder", "Reload", "Export", "Jev Mode"];
const barActions = () => FOLDER_ACTIONS.filter((name) => within(screen.getByRole("banner")).queryByRole("button", { name }) !== null);
const replyBox = () => screen.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement;
const testDeck = () => screen.getByRole("region", { name: "Test an agent" });

describe("the first test", () => {
  it("runs from an empty home to one agent, one badge and one result", async () => {
    const storage = storageWith();
    renderApp(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Try a first test" }));
    await userEvent.click(await screen.findByRole("button", { name: "Make the agent" }));
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(vi.mocked(writeText).mock.calls[0][0]).toContain("# Test: Name what matters next");
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    await pasteAndJudge("1. Fix the flaky export test.", "Met");
    expect(await screen.findByTestId("landing")).toBeTruthy();

    const state = await loadFolder(storage);
    expect(state.profiles).toHaveLength(1);
    expect(state.credentials.map((c) => c.name)).toEqual(["Name what matters next"]);
    expect(state.assessments).toEqual([expect.objectContaining({ profileSlug: state.profiles[0].slug, credentialSlug: "name-what-matters-next", result: "met" })]);
  });

  it("a failed badge save then Close leaves home with the agent and no first test", async () => {
    const storage = storageWith();
    const real = storage.writeText.bind(storage);
    vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
      if (path.endsWith(".md")) throw new Error("disk full");
      return real(root, path, text);
    });
    renderApp(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Try a first test" }));
    await userEvent.click(await screen.findByRole("button", { name: "Make the agent" }));
    expect((await screen.findByRole("alert")).textContent).toContain("disk full");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("region", { name: "Agents" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try a first test" })).toBeNull();
  });
});

describe("TestDeck", () => {
  it("four beats record a met result, the badge lands on the agent, and Home goes home", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, fromBadge);
    expect(await screen.findByRole("heading", { name: "Who takes it" })).toBeTruthy();
    await takeAndCopy();

    expect(vi.mocked(writeText).mock.calls[0][0]).toContain("# Test: Code review");
    const [waiting] = readPending(FOLDER);
    expect(waiting).toMatchObject({
      profileSlug: "opus",
      credentialKey: "eng/review",
      assignmentVersion: await assignmentVersion(review.task, review.rubric),
      setup: { harness: "claude-code", model: "opus", effort: "high" },
      handoff: { id: "skeleton", text: fillHandoff(BUILT_IN_HANDOFF, review) },
    });

    await pasteAndJudge("I reviewed it.", "Met");
    expect(await screen.findByTestId("landing")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Opus agent holds it" })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(state.assessments).toEqual([
      expect.objectContaining({ profileSlug: "opus", result: "met", handBack: "I reviewed it.", handoff: { id: "skeleton", text: fillHandoff(BUILT_IN_HANDOFF, review) } }),
    ]);
    expect(readPending(FOLDER)).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(within(await badgeCard()).getByText("Opus agent")).toBeTruthy();
  });

  it("Covers AE4. Not yet records not met with no landing, and the badge still has no holders", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, fromBadge);
    await takeAndCopy();
    await pasteAndJudge("I tried.", "Not yet");

    expect(await screen.findByRole("heading", { name: "Not yet" })).toBeTruthy();
    expect(screen.queryByTestId("landing")).toBeNull();
    expect(screen.queryByRole("button", { name: /go-to/ })).toBeNull();
    expect((await loadFolder(storage)).assessments).toEqual([expect.objectContaining({ result: "not_met", handBack: "I tried." })]);
    expect(Object.keys(storage.files()).filter((p) => p.includes("/marks/"))).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(within(await badgeCard()).getByText("No holders yet")).toBeTruthy();
  });

  it("the pickers show machines and cartridges, and the doors dashed outlines", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), { view: "deck", deck: "test", profileSlug: "opus" });
    const badge = await screen.findByRole("button", { name: "Code review" });
    expect(badge.querySelector("svg.cast-cartridge")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create a credential" }).querySelector('[data-outline="cartridge"]')).not.toBeNull();
    cleanup();

    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    const agent = await screen.findByRole("button", { name: "Opus agent" });
    expect(agent.querySelector("svg.cast-machine-mini")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Create an agent" }).querySelector('[data-outline="machine"]')).not.toBeNull();
  });

  it("hand it over plugs the badge into the box beside the agent, Copy prints and feeds the handoff, and the reply shows on the screen", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await userEvent.click(await screen.findByRole("button", { name: "Opus agent" }));
    await screen.findByRole("heading", { name: "Hand it over" });
    expect(machine().getAttribute("data-screen")).toBe("idle");
    await waitFor(() => expect(box().querySelector(".cast-handoff-input image.cast-label")).not.toBeNull());
    expect(machine().querySelector(".cast-plugged")).toBeNull();

    let release!: () => void;
    vi.mocked(writeText).mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(machine().getAttribute("data-screen")).toBe("sending");
    // Nothing prints or feeds until the clipboard holds the handoff.
    expect(box().classList.contains("cast-printing")).toBe(false);
    expect(machine().querySelector(".cast-plugged")).toBeNull();
    release();
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    expect(box().classList.contains("cast-printing")).toBe(true);
    expect(machine().classList.contains("cast-feeding")).toBe(true);
    expect(machine().querySelector(".cast-plugged .cast-card-label")?.textContent).toBe("S");
    await waitFor(() => expect(machine().getAttribute("data-screen")).toBe("waiting"), { timeout: SENDING_MS + 1000 });

    await userEvent.type(screen.getByRole("textbox", { name: "Reply" }), "First line{Enter}second{Enter}third{Enter}fourth");
    const lines = [...machine().querySelectorAll(".cast-screen-reply text")].map((t) => t.textContent);
    expect(lines).toEqual(["First line", "second", "third"]);
  });

  it("Met ejects the handoff and lights the agent's key", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    await pasteAndJudge("Done.", "Met");
    const landing = await screen.findByTestId("landing");
    const drawn = landing.querySelector("svg.cast-machine")!;
    expect(drawn.classList.contains("cast-ejecting")).toBe(true);
    expect(drawn.querySelector(".cast-plugged")).not.toBeNull();
    await waitFor(() => expect(drawn.querySelector('[data-credential="eng/review"]')?.getAttribute("data-key")).toBe("lit"));
    expect(drawn.querySelector('[data-credential="eng/review"]')!.classList.contains("cast-key-seated")).toBe(true);
  });

  it("Not yet ejects the handoff and lights nothing", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    await pasteAndJudge("I tried.", "Not yet");
    await screen.findByRole("heading", { name: "Not yet" });
    expect(machine().classList.contains("cast-ejecting")).toBe(true);
    expect(machine().querySelectorAll('[data-key="lit"], [data-key="raised"]')).toHaveLength(0);
  });

  it("Not yet offers Try another agent, back at who takes it with the credential picked", async () => {
    const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5" };
    renderApp(storageWith({ credentials: [review], profiles: [opus, codex] }), fromBadge);
    await takeAndCopy();
    await pasteAndJudge("I tried.", "Not yet");
    await userEvent.click(await screen.findByRole("button", { name: "Try another agent" }));
    expect(await screen.findByRole("heading", { name: "Who takes it" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Codex agent" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    expect(vi.mocked(writeText).mock.lastCall?.[0]).toContain("# Test: Code review");
    expect(readPending(FOLDER)[0]).toMatchObject({ profileSlug: "codex", credentialKey: "eng/review" });
  });

  it("Covers AE3. After Copy and quitting, home lists the test first and it resumes at what came back", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, fromBadge);
    await takeAndCopy();
    cleanup();

    renderApp(storage);
    const needs = await screen.findByRole("region", { name: "What needs you" });
    const [first] = within(needs).getAllByRole("button");
    expect(first.textContent).toContain("Pull Opus agent's handoff");
    await userEvent.click(first);
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    await pasteAndJudge("Here it is.", "Met");
    expect(await screen.findByTestId("landing")).toBeTruthy();
  });

  it("Covers AE2. Starting from an agent with no credentials routes through the credential deck and back", async () => {
    const storage = storageWith({ profiles: [opus] });
    renderApp(storage, { view: "deck", deck: "test", profileSlug: "opus" });
    expect(await screen.findByRole("heading", { name: "Which badge" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create a credential" }));

    await userEvent.click(await screen.findByRole("button", { name: "Build your own" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), "Write docs");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Learning target" }), "I can explain a module");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Task" }), "Document the module");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));

    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Answered" }).textContent).toContain("Opus agent");
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(vi.mocked(writeText).mock.calls[0][0]).toContain("# Test: Write docs");
  });

  it("starting from a badge with no agents offers Create an agent and returns to the test", async () => {
    renderApp(storageWith({ credentials: [review] }), fromBadge);
    await userEvent.click(await screen.findByRole("button", { name: "Create an agent" }));
    await userEvent.click(await screen.findByRole("button", { name: "Make the agent" }));
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Answered" }).textContent).toContain("Claude Code, opus, high");
  });

  it("a re-test opens with both picked, at hand it over", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), { view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review" });
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
  });

  it("a badge with no task yet cannot be copied", async () => {
    renderApp(storageWith({ credentials: [{ ...review, task: "" }], profiles: [opus] }), { view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review" });
    expect(await screen.findByText("This badge has no task yet")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a failed copy says so, stays on the card and leaves nothing waiting", async () => {
    vi.mocked(writeText).mockRejectedValue(new Error("Clipboard unavailable"));
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), { view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review" });
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Clipboard unavailable");
    expect(screen.getByRole("heading", { name: "Hand it over" })).toBeTruthy();
    expect(readPending(FOLDER)).toEqual([]);
    expect(box().classList.contains("cast-printing")).toBe(false);
    expect(machine().classList.contains("cast-feeding")).toBe(false);
    expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Copy snapshots this machine and the agent's memory into the waiting test", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    storage.queueContext({ machineId: "m1", machine: "Studio Mac", memory: "0123456789ab" });
    renderApp(storage, fromBadge);
    await takeAndCopy();
    const [waiting] = readPending(FOLDER);
    expect(waiting.context).toEqual({
      machineId: "m1",
      machine: "Studio Mac",
      memory: "0123456789ab",
      capturedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("Covers AE2. The result carries the context from copy time, not record time", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    storage.queueContext({ machineId: "m1", machine: "Studio Mac", memory: "aaaaaaaaaaaa" });
    storage.queueContext({ machineId: "m1", machine: "Studio Mac", memory: "bbbbbbbbbbbb" });
    renderApp(storage, fromBadge);
    await takeAndCopy();
    await pasteAndJudge("Done.", "Not yet");
    await screen.findByRole("heading", { name: "Not yet" });
    const [saved] = (await loadFolder(storage)).assessments;
    expect(saved.context?.memory).toBe("aaaaaaaaaaaa");
  });

  it("a failed context read still copies and waits, with no context", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    storage.queueContext(new Error("no home"));
    renderApp(storage, fromBadge);
    await takeAndCopy();
    const [waiting] = readPending(FOLDER);
    expect(waiting).toMatchObject({ profileSlug: "opus", credentialKey: "eng/review" });
    expect(waiting).not.toHaveProperty("context");
  });

  it("Covers AE3, AE6. A waiting test from before context existed records a result with no context, and a changed memory never makes it stale", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    addPending(FOLDER, {
      profileSlug: "opus",
      credentialKey: "eng/review",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: await assignmentVersion(review.task, review.rubric),
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    });
    renderApp(storage);
    const needs = await screen.findByRole("region", { name: "What needs you" });
    await userEvent.click(within(needs).getAllByRole("button")[0]);
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy again" })).toBeNull();
    await pasteAndJudge("Here.", "Not yet");
    await screen.findByRole("heading", { name: "Not yet" });
    const [saved] = (await loadFolder(storage)).assessments;
    expect(saved).not.toHaveProperty("context");
    // A plug from before handoffs ran the built-in prompt; the result shows it as the skeleton (R14).
    expect(saved).not.toHaveProperty("handoff");
  });

  it("pulling without a result removes the plug and goes home", async () => {
    addPending(FOLDER, {
      profileSlug: "opus",
      credentialKey: "eng/review",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: await assignmentVersion(review.task, review.rubric),
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    });
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), { ...fromBadge, profileSlug: "opus", resume: true });
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Pull without a result" }));
    expect(await screen.findByRole("button", { name: "Create a credential" })).toBeTruthy();
    expect(readPending(FOLDER)).toEqual([]);
  });

  it("a second Copy while the clipboard is still writing moves on once", async () => {
    const writes: (() => void)[] = [];
    vi.mocked(writeText).mockImplementation(() => new Promise<void>((r) => writes.push(r)));
    const done = () => writes.forEach((r) => r());
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await userEvent.click(await screen.findByRole("button", { name: "Opus agent" }));
    const copyButton = await screen.findByRole("button", { name: "Copy" });
    fireEvent.click(copyButton);
    fireEvent.click(copyButton);
    await act(async () => done());
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: "Did it meet it" })).toBeNull();
  });

  it("Copy again shows a clipboard failure", async () => {
    addPending(FOLDER, {
      profileSlug: "opus",
      credentialKey: "eng/review",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: "an-older-version",
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    });
    vi.mocked(writeText).mockRejectedValue(new Error("Clipboard is busy"));
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), { ...fromBadge, profileSlug: "opus", resume: true });
    await userEvent.click(await screen.findByRole("button", { name: "Copy again" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Clipboard is busy");
  });

  it("a waiting test whose task changed offers Copy again instead of recording", async () => {
    addPending(FOLDER, {
      profileSlug: "opus",
      credentialKey: "eng/review",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: "an-older-version",
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    });
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), { ...fromBadge, profileSlug: "opus", resume: true });
    expect(await screen.findByText("The task changed since you copied it")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Copy again" }));
    expect(await screen.findByRole("textbox", { name: "Reply" })).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(readPending(FOLDER)[0].assignmentVersion).toBe(await assignmentVersion(review.task, review.rubric));
  });

  it("a waiting test whose agent setup changed says so", async () => {
    addPending(FOLDER, {
      profileSlug: "opus",
      credentialKey: "eng/review",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: await assignmentVersion(review.task, review.rubric),
      setup: { harness: "claude-code", model: "sonnet", effort: "high" },
    });
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), { ...fromBadge, profileSlug: "opus", resume: true });
    expect(await screen.findByText("The agent's setup changed since you copied it")).toBeTruthy();
  });

  it("shows the rubric beside Met and Not yet when one exists", async () => {
    const withRubric = { ...review, rubric: "Finds the off-by-one." };
    renderApp(storageWith({ credentials: [withRubric], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    await userEvent.type(screen.getByRole("textbox", { name: "Reply" }), "Done");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(within(await screen.findByRole("region", { name: "Rubric" })).getByText("Finds the off-by-one.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Met" })).toBeTruthy();
  });

  it("an earned badge re-tested after a task change lands again", async () => {
    const edited = { ...review, task: "Review the diff twice." };
    const earned = await result(opus, review);
    const storage = storageWith({ credentials: [edited], profiles: [opus], assessments: [earned] });
    renderApp(storage, { view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review" });
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    await pasteAndJudge("Twice.", "Met");
    expect(await screen.findByTestId("landing")).toBeTruthy();
    expect((await loadFolder(storage)).assessments).toHaveLength(2);
  });
});

describe("TestDeck with the handoff box", () => {
  const A = "20260901T090000Z";
  const B = "20260902T090000Z";
  const handoff = (id: string, text: string): Handoff => ({ collectionSlug: "eng", credentialSlug: "review", id, text });
  const handoffA = handoff(A, "Handoff A for {{name}}\n\n{{task}}\n");
  const handoffB = handoff(B, "Handoff B for {{name}}\n\n{{task}}\n");
  const docs: Credential = { ...review, slug: "docs", name: "Write docs", task: "Document the module." };
  const sonnet = { ...opus, slug: "sonnet", name: "Sonnet agent", model: "sonnet" };
  const both = { view: "deck", deck: "test", profileSlug: "opus", credentialKey: "eng/review" } as const;

  const keysList = () => screen.getByRole("list", { name: "Handoffs" });
  const key = (name: string) => within(keysList()).getByRole("button", { name });
  const pressed = () => within(keysList()).queryAllByRole("button", { pressed: true }).map((b) => b.textContent);
  const copyButton = () => screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement;

  async function plug(entry: Partial<PendingTest> & Pick<PendingTest, "credentialKey">, credential: Credential = review) {
    addPending(FOLDER, {
      profileSlug: "opus",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: await assignmentVersion(credential.task, credential.rubric),
      setup: { harness: "claude-code", model: "opus", effort: "high" },
      ...entry,
    });
  }

  it("Covers F1. From a badge it asks who takes it, lights the default in the box, and Copy plugs the filled default", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], handoffs: [handoffA, handoffB] }), fromBadge);
    expect(await screen.findByRole("heading", { name: "Who takes it" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Opus agent" }));
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    expect(within(keysList()).getAllByRole("button").map((b) => b.textContent)).toEqual(["S", "A", "B · default"]);
    expect(pressed()).toEqual(["B · default"]);
    expect(box().querySelector(`[data-handoff-key="${B}"]`)?.getAttribute("data-key-state")).toBe("lit");

    await userEvent.click(copyButton());
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    const filled = fillHandoff(handoffB.text, review);
    expect(vi.mocked(writeText).mock.calls[0][0]).toBe(filled);
    expect(readPending(FOLDER)).toEqual([expect.objectContaining({ profileSlug: "opus", credentialKey: "eng/review", handoff: { id: B, text: filled } })]);
  });

  it("Covers AE3, F3. When the agent's winner is not the default, no key is lit, both are offered, and Copy waits for a pick", async () => {
    const met = await result(opus, review, { handoff: { id: A, text: fillHandoff(handoffA.text, review) } });
    renderApp(storageWith({ credentials: [review], profiles: [opus], handoffs: [handoffA, handoffB], assessments: [met] }), fromBadge);
    await userEvent.click(await screen.findByRole("button", { name: "Opus agent" }));
    await screen.findByRole("heading", { name: "Hand it over" });

    expect(pressed()).toEqual([]);
    expect(key("A · this agent's winner")).toBeTruthy();
    expect(key("B · badge default")).toBeTruthy();
    expect(screen.getByText("Pick one to copy")).toBeTruthy();
    expect(copyButton().disabled).toBe(true);
    expect(box().querySelectorAll('[data-key-state="lit"]')).toHaveLength(0);

    await userEvent.click(key("A · this agent's winner"));
    expect(pressed()).toEqual(["A · this agent's winner"]);
    expect(screen.queryByText("Pick one to copy")).toBeNull();
    expect(copyButton().disabled).toBe(false);
    await userEvent.click(copyButton());
    await screen.findByRole("heading", { name: "What came back" });
    expect(vi.mocked(writeText).mock.calls[0][0]).toBe(fillHandoff(handoffA.text, review));
  });

  it("Covers AE4. An agent that never met the badge gets the default lit and no question", async () => {
    const met = await result(opus, review, { handoff: { id: A, text: "A as copied" } });
    renderApp(storageWith({ credentials: [review], profiles: [opus, sonnet], handoffs: [handoffA, handoffB], assessments: [met] }), fromBadge);
    await userEvent.click(await screen.findByRole("button", { name: "Sonnet agent" }));
    await screen.findByRole("heading", { name: "Hand it over" });
    expect(pressed()).toEqual(["B · default"]);
    expect(screen.queryByText("Pick one to copy")).toBeNull();
    expect(copyButton().disabled).toBe(false);
  });

  it("Covers AE5. An agent holding another badge's handoff is asked to pull it first, and after the hand-back the test comes back", async () => {
    await plug({ credentialKey: "eng/docs", handoff: { id: "skeleton", text: fillHandoff(BUILT_IN_HANDOFF, docs) } }, docs);
    const storage = storageWith({ credentials: [review, docs], profiles: [opus] });
    renderApp(storage, fromBadge);
    await userEvent.click(await screen.findByRole("button", { name: "Opus agent" }));
    expect(await screen.findByRole("heading", { name: "Pull that handoff first" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Hand it over" })).toBeNull();
    expect(screen.getByText("Opus agent holds the Write docs handoff")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Pull it" }));
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    await pasteAndJudge("Docs written.", "Met");
    expect(await screen.findByRole("heading", { name: "Opus agent holds it" })).toBeTruthy();
    expect((await loadFolder(storage)).assessments).toEqual([expect.objectContaining({ credentialSlug: "docs", result: "met" })]);
    expect(readPending(FOLDER)).toEqual([]);

    // The screen waits; its quiet way back names the test it held up.
    expect(within(screen.getByTestId("landing")).queryByRole("button", { name: "Home" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Hand over Code review" }));
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    await userEvent.click(copyButton());
    await screen.findByRole("heading", { name: "What came back" });
    expect(vi.mocked(writeText).mock.lastCall?.[0]).toContain("# Test: Code review");
    expect(readPending(FOLDER)).toEqual([expect.objectContaining({ credentialKey: "eng/review" })]);
  });

  it("a Met on a pulled handoff offers the go-to, and taking it marks that badge and goes back to the test it held up", async () => {
    await plug({ credentialKey: "eng/docs" }, docs);
    const storage = storageWith({ credentials: [review, docs], profiles: [opus] });
    renderApp(storage, both);
    await userEvent.click(await screen.findByRole("button", { name: "Pull it" }));
    await screen.findByRole("heading", { name: "What came back" });
    await pasteAndJudge("Docs written.", "Met");
    await screen.findByTestId("landing");
    expect(screen.getByRole("button", { name: "Hand over Code review" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Make Opus agent the go-to" }));
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    const made = Object.keys(storage.files()).filter((p) => p.startsWith(`${marksDir("eng", "docs")}/`));
    expect(made).toHaveLength(1);
    const [docsResult] = (await loadFolder(storage)).assessments;
    expect(JSON.parse(storage.file(made[0])!)).toEqual({ agent: "opus", result: docsResult.fileStem });
    expect(Object.keys(storage.files()).filter((p) => p.startsWith(`${marksDir("eng", "review")}/`))).toEqual([]);
  });

  it("Not yet on a pulled handoff goes on to the test it held up", async () => {
    await plug({ credentialKey: "eng/docs" }, docs);
    renderApp(storageWith({ credentials: [review, docs], profiles: [opus] }), both);
    await userEvent.click(await screen.findByRole("button", { name: "Pull it" }));
    await screen.findByRole("heading", { name: "What came back" });
    await pasteAndJudge("Not done.", "Not yet");
    await screen.findByRole("heading", { name: "Not yet" });
    expect(screen.queryByRole("button", { name: "Try another agent" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Hand over Code review" }));
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
  });

  it("entering from the re-test row with the agent plugged on another badge shows Pull that handoff first, never Hand it over", async () => {
    // A plug saved before handoffs still counts.
    await plug({ credentialKey: "eng/docs" }, docs);
    renderApp(storageWith({ credentials: [review, docs], profiles: [opus] }), both);
    expect(await screen.findByRole("heading", { name: "Pull that handoff first" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Hand it over" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("an agent holding a handoff for this badge opens straight to what came back", async () => {
    await plug({ credentialKey: "eng/review", handoff: { id: "skeleton", text: "as copied" } });
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), both);
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    expect(machine().querySelector(".cast-plugged .cast-card-label")?.textContent).toBe("S");
    cleanup();

    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await userEvent.click(await screen.findByRole("button", { name: "Opus agent" }));
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
  });

  it("Covers F2. Recording stores the plugged handoff's id and the text that was copied, even after the handoff was edited", async () => {
    await plug({ credentialKey: "eng/review", handoff: { id: A, text: "Handoff A as it was copied\n" } });
    const storage = storageWith({ credentials: [review], profiles: [opus], handoffs: [handoff(A, "Handoff A, edited since\n\n{{task}}\n")] });
    renderApp(storage, { ...both, resume: true });
    await screen.findByRole("heading", { name: "What came back" });
    await pasteAndJudge("Reviewed.", "Met");
    await screen.findByTestId("landing");
    const [saved] = (await loadFolder(storage)).assessments;
    expect(saved.handoff).toEqual({ id: A, text: "Handoff A as it was copied\n" });
    expect(readPending(FOLDER)).toEqual([]);
  });

  it("a plug lost between Copy and record still records the handoff that was copied", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus], handoffs: [handoffA] });
    renderApp(storage, both);
    await screen.findByRole("heading", { name: "Hand it over" });
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      await userEvent.click(copyButton());
      await screen.findByRole("heading", { name: "What came back" });
      expect(readPending(FOLDER)).toEqual([]);
      await pasteAndJudge("Reviewed.", "Not yet");
      await screen.findByRole("heading", { name: "Not yet" });
    } finally {
      blocked.mockRestore();
    }
    const [saved] = (await loadFolder(storage)).assessments;
    expect(saved.handoff).toEqual({ id: A, text: fillHandoff(handoffA.text, review) });
  });

  it("Covers AE6. Pull without a result ejects the handoff, writes nothing, and the agent can take a new one", async () => {
    await plug({ credentialKey: "eng/review", handoff: { id: "skeleton", text: "as copied" } });
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    const before = await snapshot(storage);
    renderApp(storage, { ...both, resume: true });
    await userEvent.click(await screen.findByRole("button", { name: "Pull without a result" }));
    await screen.findByRole("region", { name: "What needs you" });
    expect(readPending(FOLDER)).toEqual([]);
    expect(await snapshot(storage)).toEqual(before);
    cleanup();

    renderApp(storage, both);
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
  });

  it("Covers AE7. Copy again after a task edit re-copies the plugged handoff with the new task and keeps one plug", async () => {
    const edited = { ...review, task: "Review the diff twice.", rubric: "Finds the off-by-one." };
    await plug({ credentialKey: "eng/review", assignmentVersion: "an-older-version", handoff: { id: A, text: fillHandoff(handoffA.text, review) } });
    renderApp(storageWith({ credentials: [edited], profiles: [opus], handoffs: [handoffA, handoffB] }), { ...both, resume: true });
    await userEvent.click(await screen.findByRole("button", { name: "Copy again" }));
    expect(await screen.findByRole("textbox", { name: "Reply" })).toBeTruthy();

    const filled = fillHandoff(handoffA.text, edited);
    expect(vi.mocked(writeText).mock.calls[0][0]).toBe(filled);
    expect(filled).toContain("Review the diff twice.");
    expect(filled).not.toContain("Finds the off-by-one.");
    const plugs = readPending(FOLDER);
    expect(plugs).toHaveLength(1);
    expect(plugs[0]).toMatchObject({ assignmentVersion: await assignmentVersion(edited.task, edited.rubric), handoff: { id: A, text: filled } });
  });

  it("Copy again on a skeleton plug copies the skeleton as it is now", async () => {
    const skeleton = "The skeleton, edited\n\n{{task}}\n";
    await plug({ credentialKey: "eng/review", assignmentVersion: "an-older-version" });
    renderApp(storageWith({ credentials: [review], profiles: [opus], handoffs: [handoffA], skeleton }), { ...both, resume: true });
    await userEvent.click(await screen.findByRole("button", { name: "Copy again" }));
    await screen.findByRole("textbox", { name: "Reply" });
    expect(vi.mocked(writeText).mock.calls[0][0]).toBe(fillHandoff(skeleton, review));
    expect(readPending(FOLDER)[0].handoff).toEqual({ id: "skeleton", text: fillHandoff(skeleton, review) });
  });

  it("returning from editing a handoff lights that handoff, not the default", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], handoffs: [handoffA, handoffB] }), { ...both, handoffId: A });
    await screen.findByRole("heading", { name: "Hand it over" });
    expect(pressed()).toEqual(["A"]);
    await userEvent.click(copyButton());
    await screen.findByRole("heading", { name: "What came back" });
    expect(vi.mocked(writeText).mock.calls[0][0]).toBe(fillHandoff(handoffA.text, review));
  });

  it("Edit handoffs opens the box for the badge and comes back to the test with the pick lit", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], handoffs: [handoffA, handoffB] }), both);
    await screen.findByRole("heading", { name: "Hand it over" });
    await userEvent.click(key("A"));
    await userEvent.click(screen.getByRole("button", { name: "Edit handoffs" }));
    expect(await screen.findByRole("heading", { name: "Handoffs" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    expect(pressed()).toEqual(["A"]);
  });
});

// The screen after a Met waits and offers the go-to mark (go-to U3, R3, R5, R6, KTD6, KTD9).
describe("TestDeck's go-to offer after a Met", () => {
  const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5" };
  const OLD = "20260901T090000Z";
  const markOn = (profileSlug: string): Mark => ({ collectionSlug: "eng", credentialSlug: "review", id: "20260901T100000Z", profileSlug, fileStem: OLD });
  /** The badge's mark files, oldest first. */
  const marks = (storage: MemoryStorage) =>
    Object.keys(storage.files())
      .filter((p) => p.startsWith(`${marksDir("eng", "review")}/`))
      .sort();
  const markJson = (storage: MemoryStorage, path: string) => JSON.parse(storage.file(path)!);
  const landing = () => screen.getByTestId("landing");
  const primary = () => landing().querySelector<HTMLButtonElement>("button.primary");
  const atHome = () => screen.findByRole("heading", { name: "Home", level: 1 });
  const goToLine = async (line: string) => waitFor(async () => expect(within(await badgeCard()).getByText(line)).toBeTruthy());
  const stemOf = async (storage: MemoryStorage, handBack: string) => (await loadFolder(storage)).assessments.find((a) => a.handBack === handBack)!.fileStem;

  async function toLanding(storage: MemoryStorage, reply = "I reviewed it.") {
    renderApp(storage, fromBadge);
    await takeAndCopy();
    await pasteAndJudge(reply, "Met");
    await screen.findByTestId("landing");
  }

  /** Holds every mark write until the returned release runs. */
  function holdMarks(storage: MemoryStorage): () => void {
    const real = storage.writeText.bind(storage);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
      if (path.includes("/marks/")) await gate;
      return real(root, path, text);
    });
    return () => release();
  }

  it("after Met the screen stays up well past 1.4 s, focus on its heading, and offers Make Opus agent the go-to", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    await toLanding(storage);
    await act(() => new Promise((r) => setTimeout(r, 1600)));
    expect(landing()).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Opus agent holds it" }));
    expect(landing().querySelectorAll("button.primary")).toHaveLength(1);
    expect(primary()?.textContent).toBe("Make Opus agent the go-to");
    expect(within(landing()).getByRole("button", { name: "Home" }).className).toBe("ghost");
    expect(marks(storage)).toEqual([]);
  }, 10_000);

  it("Covers AE3. With Codex the go-to, Make Opus agent the go-to writes one mark on the new result, goes home, and Home names Opus agent", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus, codex], assessments: [await result(codex, review)], marks: [markOn("codex")] });
    const before = marks(storage);
    await toLanding(storage, "Opus reviewed it.");
    await userEvent.click(screen.getByRole("button", { name: "Make Opus agent the go-to" }));
    await atHome();

    const made = marks(storage).filter((p) => !before.includes(p));
    expect(made).toHaveLength(1);
    expect(markJson(storage, made[0])).toEqual({ agent: "opus", result: await stemOf(storage, "Opus reviewed it.") });
    await goToLine("Go-to: Opus agent");
  });

  it("Covers AE2. With Opus agent the go-to, a new Met offers Keep, and taking it writes a second mark on the new result", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [await result(opus, review)], marks: [markOn("opus")] });
    await toLanding(storage, "Again.");
    expect(screen.queryByRole("button", { name: "Make Opus agent the go-to" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Keep Opus agent as the go-to" }));
    await atHome();

    const all = marks(storage);
    expect(all).toHaveLength(2);
    expect(markJson(storage, all[1])).toEqual({ agent: "opus", result: await stemOf(storage, "Again.") });
    expect(markJson(storage, all[0])).toEqual({ agent: "opus", result: OLD });
    await goToLine("Go-to: Opus agent");
  });

  it.each([
    ["the quiet Home", () => userEvent.click(screen.getByRole("button", { name: "Home" }))],
    ["Escape", () => userEvent.keyboard("{Escape}")],
  ])("Covers AE2. %s after a Met writes no mark, goes home, and the go-to stays", async (_, leave) => {
    const storage = storageWith({ credentials: [review], profiles: [opus, codex], assessments: [await result(codex, review)], marks: [markOn("codex")] });
    const before = marks(storage);
    await toLanding(storage);
    await leave();
    await atHome();
    expect(marks(storage)).toEqual(before);
    await goToLine("Go-to: Codex agent");
  });

  it("a reload that removes the recorded result takes the offer away, and the quiet back still leaves", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    await toLanding(storage, "Gone soon.");
    const stem = await stemOf(storage, "Gone soon.");
    expect(primary()).not.toBeNull();
    storage.remove(assessmentPath("opus", "eng", "review", stem));
    fireEvent.focus(window);
    await waitFor(() => expect(primary()).toBeNull());
    expect(screen.getByRole("heading", { name: "Opus agent holds it" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    await atHome();
    expect(marks(storage)).toEqual([]);
  });

  it("a reload that removes the agent shows Not in the folder, not a fresh deck, and Escape goes home", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    await toLanding(storage);
    storage.remove(profilePath("opus"));
    fireEvent.focus(window);
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Who takes it" })).toBeNull();
    expect(screen.queryByRole("button", { name: /go-to/ })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await atHome();
  });

  it("a mark that fails to save shows the error inline, writes nothing, and stays on the screen", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    const real = storage.writeText.bind(storage);
    vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
      if (path.includes("/marks/")) throw new Error("disk full");
      return real(root, path, text);
    });
    await toLanding(storage);
    await userEvent.click(screen.getByRole("button", { name: "Make Opus agent the go-to" }));
    const alert = await within(landing()).findByRole("alert");
    expect(alert.textContent).toBe("disk full");
    expect(alert.classList.contains("deck-error")).toBe(true);
    expect(alert.nextElementSibling?.classList.contains("deck-actions")).toBe(true);
    expect(marks(storage)).toEqual([]);
    expect(screen.getByRole("heading", { name: "Opus agent holds it" })).toBeTruthy();
    expect(primary()?.disabled).toBe(false);
  });

  it("a double click on the primary writes one mark, and Escape while it saves does nothing", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    const release = holdMarks(storage);
    await toLanding(storage);
    const make = screen.getByRole("button", { name: "Make Opus agent the go-to" }) as HTMLButtonElement;
    await userEvent.dblClick(make);
    expect(make.disabled).toBe(true);
    expect((within(landing()).getByRole("button", { name: "Home" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(landing()).toBeTruthy();

    release();
    await atHome();
    expect(marks(storage)).toHaveLength(1);
  });
});

// The paste and judge cards as panes (U4, R7, R10, R12, R14, R19-R22, KTD9).
describe("TestDeck's paste and judge panes", () => {
  const withRubric: Credential = { ...review, rubric: "Finds the **off-by-one**." };
  const markdownReply = "# Findings{Enter}{Enter}- one{Enter}- two";
  const storedReply = "# Findings\n\n- one\n- two";

  async function toJudge(reply: string) {
    await userEvent.type(replyBox(), reply);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Did it meet it" })).toBeTruthy();
  }

  it("on What came back the reply box has focus and the top bar keeps only the window keys and the brand", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await screen.findByRole("heading", { name: "Who takes it" });
    expect(barActions()).toEqual(FOLDER_ACTIONS);
    await takeAndCopy();
    await waitFor(() => expect(document.activeElement).toBe(replyBox()));
    expect(testDeck().classList.contains("pane")).toBe(true);
    expect(barActions()).toEqual([]);
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Andamio Desktop, go home" })).toBeTruthy();
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Close window" })).toBeTruthy();
  });

  it("a test resumed at What came back opens with focus in the reply box", async () => {
    addPending(FOLDER, {
      profileSlug: "opus",
      credentialKey: "eng/review",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: await assignmentVersion(review.task, review.rubric),
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    });
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), { ...fromBadge, profileSlug: "opus", resume: true });
    await screen.findByRole("heading", { name: "What came back" });
    await waitFor(() => expect(document.activeElement).toBe(replyBox()));
    expect(barActions()).toEqual([]);
  });

  it("the drawing above the reply box is a strip of the full machine and the handoff box, the reply's first lines on its screen", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    const strip = machine().closest(".test-strip");
    expect(strip).not.toBeNull();
    expect(box().closest(".test-strip")).toBe(strip);
    // The strip sits above the reply box.
    expect(strip!.compareDocumentPosition(replyBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.type(replyBox(), "First line{Enter}second{Enter}third{Enter}fourth");
    // The dots run out first (SENDING_MS), then the screen shows the reply.
    await waitFor(() => expect([...machine().querySelectorAll(".cast-screen-reply text")].map((t) => t.textContent)).toEqual(["First line", "second", "third"]), {
      timeout: SENDING_MS + 1000,
    });
  });

  it("on Did it meet it the pasted reply shows rendered next to the rendered rubric, with Met the one main action", async () => {
    renderApp(storageWith({ credentials: [withRubric], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    await toJudge(markdownReply);

    expect(testDeck().classList.contains("pane")).toBe(true);
    expect(barActions()).toEqual([]);
    const reply = screen.getByRole("region", { name: "Reply" });
    const rubric = screen.getByRole("region", { name: "Rubric" });
    expect(within(reply).getByRole("heading", { name: "Findings" })).toBeTruthy();
    expect(within(reply).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["one", "two"]);
    expect(within(rubric).getByText("off-by-one").tagName).toBe("STRONG");
    // Side by side in one place, each scrolling on its own and reachable by keyboard.
    expect(reply.parentElement?.parentElement).toBe(rubric.parentElement?.parentElement);
    expect(reply.getAttribute("tabindex")).toBe("0");
    expect(rubric.getAttribute("tabindex")).toBe("0");
    // The reply no longer settles as a cut line above the card.
    expect(screen.getByRole("list", { name: "Answered" }).textContent).not.toContain("Findings");
    const main = testDeck().querySelectorAll("button.primary");
    expect([...main].map((b) => b.textContent)).toEqual(["Met"]);
    expect(screen.getByRole("button", { name: "Not yet" })).toBeTruthy();
  });

  it("with an empty rubric the judge card shows the reply and no rubric region", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    await toJudge("Reviewed it.");
    expect(within(screen.getByRole("region", { name: "Reply" })).getByText("Reviewed it.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Rubric" })).toBeNull();
  });

  it("the stored-text switch shows the reply and the rubric exactly as stored, and back", async () => {
    const storage = storageWith({ credentials: [withRubric], profiles: [opus] });
    renderApp(storage, fromBadge);
    await takeAndCopy();
    await toJudge(markdownReply);

    await userEvent.click(screen.getByRole("button", { name: "Show as stored" }));
    const reply = screen.getByRole("region", { name: "Reply" });
    expect(within(reply).queryByRole("heading")).toBeNull();
    expect(reply.querySelector("pre")?.textContent).toBe(storedReply);
    expect(screen.getByRole("region", { name: "Rubric" }).querySelector("pre")?.textContent).toBe("Finds the **off-by-one**.");

    await userEvent.click(screen.getByRole("button", { name: "Show formatted" }));
    expect(within(screen.getByRole("region", { name: "Reply" })).getByRole("heading", { name: "Findings" })).toBeTruthy();

    // What the switch showed is what the result keeps.
    await userEvent.click(screen.getByRole("button", { name: "Met" }));
    await screen.findByTestId("landing");
    expect((await loadFolder(storage)).assessments[0].handBack).toBe(storedReply);
  });

  it("Escape on Did it meet it goes back to What came back with the pasted reply still in the box", async () => {
    renderApp(storageWith({ credentials: [withRubric], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    await toJudge("Kept through Escape");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    expect(replyBox().value).toBe("Kept through Escape");
    await waitFor(() => expect(document.activeElement).toBe(replyBox()));
  });

  it("two more Escapes after a pasted reply leave the test deck open, and so does one more", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    await toJudge("Do not lose me");
    await userEvent.keyboard("{Escape}");
    await screen.findByRole("heading", { name: "What came back" });
    await waitFor(() => expect(document.activeElement).toBe(replyBox()));

    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    expect(testDeck()).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Hand it over" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(testDeck()).toBeTruthy();
    expect(screen.queryByRole("region", { name: "What needs you" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Agents" })).toBeNull();
  });

  it("with nothing pasted, Escape still leaves the test as before", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await screen.findByRole("heading", { name: "Who takes it" });
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("region", { name: "Agents" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Test an agent" })).toBeNull();
  });

  it("Escape in the reply box moves focus out of it and keeps the deck and the reply", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    await userEvent.type(replyBox(), "Half a thought");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "What came back" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
    expect(replyBox().value).toBe("Half a thought");
  });

  it("Met records the result as before, and the landing card brings back the full top bar", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, fromBadge);
    await takeAndCopy();
    await pasteAndJudge("I reviewed it.", "Met");
    expect(await screen.findByTestId("landing")).toBeTruthy();
    expect(barActions()).toEqual(FOLDER_ACTIONS);
    expect((await loadFolder(storage)).assessments).toEqual([expect.objectContaining({ profileSlug: "opus", result: "met", handBack: "I reviewed it." })]);
  });

  it("a reload that makes the waiting test stale still offers Copy again, on a page, and keeps the pasted reply for after", async () => {
    addPending(FOLDER, {
      profileSlug: "opus",
      credentialKey: "eng/review",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: await assignmentVersion(review.task, review.rubric),
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    });
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, { ...fromBadge, profileSlug: "opus", resume: true });
    await screen.findByRole("heading", { name: "What came back" });
    await userEvent.type(replyBox(), "Kept for after");

    await storage.writeText("data", credentialPath("eng", "review"), serializeCredentialMd({ ...review, task: "Review the diff twice." }));
    fireEvent.focus(window);
    expect(await screen.findByText("The task changed since you copied it")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy again" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull();
    expect(testDeck().classList.contains("pane")).toBe(false);
    expect(barActions()).toEqual(FOLDER_ACTIONS);

    // The reply is held, so Escape does not throw it away.
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("heading", { name: "What came back" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Copy again" }));
    expect((await screen.findByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement).value).toBe("Kept for after");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(within(await screen.findByRole("region", { name: "Reply" })).getByText("Kept for after")).toBeTruthy();
  });
});

// Jev's second opinion on the judge pane (U6, R6-R11, R13, KTD10, KTD11, KTD13, KTD19, KTD20).
describe("TestDeck's second opinion", () => {
  const graded: Credential = { ...review, rubric: "- Names the off-by-one\n- Points to the line\n- Suggests a fix" };
  const POINTS = ["Names the off-by-one", "Points to the line", "Suggests a fix"];
  const ANSWERS: JevAnswers = { answers: { p1: 0.94, p2: 0.52, p3: 0.12, overall: 0.38 } };
  const ALL_HIGH: JevAnswers = { answers: { p1: 0.95, p2: 0.92, p3: 0.97, overall: 0.93 } };
  const REPLY = "I found it on line 12.";
  const FIX_THE_KEY = "Jev Mode in the top bar, on home";
  const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5" };

  function renderWithJev(storage: MemoryStorage, fake: FakeJev, route: Route = fromBadge) {
    return render(
      <JevProvider jev={fake}>
        <FolderProvider storage={storage} folder={FOLDER}>
          <AppShell onChangeFolder={() => {}} initialRoute={route} />
        </FolderProvider>
      </JevProvider>,
    );
  }

  async function toJudge(reply = REPLY) {
    await userEvent.type(replyBox(), reply);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Did it meet it" });
  }

  /** Opus takes the badge from its page, and the reply reaches the judge pane. */
  async function judge(fake: FakeJev, { credential = graded, reply = REPLY, profiles = [opus] }: { credential?: Credential; reply?: string; profiles?: typeof opus[] } = {}) {
    const storage = storageWith({ credentials: [credential], profiles });
    renderWithJev(storage, fake);
    await takeAndCopy();
    await toJudge(reply);
    return storage;
  }

  /** An ask that waits until the test answers it. */
  function held(fake: FakeJev) {
    let answer!: (a: JevAnswers) => void;
    let fail!: (e: JevError) => void;
    fake.queue("ask", new Promise<JevAnswers>((resolve, reject) => ((answer = resolve), (fail = reject))));
    return { answer, fail };
  }

  const choice = (name: "Met" | "Not yet") => screen.getByRole("button", { name }) as HTMLButtonElement;
  const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
  const askAction = () => screen.queryByRole("button", { name: /^(Ask Jev|Check with Jev|Asking Jev…)$/ });
  const reading = () => screen.queryByRole("region", { name: "Jev's reading" });
  const readingRows = () => within(reading()!).getAllByRole("listitem");
  const saved = async (storage: MemoryStorage) => (await loadFolder(storage)).assessments;
  const settle = () => act(async () => {});

  it("Covers AE1. With Jev Mode off, Met saves at once, no ask or check renders, and nothing is asked", async () => {
    const fake = new FakeJev();
    const storage = await judge(fake);
    expect(askAction()).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(choice("Met").classList.contains("primary")).toBe(true);
    expect(choice("Met").hasAttribute("aria-pressed")).toBe(false);

    await userEvent.click(choice("Met"));
    expect(await screen.findByTestId("landing")).toBeTruthy();
    const [a] = await saved(storage);
    expect(a.result).toBe("met");
    expect(a.jev).toBeUndefined();
    expect(fake.asks).toEqual([]);
  });

  it("Covers AE2. With Jev Mode on and an empty rubric, there is no Ask Jev and Met saves at once", async () => {
    const fake = new FakeJev(FAKE_ON);
    const storage = await judge(fake, { credential: review });
    expect(askAction()).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await userEvent.click(choice("Met"));
    expect(await screen.findByTestId("landing")).toBeTruthy();
    expect((await saved(storage))[0]).toMatchObject({ result: "met" });
    expect(fake.asks).toEqual([]);
  });

  it("in a Jev round Met and Not yet are choices, only Save is an ink block, and Save waits for a pick", async () => {
    await judge(new FakeJev(FAKE_ON));
    expect([...testDeck().querySelectorAll("button.primary")].map((b) => b.textContent)).toEqual(["Save"]);
    expect(choice("Met").getAttribute("aria-pressed")).toBe("false");
    expect(choice("Not yet").getAttribute("aria-pressed")).toBe("false");
    expect(save().disabled).toBe(true);
    expect(button("Ask Jev")).toBeTruthy();

    await userEvent.click(choice("Met"));
    expect(screen.queryByTestId("landing")).toBeNull();
    expect(choice("Met").getAttribute("aria-pressed")).toBe("true");
    expect(save().disabled).toBe(false);
    expect(button("Check with Jev")).toBeTruthy();
    expect([...testDeck().querySelectorAll("button.primary")].map((b) => b.textContent)).toEqual(["Save"]);
  });

  it("Covers AE3. Not yet, Check with Jev reading every point above 0.9, then Met and Save records Met with the reading seen after and changed", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", ALL_HIGH);
    const storage = await judge(fake);
    await userEvent.click(choice("Not yet"));
    await userEvent.click(button("Check with Jev"));
    expect(await screen.findByRole("region", { name: "Jev's reading" })).toBeTruthy();
    expect(askAction()).toBeNull();
    await userEvent.click(choice("Met"));
    await userEvent.click(save());

    expect(await screen.findByTestId("landing")).toBeTruthy();
    const [a] = await saved(storage);
    expect(a.result).toBe("met");
    expect(a.jev).toEqual({
      model: "jev-1.13.0",
      assignmentVersion: await assignmentVersion(graded.task, graded.rubric),
      askedAt: expect.any(String),
      seen: "after",
      verdictWhenSeen: "not_met",
      verdictChanged: true,
      overall: 0.93,
      points: [
        { text: POINTS[0], probability: 0.95 },
        { text: POINTS[1], probability: 0.92 },
        { text: POINTS[2], probability: 0.97 },
      ],
    });
    expect(new Date(a.jev!.askedAt).toISOString()).toBe(a.jev!.askedAt);
    expect(fake.asks).toEqual([expect.objectContaining({ kind: "secondOpinion", state: expect.objectContaining({ reply: REPLY, rubric_points: POINTS }) })]);
  });

  it("a verdict kept after the check saves as seen after and unchanged", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", ANSWERS);
    const storage = await judge(fake);
    await userEvent.click(choice("Not yet"));
    await userEvent.click(button("Check with Jev"));
    await screen.findByRole("region", { name: "Jev's reading" });
    await userEvent.click(save());
    await screen.findByRole("heading", { name: "Not yet" });
    expect((await saved(storage))[0]).toMatchObject({ result: "not_met", jev: { seen: "after", verdictWhenSeen: "not_met", verdictChanged: false } });
  });

  it("asked before a pick, then picked and saved, the reading is seen before with no change fields", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", ANSWERS);
    const storage = await judge(fake);
    await userEvent.click(button("Ask Jev"));
    await screen.findByRole("region", { name: "Jev's reading" });
    await userEvent.click(choice("Met"));
    expect(askAction()).toBeNull();
    await userEvent.click(save());
    await screen.findByTestId("landing");
    const [a] = await saved(storage);
    expect(a.jev).toMatchObject({ seen: "before", overall: 0.38 });
    expect(a.jev).not.toHaveProperty("verdictWhenSeen");
    expect(a.jev).not.toHaveProperty("verdictChanged");
  });

  it("Covers AE4. The reading shows three points as percentages and the overall, marks the 0.52 point to sharpen, and sits in the rubric column in a polite live region", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", ANSWERS);
    await judge(fake);
    await userEvent.click(button("Ask Jev"));
    const panel = await screen.findByRole("region", { name: "Jev's reading" });
    expect(readingRows().map((li) => li.querySelector(".jev-point-text")?.textContent)).toEqual(POINTS);
    expect(readingRows().map((li) => li.querySelector(".jev-p")?.textContent)).toEqual(["94%", "52%", "12%"]);
    expect(readingRows().map((li) => within(li).queryByText("Can't call: sharpen this point") !== null)).toEqual([false, true, false]);
    expect(panel.querySelector(".jev-overall .jev-p")?.textContent).toBe("38%");
    expect(within(panel).getByText("Jev can't call the whole bar")).toBeTruthy();

    // Below the rubric, in its column, and announced politely.
    const rubric = screen.getByRole("region", { name: "Rubric" });
    expect(panel.closest(".meet-text-rubric")).toBe(rubric.closest(".meet-text-rubric"));
    expect(rubric.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it("Covers AE5. An unreachable Jev shows one line, the ask can be tried again, and Save records the result without a reading", async () => {
    const fake = new FakeJev(FAKE_ON);
    const ask = held(fake);
    const storage = await judge(fake);
    await userEvent.click(button("Ask Jev"));
    expect(button("Asking Jev…").disabled).toBe(true);
    await act(async () => ask.fail(new JevError("unreachable")));

    const line = await screen.findByText("Jev couldn't be reached.");
    expect(line.closest('[aria-live="polite"]')).not.toBeNull();
    expect(line.getAttribute("role")).toBeNull();
    expect(screen.queryAllByText(/Jev/, { selector: ".deck-error" })).toHaveLength(1);
    expect(reading()).toBeNull();
    expect(button("Ask Jev").disabled).toBe(false);

    await userEvent.click(choice("Not yet"));
    await userEvent.click(save());
    await screen.findByRole("heading", { name: "Not yet" });
    const [a] = await saved(storage);
    expect(a).toMatchObject({ result: "not_met", handBack: REPLY });
    expect(a.jev).toBeUndefined();
  });

  it("a key refused names where to fix it, hides the ask for the rest of the round, and Save still records without a reading", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", new JevError("keyRefused"));
    const storage = await judge(fake);
    await userEvent.click(button("Ask Jev"));
    const line = await screen.findByText((text, el) => el?.classList.contains("deck-error") === true && text.includes(FIX_THE_KEY));
    expect(line.textContent).toContain("refused");
    expect(askAction()).toBeNull();

    // Still hidden after going back to the reply and returning.
    await userEvent.click(button("Back"));
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Did it meet it" });
    expect(askAction()).toBeNull();
    await userEvent.click(choice("Met"));
    expect(askAction()).toBeNull();
    await userEvent.click(save());
    await screen.findByTestId("landing");
    expect((await saved(storage))[0].jev).toBeUndefined();
    expect(fake.asks).toHaveLength(1);
  });

  it("a key missing during Check with Jev keeps Save and the choices as they were", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", new JevError("keyMissing"));
    const storage = await judge(fake);
    await userEvent.click(choice("Not yet"));
    await userEvent.click(button("Check with Jev"));
    const line = await screen.findByText((text, el) => el?.classList.contains("deck-error") === true && text.includes(FIX_THE_KEY));
    expect(line.textContent).not.toContain("refused");
    expect(askAction()).toBeNull();
    expect(choice("Not yet").getAttribute("aria-pressed")).toBe("true");
    expect(choice("Met").getAttribute("aria-pressed")).toBe("false");
    expect(choice("Met").classList.contains("primary")).toBe(false);
    expect(save().disabled).toBe(false);
    await userEvent.click(save());
    await screen.findByRole("heading", { name: "Not yet" });
    expect((await saved(storage))[0]).toMatchObject({ result: "not_met" });
  });

  it("an answer that is not a full reading fails like any other ask, and a retry can land", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", { answers: { p1: 0.9, p2: 0.8, p3: 0.7 } });
    fake.queue("ask", ANSWERS);
    await judge(fake);
    await userEvent.click(button("Ask Jev"));
    expect(await screen.findByText("Jev couldn't answer.")).toBeTruthy();
    expect(reading()).toBeNull();
    await userEvent.click(button("Ask Jev"));
    expect(await screen.findByRole("region", { name: "Jev's reading" })).toBeTruthy();
    expect(screen.queryByText("Jev couldn't answer.")).toBeNull();
  });

  it("a folder reload that empties the rubric after a pick keeps Save and the pick", async () => {
    const fake = new FakeJev(FAKE_ON);
    const storage = await judge(fake);
    await userEvent.click(choice("Met"));
    await storage.writeText("data", credentialPath("eng", "review"), serializeCredentialMd({ ...graded, rubric: "" }));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Rubric" })).toBeNull());
    expect(askAction()).toBeNull();
    expect(choice("Met").getAttribute("aria-pressed")).toBe("true");
    expect(save().disabled).toBe(false);
    await userEvent.click(save());
    await screen.findByTestId("landing");
    expect((await saved(storage))[0]).toMatchObject({ result: "met" });
  });

  it("a reload that changes the assignment drops the reading, and the result saves without it", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", ANSWERS);
    const storage = await judge(fake);
    await userEvent.click(button("Ask Jev"));
    await screen.findByRole("region", { name: "Jev's reading" });
    await storage.writeText("data", credentialPath("eng", "review"), serializeCredentialMd({ ...graded, rubric: `${graded.rubric}\n- Adds a test` }));
    fireEvent.focus(window);
    await waitFor(() => expect(reading()).toBeNull());
    expect(await screen.findByRole("button", { name: "Ask Jev" })).toBeTruthy();
    await userEvent.click(choice("Met"));
    await userEvent.click(save());
    await screen.findByTestId("landing");
    expect((await saved(storage))[0].jev).toBeUndefined();
  });

  it("Save pressed while a check is in flight saves without the reading, and the late answer changes nothing", async () => {
    const fake = new FakeJev(FAKE_ON);
    const ask = held(fake);
    const storage = await judge(fake);
    await userEvent.click(choice("Not yet"));
    await userEvent.click(button("Check with Jev"));
    expect(button("Asking Jev…").disabled).toBe(true);
    expect(save().disabled).toBe(false);
    await userEvent.click(save());
    await screen.findByRole("heading", { name: "Not yet" });
    const before = await snapshot(storage);
    expect((await saved(storage))[0].jev).toBeUndefined();

    await act(async () => ask.answer(ALL_HIGH));
    await settle();
    expect(await snapshot(storage)).toEqual(before);
    expect(reading()).toBeNull();
    expect(screen.getByRole("heading", { name: "Not yet" })).toBeTruthy();
  });

  it("a double click on Ask Jev sends one request, and the action reads Asking Jev… until the answer arrives", async () => {
    const fake = new FakeJev(FAKE_ON);
    const ask = held(fake);
    await judge(fake);
    await userEvent.dblClick(button("Ask Jev"));
    expect(fake.asks).toHaveLength(1);
    expect(button("Asking Jev…").disabled).toBe(true);
    await act(async () => ask.answer(ANSWERS));
    expect(await screen.findByRole("region", { name: "Jev's reading" })).toBeTruthy();
    expect(askAction()).toBeNull();
    expect(fake.asks).toHaveLength(1);
  });

  it("going Back and returning without an edit keeps the reading, and an edit to the reply drops it", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", ANSWERS);
    await judge(fake);
    await userEvent.click(button("Ask Jev"));
    await screen.findByRole("region", { name: "Jev's reading" });

    await userEvent.click(button("Back"));
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Did it meet it" });
    expect(reading()).not.toBeNull();
    expect(askAction()).toBeNull();
    expect(fake.asks).toHaveLength(1);

    await userEvent.click(button("Back"));
    await userEvent.type(await screen.findByRole("textbox", { name: "Reply" }), " And a fix.");
    await userEvent.click(button("Next"));
    await screen.findByRole("heading", { name: "Did it meet it" });
    expect(reading()).toBeNull();
    expect(button("Ask Jev")).toBeTruthy();
  });

  it("an edit while a check is in flight drops it, so its answer never shows against the new reply", async () => {
    const fake = new FakeJev(FAKE_ON);
    const ask = held(fake);
    await judge(fake);
    await userEvent.click(button("Ask Jev"));
    await userEvent.click(button("Back"));
    await userEvent.type(await screen.findByRole("textbox", { name: "Reply" }), " And a fix.");
    await act(async () => ask.answer(ANSWERS));
    await userEvent.click(button("Next"));
    await screen.findByRole("heading", { name: "Did it meet it" });
    expect(reading()).toBeNull();
    expect(button("Ask Jev").disabled).toBe(false);
  });

  it("Try another starts the next round with no verdict and no reading", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", ANSWERS);
    await judge(fake, { profiles: [opus, codex] });
    await userEvent.click(button("Ask Jev"));
    await screen.findByRole("region", { name: "Jev's reading" });
    await userEvent.click(choice("Not yet"));
    await userEvent.click(save());
    await userEvent.click(await screen.findByRole("button", { name: "Try another agent" }));
    await userEvent.click(await screen.findByRole("button", { name: "Codex agent" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    await screen.findByRole("heading", { name: "What came back" });
    await toJudge(REPLY);

    expect(reading()).toBeNull();
    expect(choice("Met").getAttribute("aria-pressed")).toBe("false");
    expect(choice("Not yet").getAttribute("aria-pressed")).toBe("false");
    expect(save().disabled).toBe(true);
    expect(button("Ask Jev").disabled).toBe(false);
  });

  it("a check still in flight when the round ends never lands in the next one", async () => {
    const fake = new FakeJev(FAKE_ON);
    const ask = held(fake);
    await judge(fake, { profiles: [opus, codex] });
    await userEvent.click(choice("Not yet"));
    await userEvent.click(button("Check with Jev"));
    await userEvent.click(save());
    await userEvent.click(await screen.findByRole("button", { name: "Try another agent" }));
    await userEvent.click(await screen.findByRole("button", { name: "Codex agent" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    await screen.findByRole("heading", { name: "What came back" });
    await toJudge(REPLY);
    expect(button("Ask Jev").disabled).toBe(false);

    await act(async () => ask.answer(ALL_HIGH));
    await settle();
    expect(reading()).toBeNull();
    expect(button("Ask Jev").disabled).toBe(false);
  });

  it("a reply over Jev's budget says so, offers no ask, and Met saves at once", async () => {
    const fake = new FakeJev(FAKE_ON);
    const storage = storageWith({ credentials: [graded], profiles: [opus] });
    renderWithJev(storage, fake);
    await takeAndCopy();
    fireEvent.change(replyBox(), { target: { value: "x".repeat(130_000) } });
    await userEvent.click(button("Next"));
    await screen.findByRole("heading", { name: "Did it meet it" });

    expect(screen.getByText("This reply is too long for Jev")).toBeTruthy();
    expect(askAction()).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(choice("Met").classList.contains("primary")).toBe(true);
    await userEvent.click(choice("Met"));
    expect(await screen.findByTestId("landing")).toBeTruthy();
    expect((await saved(storage))[0]).toMatchObject({ result: "met" });
    expect(fake.asks).toEqual([]);
  });

  it("the choices and the ask are disabled while the save runs", async () => {
    const fake = new FakeJev(FAKE_ON);
    const storage = await judge(fake);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = storage.writeText.bind(storage);
    vi.spyOn(storage, "writeText").mockImplementation(async (...args) => {
      await gate;
      return real(...args);
    });
    await userEvent.click(choice("Met"));
    await userEvent.click(save());
    expect(choice("Met").disabled).toBe(true);
    expect(choice("Not yet").disabled).toBe(true);
    expect(button("Check with Jev").disabled).toBe(true);
    release();
    expect(await screen.findByTestId("landing")).toBeTruthy();
  });

  it("each failure kind has its own line, carries no outside text, and only what a retry can't fix takes the ask away", () => {
    const lines = JEV_ERROR_KINDS.map((kind) => jevFailure(new JevError(kind)));
    expect(new Set(lines.map((l) => l.line)).size).toBe(lines.length);
    for (const { line } of lines) expect(line).not.toContain("Jev: ");
    const byKind = Object.fromEntries(JEV_ERROR_KINDS.map((kind, i) => [kind, lines[i]]));
    expect(byKind.keyRefused.line).toContain(FIX_THE_KEY);
    expect(byKind.keyMissing.line).toContain(FIX_THE_KEY);
    expect(byKind.rateLimited.line).toContain("Try again in a moment");
    expect(byKind.unreachable.line).toBe("Jev couldn't be reached.");
    expect(JEV_ERROR_KINDS.filter((kind) => !byKind[kind].retry)).toEqual(["off", "keyMissing", "keyRefused", "tooLong", "invalidKey"]);
    expect(jevFailure(new JevError("other", { status: 502 })).line).toBe("Jev couldn't answer (502).");
    expect(jevFailure(new JevError("rateLimited", { retryAfter: 30 })).line).toBe(byKind.rateLimited.line);
  });
});

// Jev's cleanup of a terminal paste on the paste pane (U9, R15, R18-R21, F3, KTD17, KTD18, KTD20).
describe("TestDeck's paste cleanup", () => {
  /** A Claude Code copy: a marker, a two-space gutter, and a list item the terminal tore. */
  const TERMINAL = "⏺ Fixed two things:\n  - the stale flag on the\n    badge page\n  - the next item";
  /** What the paste puts in the box: the marker and the gutter gone, the torn line kept. */
  const FIXED = "Fixed two things:\n- the stale flag on the\n  badge page\n- the next item";
  const JOINED = "Fixed two things:\n- the stale flag on the badge page\n- the next item";
  const JOIN: JevAnswers = { answers: { L003: 0.9 } };
  const KEEP: JevAnswers = { answers: { L003: 0.1 } };
  const FIX_THE_KEY = "Jev Mode in the top bar, on home";
  const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5" };

  function renderWithJev(storage: MemoryStorage, fake: FakeJev) {
    return render(
      <JevProvider jev={fake}>
        <FolderProvider storage={storage} folder={FOLDER}>
          <AppShell onChangeFolder={() => {}} initialRoute={fromBadge} />
        </FolderProvider>
      </JevProvider>,
    );
  }

  /** Opus takes the badge, and the deck waits at What came back. */
  async function toPaste(fake: FakeJev, profiles = [opus]) {
    const storage = storageWith({ credentials: [review], profiles });
    renderWithJev(storage, fake);
    await takeAndCopy();
    return storage;
  }

  function held(fake: FakeJev) {
    let answer!: (a: JevAnswers) => void;
    fake.queue("ask", new Promise<JevAnswers>((resolve) => (answer = resolve)));
    return { answer };
  }

  const paste = (text: string) => firePaste(replyBox(), { "text/plain": text });
  const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
  const cleanUp = () => screen.queryByRole("button", { name: /^(Clean up with Jev|Cleaning up…)$/ }) as HTMLButtonElement | null;
  const putBack = () => screen.queryByRole("button", { name: "Put back the paste" });
  const next = () => button("Next");
  const settle = () => act(async () => {});

  it("Covers AE6. With Jev usable, a terminal paste into an empty box offers the cleanup, which joins the torn line and is what saves", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", JOIN);
    const storage = await toPaste(fake);
    paste(TERMINAL);
    expect(replyBox().value).toBe(FIXED);
    expect(fake.asks).toEqual([]);

    await userEvent.click(cleanUp()!);
    expect(await screen.findByRole("button", { name: "Put back the paste" })).toBeTruthy();
    expect(replyBox().value).toBe(JOINED);
    expect(cleanUp()).toBeNull();
    expect(fake.asks).toEqual([
      {
        kind: "lineBreaks",
        state: "L001| Fixed two things:\nL002| - the stale flag on the\nL003|   badge page\nL004| - the next item",
        questions: { L003: expect.objectContaining({ type: "noul", instructions: expect.stringContaining("Does line L003 pick up mid-sentence") }) },
      },
    ]);

    await userEvent.click(next());
    await screen.findByRole("heading", { name: "Did it meet it" });
    await userEvent.click(button("Met"));
    expect(await screen.findByTestId("landing")).toBeTruthy();
    expect((await loadFolder(storage)).assessments[0].handBack).toBe(JOINED);
  });

  it("Put back the paste stays offered until the user types, restores what the paste first produced, and the cleanup is offered again", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", JOIN);
    fake.queue("ask", JOIN);
    await toPaste(fake);
    paste(TERMINAL);
    await userEvent.click(cleanUp()!);
    await screen.findByRole("button", { name: "Put back the paste" });

    // Judging and coming back is no edit.
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "What came back" });
    expect(replyBox().value).toBe(JOINED);
    await userEvent.click(button("Put back the paste"));
    expect(replyBox().value).toBe(FIXED);
    expect(putBack()).toBeNull();
    expect(cleanUp()?.textContent).toBe("Clean up with Jev");

    await userEvent.click(cleanUp()!);
    await screen.findByRole("button", { name: "Put back the paste" });
    expect(replyBox().value).toBe(JOINED);

    // Typing ends both offers.
    await userEvent.type(replyBox(), " Done.");
    expect(replyBox().value).toBe(`${JOINED} Done.`);
    expect(putBack()).toBeNull();
    expect(cleanUp()).toBeNull();
  });

  it("a Claude Code paste with no candidates left after the fixes offers no cleanup", async () => {
    const fake = new FakeJev(FAKE_ON);
    await toPaste(fake);
    paste("⏺ Done.\n\n⏺ Saved the result.\n\n  ⎿  Wrote 3 lines");
    expect(replyBox().value).toBe("Done.\n\nSaved the result.\n\n   Wrote 3 lines");
    expect(cleanUp()).toBeNull();
  });

  it("a cleanup that joins nothing says Nothing to join and offers no put-back", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", KEEP);
    await toPaste(fake);
    paste(TERMINAL);
    await userEvent.click(cleanUp()!);
    expect(await screen.findByText("Nothing to join")).toBeTruthy();
    expect(replyBox().value).toBe(FIXED);
    expect(putBack()).toBeNull();
    expect(cleanUp()).toBeNull();
  });

  it("while a cleanup runs, its action reads Cleaning up…, Next is disabled, and the line beside Next says why", async () => {
    const fake = new FakeJev(FAKE_ON);
    const ask = held(fake);
    await toPaste(fake);
    paste(TERMINAL);
    expect(next().disabled).toBe(false);
    await userEvent.dblClick(cleanUp()!);
    expect(fake.asks).toHaveLength(1);
    expect(cleanUp()?.textContent).toBe("Cleaning up…");
    expect(cleanUp()?.disabled).toBe(true);
    expect(next().disabled).toBe(true);
    const why = screen.getByText("Waiting for Jev");
    // The body's last line, so it sits just above Next.
    expect(why.parentElement?.lastElementChild).toBe(why);
    expect(why.closest(".deck-body")).not.toBeNull();

    await act(async () => ask.answer(JOIN));
    expect(await screen.findByRole("button", { name: "Put back the paste" })).toBeTruthy();
    expect(next().disabled).toBe(false);
    expect(screen.queryByText("Waiting for Jev")).toBeNull();
  });

  it("an answer that lands after the user typed changes nothing", async () => {
    const fake = new FakeJev(FAKE_ON);
    const ask = held(fake);
    await toPaste(fake);
    paste(TERMINAL);
    await userEvent.click(cleanUp()!);
    await userEvent.type(replyBox(), " More.");
    expect(next().disabled).toBe(false);
    await act(async () => ask.answer(JOIN));
    await settle();
    expect(replyBox().value).toBe(`${FIXED} More.`);
    expect(putBack()).toBeNull();
    expect(cleanUp()).toBeNull();
  });

  it("an answer that lands after Back unmounted the editor changes nothing, and the cleanup is offered again on return", async () => {
    const fake = new FakeJev(FAKE_ON);
    const ask = held(fake);
    await toPaste(fake);
    paste(TERMINAL);
    await userEvent.click(cleanUp()!);
    await userEvent.click(button("Back"));
    await screen.findByRole("heading", { name: "Hand it over" });
    await act(async () => ask.answer(JOIN));
    await settle();

    await userEvent.click(button("Copy"));
    await screen.findByRole("heading", { name: "What came back" });
    expect(replyBox().value).toBe(FIXED);
    expect(putBack()).toBeNull();
    expect(cleanUp()?.textContent).toBe("Clean up with Jev");
    expect(cleanUp()?.disabled).toBe(false);
    expect(next().disabled).toBe(false);
    expect(fake.asks).toHaveLength(1);
  });

  it("a 429 on the batch waits, retries and then the cleanup applies", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", new JevError("rateLimited", { retryAfter: 0 }));
    fake.queue("ask", JOIN);
    await toPaste(fake);
    paste(TERMINAL);
    await userEvent.click(cleanUp()!);
    expect(await screen.findByRole("button", { name: "Put back the paste" })).toBeTruthy();
    expect(replyBox().value).toBe(JOINED);
    expect(fake.asks).toHaveLength(2);
  });

  it("a batch that still fails after its retries shows one line, applies nothing, and can be tried again", async () => {
    const fake = new FakeJev(FAKE_ON);
    for (let i = 0; i < 4; i++) fake.queue("ask", new JevError("overloaded", { retryAfter: 0 }));
    fake.queue("ask", JOIN);
    await toPaste(fake);
    paste(TERMINAL);
    await userEvent.click(cleanUp()!);
    const line = jevFailure(new JevError("overloaded")).line;
    expect(await screen.findByText(line)).toBeTruthy();
    expect(fake.asks).toHaveLength(4);
    expect(replyBox().value).toBe(FIXED);
    expect(putBack()).toBeNull();
    expect(next().disabled).toBe(false);

    await userEvent.click(cleanUp()!);
    await screen.findByRole("button", { name: "Put back the paste" });
    expect(screen.queryByText(line)).toBeNull();
    expect(replyBox().value).toBe(JOINED);
  });

  it("a key refused names where to fix it and takes the cleanup away, leaving the paste as it was", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", new JevError("keyRefused"));
    await toPaste(fake);
    paste(TERMINAL);
    await userEvent.click(cleanUp()!);
    expect((await screen.findByText(/TypeSafe refused the key/)).textContent).toContain(FIX_THE_KEY);
    expect(cleanUp()).toBeNull();
    // The line stands alone, with no empty helper row under it.
    expect(testDeck().querySelector(".deck-body .helper-status")).toBeNull();
    expect(replyBox().value).toBe(FIXED);
    expect(fake.asks).toHaveLength(1);
  });

  it("with Jev Mode off, a terminal paste still gets the fixes and offers no cleanup", async () => {
    const fake = new FakeJev();
    await toPaste(fake);
    paste(TERMINAL);
    expect(replyBox().value).toBe(FIXED);
    expect(cleanUp()).toBeNull();
    expect(fake.asks).toEqual([]);
  });

  it("a paste into a box that already held text offers no cleanup", async () => {
    const fake = new FakeJev(FAKE_ON);
    await toPaste(fake);
    await userEvent.type(replyBox(), "Notes: ");
    paste(TERMINAL);
    expect(replyBox().value).toBe(`Notes: ${FIXED}`);
    expect(cleanUp()).toBeNull();
  });

  it("a paste too long for Jev says so and offers no cleanup", async () => {
    const fake = new FakeJev(FAKE_ON);
    await toPaste(fake);
    const line = "  the badge page kept showing the stale flag after a result was";
    paste(Array.from({ length: 2500 }, () => line).join("\n"));
    expect(screen.getByText("This reply is too long for Jev")).toBeTruthy();
    expect(cleanUp()).toBeNull();
    expect(fake.asks).toEqual([]);
  });

  it("Try another clears the cleanup, so the next round starts with no offer", async () => {
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", JOIN);
    await toPaste(fake, [opus, codex]);
    paste(TERMINAL);
    await userEvent.click(cleanUp()!);
    await screen.findByRole("button", { name: "Put back the paste" });
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole("button", { name: "Not yet" }));
    await userEvent.click(await screen.findByRole("button", { name: "Try another agent" }));
    await userEvent.click(await screen.findByRole("button", { name: "Codex agent" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    await screen.findByRole("heading", { name: "What came back" });
    expect(replyBox().value).toBe("");
    expect(putBack()).toBeNull();
    expect(cleanUp()).toBeNull();
    expect(screen.queryByText("Nothing to join")).toBeNull();
  });
});
