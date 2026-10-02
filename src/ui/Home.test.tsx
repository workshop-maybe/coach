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
  handoffPath,
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
  it("Covers AE1. An empty folder shows the first test, then the two doors", async () => {
    renderApp(storageWith());
    const first = await screen.findByRole("button", { name: "Try a first test" });
    const agentDoor = screen.getByRole("button", { name: "Create an agent" });
    expect(screen.getByRole("button", { name: "Create a credential" })).toBeTruthy();
    expect(first.classList.contains("primary")).toBe(true);
    expect(first.compareDocumentPosition(agentDoor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("region", { name: "What needs you" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Agents" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Badges" })).toBeNull();
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Try a first test opens the agent card", async () => {
    renderApp(storageWith());
    await userEvent.click(await screen.findByRole("button", { name: "Try a first test" }));
    expect(await screen.findByRole("region", { name: "Create an agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make the agent" })).toBeTruthy();
  });

  it("a folder with one agent, or one badge, offers no first test", async () => {
    renderApp(storageWith({ profiles: [opus] }));
    await screen.findByRole("region", { name: "Agents" });
    expect(screen.queryByRole("button", { name: "Try a first test" })).toBeNull();
    cleanup();
    renderApp(storageWith({ credentials: [review] }));
    await screen.findByRole("region", { name: "Badges" });
    expect(screen.queryByRole("button", { name: "Try a first test" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create an agent" })).toBeTruthy();
  });

  it("a populated folder never shows the empty layout while its matrix builds", async () => {
    let sawEmpty = false;
    const hasEmpty = (n: Node) => n instanceof Element && (n.classList.contains("home-empty") || n.querySelector(".home-empty") !== null);
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (hasEmpty(r.target) || [...r.addedNodes].some(hasEmpty)) sawEmpty = true;
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    renderApp(storageWith({ credentials: [review], profiles: [opus] }));
    await screen.findByRole("region", { name: "Agents" });
    await new Promise((r) => setTimeout(r, 0));
    observer.disconnect();
    expect(sawEmpty).toBe(false);
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
    expect(within(within(opusCard).getByRole("list", { name: "Earned" })).getByText("Code review")).toBeTruthy();
    const codexCard = within(agents).getByRole("button", { name: /^Codex agent/ });
    expect(within(codexCard).queryByRole("list", { name: "Earned" })).toBeNull();

    const badges = screen.getByRole("region", { name: "Badges" });
    const held = within(badges).getByRole("button", { name: /Code review/ });
    expect(within(held).getByText("Opus agent")).toBeTruthy();
    const unheld = within(badges).getByRole("button", { name: /Write docs/ });
    expect(within(unheld).queryByText("Opus agent")).toBeNull();
  });

  it("Covers AE4 (cast). Both doors show dashed outlines, and they stay dashed once a machine stands in the agents row", async () => {
    renderApp(storageWith());
    const agentDoor = await screen.findByRole("button", { name: "Create an agent" });
    const credentialDoor = screen.getByRole("button", { name: "Create a credential" });
    expect(agentDoor.querySelector('svg.cast-outline[data-outline="machine"] [stroke-dasharray]')).not.toBeNull();
    expect(credentialDoor.querySelector('svg.cast-outline[data-outline="cartridge"] [stroke-dasharray]')).not.toBeNull();
    cleanup();

    renderApp(storageWith({ profiles: [opus] }));
    const agents = await screen.findByRole("region", { name: "Agents" });
    const card = within(agents).getByRole("button", { name: /^Opus agent/ });
    expect(card.querySelector("svg.cast-machine")).not.toBeNull();
    expect(card.querySelector("[stroke-dasharray]")).toBeNull();
    const door = screen.getByRole("button", { name: "Create an agent" });
    expect(door.querySelector('svg.cast-outline[data-outline="machine"] [stroke-dasharray]')).not.toBeNull();
  });

  it("an agent's machine lights a key for each credential it earned", async () => {
    renderApp(storageWith({ credentials: [review, docs], profiles: [opus, codex], assessments: [await met(opus, review)] }));
    const agents = await screen.findByRole("region", { name: "Agents" });
    const opusCard = within(agents).getByRole("button", { name: /^Opus agent/ });
    const lit = opusCard.querySelectorAll('svg.cast-machine-mini [data-key="lit"]');
    expect([...lit].map((k) => k.getAttribute("data-credential"))).toEqual(["eng/review"]);
    const codexCard = within(agents).getByRole("button", { name: /^Codex agent/ });
    expect(codexCard.querySelectorAll('[data-key="lit"]')).toHaveLength(0);
  });

  it("credentials are cartridges, and one nobody holds sits unslotted", async () => {
    renderApp(storageWith({ credentials: [review, docs], profiles: [opus], assessments: [await met(opus, review)] }));
    const badges = await screen.findByRole("region", { name: "Badges" });
    const held = within(badges).getByRole("button", { name: /Code review/ });
    const unheld = within(badges).getByRole("button", { name: /Write docs/ });
    expect(held.querySelector("svg.cast-cartridge")).not.toBeNull();
    expect(held.classList.contains("badge-card-unheld")).toBe(false);
    expect(unheld.classList.contains("badge-card-unheld")).toBe(true);
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
    expect(first.textContent).toContain("Pull Opus agent's handoff");
    expect(first.textContent).toContain("Write docs");
    expect(first.querySelector('svg.cast-machine-mini[data-screen="waiting"] .cast-cursor')).not.toBeNull();
    // A test copied before handoffs holds the skeleton.
    expect(first.querySelector("svg.cast-machine-mini .cast-plugged text")?.textContent).toBe("S");
    await userEvent.click(first);
    expect(await screen.findByRole("heading", { name: "What came back" })).toBeTruthy();
  });

  it("Covers R15. A plugged agent's card draws its handoff by letter, and an unplugged one draws none", async () => {
    addPending("/data", {
      profileSlug: "opus",
      credentialKey: "eng/docs",
      copiedAt: "2026-09-29T10:00:00.000Z",
      assignmentVersion: "x",
      setup: { harness: "claude-code", model: "opus", effort: "high" },
      handoff: { id: "20260902T090000Z", text: "Document the module." },
    });
    const storage = storageWith({ credentials: [review, docs], profiles: [opus, codex] });
    storage.seed({
      [handoffPath("eng", "docs", "20260901T090000Z")]: "{{task}}\n",
      [handoffPath("eng", "docs", "20260902T090000Z")]: "{{task}}\n",
    });
    renderApp(storage);
    const agents = await screen.findByRole("region", { name: "Agents" });
    const opusCard = within(agents).getByRole("button", { name: /^Opus agent/ });
    await waitFor(() => expect(opusCard.querySelector("svg.cast-machine-mini .cast-plugged text")?.textContent).toBe("B"));
    const codexCard = within(agents).getByRole("button", { name: /^Codex agent/ });
    expect(codexCard.querySelector(".cast-plugged")).toBeNull();
    const [first] = await rows();
    expect(first.textContent).toContain("Pull Opus agent's handoff");
    expect(first.querySelector(".cast-plugged text")?.textContent).toBe("B");
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
    expect(within(within(agents).getByRole("list", { name: "Earned" })).getByText("Code review")).toBeTruthy();
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
    expect(await screen.findByRole("heading", { name: "Where to start" })).toBeTruthy();
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
