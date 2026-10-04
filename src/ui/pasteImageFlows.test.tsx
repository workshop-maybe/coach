// @vitest-environment jsdom
// Pasting an image into each rich box (U5 of the paste-images plan): the file lands beside
// the file that box saves to (R8), the saved text names it, a beat waits for the write
// (R11), a reply keeps its pictures when its agent changes (R10), and the views read them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { loadFolder } from "../domain/folder";
import type { MemoryStorage } from "../storage/memory";
import { firePaste, pngFile } from "../test/paste";
import { opus, renderApp, result, review, storageWith } from "./testFolder";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; these flows paste into a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(writeText).mockReset();
});
afterEach(cleanup);

const IMAGE = /!\[\]\((image-[0-9a-f]{8}\.png)\)/;

/** Pastes a PNG into the box named `name` and waits for its ref; returns the image's file name. */
async function pasteImage(name: string): Promise<string> {
  const box = (await screen.findByRole("textbox", { name })) as HTMLTextAreaElement;
  box.setSelectionRange(box.value.length, box.value.length);
  firePaste(box, {}, [pngFile()]);
  await waitFor(() => expect(box.value).toMatch(IMAGE));
  return IMAGE.exec(box.value)![1];
}

const imagesIn = (storage: MemoryStorage, dir: string) => storage.listFiles("data", dir).then((paths) => paths.filter((p) => p.endsWith(".png")));

describe("pasting an image into each box (R8)", () => {
  it("the create deck's task saves it in the folder the credential will land in", async () => {
    const storage = storageWith();
    renderApp(storage, { view: "deck", deck: "credential" });
    await userEvent.click(await screen.findByRole("button", { name: "Build your own" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), "Fix the layout");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByRole("textbox", { name: "New learning target" }), "I can fix a layout");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Task" }), "Make it look like this: ");
    const name = await pasteImage("Task");
    expect(await imagesIn(storage, "collections/my-credentials/credentials")).toEqual([`collections/my-credentials/credentials/${name}`]);
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    await screen.findByRole("button", { name: "Test it on an agent" });
    const state = await loadFolder(storage);
    expect(state.credentials[0]).toMatchObject({ collectionSlug: "my-credentials", task: `Make it look like this: ![](${name})` });
  });

  it("the task and the rubric save it beside the credential's file", async () => {
    for (const part of ["task", "rubric"] as const) {
      const storage = storageWith({ credentials: [review] });
      renderApp(storage, { view: "deck", deck: "edit-credential", credentialKey: "eng/review", part });
      const label = part === "task" ? "Task" : "Rubric";
      const name = await pasteImage(label);
      expect(await imagesIn(storage, "collections/eng")).toEqual([`collections/eng/credentials/${name}`]);
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByRole("list", { name: "Parts" });
      const saved = (await loadFolder(storage)).credentials[0];
      expect(saved[part]).toContain(`![](${name})`);
      cleanup();
    }
  });

  it("an agent's notes save it in the agents folder, and the JSON keeps the ref in its notes", async () => {
    const storage = storageWith({ profiles: [opus] });
    renderApp(storage, { view: "deck", deck: "edit-agent", profileSlug: "opus", part: "notes" });
    const name = await pasteImage("Notes");
    expect(await imagesIn(storage, "agents")).toEqual([`agents/${name}`]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("list", { name: "Parts" });
    expect(JSON.parse(storage.file("agents/opus.json")!).notes).toContain(`![](${name})`);
  });
});

describe("pasting an image into a reply", () => {
  const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5" };
  const fromBadge = { view: "deck", deck: "test", credentialKey: "eng/review" } as const;

  async function toReply(agent = "Opus agent") {
    await userEvent.click(await screen.findByRole("button", { name: agent }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
  }

  it("saves it in the result's folder, and the recorded reply names it", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    renderApp(storage, fromBadge);
    await toReply();
    const name = await pasteImage("Reply");
    expect(await imagesIn(storage, "assessments")).toEqual([`assessments/opus/eng/review/${name}`]);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Met" }));
    await screen.findByTestId("landing");
    const [saved] = (await loadFolder(storage)).assessments;
    expect(saved.handBack).toBe(`![](${name})`);
  });

  it("Covers R10. A reply moved to another agent before it is recorded keeps its picture", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus, codex] });
    renderApp(storage, fromBadge);
    await toReply();
    const name = await pasteImage("Reply");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await toReply("Codex agent");
    await waitFor(async () => expect(await imagesIn(storage, "assessments/codex")).toEqual([`assessments/codex/eng/review/${name}`]));
    await waitFor(() => expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Met" }));
    await screen.findByTestId("landing");
    const [saved] = (await loadFolder(storage)).assessments;
    expect(saved).toMatchObject({ profileSlug: "codex", handBack: `![](${name})` });
  });

  it("a reply cleared by Try another agent carries nothing into the next agent's folder", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus, codex] });
    renderApp(storage, fromBadge);
    await toReply();
    await pasteImage("Reply");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Not yet" }));
    await userEvent.click(await screen.findByRole("button", { name: "Try another agent" }));
    await toReply("Codex agent");
    await new Promise((r) => setTimeout(r, 20));
    expect(await imagesIn(storage, "assessments/codex")).toEqual([]);
  });

  it("Covers R11. Next waits while the image is still being written", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const save = storage.saveImage.bind(storage);
    storage.saveImage = async (...args) => {
      await gate;
      return save(...args);
    };
    renderApp(storage, fromBadge);
    await toReply();
    const box = screen.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement;
    await userEvent.type(box, "Here it is: ");
    firePaste(box, {}, [pngFile()]);
    const next = () => screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    await waitFor(() => expect(next().disabled).toBe(true));
    release();
    await waitFor(() => expect(next().disabled).toBe(false));
    expect(box.value).toMatch(IMAGE);
  });

  it("a write that fails says why on the notice and leaves the reply as it was", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus] });
    storage.saveImage = () => Promise.reject(new Error("The folder is read-only."));
    renderApp(storage, fromBadge);
    await toReply();
    const box = screen.getByRole("textbox", { name: "Reply" }) as HTMLTextAreaElement;
    await userEvent.type(box, "Here");
    firePaste(box, {}, [pngFile()]);
    expect(await screen.findByText("The folder is read-only.")).toBeTruthy();
    expect(box.value).toBe("Here");
  });
});

describe("reading a saved reply's pictures", () => {
  it("the reply view reads them from the result's own folder", async () => {
    const met = await result(opus, review, { handBack: "Shot:\n\n![](image-0000abcd.png)" });
    const storage = storageWith({ credentials: [review], profiles: [opus], assessments: [met] });
    const read = vi.spyOn(storage, "readDataUri");
    renderApp(storage, { view: "item", item: "reply", credentialKey: "eng/review", take: { profileSlug: "opus", fileStem: met.fileStem } });
    await screen.findByRole("region", { name: "Reply" });
    await waitFor(() => expect(read).toHaveBeenCalledWith("data", `assessments/opus/eng/review/image-0000abcd.png`));
    expect(within(screen.getByRole("region", { name: "Reply" })).getByText("image-0000abcd.png")).toBeTruthy();
  });
});
