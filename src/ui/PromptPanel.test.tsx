// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { PromptPanel } from "./PromptPanel";
import { ExportDialog } from "./ExportDialog";
import { FolderProvider } from "./useFolderState";
import { MemoryStorage } from "../storage/memory";
import {
  MARKER_PATH,
  collectionPath,
  credentialPath,
  profilePath,
  serializeCollection,
  serializeProfile,
} from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import { buildPrompt } from "../domain/prompts";
import type { AgentProfile, Credential } from "../domain/types";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const RUBRIC = "The answer must include tests.";

const review: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: ["I can find bugs in a diff."],
  task: "Review the attached diff.",
  rubric: RUBRIC,
  extraSections: [],
};
const blank: Credential = { ...review, slug: "blank", name: "Blank task", task: "", rubric: "" };
const opus: AgentProfile = {
  slug: "opus",
  name: "Opus agent",
  harness: "claude-code",
  model: "opus",
  effort: "high",
  repo: "",
  notes: "",
  params: {},
};

function fixture(): MemoryStorage {
  return new MemoryStorage({
    [MARKER_PATH]: '{ "format": 1 }\n',
    [collectionPath("eng")]: serializeCollection({
      slug: "eng",
      name: "Engineering",
      description: "",
      order: ["review", "blank"],
      codes: { review: 1, blank: 2 },
    }),
    [credentialPath("eng", "review")]: serializeCredentialMd(review),
    [credentialPath("eng", "blank")]: serializeCredentialMd(blank),
    [profilePath("opus")]: serializeProfile(opus),
  });
}

function renderPanel(storage: MemoryStorage, props: Partial<Parameters<typeof PromptPanel>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <FolderProvider storage={storage} folder="/data">
      <PromptPanel credentialKey="eng/review" onClose={onClose} {...props} />
    </FolderProvider>,
  );
  return { onClose };
}

async function promptText(): Promise<HTMLTextAreaElement> {
  return (await screen.findByLabelText("Prompt text")) as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.mocked(writeText).mockReset();
  vi.mocked(invoke).mockReset();
});
afterEach(cleanup);

