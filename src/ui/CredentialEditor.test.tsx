// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell, type Route } from "./AppShell";
import { FolderProvider } from "./useFolderState";
import { MemoryStorage } from "../storage/memory";
import { MARKER_PATH, collectionPath, credentialPath, loadFolder, serializeCollection, serializeMarker } from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import type { Collection, Credential } from "../domain/types";

afterEach(cleanup);

// PromptPanel and ExportDialog belong to another unit. Stand-ins that echo their props
// keep these tests about the wiring only.
vi.mock("./PromptPanel", () => ({
  PromptPanel: (props: { credentialKey: string; onClose(): void }) => (
    <section aria-label="Prompt">
      <p>prompt for {props.credentialKey}</p>
      <button type="button" onClick={props.onClose}>Close</button>
    </section>
  ),
}));
vi.mock("./ExportDialog", () => ({
  ExportDialog: (props: { collectionSlug: string; onClose(): void }) => (
    <section aria-label="Export">
      <p>export {props.collectionSlug}</p>
      <button type="button" onClick={props.onClose}>Close</button>
    </section>
  ),
}));

const collection: Collection = {
  slug: "eng",
  name: "Engineering",
  description: "",
  order: ["review", "testing", "docs"],
  codes: { review: 1, testing: 2, docs: 3 },
};

function cred(slug: string, name: string, extra: Partial<Credential> = {}): Credential {
  return {
    slug,
    collectionSlug: "eng",
    name,
    learningTargets: [],
    task: "",
    rubric: "",
    extraSections: [],
    ...extra,
  };
}

const review = cred("review", "Code review", {
  learningTargets: ["I can read a diff."],
  task: "Review this pull request.",
  rubric: "Finds the real bug.",
});
const reviewPath = credentialPath("eng", "review");

function fixture(): MemoryStorage {
  return new MemoryStorage({
    [MARKER_PATH]: serializeMarker(),
    [collectionPath("eng")]: serializeCollection(collection),
    [reviewPath]: serializeCredentialMd(review),
    [credentialPath("eng", "testing")]: serializeCredentialMd(cred("testing", "Testing")),
    [credentialPath("eng", "docs")]: serializeCredentialMd(cred("docs", "Docs")),
  });
}

function renderApp(storage: MemoryStorage, initialRoute: Route) {
  return render(
    <FolderProvider storage={storage} folder="/data">
      <AppShell onChangeFolder={() => {}} initialRoute={initialRoute} />
    </FolderProvider>,
  );
}

const openReview: Route = { view: "collections", collectionSlug: "eng", credentialKey: "eng/review" };

