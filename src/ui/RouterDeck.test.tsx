// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { profilePath } from "../domain/folder";
import type { JevAnswers, RouteRequest } from "../domain/jevRequest";
import type { AgentProfile, Assessment, Credential, Mark } from "../domain/types";
import { FAKE_ON, FakeJev } from "../jev/fakeJev";
import { JEV_OFF, JevError } from "../jev/jev";
import type { MemoryStorage } from "../storage/memory";
import { AppShell, type Route } from "./AppShell";
import { JevProvider } from "./jevContext";
import { FOLDER, opus, result, storageWith } from "./testFolder";
import { FolderProvider } from "./useFolderState";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
// ProseMirror typing does not run in jsdom; these flows type into a textarea stand-in.
vi.mock("./RichText", () => import("./richTextStub"));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const cred = (slug: string, name: string, task = `Do ${name}.`): Credential => ({
  slug,
  collectionSlug: "eng",
  name,
  learningTargets: [`I can ${name.toLowerCase()}.`],
  task,
  rubric: "SECRET RUBRIC",
  extraSections: [],
});
const migration = cred("migration", "Write a migration");
const docs = cred("docs", "Write docs");
const deploy = cred("deploy", "Ship a deploy");
const codex: AgentProfile = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt" };
const sonnet: AgentProfile = { ...opus, slug: "sonnet", name: "Sonnet agent", model: "sonnet" };

const ROUTER: Route = { view: "deck", deck: "router" };
const JOB = "Add a reversible migration for the users table";

function goTo(p: AgentProfile, c: Credential): Mark {
  return { collectionSlug: c.collectionSlug, credentialSlug: c.slug, id: "20260902T090000Z", profileSlug: p.slug, fileStem: "20260901T090000Z" };
}

/** A folder where Codex is Write a migration's go-to and Sonnet also holds it, cheaper. */
async function folder(opts: { costOrder?: string[]; marks?: Mark[]; assessments?: Assessment[] } = {}) {
  return storageWith({
    credentials: [migration, docs, deploy],
    profiles: [codex, opus, sonnet],
    assessments: opts.assessments ?? [await result(codex, migration), await result(sonnet, migration)],
    marks: opts.marks ?? [goTo(codex, migration)],
    costOrder: "costOrder" in opts ? opts.costOrder : ["sonnet", "codex", "opus"],
  });
}

function renderRouter(storage: MemoryStorage, jev: FakeJev, route: Route = ROUTER) {
  return render(
    <JevProvider jev={jev}>
      <FolderProvider storage={storage} folder={FOLDER}>
        <AppShell onChangeFolder={() => {}} initialRoute={route} />
      </FolderProvider>
    </JevProvider>,
  );
}

/** Jev's answer to a route over the three badges: each match id's probability, and the levels. */
function answer(m: [number, number, number], levels: number[] = [1, 0, 0]): JevAnswers {
  return { answers: { m1: m[0], m2: m[1], m3: m[2] }, levels: { difficulty: levels }, model: "jev-1.13.0" };
}

