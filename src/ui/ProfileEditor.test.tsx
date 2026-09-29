// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
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
  loadFolder,
  profilePath,
  serializeAssessment,
  serializeCollection,
  serializeMarker,
  serializeProfile,
} from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import type { AgentProfile, Assessment } from "../domain/types";
import { assignmentVersion } from "../domain/hash";

afterEach(cleanup);

const claude: AgentProfile = {
  slug: "claude",
  name: "Claude",
  harness: "Claude Code",
  model: "opus",
  effort: "high",
  repo: "~/projects/app",
  notes: "",
  params: { temperature: "0.2" },
};

const codex: AgentProfile = {
  slug: "codex",
  name: "Codex",
  harness: "Codex CLI",
  model: "gpt",
  effort: "medium",
  repo: "",
  notes: "",
  params: {},
};

const assessment: Assessment = {
  profileSlug: "claude",
  collectionSlug: "eng",
  credentialSlug: "review",
  fileStem: "20260929T084900Z",
  result: "met",
  recordedAt: "2026-09-29T08:49:00.000Z",
  assignmentVersion: "abc123",
  setup: { harness: "Claude Code", model: "opus", effort: "high" },
  note: "",
  handBack: "Did the review.",
};

function fixture(): MemoryStorage {
  return new MemoryStorage({
    [MARKER_PATH]: serializeMarker(),
    [collectionPath("eng")]: serializeCollection({
      slug: "eng",
      name: "Engineering",
      description: "",
      order: ["review"],
      codes: { review: 1 },
    }),
    [credentialPath("eng", "review")]: serializeCredentialMd({
      slug: "review",
      collectionSlug: "eng",
      name: "Code review",
      learningTargets: ["I can read a diff."],
      task: "Review it.",
      rubric: "Finds the bug.",
      extraSections: [],
    }),
    [profilePath("claude")]: serializeProfile(claude),
    [profilePath("codex")]: serializeProfile(codex),
    [assessmentPath("claude", "eng", "review", assessment.fileStem)]: serializeAssessment(assessment),
  });
}

function renderApp(storage: MemoryStorage, initialRoute: Route) {
  return render(
    <FolderProvider storage={storage} folder="/data">
      <AppShell onChangeFolder={() => {}} initialRoute={initialRoute} />
    </FolderProvider>,
  );
}

