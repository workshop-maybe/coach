// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { loadFolder } from "../domain/folder";
import { BUILT_IN_HANDOFF, fillHandoff } from "../domain/handoffs";
import { assignmentVersion } from "../domain/hash";
import type { Credential, Handoff } from "../domain/types";
import { addPending, readPending, type PendingTest } from "./pendingTests";
import { LANDING_MS, SENDING_MS } from "./TestDeck";
import { FOLDER, opus, renderApp, result, review, snapshot, storageWith } from "./testFolder";

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

describe("TestDeck", () => {
  it("four beats record a met result, the badge lands on the agent, then home", async () => {
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

    const held = await waitFor(badgeCard, { timeout: LANDING_MS + 4000 });
    expect(within(held).getByText("Opus agent")).toBeTruthy();
  });

  it("Covers AE4. Not yet records not met with no landing, and the badge still has no holders", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, fromBadge);
    await takeAndCopy();
    await pasteAndJudge("I tried.", "Not yet");

    expect(await screen.findByRole("heading", { name: "Not yet" })).toBeTruthy();
    expect(screen.queryByTestId("landing")).toBeNull();
    expect((await loadFolder(storage)).assessments).toEqual([expect.objectContaining({ result: "not_met", handBack: "I tried." })]);

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
    expect(await screen.findByText("Finds the off-by-one.")).toBeTruthy();
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

    expect(await screen.findByRole("heading", { name: "Hand it over" }, { timeout: LANDING_MS + 4000 })).toBeTruthy();
    await userEvent.click(copyButton());
    await screen.findByRole("heading", { name: "What came back" });
    expect(vi.mocked(writeText).mock.lastCall?.[0]).toContain("# Test: Code review");
    expect(readPending(FOLDER)).toEqual([expect.objectContaining({ credentialKey: "eng/review" })]);
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
