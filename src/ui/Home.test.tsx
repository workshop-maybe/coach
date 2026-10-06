// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import { Home } from "./Home";
import { NavContext } from "./nav";
import type { Route } from "./routes";
import { heldReply, renderWithJev, storageWith as folderWith } from "./testFolder";
import { FolderProvider } from "./useFolderState";
import { addPending } from "./pendingTests";
import { MemoryStorage } from "../storage/memory";
import {
  MARKER_PATH,
  assessmentPath,
  collectionPath,
  credentialPath,
  handoffPath,
  heldPath,
  markPath,
  profilePath,
  serializeAssessment,
  serializeCollection,
  serializeHeld,
  serializeMark,
  serializeProfile,
} from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import { assignmentVersion } from "../domain/hash";
import type { AgentProfile, Assessment, Collection, Credential, HeldReply, Mark } from "../domain/types";
import { addBuiltinCollection } from "../domain/operations";
import { loadFolder } from "../domain/folder";
import type { JevAnswers } from "../domain/jevRequest";
import { FAKE_ON, FakeJev } from "../jev/fakeJev";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
const pick = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock("./exportFolder", () => ({ pickExportFolder: pick }));
// ProseMirror typing does not run in jsdom; the router's job types into a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

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

function storageWith(opts: { credentials?: Credential[]; profiles?: AgentProfile[]; assessments?: Assessment[]; held?: HeldReply[]; marks?: Mark[] } = {}): MemoryStorage {
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
  for (const h of opts.held ?? []) files[heldPath(h.profileSlug, h.collectionSlug, h.credentialSlug, h.fileStem)] = serializeHeld(h);
  for (const m of opts.marks ?? []) files[markPath(m.collectionSlug, m.credentialSlug, m.id)] = serializeMark(m);
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

/** Home's sections, which pair What needs you with Agents on a wide window when all three show. */
const shelves = () => document.querySelector<HTMLElement>(".home > .home-shelves");
const sectionNames = () => [...(shelves()?.querySelectorAll(":scope > section") ?? [])].map((s) => s.querySelector("h2")?.textContent);
const PAIRED = "home-shelves-paired";

describe("Home's paired row", () => {
  it("pairs What needs you with Agents when all three sections show, and keeps the doors outside", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus, codex], assessments: [await met(opus, review)] }));
    await needs();
    expect(shelves()!.classList.contains(PAIRED)).toBe(true);
    expect(sectionNames()).toEqual(["What needs you", "Agents", "Badges"]);
    const door = screen.getByRole("button", { name: "Create an agent" });
    expect(shelves()!.contains(door)).toBe(false);
    expect(door.closest(".doors")?.parentElement?.classList.contains("home")).toBe(true);
  });

  it("does not pair agents and badges when nothing needs you", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await met(opus, review)] }));
    await screen.findByRole("region", { name: "Badges" });
    expect(screen.queryByRole("region", { name: "What needs you" })).toBeNull();
    expect(sectionNames()).toEqual(["Agents", "Badges"]);
    expect(shelves()!.classList.contains(PAIRED)).toBe(false);
  });

  it("does not pair What needs you with Badges when there are no agents", async () => {
    renderApp(storageWith({ credentials: [review] }));
    await needs();
    expect(sectionNames()).toEqual(["What needs you", "Badges"]);
    expect(shelves()!.classList.contains(PAIRED)).toBe(false);
  });

  it("an empty folder has no shelves", async () => {
    renderApp(storageWith());
    await screen.findByRole("button", { name: "Try a first test" });
    expect(document.querySelector(".home-empty")).not.toBeNull();
    expect(shelves()).toBeNull();
  });

  it("a need resolved by a reload unpairs the row, and the doors stay the same nodes", async () => {
    const storage = storageWith({ credentials: [review], profiles: [opus, codex], assessments: [await met(opus, review)] });
    renderApp(storage);
    expect((await rows())[0].textContent).toContain("Test Codex agent");
    expect(shelves()!.classList.contains(PAIRED)).toBe(true);
    const door = screen.getByRole("button", { name: "Create an agent" });
    const result = await met(codex, review);
    await storage.writeText("data", assessmentPath(result.profileSlug, result.collectionSlug, result.credentialSlug, result.fileStem), serializeAssessment(result));
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "What needs you" })).toBeNull());
    expect(shelves()!.classList.contains(PAIRED)).toBe(false);
    expect(screen.getByRole("button", { name: "Create an agent" })).toBe(door);
  });
});

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

  it("Covers R1 (router). Home, empty and full, shows three doors in order, the third a dashed handoff card that opens the router", async () => {
    for (const storage of [storageWith(), storageWith({ credentials: [review], profiles: [opus] })]) {
      renderApp(storage);
      await screen.findByRole("button", { name: "Find an agent for a job" });
      const doors = [...document.querySelectorAll(".doors > button.door")].map((d) => d.textContent);
      expect(doors).toEqual(["Create an agent", "Create a credential", "Find an agent for a job"]);
      const door = screen.getByRole("button", { name: "Find an agent for a job" });
      expect(door.querySelector('svg.cast-outline[data-outline="handoff"] [stroke-dasharray]')).not.toBeNull();
      await userEvent.click(door);
      expect(await screen.findByRole("region", { name: "Find an agent for a job" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "The job" })).toBeTruthy();
      cleanup();
    }
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

// The go-to on a badge's card (U4, U7, R7, R9, KTD8): one line under its holders, flagged when
// the go-to's latest result there is not Met, or the badge's task or the go-to's setup changed since.
describe("Home's go-to", () => {
  const day2 = { fileStem: "20260902T090000Z", recordedAt: "2026-09-02T09:00:00.000Z" };
  const markOn = (profile: AgentProfile, fileStem = "20260901T090000Z"): Mark => ({
    collectionSlug: "eng",
    credentialSlug: "review",
    id: "20260903T090000Z",
    profileSlug: profile.slug,
    fileStem,
  });
  const card = async (name: RegExp) => within(await screen.findByRole("region", { name: "Badges" })).getByRole("button", { name });
  const goToLineOf = (el: HTMLElement) => el.querySelector<HTMLElement>(".badge-card-goto");

  it("Covers AE1. A badge two agents hold names its go-to in one line, and the go-to's hidden holder name stays the only exact match", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus, codex], assessments: [await met(opus, review), await met(codex, review)], marks: [markOn(codex)] }));
    const held = await card(/Code review/);
    await waitFor(() => expect(goToLineOf(held)?.textContent).toBe("Go-to: Codex agent"));
    expect(goToLineOf(held)!.classList.contains("flagged")).toBe(false);
    expect(within(held).getAllByText("Codex agent")).toHaveLength(1);
    expect(within(held).getByText("Codex agent").classList.contains("visually-hidden")).toBe(true);
    expect(within(held).getByText("Go-to: Codex agent")).toBe(goToLineOf(held));
  });

  it("a badge with no go-to has no go-to line", async () => {
    renderApp(storageWith({ credentials: [review, docs], profiles: [opus, codex], assessments: [await met(opus, review), await met(codex, review)], marks: [markOn(codex)] }));
    const held = await card(/Code review/);
    await waitFor(() => expect(goToLineOf(held)).not.toBeNull());
    expect(goToLineOf(await card(/Write docs/))).toBeNull();
    expect(within(await card(/Write docs/)).queryByText(/^Go-to/)).toBeNull();
  });

  it("Covers AE5. A go-to whose latest result is Not met leaves the card unheld and still names it, flagged", async () => {
    renderApp(
      storageWith({
        credentials: [review],
        profiles: [opus, codex],
        assessments: [await met(codex, review), await met(codex, review, { ...day2, result: "not_met" })],
        marks: [markOn(codex)],
      }),
    );
    const unheld = await card(/Code review/);
    await waitFor(() => expect(goToLineOf(unheld)?.textContent).toBe("Go-to: Codex agent · not met"));
    expect(unheld.classList.contains("badge-card-unheld")).toBe(true);
    expect(within(unheld).getByText("No holders yet")).toBeTruthy();
    expect(goToLineOf(unheld)!.classList.contains("flagged")).toBe(true);
  });

  it("a go-to whose setup changed since its result is flagged setup changed", async () => {
    const earned = await met(codex, review);
    renderApp(storageWith({ credentials: [review], profiles: [opus, { ...codex, model: "gpt-6" }], assessments: [earned], marks: [markOn(codex)] }));
    const held = await card(/Code review/);
    await waitFor(() => expect(goToLineOf(held)?.textContent).toBe("Go-to: Codex agent · setup changed"));
    expect(goToLineOf(held)!.classList.contains("flagged")).toBe(true);
  });

  it("Covers AE9. A go-to whose badge's task changed since its Met still holds it and is flagged task changed", async () => {
    const earned = await met(codex, review);
    renderApp(storageWith({ credentials: [{ ...review, task: "Review the diff, then its tests." }], profiles: [opus, codex], assessments: [earned], marks: [markOn(codex)] }));
    const held = await card(/Code review/);
    await waitFor(() => expect(goToLineOf(held)?.textContent).toBe("Go-to: Codex agent · task changed"));
    expect(goToLineOf(held)!.classList.contains("flagged")).toBe(true);
    expect(within(held).getByText("Codex agent").classList.contains("visually-hidden")).toBe(true);
  });

  it("Covers AE8. A go-to agent in the trash leaves its badge with no go-to line", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], assessments: [await met(opus, review), await met(codex, review)], marks: [markOn(codex)] }));
    const held = await card(/Code review/);
    await waitFor(() => expect(within(held).getByText("Opus agent")).toBeTruthy());
    expect(goToLineOf(held)).toBeNull();
    expect(within(held).queryByText(/^Go-to/)).toBeNull();
  });
});

