// @vitest-environment jsdom
// Adding a video to each rich box (U7 of the video plan), through the stub's Video key: the
// file lands beside the file that box saves to (R12), the saved text names it, a beat waits
// for the copy (R7), a refusal names its files on one notice (R5), and a reply keeps its
// videos when its agent changes (R13).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { loadFolder } from "../domain/folder";
import type { MemoryStorage } from "../storage/memory";
import { mkvBytes, mp4Bytes } from "../test/videoBytes";
import { opus, renderApp, review, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; these flows add through a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(writeText).mockReset();
});
afterEach(cleanup);

const VIDEO = /!\[\]\((video-[0-9a-f]{8}\.mp4)\)/;

/** The box named `name`, with the cursor at its end. */
async function boxAtEnd(name: string): Promise<HTMLTextAreaElement> {
  const box = (await screen.findByRole("textbox", { name })) as HTMLTextAreaElement;
  box.setSelectionRange(box.value.length, box.value.length);
  return box;
}

/** Picks an MP4 with the Video key of the box named `name` and waits for its ref; returns the video's file name. */
async function addVideo(storage: MemoryStorage, name: string): Promise<string> {
  const box = await boxAtEnd(name);
  storage.queueAdd([{ name: "clip.mp4", bytes: mp4Bytes() }]);
  await userEvent.click(screen.getByRole("button", { name: "Video" }));
  await waitFor(() => expect(box.value).toMatch(VIDEO));
  return VIDEO.exec(box.value)![1];
}

const videosIn = (storage: MemoryStorage, dir: string) => storage.listFiles("data", dir).then((paths) => paths.filter((p) => /\.(mp4|m4v|mov|webm)$/.test(p)));

describe("adding a video to each box (R12)", () => {
  it("the create deck's task adds it in the folder the credential will land in", async () => {
    const storage = storageWith();
    renderApp(storage, { view: "deck", deck: "credential" });
    await userEvent.click(await screen.findByRole("button", { name: "Build your own" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), "Fix the layout");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Learning target" }), "I can fix a layout");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Task" }), "Do what this shows: ");
    const name = await addVideo(storage, "Task");
    expect(storage.adds).toEqual([{ dir: "collections/my-credentials/credentials", from: { kind: "pick" } }]);
    expect(await videosIn(storage, "")).toEqual([`collections/my-credentials/credentials/${name}`]);
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    await screen.findByRole("button", { name: "Test it on an agent" });
    const state = await loadFolder(storage);
    expect(state.credentials[0]).toMatchObject({ collectionSlug: "my-credentials", task: `Do what this shows: ![](${name})` });
  });

  it("the task and the rubric add it beside the credential's file", async () => {
    for (const part of ["task", "rubric"] as const) {
      const storage = storageWith({ credentials: [review] });
      renderApp(storage, { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part });
      const name = await addVideo(storage, part === "task" ? "Task" : "Rubric");
      expect(await videosIn(storage, "")).toEqual([`collections/eng/credentials/${name}`]);
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByRole("list", { name: "Parts" });
      const saved = (await loadFolder(storage)).credentials[0];
      expect(saved[part]).toContain(`![](${name})`);
      cleanup();
    }
  });

  it("an agent's notes add it in the agents folder, and the JSON keeps the ref in its notes", async () => {
    const storage = storageWith({ profiles: [opus] });
    renderApp(storage, { view: "deck", deck: "edit-agent", profileSlug: "opus", part: "notes" });
    const name = await addVideo(storage, "Notes");
    expect(await videosIn(storage, "")).toEqual([`agents/${name}`]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    expect(JSON.parse(storage.file("agents/opus.json")!).notes).toContain(`![](${name})`);
  });
});