describe("PromptPanel", () => {
  it("copies the edited text, and Reset restores the template output", async () => {
    vi.mocked(writeText).mockResolvedValue(undefined);
    renderPanel(fixture(), { initialJob: "check" });
    const text = await promptText();
    const template = buildPrompt("check", review);
    expect(text.value).toBe(template);

    await userEvent.clear(text);
    await userEvent.type(text, "My own words");
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("My own words");
    expect(await screen.findByText("Copied")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(text.value).toBe(template);
  });

  it("shows a visible error when the copy fails", async () => {
    vi.mocked(writeText).mockRejectedValue(new Error("clipboard busy"));
    renderPanel(fixture(), { initialJob: "review" });
    await promptText();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    const panel = screen.getByRole("region", { name: "Prompt" });
    expect(await within(panel).findByRole("alert")).toHaveProperty("textContent", "Could not copy: clipboard busy");
    expect(within(panel).queryByText("Copied")).toBeNull();
  });

  it("the test prompt never contains the rubric, while a helper prompt does", async () => {
    renderPanel(fixture(), { initialJob: "test", profileSlug: "opus" });
    const text = await promptText();
    expect(text.value).toContain("Review the attached diff.");
    expect(text.value).not.toContain(RUBRIC);

    await userEvent.selectOptions(screen.getByLabelText("Prompt job"), "check");
    expect((await promptText()).value).toContain(RUBRIC);
  });

  it("shows the agent picker only for the test job", async () => {
    renderPanel(fixture(), { initialJob: "test" });
    await promptText();
    expect(screen.getByLabelText("Agent")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Prompt job"), "suggest");
    expect(screen.queryByLabelText("Agent")).toBeNull();
  });

  it("blocks the test job for a credential with an empty task", async () => {
    renderPanel(fixture(), { credentialKey: "eng/blank", initialJob: "test", profileSlug: "opus" });
    expect(await screen.findByText(/has no task yet/)).toBeTruthy();
    expect(screen.queryByLabelText("Prompt text")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();

    // Helper jobs still work for the same credential.
    await userEvent.selectOptions(screen.getByLabelText("Prompt job"), "suggest");
    expect((await promptText()).value).toBe(buildPrompt("suggest", blank));
  });

  it("keeps the edited text when the folder reloads on window focus", async () => {
    const storage = fixture();
    renderPanel(storage, { initialJob: "test", profileSlug: "opus" });
    const text = await promptText();
    await userEvent.type(text, " EXTRA");
    const edited = text.value;

    storage.seed({ [credentialPath("eng", "review")]: serializeCredentialMd({ ...review, task: "Changed outside." }) });
    await act(async () => {
      fireEvent.focus(window);
    });
    await waitFor(() => expect(storage.writes).toEqual([]));
    expect((await promptText()).value).toBe(edited);
  });

  it("after a test prompt, Record result opens the assessment form for that agent and credential", async () => {
    renderPanel(fixture(), { initialJob: "test", profileSlug: "opus" });
    await promptText();
    await userEvent.click(screen.getByRole("button", { name: "Record result" }));
    const form = await screen.findByRole("form", { name: "Record result" });
    expect(within(form).getByText("Opus agent")).toBeTruthy();
    expect(within(form).getByText("Code review")).toBeTruthy();
    expect(within(form).queryByLabelText("Agent")).toBeNull();
    expect(within(form).queryByLabelText("Credential")).toBeNull();
  });
});

describe("ExportDialog", () => {
  function renderDialog(storage: MemoryStorage) {
    render(
      <FolderProvider storage={storage} folder="/data">
        <ExportDialog collectionSlug="eng" onClose={() => {}} />
      </FolderProvider>,
    );
  }

  it("says when a badge was exported without its art", async () => {
    vi.mocked(invoke).mockResolvedValue("/exports");
    const storage = fixture();
    const raw = JSON.parse(storage.file(collectionPath("eng"))!);
    raw.badge = { art: "collections/eng/badge/art-deadbeef.png" };
    storage.seed({ [collectionPath("eng")]: JSON.stringify(raw) });
    renderDialog(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Choose folder and export" }));
    expect(await screen.findByText(/2 badges were exported without art because the image could not be read/)).toBeTruthy();
  });

  it("writes the export files to the export root with the rubric left out by default", async () => {
    vi.mocked(invoke).mockResolvedValue("/exports");
    const storage = fixture();
    renderDialog(storage);
    const include = (await screen.findByLabelText("Include rubric")) as HTMLInputElement;
    expect(include.checked).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Choose folder and export" }));
    expect(await screen.findByText(/Exported 7 files to \/exports/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("pick_export_folder");
    const out = storage.files("export");
    expect(Object.keys(out).sort()).toEqual([
      "eng.json",
      "eng/1/assignment.md",
      "eng/1/badge.svg",
      "eng/1/outline.md",
      "eng/2/assignment.md",
      "eng/2/badge.svg",
      "eng/2/outline.md",
    ]);
    const badge = out["eng/1/badge.svg"];
    expect(badge).toContain("<svg");
    expect(badge).toContain("@font-face");
    expect(Object.values(out).join("\n")).not.toContain(RUBRIC);
    expect(storage.writes.every((w) => w.root === "export")).toBe(true);
  });

  it("embeds the collection art in each exported badge", async () => {
    vi.mocked(invoke).mockResolvedValue("/exports");
    const storage = fixture();
    const art = "data:image/png;base64,QUJDREVGRw==";
    storage.seedImage("art/eng.png", art);
    const raw = JSON.parse(storage.file(collectionPath("eng"))!);
    raw.badge = { art: "art/eng.png" };
    storage.seed({ [collectionPath("eng")]: JSON.stringify(raw) });
    renderDialog(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Choose folder and export" }));
    await screen.findByText(/Exported/);
    expect(storage.file("eng/1/badge.svg", "export")).toContain(art);
  });

  it("saves missing module codes before exporting, so exported codes match the folder", async () => {
    vi.mocked(invoke).mockResolvedValue("/exports");
    const storage = fixture();
    const raw = JSON.parse(storage.file(collectionPath("eng"))!);
    delete raw.codes.blank;
    storage.seed({ [collectionPath("eng")]: JSON.stringify(raw) });
    renderDialog(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Choose folder and export" }));
    await screen.findByText(/Exported/);
    const saved = JSON.parse(storage.file(collectionPath("eng"))!);
    expect(saved.codes).toEqual({ review: 1, blank: 2 });
    expect(Object.keys(storage.files("export")).sort()).toContain("eng/2/outline.md");
  });

  it("includes the rubric when the user chooses to", async () => {
    vi.mocked(invoke).mockResolvedValue("/exports");
    const storage = fixture();
    renderDialog(storage);
    await userEvent.click(await screen.findByLabelText("Include rubric"));
    await userEvent.click(screen.getByRole("button", { name: "Choose folder and export" }));
    await screen.findByText(/Exported/);
    expect(storage.file("eng/1/assignment.md", "export")).toContain(RUBRIC);
  });

  it("writes nothing when the folder picker is cancelled, and shows errors", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("no access"));
    const storage = fixture();
    renderDialog(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Choose folder and export" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(storage.files("export")).toEqual({});

    await userEvent.click(screen.getByRole("button", { name: "Choose folder and export" }));
    const dialog = screen.getByRole("region", { name: "Export" });
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", "Export failed: no access");
  });
});
