// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { loadFolder } from "../domain/folder";
import { assignmentVersion } from "../domain/hash";
import { addPending, readPending } from "./pendingTests";
import { LANDING_MS, SENDING_MS } from "./TestDeck";
import { FOLDER, opus, renderApp, result, review, storageWith } from "./testFolder";

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
    });

    await pasteAndJudge("I reviewed it.", "Met");
    expect(await screen.findByTestId("landing")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Opus agent holds it" })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(state.assessments).toEqual([expect.objectContaining({ profileSlug: "opus", result: "met", handBack: "I reviewed it." })]);
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

  it("hand it over loads the cartridge, Copy sends then waits, and the reply shows on the screen", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await userEvent.click(await screen.findByRole("button", { name: "Opus agent" }));
    await screen.findByRole("heading", { name: "Hand it over" });
    expect(machine().getAttribute("data-screen")).toBe("idle");
    await waitFor(() => expect(machine().querySelector(".cast-loaded image.cast-label")).not.toBeNull());

    let release!: () => void;
    vi.mocked(writeText).mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(machine().getAttribute("data-screen")).toBe("sending");
    release();
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    await waitFor(() => expect(machine().getAttribute("data-screen")).toBe("waiting"), { timeout: SENDING_MS + 1000 });
    expect(machine().querySelector(".cast-loaded")).not.toBeNull();

    await userEvent.type(screen.getByRole("textbox", { name: "Reply" }), "First line{Enter}second{Enter}third{Enter}fourth");
    const lines = [...machine().querySelectorAll(".cast-screen-reply text")].map((t) => t.textContent);
    expect(lines).toEqual(["First line", "second", "third"]);
  });

  it("Met ejects the cartridge and lights the agent's key", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), fromBadge);
    await takeAndCopy();
    await pasteAndJudge("Done.", "Met");
    const landing = await screen.findByTestId("landing");
    const drawn = landing.querySelector("svg.cast-machine")!;
    expect(drawn.classList.contains("cast-ejecting")).toBe(true);
    await waitFor(() => expect(drawn.querySelector('[data-credential="eng/review"]')?.getAttribute("data-key")).toBe("lit"));
    expect(drawn.querySelector('[data-credential="eng/review"]')!.classList.contains("cast-key-seated")).toBe(true);
  });

  it("Not yet ejects the cartridge and lights nothing", async () => {
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
    expect(first.textContent).toContain("Paste Opus agent's reply");
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
  });

  it("dismissing a waiting test removes it and goes home", async () => {
    addPending(FOLDER, {
      profileSlug: "opus",
      credentialKey: "eng/review",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: await assignmentVersion(review.task, review.rubric),
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    });
    renderApp(storageWith({ credentials: [review], profiles: [opus] }), { ...fromBadge, profileSlug: "opus", resume: true });
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss this test" }));
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
