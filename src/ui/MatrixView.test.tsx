// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell, type Route } from "./AppShell";
import { FolderProvider } from "./useFolderState";
import { MemoryStorage } from "../storage/memory";
import {
  MARKER_PATH,
  assessmentPath,
  collectionPath,
  credentialPath,
  profilePath,
  serializeAssessment,
  serializeCollection,
  serializeProfile,
} from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import { assignmentVersion } from "../domain/hash";
import { FLAG_REASONS } from "../domain/matrix";
import type { AgentProfile, Assessment, Credential } from "../domain/types";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

afterEach(cleanup);

const review: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: ["I can find bugs in a diff."],
  task: "Review the attached diff.",
  rubric: "Must include tests.",
  extraSections: [],
};
const docs: Credential = { ...review, slug: "docs", name: "Write docs", task: "Document the module." };
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
const codex: AgentProfile = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt" };

async function assessment(overrides: Partial<Assessment>): Promise<Assessment> {
  return {
    profileSlug: "opus",
    collectionSlug: "eng",
    credentialSlug: "review",
    fileStem: "20260901T090000Z",
    result: "not_met",
    recordedAt: "2026-09-01T09:00:00.000Z",
    assignmentVersion: await assignmentVersion(review.task, review.rubric),
    setup: { harness: "claude-code", model: "opus", effort: "high" },
    note: "",
    handBack: "Hand-back text",
    ...overrides,
  };
}

function base(): Record<string, string> {
  return {
    [MARKER_PATH]: '{ "format": 1 }\n',
    [collectionPath("eng")]: serializeCollection({
      slug: "eng",
      name: "Engineering",
      description: "",
      order: ["review", "docs"],
      codes: { review: 1, docs: 2 },
    }),
    [credentialPath("eng", "review")]: serializeCredentialMd(review),
    [credentialPath("eng", "docs")]: serializeCredentialMd(docs),
    [profilePath("opus")]: serializeProfile(opus),
    [profilePath("codex")]: serializeProfile(codex),
  };
}

/** Opus has two results for Code review. The newer one is met, on an old version and an old setup. */
async function fixture(): Promise<MemoryStorage> {
  const older = await assessment({ note: "First try", handBack: "Older hand-back" });
  const newer = await assessment({
    fileStem: "20260910T090000Z",
    recordedAt: "2026-09-10T09:00:00.000Z",
    result: "met",
    assignmentVersion: "0123456789ab",
    setup: { harness: "claude-code", model: "sonnet", effort: "medium" },
    note: "Second try",
    handBack: "Newer hand-back",
  });
  const files = base();
  for (const a of [older, newer]) {
    files[assessmentPath(a.profileSlug, a.collectionSlug, a.credentialSlug, a.fileStem)] = serializeAssessment(a);
  }
  return new MemoryStorage(files);
}

function renderApp(storage: MemoryStorage, initialRoute: Route = { view: "matrix" }) {
  render(
    <FolderProvider storage={storage} folder="/data">
      <AppShell onChangeFolder={() => {}} initialRoute={initialRoute} />
    </FolderProvider>,
  );
}

function cell(profile: string, credential: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: new RegExp(`^${profile}, ${credential}:`) });
}