// Held replies in What needs you (hold-and-compare KTD12, KTD13): one row per handoff with
// held replies, a cartridge counting them or the one agent's machine, the badge and the
// handoff as detail.
describe("Home's held replies", () => {
  const sonnet: AgentProfile = { ...opus, slug: "sonnet", name: "Sonnet agent", model: "sonnet" };
  const day = (d: number) => ({ fileStem: `2026090${d}T090000Z`, heldAt: `2026-09-0${d}T09:00:00.000Z` });
  const ref = (h: HeldReply) => ({ profileSlug: h.profileSlug, fileStem: h.fileStem });
  const titleOf = (row: HTMLElement) => row.querySelector(".need-title")?.textContent;
  const detailOf = (row: HTMLElement) => row.querySelector(".need-detail")?.textContent;

  /** Home alone, with a spy for where its rows go. */
  function renderHome(storage: MemoryStorage) {
    const navigate = vi.fn<(route: Route) => void>();
    render(
      <FolderProvider storage={storage} folder="/data">
        <NavContext.Provider value={{ route: { view: "home" }, navigate }}>
          <Home />
        </NavContext.Provider>
      </FolderProvider>,
    );
    return navigate;
  }

  it("Covers AE3. Three held replies on one handoff show one row that counts them, drawn as the badge's cartridge", async () => {
    const held = [await heldReply(opus, review, day(2)), await heldReply(codex, review, day(3)), await heldReply(sonnet, review, day(4))];
    renderApp(storageWith({ credentials: [review], profiles: [opus, codex, sonnet], held }));
    const list = await rows();
    expect(list).toHaveLength(1);
    const [row] = list;
    expect(titleOf(row)).toBe("Compare 3 replies");
    expect(detailOf(row)).toBe("Code review · Skeleton");
    expect(row.classList.contains("need-held")).toBe(true);
    expect(row.querySelector("svg.cast-cartridge")).not.toBeNull();
    expect(row.querySelector("svg.cast-machine-mini")).toBeNull();
  });

  it("one held reply names its agent and draws its machine idle, and the agent gets no No results yet row", async () => {
    renderApp(storageWith({ credentials: [review], profiles: [opus], held: [await heldReply(opus, review)] }));
    const list = await rows();
    expect(list).toHaveLength(1);
    const [row] = list;
    expect(titleOf(row)).toBe("Judge Opus agent's reply");
    expect(detailOf(row)).toBe("Code review · Skeleton");
    expect(row.querySelector('svg.cast-machine-mini[data-screen="idle"]')).not.toBeNull();
    expect(row.querySelector("svg.cast-cartridge")).toBeNull();
  });

  it("one agent's held replies on two handoffs of a badge show two rows, each with its own key", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const handoffA = "20260901T080000Z";
      const storage = storageWith({
        credentials: [review],
        profiles: [opus],
        held: [await heldReply(opus, review, day(2)), await heldReply(opus, review, { ...day(3), handoff: { id: handoffA, text: "{{task}}\n" } })],
      });
      storage.seed({ [handoffPath("eng", "review", handoffA)]: "{{task}}\n" });
      renderApp(storage);
      await waitFor(async () => expect((await rows()).map(detailOf)).toEqual(["Code review · Skeleton", "Code review · Handoff A"]));
      expect((await rows()).map(titleOf)).toEqual(["Judge Opus agent's reply", "Judge Opus agent's reply"]);
      expect(errors.mock.calls.some((args) => args.some((a) => /same key/.test(String(a))))).toBe(false);
    } finally {
      errors.mockRestore();
    }
  });

  it("a held row opens the compare of its replies, oldest first and picked, or the one reply", async () => {
    const held = [await heldReply(codex, review, day(3)), await heldReply(opus, review, day(2))];
    let navigate = renderHome(storageWith({ credentials: [review], profiles: [opus, codex], held }));
    await userEvent.click((await rows())[0]);
    const takes = [ref(held[1]), ref(held[0])];
    expect(navigate).toHaveBeenLastCalledWith({ view: "item", item: "compare", credentialKey: "eng/review", takes, picks: takes });
    cleanup();

    navigate = renderHome(storageWith({ credentials: [review], profiles: [opus], held: [held[1]] }));
    await userEvent.click((await rows())[0]);
    expect(navigate).toHaveBeenLastCalledWith({ view: "item", item: "reply", credentialKey: "eng/review", take: ref(held[1]) });
  });
});

