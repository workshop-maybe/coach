// @vitest-environment jsdom
// The Quineling view (U5 of docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md, R6-R11,
// R17, R19; KTD4, KTD9, KTD12): a reply to a program badge opens into the checks, the fixtures
// and the body, with the reply's header, verdict actions and way back as in the reply view. The
// runtime is the real vendored one; the body's drawing is mocked, since jsdom has no canvas.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assessmentPath, collectionPath, credentialPath, serializeCollection } from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import { checkProgram } from "../domain/programChecks";
import { loadQuinelings, newSession, type QuinelingsRuntime } from "../domain/quinelings";
import type { Assessment, Credential, FolderState, Handoff } from "../domain/types";
import type { MemoryStorage } from "../storage/memory";
import { formatDate } from "./format";
import type { TakeRef } from "./routes";
import { heldReply, opus, renderApp, result, review, storageWith } from "./testFolder";

// These tests load and run the real Quinelings runtime: about 1 s to load, about 25 ms a run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const builds = vi.hoisted(() => ({ last: null as FolderState | null }));
vi.mock("../domain/matrix", async (importOriginal) => {
  const real = await importOriginal<typeof import("../domain/matrix")>();
  return {
    ...real,
    buildMatrix: async (state: FolderState) => {
      const matrix = await real.buildMatrix(state);
      builds.last = state;
      return matrix;
    },
  };
});
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("./pdfDocument", () => ({ openPdf: vi.fn() }));
// jsdom has no canvas: the body stands in as a box that shows what the view hands it.
vi.mock("./QuinelingBody", () => ({
  QuinelingBody: (props: { artifact: { id: string }; trace: unknown[] | null; walkKey: number; redNodeId: string | null; guessNodeId: string | null }) => (
    <div
      className="quineling-canvas-wrap"
      data-testid="body"
      data-artifact={props.artifact.id}
      data-trace={props.trace === null ? "none" : String(props.trace.length)}
      data-walk={props.walkKey}
      data-red={props.redNodeId ?? ""}
      data-guess={props.guessNodeId ?? ""}
    />
  ),
}));

let rt: QuinelingsRuntime;
beforeAll(async () => {
  rt = await loadQuinelings();
});
beforeEach(() => {
  localStorage.clear();
  builds.last = null;
});
afterEach(cleanup);

const codex = { ...opus, slug: "codex", name: "Codex agent", harness: "codex", model: "gpt-5", effort: "medium" };
/** The Bounded programs copy's gather-readiness badge, in the folder's own collection. */
const gather: Credential = { ...review, slug: "gather-readiness", collectionSlug: "eng", name: "Gather readiness", task: "Write the program." };
const KEY = "eng/gather-readiness";
const a: Handoff = { id: "a", collectionSlug: "eng", credentialSlug: "gather-readiness", text: "# A\n\n{{task}}\n" };
const day = (n: number) => ({ fileStem: `2026090${n}T090000Z`, recordedAt: `2026-09-0${n}T09:00:00.000Z` });
const heldDay = (n: number) => ({ fileStem: day(n).fileStem, heldAt: day(n).recordedAt });
const take = (slug: string, n: number): TakeRef => ({ profileSlug: slug, fileStem: day(n).fileStem });
const BOUNDARY = "inclusive freshness boundary";

type Step = { id: string; params: Record<string, unknown> };
const intent = () => structuredClone(rt.QDLV1Library.get("gather-readiness").intent) as unknown as { steps: Step[] } & Record<string, unknown>;
/** gather-readiness with `young` comparing with `lt` where the job uses `lte` (AE1). */
function strictYoung() {
  const program = intent();
  program.steps.find((s) => s.id === "young")!.params = { operator: "lt" };
  return program;
}
const fenced = (program: unknown, before = "Here is the program.") => `${before}\n\n\`\`\`json\n${JSON.stringify(program, null, 2)}\n\`\`\`\n`;

