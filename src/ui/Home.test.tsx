// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import { FolderProvider } from "./useFolderState";
import { addPending } from "./pendingTests";
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
import type { AgentProfile, Assessment, Credential } from "../domain/types";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
const pick = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock("./exportFolder", () => ({ pickExportFolder: pick }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const review: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: ["I can find bugs in a diff."],
  task: "Review the attached diff.",
  rubric: "",
  extraSections: [],
};
const docs: Credential = { ...review, slug: "docs", name: "Write docs", task: "Document the module." };
const opus: AgentProfile = { slug: "opus", name: "Opus agent", harness: "claude-code", model: "opus", effort: "high", repo: "", notes: "", params: {} };
const codex: AgentProfile = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt" };

async function met(profile: AgentProfile, credential: Credential, overrides: Partial<Assessment> = {}): Promise<Assessment> {
  return {
    profileSlug: profile.slug,
    collectionSlug: credential.collectionSlug,
    credentialSlug: credential.slug,
    fileStem: "20260901T090000Z",
    result: "met",
    recordedAt: "2026-09-01T09:00:00.000Z",
    assignmentVersion: await assignmentVersion(credential.task, credential.rubric),
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    note: "",
    handBack: "Done",
    ...overrides,
  };
}

function storageWith(opts: { credentials?: Credential[]; profiles?: AgentProfile[]; assessments?: Assessment[] } = {}): MemoryStorage {
  const credentials = opts.credentials ?? [];
  const files: Record<string, string> = { [MARKER_PATH]: '{ "format": 1 }\n' };
  if (credentials.length > 0) {
    files[collectionPath("eng")] = serializeCollection({
      slug: "eng",
      name: "Engineering",
      description: "",
      order: credentials.map((c) => c.slug),
      codes: Object.fromEntries(credentials.map((c, i) => [c.slug, i + 1])),
    });
  }
  for (const c of credentials) files[credentialPath(c.collectionSlug, c.slug)] = serializeCredentialMd(c);
  for (const p of opts.profiles ?? []) files[profilePath(p.slug)] = serializeProfile(p);
  for (const a of opts.assessments ?? []) {
    files[assessmentPath(a.profileSlug, a.collectionSlug, a.credentialSlug, a.fileStem)] = serializeAssessment(a);
  }
  return new MemoryStorage(files);
}

function renderApp(storage: MemoryStorage) {
  render(
    <FolderProvider storage={storage} folder="/data">
      <AppShell onChangeFolder={() => {}} />
    </FolderProvider>,
  );
}

const needs = () => screen.findByRole("region", { name: "What needs you" });
const rows = async () => within(await needs()).getAllByRole("button").filter((b) => b.textContent !== "More");

describe("Home", () => {
  it("Covers AE1. An empty folder shows only the two doors", async () => {
    renderApp(storageWith());
    expect(await screen.findByRole("button", { name: "Create an agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create a credential" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "What needs you" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Agents" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Badges" })).toBeNull();
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Covers AE1. With one credential its badge shows, and What needs you lists it as nobody holds it", async () => {
    renderApp(storageWith({ credentials: [review] }));
    const badges = await screen.findByRole("region", { name: "Badges" });
    expect(within(badges).getByRole("button", { name: /Code review/ })).toBeTruthy();
    const [row] = await rows();
    expect(row.textContent).toContain("Code review");
    expect(row.textContent).toContain("Nobody holds it yet");
    expect(screen.getByRole("button", { name: "Create a credential" })).toBeTruthy();
  });

  it("each agent shows the badges it earned, and each badge shows who holds it", async () => {
    renderApp(storageWith({ credentials: [review, docs], profiles: [opus, codex], assessments: [await met(opus, review)] }));
    const agents = await screen.findByRole("region", { name: "Agents" });
    const opusCard = within(agents).getByRole("button", { name: /^Opus agent/ });
    expect(await within(opusCard).findByRole("img", { name: "Badge for Code review" })).toBeTruthy();
    const codexCard = within(agents).getByRole("button", { name: /^Codex agent/ });
    expect(within(codexCard).queryByRole("img", { name: /Badge for/ })).toBeNull();

    const badges = screen.getByRole("region", { name: "Badges" });
    const held = within(badges).getByRole("button", { name: /Code review/ });
    expect(within(held).getByText("Opus agent")).toBeTruthy();
    const unheld = within(badges).getByRole("button", { name: /Write docs/ });
    expect(within(unheld).queryByText("Opus agent")).toBeNull();
  });

  it("Covers AE3. A test waiting on a reply is listed first and opens at what came back", async () => {
    addPending("/data", {
      profileSlug: "opus",
      credentialKey: "eng/docs",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: "x",
      setup: { harness: "claude-code", model: "opus", effort: "high" },
    });
    renderApp(storageWith({ credentials: [review, docs], profiles: [opus] }));
    const [first] = await rows();
    expect(first.textContent).toContain("Paste Opus agent's reply");
    expect(first.textContent).toContain("Write docs");
    await userEvent.click(first);
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
  });

  it("Covers AE5. An edited task keeps the badge on the agent and suggests a re-test", async () => {
    const earned = await met(opus, review);
    const edited = { ...review, task: "Review the attached diff, twice." };
    renderApp(storageWith({ credentials: [edited], profiles: [opus], assessments: [earned] }));
    const [row] = await rows();
    expect(row.textContent).toContain("Re-test Opus agent");
    expect(row.textContent).toContain("Code review");
    expect(row.textContent).toContain("task changed");
    const agents = screen.getByRole("region", { name: "Agents" });
    expect(await within(agents).findByRole("img", { name: "Badge for Code review" })).toBeTruthy();
    await userEvent.click(row);
    expect(await screen.findByRole("heading", { name: "Hand it over" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Answered" }).textContent).toContain("Opus agent");
  });

  it("a credential missing its task is half-made, listed once, and opens that part", async () => {
    renderApp(storageWith({ credentials: [{ ...docs, task: "" }] }));
    const list = await rows();
    expect(list).toHaveLength(1);
    expect(list[0].textContent).toContain("Finish Write docs");
    await userEvent.click(list[0]);
    expect(await screen.findByRole("heading", { name: "The task" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Task" })).toBeTruthy();
  });

  it("an agent with no results opens the test with the agent picked", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus, codex], assessments: [await met(opus, review)] }));
    const [row] = await rows();
    expect(row.textContent).toContain("Test Codex agent");
    await userEvent.click(row);
    expect(await screen.findByRole("heading", { name: "Which badge" })).toBeTruthy();
  });

  it("an unheld badge opens who takes it with the credential picked", async () => {
    renderApp(storageWith({ credentials: [review] }));
    await userEvent.click((await rows())[0]);
    expect(await screen.findByRole("heading", { name: "Who takes it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create an agent" })).toBeTruthy();
  });

  it("shows the top three with a quiet More", async () => {
    const four = ["a", "b", "c", "d"].map((s) => ({ ...review, slug: s, name: `Badge ${s}` }));
    renderApp(storageWith({ credentials: four }));
    expect(await rows()).toHaveLength(3);
    await userEvent.click(within(await needs()).getByRole("button", { name: "More" }));
    expect(await rows()).toHaveLength(4);
  });

  it("the doors, an agent and a badge each open their place, and the deck closes home", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus] }));
    await userEvent.click(await screen.findByRole("button", { name: "Create a credential" }));
    expect(await screen.findByRole("heading", { name: "What is it called" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await userEvent.click(await screen.findByRole("button", { name: "Create an agent" }));
    expect(await screen.findByRole("region", { name: "Create an agent" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    const agents = await screen.findByRole("region", { name: "Agents" });
    await userEvent.click(within(agents).getByRole("button", { name: /^Opus agent/ }));
    expect(await screen.findByRole("heading", { name: "Opus agent", level: 2 })).toBeTruthy();
    expect(screen.getByRole("region", { name: "An agent" })).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);

    const badges = await screen.findByRole("region", { name: "Badges" });
    await userEvent.click(within(badges).getByRole("button", { name: /Code review/ }));
    expect(await screen.findByRole("region", { name: "Code review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test it on an agent" })).toBeTruthy();
  });

  it("Export writes every collection and reports it", async () => {
    pick.mockResolvedValueOnce("/out");
    const storage = storageWith({ credentials: [review] });
    storage.seed({
      [collectionPath("words")]: serializeCollection({ slug: "words", name: "Words", description: "", order: ["essay"], codes: { essay: 1 } }),
      [credentialPath("words", "essay")]: serializeCredentialMd({ ...review, slug: "essay", collectionSlug: "words", name: "Essay" }),
    });
    renderApp(storage);
    await screen.findByRole("region", { name: "Badges" });
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(screen.getByText(/^Exported 8 files to \/out\./)).toBeTruthy());
    expect(storage.files("export")["eng.json"]).toBeTruthy();
    expect(storage.files("export")["words.json"]).toBeTruthy();
  });

  it("cancelling the export folder writes nothing", async () => {
    pick.mockResolvedValueOnce(null);
    const storage = storageWith({ credentials: [review] });
    renderApp(storage);
    await screen.findByRole("region", { name: "Badges" });
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(pick).toHaveBeenCalled());
    expect(storage.files("export")).toEqual({});
  });
});