/** A collection file holding `credentials`, in their order. */
function collectionFile(slug: string, name: string, credentials: Credential[], from?: string): Record<string, string> {
  const collection: Collection = {
    slug,
    name,
    description: "",
    order: credentials.map((c) => c.slug),
    codes: Object.fromEntries(credentials.map((c, i) => [c.slug, i + 1])),
    ...(from ? { from } : {}),
  };
  const files: Record<string, string> = { [collectionPath(slug)]: serializeCollection(collection) };
  for (const c of credentials) files[credentialPath(slug, c.slug)] = serializeCredentialMd({ ...c, collectionSlug: slug });
  return files;
}

const badges = () => screen.findByRole("region", { name: "Badges" });
const groupsIn = (region: HTMLElement) => within(region).queryAllByRole("group");
const groupNames = (group: HTMLElement) => [...group.querySelectorAll(".badge-card-name")].map((n) => n.textContent);
const audit: Credential = { ...review, slug: "audit", name: "Audit a contract", task: "Audit the contract." };

describe("Home's collections", () => {
  it("Covers AE1. one collection of your own shows one list with no group heading, and only Add a collection beside Badges", async () => {
    renderApp(storageWith({ credentials: [review, docs] }));
    const region = await badges();
    expect(groupsIn(region)).toHaveLength(0);
    expect(within(region).queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(within(region).queryAllByRole("button", { name: /^Add a badge/ })).toHaveLength(0);
    expect(within(region).queryAllByRole("button", { name: /^(Rename|Delete) / })).toHaveLength(0);
    const add = within(region).getByRole("button", { name: "Add a collection" });
    expect(add.closest(".home-section-head")?.querySelector("h2")?.textContent).toBe("Badges");
    expect([...region.querySelectorAll(".badge-card-name")].map((n) => n.textContent)).toEqual(["Code review", "Write docs"]);
    expect(screen.getAllByRole("button", { name: "Add a collection" })).toHaveLength(1);
  });

  it("two collections show two groups, each under its name, with badges in matrix order", async () => {
    const storage = storageWith({ credentials: [review, docs] });
    storage.seed(collectionFile("client", "Client work", [audit, { ...docs, slug: "brief", name: "Write a brief" }]));
    renderApp(storage);
    const region = await badges();
    await waitFor(() => expect(groupsIn(region)).toHaveLength(2));
    const [client, eng] = groupsIn(region);
    // Collections sort by name in the folder, so Client work comes first.
    expect(within(client).getByRole("heading", { level: 3 }).textContent).toBe("Client work");
    expect(within(eng).getByRole("heading", { level: 3 }).textContent).toBe("Engineering");
    expect(groupNames(client)).toEqual(["Audit a contract", "Write a brief"]);
    expect(groupNames(eng)).toEqual(["Code review", "Write docs"]);
    // Each group link names its collection; the visible text stays short.
    const link = within(client).getByRole("button", { name: "Add a badge to Client work" });
    expect(link.textContent).toBe("Add a badge here");
    expect(within(eng).getByRole("button", { name: "Add a badge to Engineering" })).toBeTruthy();
    expect(within(region).getAllByRole("button", { name: "Add a collection" })).toHaveLength(1);
  });

  it("each group's Rename and Delete name the collection, and open its rename and delete decks", async () => {
    const storage = storageWith({ credentials: [review] });
    storage.seed(collectionFile("client", "Client work", [audit]));
    renderApp(storage);
    const region = await badges();
    await waitFor(() => expect(groupsIn(region)).toHaveLength(2));
    const [client, eng] = groupsIn(region);
    const rename = within(client).getByRole("button", { name: "Rename Client work" });
    const del = within(client).getByRole("button", { name: "Delete Client work" });
    expect(rename.textContent).toBe("Rename");
    expect(del.textContent).toBe("Delete");
    expect(within(eng).getByRole("button", { name: "Rename Engineering" })).toBeTruthy();
    expect(within(eng).getByRole("button", { name: "Delete Engineering" })).toBeTruthy();

    await userEvent.click(rename);
    expect(await screen.findByRole("heading", { name: "What is it called" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Client work");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await userEvent.click(await screen.findByRole("button", { name: "Delete Client work" }));
    expect(await screen.findByRole("heading", { name: "Move Client work to the trash" })).toBeTruthy();
  });

  it("a lone built-in copy shows as a named group", async () => {
    const storage = storageWith();
    await addBuiltinCollection(storage, await loadFolder(storage), "nostr-relays");
    renderApp(storage);
    const region = await badges();
    const [group] = groupsIn(region);
    expect(within(group).getByRole("heading", { level: 3 }).textContent).toBe("Nostr relays");
    expect(within(group).getByRole("button", { name: "Add a badge to Nostr relays" })).toBeTruthy();
  });

  it("Add a badge here opens the credential deck for that collection, and the badge lands there", async () => {
    const storage = storageWith({ credentials: [review] });
    storage.seed(collectionFile("client", "Client work", [audit]));
    renderApp(storage);
    await userEvent.click(await screen.findByRole("button", { name: "Add a badge to Client work" }));
    await userEvent.click(await screen.findByRole("button", { name: "Name what matters next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Make the badge" }));
    await screen.findByRole("button", { name: "Test it on an agent" });
    const made = (await loadFolder(storage)).credentials.find((c) => c.slug === "name-what-matters-next");
    expect(made?.collectionSlug).toBe("client");
  });

  it("My credentials with badges plus an empty Client work shows two groups, Client work with its heading and link and no shelf", async () => {
    const storage = storageWith();
    storage.seed({ ...collectionFile("my-credentials", "My credentials", [review, docs]), ...collectionFile("client-work", "Client work", []) });
    renderApp(storage);
    const region = await badges();
    await waitFor(() => expect(groupsIn(region)).toHaveLength(2));
    const [client, mine] = groupsIn(region);
    expect(within(client).getByRole("heading", { level: 3 }).textContent).toBe("Client work");
    expect(within(client).getByRole("button", { name: "Add a badge to Client work" })).toBeTruthy();
    expect(within(client).queryByRole("list")).toBeNull();
    expect(groupNames(mine)).toEqual(["Code review", "Write docs"]);
  });

  it("an empty folder shows Add a collection under the doors, and it opens the deck", async () => {
    renderApp(storageWith());
    const add = await screen.findByRole("button", { name: "Add a collection" });
    const doors = document.querySelector(".doors")!;
    expect(doors.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(doors.contains(add)).toBe(false);
    expect(screen.queryByRole("region", { name: "Badges" })).toBeNull();
    await userEvent.click(add);
    expect(await screen.findByRole("region", { name: "Add a collection" })).toBeTruthy();
  });

  it("an empty folder after adding Nostr relays shows a Nostr relays group with its link", async () => {
    renderApp(storageWith());
    await userEvent.click(await screen.findByRole("button", { name: "Add a collection" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Nostr relays/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add the collection" }));
    const region = await badges();
    const [group] = groupsIn(region);
    expect(within(group).getByRole("heading", { level: 3 }).textContent).toBe("Nostr relays");
    expect(within(group).getByRole("button", { name: "Add a badge to Nostr relays" })).toBeTruthy();
    // Under the doors it is gone, and beside Badges it stays.
    expect(screen.getAllByRole("button", { name: "Add a collection" })).toHaveLength(1);
    expect(region.contains(screen.getByRole("button", { name: "Add a collection" }))).toBe(true);
  });
});

describe("Home's collections and the router", () => {
  const cred = (slug: string, name: string): Credential => ({ ...review, slug, name, learningTargets: [`I can ${name.toLowerCase()}.`], task: `Do ${name}.` });
  const migration = cred("migration", "Write a migration");
  const codex: AgentProfile = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt" };
  const sonnet: AgentProfile = { ...opus, slug: "sonnet", name: "Sonnet agent", model: "sonnet" };

  it("adding a collection with five badges leaves an earlier match that cited only older badges standing", async () => {
    const storage = folderWith({
      credentials: [migration, cred("docs", "Write docs"), cred("deploy", "Ship a deploy")],
      profiles: [codex, opus, sonnet],
      assessments: [await met(codex, migration), await met(sonnet, migration)],
      marks: [{ collectionSlug: "eng", credentialSlug: "migration", id: "20260902T090000Z", profileSlug: "codex", fileStem: "20260901T090000Z" }],
      costOrder: ["sonnet", "codex", "opus"],
    });
    const jev = new FakeJev(FAKE_ON);
    const answer: JevAnswers = { answers: { m1: 0.9, m2: 0.1, m3: 0.1 }, levels: { difficulty: [1, 0, 0] }, model: "jev-1.13.0" };
    jev.queue("ask", answer);
    renderWithJev(storage, jev, { view: "deck", deck: "router" });
    fireEvent.change(await screen.findByRole("textbox", { name: "Job" }), { target: { value: "Add a reversible migration" } });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByRole("heading", { name: "Codex agent" })).toBeTruthy();
    // Cardano Dev Skills sorts before Engineering, so its five badges lead Home's order.
    await addBuiltinCollection(storage, await loadFolder(storage), "cardano-dev-skills");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(async () => expect((await loadFolder(storage)).credentials).toHaveLength(8));
    expect(await screen.findByRole("heading", { name: "Codex agent" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "No badge like this job" })).toBeNull();
    expect(jev.asks).toHaveLength(1);
  });
});