describe("CredentialEditor", () => {
  it("adding three learning targets and saving writes them in order", async () => {
    const storage = fixture();
    renderApp(storage, { view: "collections", collectionSlug: "eng", credentialKey: "eng/testing" });
    await screen.findByLabelText("Credential name");

    const user = userEvent.setup();
    for (const [i, text] of ["I can write a unit test.", "I can mock a clock.", "I can name a test."].entries()) {
      await user.click(screen.getByRole("button", { name: "Add learning target" }));
      await user.type(screen.getByLabelText(`Learning target ${i + 1}`), text);
    }
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved.");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    const state = await loadFolder(storage);
    const saved = state.credentials.find((c) => c.slug === "testing");
    expect(saved?.learningTargets).toEqual(["I can write a unit test.", "I can mock a clock.", "I can name a test."]);
  });

  it("learning targets can be moved and removed before saving", async () => {
    const storage = fixture();
    renderApp(storage, openReview);
    await screen.findByLabelText("Credential name");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add learning target" }));
    await user.type(screen.getByLabelText("Learning target 2"), "I can explain a finding.");
    await user.click(screen.getByRole("button", { name: "Move learning target 2 up" }));
    expect((screen.getByLabelText("Learning target 1") as HTMLInputElement).value).toBe("I can explain a finding.");
    await user.click(screen.getByRole("button", { name: "Remove learning target 2" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    const state = await loadFolder(storage);
    expect(state.credentials.find((c) => c.slug === "review")?.learningTargets).toEqual(["I can explain a finding."]);
  });

  it("the rubric field carries the only-you-see-this label", async () => {
    renderApp(fixture(), openReview);
    const rubric = (await screen.findByLabelText(/Only you see this/)) as HTMLTextAreaElement;
    expect(rubric.tagName).toBe("TEXTAREA");
    expect(rubric.value).toBe("Finds the real bug.");
    expect((screen.getByLabelText("Task") as HTMLTextAreaElement).value).toBe("Review this pull request.");
  });

  it("an outside edit plus window focus keeps the draft and offers reload or keep editing", async () => {
    const storage = fixture();
    renderApp(storage, openReview);
    const user = userEvent.setup();
    const task = (await screen.findByLabelText("Task")) as HTMLTextAreaElement;
    await user.type(task, " Be brief.");

    storage.seed({ [reviewPath]: serializeCredentialMd({ ...review, task: "Changed outside." }) });
    await act(async () => {
      fireEvent.focus(window);
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Changed on disk: reload or keep editing");
    expect((screen.getByLabelText("Task") as HTMLTextAreaElement).value).toBe("Review this pull request. Be brief.");

    // Keep editing hides the choice and keeps the draft.
    await user.click(within(alert).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("Task") as HTMLTextAreaElement).value).toBe("Review this pull request. Be brief.");

    // Saving against the old base is refused, the draft stays, nothing is written.
    await user.click(screen.getByRole("button", { name: "Save" }));
    const again = await screen.findByRole("alert");
    expect(again.textContent).toContain("Changed on disk: reload or keep editing");
    expect((screen.getByLabelText("Task") as HTMLTextAreaElement).value).toBe("Review this pull request. Be brief.");
    expect(storage.writes).toEqual([]);

    // Reload discards the draft and takes the file as it is now.
    await user.click(within(again).getByRole("button", { name: "Reload" }));
    expect(await screen.findByDisplayValue("Changed outside.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Unsaved changes")).toBeNull();

    // And the next save goes through against the new base.
    await user.type(screen.getByLabelText("Task"), " Again.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved.");
    expect(storage.file(reviewPath)).toContain("Changed outside. Again.");
  });

  it("the Prompts button opens the prompt panel for the credential", async () => {
    renderApp(fixture(), openReview);
    await userEvent.click(await screen.findByRole("button", { name: "Prompts" }));
    expect(screen.getByText("prompt for eng/review")).toBeTruthy();
    await userEvent.click(within(screen.getByRole("region", { name: "Prompt" })).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Prompt" })).toBeNull();
  });
});

describe("CollectionsView", () => {
  it("reordering credentials in the collection view saves the new order", async () => {
    const storage = fixture();
    renderApp(storage, { view: "collections", collectionSlug: "eng" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Move Docs up" }));
    await screen.findByRole("button", { name: "Move Docs down" });
    const state = await loadFolder(storage);
    expect(state.collections[0].order).toEqual(["review", "docs", "testing"]);

    const items = within(screen.getByRole("list", { name: "Credentials" })).getAllByRole("listitem");
    expect(items.map((li) => within(li).getAllByRole("button")[0].textContent)).toEqual(["Code review", "Docs", "Testing"]);
  });

  it("with no collections, says how to start, and creating one opens it", async () => {
    const storage = new MemoryStorage({ [MARKER_PATH]: serializeMarker() });
    renderApp(storage, { view: "collections" });
    expect(await screen.findByText(/No collections yet/)).toBeTruthy();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New collection name"), "Writing");
    await user.click(screen.getByRole("button", { name: "Create collection" }));
    expect(await screen.findByText(/No credentials yet/)).toBeTruthy();
    expect(storage.file(collectionPath("writing"))).toBeTruthy();
  });

  it("adding a credential opens its editor", async () => {
    const storage = fixture();
    renderApp(storage, { view: "collections", collectionSlug: "eng" });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("New credential name"), "Planning");
    await user.click(screen.getByRole("button", { name: "Add credential" }));
    expect(((await screen.findByLabelText("Credential name")) as HTMLInputElement).value).toBe("Planning");
    expect(storage.file(credentialPath("eng", "planning"))).toBeTruthy();
  });

  it("renames the collection with an explicit save", async () => {
    const storage = fixture();
    renderApp(storage, { view: "collections", collectionSlug: "eng" });
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Collection name");
    await user.clear(name);
    await user.type(name, "Engineering basics");
    await user.click(screen.getByRole("button", { name: "Save collection" }));
    await screen.findByText("Saved.");
    expect(JSON.parse(storage.file(collectionPath("eng"))!).name).toBe("Engineering basics");
  });

  it("Export opens the export dialog", async () => {
    renderApp(fixture(), { view: "collections", collectionSlug: "eng" });
    await userEvent.click(await screen.findByRole("button", { name: "Export" }));
    expect(screen.getByText("export eng")).toBeTruthy();
  });
});