async function pasteJob(text = JOB) {
  fireEvent.change(await screen.findByRole("textbox", { name: "Job" }), { target: { value: text } });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

const routingFiles = (storage: MemoryStorage) => Object.keys(storage.files()).filter((p) => p.startsWith("routing/"));
const record = (storage: MemoryStorage) => JSON.parse(storage.file(routingFiles(storage)[0])!);

describe("RouterDeck with Jev", () => {
  it("Covers F1, AE1. says what goes, asks once, and recommends the go-to, noting the cheaper holder", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", answer([0.9, 0.1, 0.1]));
    renderRouter(storage, jev);
    await pasteJob();
    expect(await screen.findByRole("heading", { name: "Ask Jev which badge it's like" })).toBeTruthy();
    expect(screen.getByText("Sends the job, and the names, tasks and learning targets of 3 badges, to TypeSafe")).toBeTruthy();
    expect(jev.asks).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByRole("heading", { name: "Codex agent" })).toBeTruthy();
    expect(jev.asks).toHaveLength(1);
    const sent = jev.asks[0] as RouteRequest;
    expect(sent.kind).toBe("route");
    expect(sent.state).toEqual({ job: JOB });
    expect(JSON.stringify(sent)).not.toContain("SECRET RUBRIC");
    expect(screen.getByText("Go-to for Write a migration")).toBeTruthy();
    expect(screen.getByText("Sonnet agent also holds this, for less")).toBeTruthy();
    expect(screen.getByText("Jev rates this job routine")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Answered" })).getByText("Like Write a migration")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Take Codex agent" }));
    await screen.findByRole("heading", { name: "Home" });
    expect(record(storage)).toMatchObject({
      job: JOB,
      credential: "migration",
      agent: "codex",
      recommended: "codex",
      basis: "go-to",
      steppedUp: false,
      matched: "jev",
      difficulty: "routine",
      jevModel: "jev-1.13.0",
    });
  });

  it("Covers AE3. a job rated unusual or high-stakes steps up one placed holder, and says why", async () => {
    const storage = await folder({ marks: [] });
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", answer([0.9, 0.1, 0.1], [0, 0.2, 0.8]));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByRole("heading", { name: "Codex agent" })).toBeTruthy();
    expect(screen.getByText("Stepped up: Jev rates this job unusual or high-stakes")).toBeTruthy();
    expect(screen.getByText("Sonnet agent also holds this, for less")).toBeTruthy();
  });

  it("Covers AE4. no badge over the threshold is a miss, and Make a badge from this job opens the credential deck", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", answer([0.69, 0.4, 0.1]));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByRole("heading", { name: "No badge like this job" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Make a badge from this job" }));
    expect(await screen.findByRole("region", { name: "Create a credential" })).toBeTruthy();
  });

  it("Covers AE5. a matched badge nobody holds cleanly offers a bake-off, naming the flagged holder", async () => {
    const stale = await result(opus, deploy, { assignmentVersion: "older" });
    const storage = await folder({ assessments: [stale] });
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", answer([0.1, 0.1, 0.95]));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByRole("heading", { name: "No agent holds Ship a deploy yet" })).toBeTruthy();
    expect(screen.getByText("Opus agent needs a re-test: task changed")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Run a bake-off on it" }));
    expect(await screen.findByRole("region", { name: "Test an agent" })).toBeTruthy();
  });

  it("Covers AE9. a second badge over the threshold is also like, and tapping it switches the card without asking again", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", answer([0.82, 0.1, 0.91]));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByRole("heading", { name: "No agent holds Ship a deploy yet" })).toBeTruthy();
    expect(screen.getByText(/Also like:/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Write a migration" }));
    expect(await screen.findByRole("heading", { name: "Codex agent" })).toBeTruthy();
    expect(jev.asks).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Take Codex agent" }));
    await screen.findByRole("heading", { name: "Home" });
    expect(record(storage)).toMatchObject({ matched: "also-like", credential: "migration" });
  });

  it("Covers AE8. choosing another holder presses it and relabels the forward, which records it beside the pick", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", answer([0.9, 0.1, 0.1]));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    await screen.findByRole("heading", { name: "Codex agent" });
    const group = screen.getByRole("list", { name: "Agents that hold it" });
    expect(within(group).getByRole("button", { name: "Codex agent" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(within(group).getByRole("button", { name: "Sonnet agent" }));
    expect(within(group).getByRole("button", { name: "Sonnet agent" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Codex agent" }).getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: "Take Sonnet agent" }));
    await screen.findByRole("heading", { name: "Home" });
    expect(record(storage)).toMatchObject({ agent: "sonnet", recommended: "codex", setup: { harness: "claude-code", model: "sonnet", effort: "high" } });
  });

  it("the lead reason renders before the record rows", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", answer([0.9, 0.1, 0.1]));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    const lead = await screen.findByText("Go-to for Write a migration");
    const rows = screen.getByRole("list", { name: "Its record" });
    expect(lead.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a rate-limited ask shows its line, and Ask Jev works again", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", new JevError("rateLimited", { retryAfter: 120 }));
    jev.queue("ask", answer([0.9, 0.1, 0.1]));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByText("Jev has had too many asks. Try again in a moment.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByRole("heading", { name: "Codex agent" })).toBeTruthy();
  });

  it("a job too long for Jev says so before anything is sent, and keeps Pick the badge myself", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    renderRouter(storage, jev);
    await pasteJob("j".repeat(140_000));
    expect(await screen.findByText("This job is too long for Jev.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask Jev" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Pick the badge myself" }));
    expect(await screen.findByRole("heading", { name: "Which badge is it like" })).toBeTruthy();
    expect(jev.asks).toHaveLength(0);
  });

  it("Back while asking, then the answer landing, moves nothing; editing the job asks again", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    let land!: (a: JevAnswers) => void;
    jev.queue("ask", new Promise<JevAnswers>((r) => (land = r)));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "The job" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await act(async () => land(answer([0.9, 0.1, 0.1])));
    expect(screen.getByRole("heading", { name: "Ask Jev which badge it's like" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask Jev" })).toBeTruthy();
  });

  it("Pick the badge myself while asking, then the late answer, leaves the pick card in place", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    let land!: (a: JevAnswers) => void;
    jev.queue("ask", new Promise<JevAnswers>((r) => (land = r)));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(screen.getByRole("button", { name: "Asking Jev…" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Pick the badge myself" }));
    await act(async () => land(answer([0.9, 0.1, 0.1])));
    expect(screen.getByRole("heading", { name: "Which badge is it like" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Codex agent" })).toBeNull();
  });

  it("closing the deck while asking sends no later request", async () => {
    const long = "x".repeat(60_000);
    const storage = storageWith({ credentials: [1, 2, 3, 4, 5].map((n) => cred(`b${n}`, `Badge ${n}`, long)), profiles: [codex] });
    const jev = new FakeJev(FAKE_ON);
    let land!: (a: JevAnswers) => void;
    jev.queue("ask", new Promise<JevAnswers>((r) => (land = r)));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await screen.findByRole("heading", { name: "Home" });
    const first = jev.asks[0] as RouteRequest;
    await act(async () => land({ answers: Object.fromEntries(Object.keys(first.questions).filter((id) => id !== "difficulty").map((id) => [id, 0.1])), levels: { difficulty: [1, 0, 0] } }));
    expect(jev.asks).toHaveLength(1);
  });

  it("an ask that finds Jev Mode off swaps to the pick card, which keeps the job and shows why", async () => {
    const storage = await folder();
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", new JevError("off"));
    // The first read is the provider's own on mount; the second, after the failed ask, finds it off.
    jev.queue("status", FAKE_ON);
    jev.queue("status", JEV_OFF);
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByRole("heading", { name: "Which badge is it like" })).toBeTruthy();
    expect(screen.getByText(/Jev Mode is off/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByRole("textbox", { name: "Job" }) as HTMLTextAreaElement).value).toBe(JOB);
  });

  it("Covers AE7. no cost order and no go-to: says so, offers the holders, and Order by cost comes back to the card", async () => {
    const storage = await folder({ costOrder: undefined, marks: [] });
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", answer([0.9, 0.1, 0.1]));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByText("Your agents have no cost order yet")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Order by cost" }));
    expect(await screen.findByRole("region", { name: "Order by cost" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Move Sonnet agent up" }));
    await userEvent.click(screen.getByRole("button", { name: "Move Sonnet agent up" }));
    await userEvent.click(screen.getByRole("button", { name: "Save the order" }));
    expect(await screen.findByRole("heading", { name: "Sonnet agent" })).toBeTruthy();
    expect(screen.getByText("Cheapest agent holding Write a migration")).toBeTruthy();
    expect(jev.asks).toHaveLength(1);
  });

  it("the recommended agent trashed while the card is open re-picks from what is left", async () => {
    const storage = await folder({ marks: [] });
    const jev = new FakeJev(FAKE_ON);
    jev.queue("ask", answer([0.9, 0.1, 0.1]));
    renderRouter(storage, jev);
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "Ask Jev" }));
    expect(await screen.findByRole("heading", { name: "Sonnet agent" })).toBeTruthy();
    await storage.moveFile("data", profilePath("sonnet"), "trash/x/agents/sonnet.json");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("heading", { name: "Codex agent" })).toBeTruthy();
  });
});

describe("RouterDeck without Jev", () => {
  it("Covers F2, AE6. asks the user to pick the badge, sends nothing, and never steps up", async () => {
    const storage = await folder({ marks: [] });
    const jev = new FakeJev(JEV_OFF);
    renderRouter(storage, jev);
    await pasteJob();
    expect(await screen.findByRole("heading", { name: "Which badge is it like" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Write a migration" }));
    expect(await screen.findByRole("heading", { name: "Sonnet agent" })).toBeTruthy();
    expect(screen.queryByText(/Stepped up/)).toBeNull();
    expect(screen.queryByText(/Jev rates/)).toBeNull();
    expect(jev.asks).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Take Sonnet agent" }));
    await screen.findByRole("heading", { name: "Home" });
    const r = record(storage);
    expect(r).toMatchObject({ matched: "picked", agent: "sonnet", basis: "cheapest" });
    expect(r.difficulty).toBeUndefined();
    expect(r.jevModel).toBeUndefined();
  });

  it("None of these is a miss", async () => {
    renderRouter(await folder(), new FakeJev(JEV_OFF));
    await pasteJob();
    await userEvent.click(await screen.findByRole("button", { name: "None of these" }));
    expect(await screen.findByRole("heading", { name: "No badge like this job" })).toBeTruthy();
  });

  it("with no badges at all, Next on the job goes straight to the miss, asking nothing", async () => {
    const jev = new FakeJev(FAKE_ON);
    renderRouter(storageWith({ profiles: [codex] }), jev);
    await pasteJob();
    expect(await screen.findByRole("heading", { name: "No badge like this job" })).toBeTruthy();
    expect(jev.asks).toHaveLength(0);
  });

  it("Escape on the job pane with text typed never closes the deck", async () => {
    renderRouter(await folder(), new FakeJev(JEV_OFF));
    fireEvent.change(await screen.findByRole("textbox", { name: "Job" }), { target: { value: JOB } });
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "Find an agent for a job" })).toBeTruthy();
  });
});