/** A folder whose `eng` collection is a copy of Bounded programs, holding gather-readiness. */
function programFolder(opts: { assessments?: Assessment[]; held?: Awaited<ReturnType<typeof heldReply>>[]; ordinary?: boolean }) {
  const storage = storageWith({ credentials: opts.ordinary ? [review] : [], profiles: [opus, codex], handoffs: [a], assessments: opts.assessments, held: opts.held });
  const order = opts.ordinary ? ["review", "gather-readiness"] : ["gather-readiness"];
  storage.seed({
    [collectionPath("eng")]: serializeCollection({
      slug: "eng",
      name: "Bounded programs",
      description: "",
      order,
      codes: Object.fromEntries(order.map((s, i) => [s, i + 1])),
      from: "bounded-programs",
    }),
    [credentialPath("eng", "gather-readiness")]: serializeCredentialMd(gather),
  });
  return storage;
}

function open(storage: MemoryStorage, at: TakeRef = take("opus", 1), key = KEY) {
  return renderApp(storage, { view: "item", item: "reply", credentialKey: key, take: at });
}

/** The view, once the runtime has loaded. */
async function ready(): Promise<HTMLElement> {
  const view = await waitFor(() => {
    const el = document.querySelector<HTMLElement>(".quineling-view");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("aria-busy")).toBeNull();
    return el!;
  });
  return view;
}

const checksPanel = () => screen.getByRole("region", { name: "Checks" });
const runButton = () => screen.getByRole("button", { name: "Run the fixtures" }) as HTMLButtonElement;
const fixtureButton = (name: string) => within(screen.getByRole("region", { name: "Fixtures" })).getByRole("button", { name: new RegExp(`^${name}`) });
const fixtureNames = () => rt.QDLV1Library.get("gather-readiness").fixtures.map((f) => f.name);
const detail = () => screen.getByRole("region", { name: "Fixtures" }).querySelector<HTMLElement>(".fixture-detail")!;

function reloadAfter(change: () => void) {
  change();
  fireEvent.focus(window);
}
const resultPath = (r: Assessment) => assessmentPath(r.profileSlug, r.collectionSlug, r.credentialSlug, r.fileStem);

/** The take's row on the page the view went back to, found by its pick box's name. */
function takeHead(agent: string, n: number): HTMLElement {
  const box = screen.getByRole("checkbox", { name: `Pick ${agent}, ${formatDate(day(n).recordedAt)}` });
  return box.parentElement!.querySelector("button.take-head")!;
}