const value = (label: string | RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe("ProfilesView", () => {
  it("lists profiles with harness, model and effort", async () => {
    renderApp(fixture(), { view: "agents" });
    expect(await screen.findByText("Claude Code · opus · high")).toBeTruthy();
    expect(screen.getByText("Codex CLI · gpt · medium")).toBeTruthy();
  });

  it("with no profiles, says how to start", async () => {
    renderApp(new MemoryStorage({ [MARKER_PATH]: serializeMarker() }), { view: "agents" });
    expect(await screen.findByText(/No agents yet/)).toBeTruthy();
  });
});

describe("ProfileEditor", () => {
  it("Covers AE2. On a locked profile the model field is read-only, the duplicate action is shown, and choosing it opens the new profile's editor", async () => {
    const storage = fixture();
    renderApp(storage, { view: "agents", profileSlug: "claude" });
    const user = userEvent.setup();
    const model = (await screen.findByLabelText("Model")) as HTMLInputElement;
    expect(model.readOnly).toBe(true);
    expect((screen.getByLabelText("Harness") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Effort") as HTMLInputElement).readOnly).toBe(true);

    await user.type(model, "sonnet");
    expect(model.value).toBe("opus");
    expect(screen.getByText("Locked because this agent has results. Duplicate to try a different setup.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Duplicate as new profile" }));
    const draft = await screen.findByRole("region", { name: "New agent" });
    expect(value("Name")).toBe("Claude (copy)");
    const draftModel = within(draft).getByLabelText("Model") as HTMLInputElement;
    expect(draftModel.readOnly).toBe(false);
    expect(draftModel.value).toBe("opus");
    expect(storage.writes).toEqual([]);

    await user.clear(draftModel);
    await user.type(draftModel, "sonnet");
    await user.click(within(draft).getByRole("button", { name: "Save" }));

    // The new profile saves untested and opens as an ordinary, unlocked profile.
    expect(await screen.findByRole("region", { name: "Claude (copy)" })).toBeTruthy();
    const state = await loadFolder(storage);
    const copy = state.profiles.find((p) => p.name === "Claude (copy)");
    expect(copy).toMatchObject({ harness: "Claude Code", model: "sonnet", effort: "high", params: { temperature: "0.2" } });
    expect(state.assessments.filter((a) => a.profileSlug === copy?.slug)).toEqual([]);
    expect(state.profiles.find((p) => p.slug === "claude")?.model).toBe("opus");
  });

  it("Covers AE3. On a locked profile the repo field stays editable, saves, and leaves the results alone", async () => {
    const storage = fixture();
    renderApp(storage, { view: "agents", profileSlug: "claude" });
    const user = userEvent.setup();
    const repo = (await screen.findByLabelText("Repo")) as HTMLInputElement;
    expect(repo.readOnly).toBe(false);
    await user.clear(repo);
    await user.type(repo, "~/projects/api");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(screen.queryByText("Unsaved changes")).toBeNull();

    const state = await loadFolder(storage);
    const saved = state.profiles.find((p) => p.slug === "claude")!;
    expect(saved.repo).toBe("~/projects/api");
    // The setup still matches the result's snapshot, so nothing is flagged.
    expect({ harness: saved.harness, model: saved.model, effort: saved.effort }).toEqual(assessment.setup);
    expect(storage.writes).toEqual([{ root: "data", path: profilePath("claude") }]);
  });

  it("cancelling a duplicate draft leaves no new profile", async () => {
    const storage = fixture();
    renderApp(storage, { view: "agents", profileSlug: "claude" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Duplicate as new profile" }));
    const draft = await screen.findByRole("region", { name: "New agent" });
    await user.type(within(draft).getByLabelText("Model"), "-x");
    await user.click(within(draft).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("region", { name: "New agent" })).toBeNull();
    expect(storage.writes).toEqual([]);
    const state = await loadFolder(storage);
    expect(state.profiles.map((p) => p.slug)).toEqual(["claude", "codex"]);
  });

  it("a new agent is written only on Save, with its params", async () => {
    const storage = fixture();
    renderApp(storage, { view: "agents" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New agent" }));
    const draft = await screen.findByRole("region", { name: "New agent" });
    const d = within(draft);
    await user.type(d.getByLabelText("Name"), "Local llama");
    await user.type(d.getByLabelText("Harness"), "Aider");
    await user.type(d.getByLabelText("Model"), "llama");
    await user.type(d.getByLabelText("Effort"), "low");
    await user.click(d.getByRole("button", { name: "Add parameter" }));
    await user.type(d.getByLabelText("Parameter 1 name"), "context");
    await user.type(d.getByLabelText("Parameter 1 value"), "32k");
    await user.click(d.getByRole("button", { name: "Add parameter" }));
    await user.type(d.getByLabelText("Parameter 2 name"), "drop");
    await user.click(d.getByRole("button", { name: "Remove parameter 2" }));
    expect(storage.writes).toEqual([]);

    await user.click(d.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("region", { name: "Local llama" })).toBeTruthy();
    const state = await loadFolder(storage);
    expect(state.profiles.find((p) => p.slug === "local-llama")).toMatchObject({
      harness: "Aider",
      model: "llama",
      effort: "low",
      params: { context: "32k" },
    });
  });

  it("an unlocked profile's setup fields are editable and save", async () => {
    const storage = fixture();
    renderApp(storage, { view: "agents", profileSlug: "codex" });
    const user = userEvent.setup();
    const model = (await screen.findByLabelText("Model")) as HTMLInputElement;
    expect(model.readOnly).toBe(false);
    expect(screen.queryByRole("button", { name: "Duplicate as new profile" })).toBeNull();
    await user.clear(model);
    await user.type(model, "gpt-next");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(JSON.parse(storage.file(profilePath("codex"))!).model).toBe("gpt-next");
  });
});

describe("Earned badges", () => {
  const task = "Review it.";
  const rubric = "Finds the bug.";

  async function earnedFixture(results: Record<string, { result: Assessment["result"]; current: boolean }>): Promise<MemoryStorage> {
    const files: Record<string, string> = {
      [MARKER_PATH]: serializeMarker(),
      [collectionPath("eng")]: serializeCollection({ slug: "eng", name: "Engineering", description: "", order: ["a", "b"], codes: { a: 1, b: 2 } }),
      [profilePath("claude")]: serializeProfile(claude),
    };
    for (const [slug, name] of [["a", "Alpha skill"], ["b", "Beta skill"]]) {
      files[credentialPath("eng", slug)] = serializeCredentialMd({
        slug, collectionSlug: "eng", name, learningTargets: ["I can."], task, rubric, extraSections: [],
      });
      const r = results[slug];
      if (!r) continue;
      const a: Assessment = {
        ...assessment,
        credentialSlug: slug,
        result: r.result,
        assignmentVersion: r.current ? await assignmentVersion(task, rubric) : "0123456789ab",
      };
      files[assessmentPath("claude", "eng", slug, a.fileStem)] = serializeAssessment(a);
    }
    return new MemoryStorage(files);
  }

  it("Covers AE4. A met and a flagged met both show, and the flagged one is dimmed with its reason", async () => {
    renderApp(await earnedFixture({ a: { result: "met", current: true }, b: { result: "met", current: false } }), { view: "agents", profileSlug: "claude" });
    const section = await screen.findByRole("region", { name: "Earned badges" });
    const items = await within(section).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    const [a, b] = items;
    expect(within(a).getByText("Alpha skill")).toBeTruthy();
    expect(within(a).getByText("Engineering")).toBeTruthy();
    expect(a.className).not.toContain("stale");
    expect(within(a).queryByText(/earlier version/)).toBeNull();
    expect(b.className).toContain("stale");
    expect(within(b).getByText("Tested against an earlier version of the assignment")).toBeTruthy();
    await waitFor(() => expect((within(a).getByRole("img") as HTMLElement).getAttribute("width")).toBe("96"));
  });

  it("shows nothing for not met or untested credentials", async () => {
    renderApp(await earnedFixture({ a: { result: "not_met", current: true } }), { view: "agents", profileSlug: "claude" });
    const section = await screen.findByRole("region", { name: "Earned badges" });
    expect(within(section).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(section).queryByText("Alpha skill")).toBeNull();
    expect(within(section).queryByText("Beta skill")).toBeNull();
  });

  it("with no met results, shows a quiet empty state", async () => {
    renderApp(await earnedFixture({}), { view: "agents", profileSlug: "claude" });
    expect(await screen.findByText("No badges yet. Record a met result for this agent to earn one.")).toBeTruthy();
  });

  it("is not shown on an unsaved new profile", async () => {
    renderApp(await earnedFixture({}), { view: "agents" });
    await userEvent.setup().click(await screen.findByRole("button", { name: "New agent" }));
    await screen.findByRole("region", { name: "New agent" });
    expect(screen.queryByRole("region", { name: "Earned badges" })).toBeNull();
  });
});