describe("adding a video to a reply", () => {
  const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5" };
  const fromBadge = { view: "deck", deck: "test", credentialKey: "eng/review" } as const;

  async function toReply(agent = "Opus agent") {
    await userEvent.click(await screen.findByRole("button", { name: agent }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
  }

  const next = () => screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;

  it("adds it in the result's folder, and the recorded reply names it", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, fromBadge);
    await toReply();
    const name = await addVideo(storage, "Reply");
    expect(await videosIn(storage, "")).toEqual([`assessments/opus/eng/review/${name}`]);
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole("button", { name: "Met" }));
    await screen.findByTestId("landing");
    const [saved] = (await loadFolder(storage)).assessments;
    expect(saved.handBack).toBe(`![](${name})`);
  });

  it("Covers R13. A reply moved to another agent before it is recorded keeps its video, and the reply view plays it", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus, codex] });
    renderApp(storage, fromBadge);
    await toReply();
    const name = await addVideo(storage, "Reply");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await toReply("Codex agent");
    await waitFor(async () => expect(await videosIn(storage, "assessments/codex")).toEqual([`assessments/codex/eng/review/${name}`]));
    await waitFor(() => expect(next().disabled).toBe(false));
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole("button", { name: "Met" }));
    await screen.findByTestId("landing");
    const [saved] = (await loadFolder(storage)).assessments;
    expect(saved).toMatchObject({ profileSlug: "codex", handBack: `![](${name})` });

    cleanup();
    renderApp(storage, { view: "item", item: "reply", credentialKey: "eng/review", take: { profileSlug: "codex", fileStem: saved.fileStem } });
    const reply = await screen.findByRole("region", { name: "Reply" });
    await waitFor(() => expect(reply.querySelector(`video[src="blob:memory/assessments/codex/eng/review/${name}"]`)).not.toBeNull());
  });

  it("a reply cleared by Try another agent carries nothing into the next agent's folder", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus, codex] });
    renderApp(storage, fromBadge);
    await toReply();
    await addVideo(storage, "Reply");
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole("button", { name: "Not yet" }));
    await userEvent.click(await screen.findByRole("button", { name: "Try another agent" }));
    await toReply("Codex agent");
    await new Promise((r) => setTimeout(r, 20));
    expect(await storage.listFiles("data", "assessments/codex")).toEqual([]);
  });

  it("Covers R7. Next waits while the video is still being copied", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const addFiles = storage.addFiles.bind(storage);
    storage.addFiles = async (...args) => {
      await gate;
      return addFiles(...args);
    };
    renderApp(storage, fromBadge);
    await toReply();
    const box = (await screen.findByRole("textbox", { name: "Reply" })) as HTMLTextAreaElement;
    await userEvent.type(box, "Here it is: ");
    storage.queueAdd([{ name: "clip.mp4", bytes: mp4Bytes() }]);
    await userEvent.click(screen.getByRole("button", { name: "Video" }));
    await waitFor(() => expect(next().disabled).toBe(true));
    release();
    await waitFor(() => expect(next().disabled).toBe(false));
    expect(box.value).toMatch(/^Here it is: !\[\]\(video-[0-9a-f]{8}\.mp4\)$/);
  });

  it("Covers R5. One added and two refused: the one goes in, and one notice names both refused files", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, fromBadge);
    await toReply();
    const box = (await screen.findByRole("textbox", { name: "Reply" })) as HTMLTextAreaElement;
    await userEvent.type(box, "Here: ");
    storage.queueAdd([
      { name: "clip.mp4", bytes: mp4Bytes() },
      { name: "clip.mkv", bytes: mkvBytes() },
      { name: "notes.txt", bytes: new TextEncoder().encode("hello") },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(await screen.findByText("clip.mkv and notes.txt: Only MP4, MOV, M4V and WebM videos, and PNG and JPEG images, can be added.")).toBeTruthy();
    await waitFor(() => expect(box.value).toMatch(VIDEO));
    expect(box.value).toBe(`Here: ![](${VIDEO.exec(box.value)![1]})`);
    expect(await videosIn(storage, "")).toHaveLength(1);
  });

  it("an add refused whole says so on the notice and leaves the reply as it was", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    storage.queueAdd([{ name: "clip.mkv", bytes: mkvBytes() }]);
    renderApp(storage, fromBadge);
    await toReply();
    const box = (await screen.findByRole("textbox", { name: "Reply" })) as HTMLTextAreaElement;
    await userEvent.type(box, "Here");
    await userEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(await screen.findByText("clip.mkv: Only MP4, MOV, M4V and WebM videos, and PNG and JPEG images, can be added.")).toBeTruthy();
    expect(box.value).toBe("Here");
    await waitFor(() => expect(next().disabled).toBe(false));
  });

  it("an add that fails outright says why on the notice and leaves the reply as it was", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    storage.queueAdd(new Error("The folder is read-only."));
    renderApp(storage, fromBadge);
    await toReply();
    const box = (await screen.findByRole("textbox", { name: "Reply" })) as HTMLTextAreaElement;
    await userEvent.type(box, "Here");
    await userEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(await screen.findByText("The folder is read-only.")).toBeTruthy();
    expect(box.value).toBe("Here");
  });
});