describe("QuinelingView", () => {
  it("a reply to a program badge opens the Quineling view; a reply to an ordinary badge opens the reply view", async () => {
    const storage = programFolder({
      ordinary: true,
      assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()) }), await result(opus, review, { ...day(2) })],
    });
    open(storage);
    await ready();
    expect(screen.getByRole("region", { name: "Checks" })).toBeTruthy();
    cleanup();

    open(storage, take("opus", 2), "eng/review");
    await screen.findByRole("heading", { name: "Opus agent", level: 2 });
    expect(document.querySelector(".quineling-view")).toBeNull();
    expect(document.querySelector(".reply-view")).not.toBeNull();
  });

  it("the header names the agent, its setup and the date, and the checks say it compiles with its operation count and reproduces its source", async () => {
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()) })] }));
    const heading = await screen.findByRole("heading", { name: "Opus agent", level: 2 });
    const bar = heading.closest<HTMLElement>(".reply-bar")!;
    expect(within(bar).getByText("claude-code · opus · high")).toBeTruthy();
    expect(within(bar).getByText(new RegExp(formatDate(day(1).recordedAt)))).toBeTruthy();
    await ready();
    const operations = (checkProgram(newSession(rt), intent()) as { operations: number }).operations;
    expect(within(checksPanel()).getByText(`Compiles · ${operations} operations`)).toBeTruthy();
    expect(within(checksPanel()).getByText("Reproduces its own source")).toBeTruthy();
    expect(runButton().disabled).toBe(false);
    expect(screen.getByTestId("body").dataset.trace).toBe("none");
  });

  it("before a run lists the fixtures in the library's order with no result, the first selected showing its expected output only", async () => {
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()) })] }));
    await ready();
    const list = within(screen.getByRole("region", { name: "Fixtures" })).getAllByRole("button");
    expect(list.map((b) => b.querySelector(".fixture-name")?.textContent)).toEqual(fixtureNames());
    expect(screen.queryByText("matches")).toBeNull();
    expect(screen.queryByText("differs")).toBeNull();
    expect(fixtureButton(fixtureNames()[0]).getAttribute("aria-pressed")).toBe("true");
    expect(within(detail()).getByText("Expected")).toBeTruthy();
    expect(within(detail()).queryByText("Actual")).toBeNull();
    expect([...detail().querySelectorAll(".fixture-output-name")].map((n) => n.textContent)).toEqual(rt.QDLV1Library.get("gather-readiness").intent.outputs);
  });

  it("Covers AE1. after Run the fixtures, inclusive freshness boundary differs and is selected, with expected and actual output and the likely cause naming young as a guess", async () => {
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(strictYoung()) })] }));
    await ready();
    await userEvent.click(runButton());

    const boundary = fixtureButton(BOUNDARY);
    expect(within(boundary).getByText("differs")).toBeTruthy();
    expect(boundary.getAttribute("aria-pressed")).toBe("true");
    for (const name of fixtureNames().filter((n) => n !== BOUNDARY)) expect(within(fixtureButton(name)).getByText("matches")).toBeTruthy();

    const shown = detail();
    expect(within(shown).getByText("Expected")).toBeTruthy();
    expect(within(shown).getByText("Actual")).toBeTruthy();
    expect(shown.textContent).toContain('"status":"simulated"');
    expect(shown.textContent).toContain('"status":"skipped"');
    const guess = shown.querySelector<HTMLElement>(".fixture-guess")!;
    expect(within(guess).getByText("Likely cause")).toBeTruthy();
    expect(guess.textContent).toContain("young");
    expect(guess.textContent).toMatch(/guess/i);

    const body = screen.getByTestId("body");
    expect(body.dataset.red).not.toBe("");
    expect(body.dataset.guess).toBe("young");
    expect(body.dataset.trace).not.toBe("none");
    const walked = Number(body.dataset.walk);
    expect(walked).toBeGreaterThan(0);

    // Selecting another fixture replays the walk on its trace, with no marks.
    await userEvent.click(fixtureButton(fixtureNames()[1]));
    expect(Number(screen.getByTestId("body").dataset.walk)).toBe(walked + 1);
    expect(screen.getByTestId("body").dataset.red).toBe("");
    expect(detail().querySelector(".fixture-guess")).toBeNull();
  });

  it("the fixture list moves with the arrow keys", async () => {
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()) })] }));
    await ready();
    const [first, second] = fixtureNames();
    fixtureButton(first).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(fixtureButton(second));
    expect(fixtureButton(second).getAttribute("aria-pressed")).toBe("true");
  });

  it("a refusal shows the expected and actual status with the diagnostic", async () => {
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()) })] }));
    await ready();
    await userEvent.click(runButton());
    const refused = fixtureNames().find((n) => n.startsWith("missing"))!;
    await userEvent.click(fixtureButton(refused));
    expect(within(fixtureButton(refused)).getByText("matches")).toBeTruthy();
    expect(detail().textContent).toContain("refused · missing-input");
  });

  it("Covers AE4. a prose-only held reply says no program was found, shows the dashed outline and a disabled Run the fixtures, still offers Met and Not yet, and keeps the reply readable", async () => {
    const held = await heldReply(codex, gather, { ...heldDay(2), handBack: "I could not write a program for this one." });
    const storage = programFolder({ held: [held] });
    open(storage, take("codex", 2));
    await ready();
    expect(within(checksPanel()).getByText("No program found")).toBeTruthy();
    expect(document.querySelector('[data-outline="body"]')).not.toBeNull();
    expect(screen.queryByTestId("body")).toBeNull();
    expect(runButton().disabled).toBe(true);
    expect(document.querySelectorAll("button.primary")).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Reply" })).getByText("I could not write a program for this one.")).toBeTruthy();

    await userEvent.click(within(checksPanel()).getByRole("button", { name: "Met" }));
    const bar = screen.getByRole("heading", { name: "Codex agent", level: 2 }).closest<HTMLElement>(".reply-bar")!;
    await waitFor(() => expect(within(bar).getByText("Met")).toBeTruthy());
    expect(storage.file(assessmentPath("codex", "eng", "gather-readiness", held.fileStem))).toMatch(/^result: met$/m);
  });

  it("a reply with two different programs says so, with the count", async () => {
    const text = `${fenced(intent())}\n${fenced(strictYoung(), "Or this one.")}`;
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: text })] }));
    await ready();
    expect(within(checksPanel()).getByText("More than one program")).toBeTruthy();
    expect(within(checksPanel()).getByText("2 programs in the reply")).toBeTruthy();
    expect(runButton().disabled).toBe(true);
  });

  it("a program that does not parse says it could not be read, with the parser's message", async () => {
    const text = 'Here.\n\n```json\n{ "format": "qdl-intent", "steps": [ }\n```\n';
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: text })] }));
    await ready();
    expect(within(checksPanel()).getByText("Could not read the program")).toBeTruthy();
    expect(checksPanel().querySelector(".quineling-diagnostic")?.textContent).not.toBe("");
    expect(runButton().disabled).toBe(true);
  });

  it("a program that fails to compile shows the diagnostic and the outline", async () => {
    const broken = intent();
    broken.steps.find((s) => s.id === "young")!.params = { operator: "nearly" };
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(broken) })] }));
    await ready();
    expect(within(checksPanel()).getByText("Does not compile")).toBeTruthy();
    expect(checksPanel().querySelector(".quineling-diagnostic")?.textContent).toMatch(/\S/);
    expect(document.querySelector('[data-outline="body"]')).not.toBeNull();
    expect(runButton().disabled).toBe(true);
  });

  it("Covers AE5. a held reply whose fixtures all match shows Met and Not yet with neither pressed; choosing Met records a result", async () => {
    const held = await heldReply(codex, gather, { ...heldDay(2), handBack: fenced(intent()) });
    const storage = programFolder({ held: [held] });
    open(storage, take("codex", 2));
    await ready();
    await userEvent.click(runButton());
    for (const name of fixtureNames()) expect(within(fixtureButton(name)).getByText("matches")).toBeTruthy();
    const met = within(checksPanel()).getByRole("button", { name: "Met" });
    const notYet = within(checksPanel()).getByRole("button", { name: "Not yet" });
    for (const b of [met, notYet]) {
      expect(b.getAttribute("aria-pressed")).toBeNull();
      expect(b.classList.contains("primary")).toBe(false);
    }
    // Running recorded nothing.
    expect(storage.file(assessmentPath("codex", "eng", "gather-readiness", held.fileStem))).toBeUndefined();
    await userEvent.click(met);
    const bar = screen.getByRole("heading", { name: "Codex agent", level: 2 }).closest<HTMLElement>(".reply-bar")!;
    await waitFor(() => expect(within(bar).getByText("Met")).toBeTruthy());
    expect(storage.file(assessmentPath("codex", "eng", "gather-readiness", held.fileStem))).toMatch(/^result: met$/m);
  });

  it("a judged result shows its Change to link, and its fixtures still run", async () => {
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), result: "not_met", handBack: fenced(strictYoung()) })] }));
    await ready();
    expect(within(checksPanel()).getByRole("button", { name: "Change to Met" })).toBeTruthy();
    await userEvent.click(runButton());
    expect(within(fixtureButton(BOUNDARY)).getByText("differs")).toBeTruthy();
  });

  it("Close returns to the badge with the reply's row lit and focused", async () => {
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()) }), await result(codex, gather, day(2))] }));
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "Gather readiness", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(takeHead("Opus agent", 1)));
  });

  it("Escape returns to the handoff page once two runs exist", async () => {
    open(
      programFolder({
        assessments: [
          await result(opus, gather, { ...day(1), handBack: fenced(intent()) }),
          await result(opus, gather, { ...day(2), handoff: { id: "a", text: "Filled A" } }),
          await result(codex, gather, { ...day(3), handoff: { id: "a", text: "Filled A" } }),
        ],
      }),
    );
    await ready();
    await waitFor(() => expect(builds.last).not.toBeNull());
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "Skeleton", level: 2 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(takeHead("Opus agent", 1)));
  });

  it("the take's file disappearing on a focus reload shows Missing", async () => {
    const gone = await result(opus, gather, { ...day(1), handBack: fenced(intent()) });
    const storage = programFolder({ assessments: [gone] });
    open(storage);
    await ready();
    reloadAfter(() => storage.remove(resultPath(gone)));
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to the badge" })).toBeTruthy();
  });

  it("a trashed badge sends Close home", async () => {
    const storage = programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()) })] });
    open(storage);
    await ready();
    reloadAfter(() => storage.remove(credentialPath("eng", "gather-readiness")));
    expect(await screen.findByRole("heading", { name: "Not in the folder" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(await screen.findByRole("region", { name: "Badges" })).toBeTruthy();
  });

  it("renaming the badge while the view is open keeps the view", async () => {
    const storage = programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()) })] });
    open(storage);
    await ready();
    await userEvent.click(runButton());
    reloadAfter(() => storage.seed({ [credentialPath("eng", "gather-readiness")]: serializeCredentialMd({ ...gather, name: "Readiness, renamed" }) }));
    await waitFor(() => expect(builds.last?.credentials[0]?.name).toBe("Readiness, renamed"));
    expect(document.querySelector(".quineling-view")).not.toBeNull();
    expect(within(fixtureButton(BOUNDARY)).getByText("matches")).toBeTruthy();
  });

  it("hostile program text renders as text, with no script, frame, source or handler", async () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script><iframe src="x"></iframe>';
    const program = intent();
    program.steps.find((s) => s.id === "young")!.id = hostile;
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(program, hostile) })] }));
    const view = await ready();
    expect(view.querySelector("script, iframe, [src]")).toBeNull();
    for (const el of view.querySelectorAll("*")) for (const attr of el.getAttributeNames()) expect(attr.startsWith("on")).toBe(false);
  });

  it("holds aria-busy on the view while the runtime loads, and the page holds exactly one button.primary", async () => {
    // The view's first render comes before the runtime's promise settles, even with it cached.
    let busy = false;
    const watch = new MutationObserver(() => {
      if (document.querySelector('.quineling-view[aria-busy="true"]')) busy = true;
    });
    watch.observe(document.body, { childList: true, subtree: true, attributes: true });
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()) })] }));
    await ready();
    watch.disconnect();
    expect(busy).toBe(true);
    expect(document.querySelectorAll("button.primary")).toHaveLength(1);
    expect(runButton().classList.contains("primary")).toBe(true);
  });

  it("a saved reply that ran a handoff keeps its handoff text collapsed below", async () => {
    open(programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(intent()), handoff: { id: "a", text: "Filled handoff A" } })] }));
    await ready();
    const ran = screen.getByText("Handoff A").closest("details")!;
    expect(ran.open).toBe(false);
    expect(ran.querySelector("pre")?.textContent).toBe("Filled handoff A");
  });
});

// Kept beside the view's tests so a stray write in a run would show (R10).
describe("QuinelingView writes", () => {
  it("running the fixtures writes nothing to the folder", async () => {
    const storage = programFolder({ assessments: [await result(opus, gather, { ...day(1), handBack: fenced(strictYoung()) })] });
    const before = JSON.stringify(storage.files());
    open(storage);
    await ready();
    await userEvent.click(runButton());
    expect(JSON.stringify(storage.files())).toBe(before);
  });
});