describe("MatrixView", () => {
  it("shows each cell's status as a text label", async () => {
    renderApp(await fixture());
    expect((await cell("Opus agent", "Code review")).textContent).toContain("Met");
    expect((await cell("Codex agent", "Code review")).textContent).toContain("Untested");
    expect(screen.getByRole("columnheader", { name: /Engineering/ })).toBeTruthy();
  });

  it("clicking an untested cell opens the cell panel with an empty history and both actions", async () => {
    renderApp(await fixture());
    await userEvent.click(await cell("Codex agent", "Write docs"));
    const panel = await screen.findByRole("region", { name: "Cell history" });
    expect(within(panel).getByText("No results yet.")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "New test prompt" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Record result" })).toBeTruthy();
  });

  it("a flagged cell shows its flags, and its history lists every result newest first", async () => {
    renderApp(await fixture());
    const flagged = await cell("Opus agent", "Code review");
    expect(flagged.getAttribute("aria-label")).toContain(FLAG_REASONS.earlier_version);
    expect(flagged.getAttribute("aria-label")).toContain(FLAG_REASONS.setup_mismatch);
    expect(within(flagged).getByTitle(FLAG_REASONS.earlier_version)).toBeTruthy();
    expect(within(flagged).getByTitle(FLAG_REASONS.setup_mismatch)).toBeTruthy();

    await userEvent.click(flagged);
    const panel = await screen.findByRole("region", { name: "Cell history" });
    const items = within(panel).getAllByRole("listitem", { name: /result/i });
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Second try");
    expect(items[0].textContent).toContain("Met");
    expect(items[1].textContent).toContain("First try");
    expect(items[1].textContent).toContain("Not met");

    // Hand-backs stay collapsed until expanded.
    const details = items[0].querySelector("details")!;
    expect(details.open).toBe(false);
    await userEvent.click(within(items[0]).getByText("Hand-back"));
    expect(details.open).toBe(true);
    expect(within(items[0]).getByText("Newer hand-back")).toBeTruthy();
  });

  it("a setup-mismatch flag shows its reason and the recorded setup beside the current one", async () => {
    renderApp(await fixture(), { view: "matrix", cellKey: "opus|eng/review" });
    const panel = await screen.findByRole("region", { name: "Cell history" });
    expect(within(panel).getByText(FLAG_REASONS.setup_mismatch)).toBeTruthy();
    expect(within(panel).getByText(FLAG_REASONS.earlier_version)).toBeTruthy();
    expect(within(panel).getByText("claude-code · sonnet · medium")).toBeTruthy();
    expect(within(panel).getByText("claude-code · opus · high")).toBeTruthy();
    expect(within(panel).getByText("Recorded setup")).toBeTruthy();
    expect(within(panel).getByText("Current setup")).toBeTruthy();
  });

  it("after an assessment is recorded, the cell shows the new status without a manual reload", async () => {
    const storage = await fixture();
    renderApp(storage);
    await userEvent.click(await cell("Codex agent", "Write docs"));
    const panel = await screen.findByRole("region", { name: "Cell history" });
    await userEvent.click(within(panel).getByRole("button", { name: "Record result" }));
    const form = await screen.findByRole("form", { name: "Record result" });
    await userEvent.type(within(form).getByLabelText("Hand-back"), "All done.");
    await userEvent.click(within(form).getByLabelText("Met"));
    await userEvent.click(within(form).getByRole("button", { name: "Save result" }));

    await waitFor(async () => expect((await cell("Codex agent", "Write docs")).textContent).toContain("Met"));
    expect(storage.writes.filter((w) => w.path.startsWith("assessments/codex/eng/docs/"))).toHaveLength(1);
  });

  it("New test prompt opens the prompt panel on the test job for that agent", async () => {
    renderApp(await fixture(), { view: "matrix", cellKey: "codex|eng/docs" });
    const panel = await screen.findByRole("region", { name: "Cell history" });
    await userEvent.click(within(panel).getByRole("button", { name: "New test prompt" }));
    const prompt = await screen.findByRole("region", { name: "Prompt" });
    expect((within(prompt).getByLabelText("Prompt job") as HTMLSelectElement).value).toBe("test");
    expect((within(prompt).getByLabelText("Agent") as HTMLSelectElement).value).toBe("codex");
    expect((within(prompt).getByLabelText("Prompt text") as HTMLTextAreaElement).value).toContain("Document the module.");
  });

  it("Covers AE7. A credential with no met cell renders with the unmet style", async () => {
    renderApp(await fixture());
    await cell("Opus agent", "Code review");
    const unmet = screen.getByRole("columnheader", { name: /Write docs/ });
    const met = screen.getByRole("columnheader", { name: /Code review/ });
    expect(unmet.className).toContain("credential-unmet");
    expect(within(unmet).getByText("No agent meets this yet")).toBeTruthy();
    expect(met.className).not.toContain("credential-unmet");
    expect(within(met).queryByText("No agent meets this yet")).toBeNull();
  });

  it("Record result above the matrix opens the form with both fields selectable", async () => {
    renderApp(await fixture());
    await cell("Opus agent", "Code review");
    await userEvent.click(screen.getByRole("button", { name: "Record result" }));
    const form = await screen.findByRole("form", { name: "Record result" });
    expect(within(form).getByLabelText("Agent")).toBeTruthy();
    expect(within(form).getByLabelText("Credential")).toBeTruthy();
  });

  it("with no profiles, the empty state links to Agents", async () => {
    const files = base();
    delete files[profilePath("opus")];
    delete files[profilePath("codex")];
    renderApp(new MemoryStorage(files));
    expect(await screen.findByText(/No agent profiles yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Go to Agents" }));
    expect(screen.getByRole("button", { name: "Agents" }).getAttribute("aria-current")).toBe("page");
  });

  it("with no credentials, the empty state links to Collections", async () => {
    renderApp(
      new MemoryStorage({ [MARKER_PATH]: '{ "format": 1 }\n', [profilePath("opus")]: serializeProfile(opus) }),
    );
    expect(await screen.findByText(/No credentials yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Go to Collections" }));
    expect(screen.getByRole("button", { name: "Collections" }).getAttribute("aria-current")).toBe("page");
  });
});
