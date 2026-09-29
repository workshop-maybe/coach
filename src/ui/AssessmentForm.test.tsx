// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssessmentForm } from "./AssessmentForm";
import { FolderProvider, useFolder } from "./useFolderState";
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
import { assignmentVersion } from "../domain/hash";
import type { AgentProfile, Credential } from "../domain/types";

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
      order: ["review"],
      codes: { review: 1 },
    }),
    [credentialPath("eng", "review")]: serializeCredentialMd(review),
    [profilePath("opus")]: serializeProfile(opus),
  });
}

function Count() {
  const { state } = useFolder();
  return <p>assessments: {state?.assessments.length ?? "none"}</p>;
}

function renderForm(storage: MemoryStorage, props: { credentialKey?: string; profileSlug?: string } = {}) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <FolderProvider storage={storage} folder="/data">
      <Count />
      <AssessmentForm {...props} onDone={onDone} onCancel={onCancel} />
    </FolderProvider>,
  );
  return { onDone, onCancel };
}

function assessmentWrites(storage: MemoryStorage) {
  return storage.writes.filter((w) => w.path.startsWith("assessments/"));
}

describe("AssessmentForm", () => {
  it("blocks saving without a met or not met choice", async () => {
    const storage = fixture();
    const { onDone } = renderForm(storage, { credentialKey: "eng/review", profileSlug: "opus" });
    const form = await screen.findByRole("form", { name: "Record result" });
    await userEvent.type(within(form).getByLabelText("Hand-back"), "Here is my work.");
    await userEvent.click(within(form).getByRole("button", { name: "Save result" }));
    expect(await within(form).findByRole("alert")).toHaveProperty("textContent", "Choose met or not met before saving.");
    expect(assessmentWrites(storage)).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
    expect((within(form).getByLabelText("Hand-back") as HTMLTextAreaElement).value).toBe("Here is my work.");
  });

  it("blocks saving without a hand-back", async () => {
    const storage = fixture();
    renderForm(storage, { credentialKey: "eng/review", profileSlug: "opus" });
    const form = await screen.findByRole("form", { name: "Record result" });
    await userEvent.click(within(form).getByLabelText("Met"));
    await userEvent.click(within(form).getByRole("button", { name: "Save result" }));
    expect(await within(form).findByRole("alert")).toHaveProperty("textContent", "Paste the agent's hand-back before saving.");
    expect(assessmentWrites(storage)).toEqual([]);
  });

  it("pre-filled, it shows the agent, the credential and the assignment version it records against", async () => {
    renderForm(fixture(), { credentialKey: "eng/review", profileSlug: "opus" });
    const form = await screen.findByRole("form", { name: "Record result" });
    expect(within(form).getByText("Opus agent")).toBeTruthy();
    expect(within(form).getByText("Code review")).toBeTruthy();
    const version = await assignmentVersion(review.task, review.rubric);
    expect(await within(form).findByText(`Records against assignment version ${version}`)).toBeTruthy();
  });

  it("with nothing given, both are selectable, and saving records the result and applies the state", async () => {
    const storage = fixture();
    const { onDone } = renderForm(storage);
    const form = await screen.findByRole("form", { name: "Record result" });
    await screen.findByText("assessments: 0");
    await userEvent.selectOptions(within(form).getByLabelText("Agent"), "opus");
    await userEvent.selectOptions(within(form).getByLabelText("Credential"), "eng/review");
    await userEvent.type(within(form).getByLabelText("Hand-back"), "## Handback\n\nDone.");
    await userEvent.click(within(form).getByLabelText("Not met"));
    await userEvent.type(within(form).getByLabelText("Note (optional)"), "Missed a bug.");
    await userEvent.click(within(form).getByRole("button", { name: "Save result" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(screen.getByText("assessments: 1")).toBeTruthy();
    const [write] = assessmentWrites(storage);
    const text = storage.file(write.path)!;
    expect(write.path.startsWith("assessments/opus/eng/review/")).toBe(true);
    expect(text).toContain("result: not_met");
    expect(text).toContain("Missed a bug.");
    expect(text).toContain("Done.");
  });

  it("a failed save shows the error and keeps the draft", async () => {
    const storage = fixture();
    const { onDone } = renderForm(storage, { credentialKey: "eng/review", profileSlug: "opus" });
    const form = await screen.findByRole("form", { name: "Record result" });
    storage.writeText = async () => {
      throw new Error("disk full");
    };
    await userEvent.type(within(form).getByLabelText("Hand-back"), "My reply");
    await userEvent.click(within(form).getByLabelText("Met"));
    await userEvent.click(within(form).getByRole("button", { name: "Save result" }));
    expect(await within(form).findByRole("alert")).toHaveProperty("textContent", "disk full");
    expect((within(form).getByLabelText("Hand-back") as HTMLTextAreaElement).value).toBe("My reply");
    expect((within(form).getByLabelText("Met") as HTMLInputElement).checked).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("Cancel calls onCancel", async () => {
    const { onCancel } = renderForm(fixture());
    const form = await screen.findByRole("form", { name: "Record result" });
    await userEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
