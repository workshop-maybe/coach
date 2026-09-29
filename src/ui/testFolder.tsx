// Test fixtures for the deck tests: a data folder in memory with credentials, agents
// and results, and the app rendered over it on a chosen route.

import { render } from "@testing-library/react";
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
import { MemoryStorage } from "../storage/memory";
import { AppShell, type Route } from "./AppShell";
import { FolderProvider } from "./useFolderState";

export const FOLDER = "/data";

export const review: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: ["I can find bugs in a diff."],
  task: "Review the attached diff.",
  rubric: "",
  extraSections: [],
};

export const opus: AgentProfile = {
  slug: "opus",
  name: "Opus agent",
  harness: "claude-code",
  model: "opus",
  effort: "high",
  repo: "",
  notes: "",
  params: {},
};

export async function result(profile: AgentProfile, credential: Credential, overrides: Partial<Assessment> = {}): Promise<Assessment> {
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

export function storageWith(opts: { credentials?: Credential[]; profiles?: AgentProfile[]; assessments?: Assessment[] } = {}): MemoryStorage {
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

export function renderApp(storage: MemoryStorage, initialRoute?: Route) {
  return render(
    <FolderProvider storage={storage} folder={FOLDER}>
      <AppShell onChangeFolder={() => {}} initialRoute={initialRoute} />
    </FolderProvider>,
  );
}

/** Every data file's text, to assert that nothing was written. */
export async function snapshot(storage: MemoryStorage): Promise<Record<string, string | null>> {
  const paths = await storage.listFiles("data", "");
  return Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await storage.readText("data", p)] as const)));
}
