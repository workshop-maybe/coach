import { beforeAll, describe, expect, it } from "vitest";
import { assignmentVersion } from "./hash";
import { FLAG_REASONS, buildMatrix, cellKey } from "./matrix";
import type {
  AgentProfile,
  Assessment,
  AssessmentResult,
  Collection,
  Credential,
  FolderState,
} from "./types";

function collection(slug: string, order: string[] = []): Collection {
  return { slug, name: slug, description: "", order, codes: {} };
}

function credential(collectionSlug: string, slug: string, overrides: Partial<Credential> = {}): Credential {
  return {
    slug,
    collectionSlug,
    name: slug,
    learningTargets: ["I can do the thing."],
    task: `Task for ${slug}`,
    rubric: `Rubric for ${slug}`,
    extraSections: [],
    ...overrides,
  };
}

function profile(slug: string, overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    slug,
    name: slug,
    harness: "claude-code",
    model: "opus",
    effort: "high",
    repo: "~/code",
    notes: "",
    params: {},
    ...overrides,
  };
}

function state(parts: Partial<FolderState> = {}): FolderState {
  return {
    collections: [],
    credentials: [],
    profiles: [],
    assessments: [],
    skeleton: null,
    handoffs: [],
    errors: [],
    warnings: [],
    raw: {},
    ...parts,
  };
}

const versions = new Map<string, string>();
async function versionOf(c: Credential): Promise<string> {
  return assignmentVersion(c.task, c.rubric);
}

function assessment(
  p: AgentProfile,
  c: Credential,
  result: AssessmentResult,
  recordedAt: string,
  overrides: Partial<Assessment> = {},
): Assessment {
  return {
    profileSlug: p.slug,
    collectionSlug: c.collectionSlug,
    credentialSlug: c.slug,
    fileStem: recordedAt.replace(/[-:]/g, "").replace(/\.\d+/, ""),
    result,
    recordedAt,
    assignmentVersion: versions.get(`${c.collectionSlug}/${c.slug}`) ?? "",
    setup: { harness: p.harness, model: p.model, effort: p.effort },
    note: "",
    handBack: "",
    ...overrides,
  };
}

const col = collection("code-review", ["review-a-pr", "write-tests"]);
const colB = collection("writing", ["summarize"]);
const credX = credential("code-review", "review-a-pr");
const credY = credential("code-review", "write-tests");
const credZ = credential("writing", "summarize");
const profA = profile("agent-a");
const profB = profile("agent-b", { model: "sonnet" });

beforeAll(async () => {
  for (const c of [credX, credY, credZ]) versions.set(`${c.collectionSlug}/${c.slug}`, await versionOf(c));
});

describe("cellKey", () => {
  it("joins profile slug and credential key with a pipe", () => {
    expect(cellKey("agent-a", "code-review/review-a-pr")).toBe("agent-a|code-review/review-a-pr");
  });
});

describe("FLAG_REASONS", () => {
  it("explains each flag", () => {
    expect(FLAG_REASONS.earlier_version).toBe("Tested against an earlier version of the assignment");
    expect(FLAG_REASONS.setup_mismatch).toBe("Agent setup changed since this result");
  });
});

describe("buildMatrix", () => {
  const base = () =>
    state({
      collections: [col, colB],
      credentials: [credX, credY, credZ],
      profiles: [profA, profB],
    });

  it("lays out profiles as rows and credentials grouped by collection in state order", async () => {
    const m = await buildMatrix(
      state({
        collections: [colB, col],
        credentials: [credY, credZ, credX],
        profiles: [profB, profA],
      }),
    );
    expect(m.rows.map((p) => p.slug)).toEqual(["agent-b", "agent-a"]);
    expect(m.columns.map((g) => g.collection.slug)).toEqual(["writing", "code-review"]);
    expect(m.columns.map((g) => g.credentials.map((c) => c.slug))).toEqual([
      ["summarize"],
      ["write-tests", "review-a-pr"],
    ]);
    expect(m.cells.size).toBe(6);
  });

  it("marks a cell with no assessments as untested", async () => {
    const m = await buildMatrix(base());
    const cell = m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!;
    expect(cell).toMatchObject({
      profileSlug: "agent-a",
      credentialKey: "code-review/review-a-pr",
      status: "untested",
      flags: [],
      latest: null,
      history: [],
    });
  });

  it("shows met when a not-met result is followed by a met result", async () => {
    const m = await buildMatrix({
      ...base(),
      assessments: [
        assessment(profA, credX, "not_met", "2026-09-01T10:00:00Z"),
        assessment(profA, credX, "met", "2026-09-02T10:00:00Z"),
      ],
    });
    const cell = m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!;
    expect(cell.status).toBe("met");
    expect(cell.flags).toEqual([]);
    expect(cell.latest?.recordedAt).toBe("2026-09-02T10:00:00Z");
  });

  it("uses recorded time, not file order, to pick the latest", async () => {
    const m = await buildMatrix({
      ...base(),
      assessments: [
        assessment(profA, credX, "not_met", "2026-09-03T10:00:00Z"),
        assessment(profA, credX, "met", "2026-09-02T10:00:00Z"),
      ],
    });
    expect(m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!.status).toBe("not_met");
  });

  it("orders history newest first", async () => {
    const m = await buildMatrix({
      ...base(),
      assessments: [
        assessment(profA, credX, "met", "2026-09-02T10:00:00Z"),
        assessment(profA, credX, "not_met", "2026-09-05T10:00:00Z"),
        assessment(profA, credX, "not_met", "2026-09-01T10:00:00Z"),
        assessment(profB, credX, "met", "2026-09-09T10:00:00Z"),
      ],
    });
    const cell = m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!;
    expect(cell.history.map((a) => a.recordedAt)).toEqual([
      "2026-09-05T10:00:00Z",
      "2026-09-02T10:00:00Z",
      "2026-09-01T10:00:00Z",
    ]);
    expect(cell.latest).toBe(cell.history[0]);
  });

  it("breaks a recorded-time tie by file stem", async () => {
    const at = "2026-09-02T10:00:00Z";
    const m = await buildMatrix({
      ...base(),
      assessments: [
        assessment(profA, credX, "met", at, { fileStem: "20260902T100000Z-2" }),
        assessment(profA, credX, "not_met", at, { fileStem: "20260902T100000Z-1" }),
      ],
    });
    const cell = m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!;
    expect(cell.latest?.fileStem).toBe("20260902T100000Z-2");
    expect(cell.status).toBe("met");
    expect(cell.history.map((a) => a.fileStem)).toEqual(["20260902T100000Z-2", "20260902T100000Z-1"]);
  });

  it("Covers AE1. After the task is edited, a met cell stays met and gains the earlier-version flag", async () => {
    const recorded = assessment(profA, credX, "met", "2026-09-02T10:00:00Z");
    const edited = { ...credX, task: `${credX.task} Also check the error path.` };
    const m = await buildMatrix({
      ...base(),
      credentials: [edited, credY, credZ],
      assessments: [recorded],
    });
    const cell = m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!;
    expect(cell.status).toBe("met");
    expect(cell.flags).toEqual(["earlier_version"]);
  });

  it("does not flag a whitespace-only assignment edit", async () => {
    const edited = { ...credX, task: `\n${credX.task}   \n\n` };
    const m = await buildMatrix({
      ...base(),
      credentials: [edited, credY, credZ],
      assessments: [assessment(profA, credX, "met", "2026-09-02T10:00:00Z")],
    });
    expect(m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!.flags).toEqual([]);
  });

  it("Covers AE5. When the profile file's model is changed by hand, that profile's cells gain the setup-mismatch flag", async () => {
    const assessments = [
      assessment(profA, credX, "met", "2026-09-02T10:00:00Z"),
      assessment(profA, credZ, "not_met", "2026-09-02T11:00:00Z"),
      assessment(profB, credX, "met", "2026-09-02T12:00:00Z"),
    ];
    const handEdited = { ...profA, model: "haiku" };
    const m = await buildMatrix({ ...base(), profiles: [handEdited, profB], assessments });
    expect(m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!.flags).toEqual(["setup_mismatch"]);
    expect(m.cells.get(cellKey("agent-a", "writing/summarize"))!.flags).toEqual(["setup_mismatch"]);
    expect(m.cells.get(cellKey("agent-a", "code-review/write-tests"))!.flags).toEqual([]);
    expect(m.cells.get(cellKey("agent-b", "code-review/review-a-pr"))!.flags).toEqual([]);
  });

  it("flags harness and effort changes as a setup mismatch too", async () => {
    for (const change of [{ harness: "codex" }, { effort: "low" }]) {
      const m = await buildMatrix({
        ...base(),
        profiles: [{ ...profA, ...change }, profB],
        assessments: [assessment(profA, credX, "met", "2026-09-02T10:00:00Z")],
      });
      expect(m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!.flags).toEqual(["setup_mismatch"]);
    }
  });

  it("does not flag a repo change", async () => {
    const m = await buildMatrix({
      ...base(),
      profiles: [{ ...profA, repo: "~/elsewhere" }, profB],
      assessments: [assessment(profA, credX, "met", "2026-09-02T10:00:00Z")],
    });
    expect(m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!.flags).toEqual([]);
  });

  it("carries both flags at once, earlier version first", async () => {
    const m = await buildMatrix({
      ...base(),
      credentials: [{ ...credX, rubric: "A new rubric." }, credY, credZ],
      profiles: [{ ...profA, model: "haiku" }, profB],
      assessments: [assessment(profA, credX, "met", "2026-09-02T10:00:00Z")],
    });
    const cell = m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!;
    expect(cell.status).toBe("met");
    expect(cell.flags).toEqual(["earlier_version", "setup_mismatch"]);
  });

  it("flags only from the latest result, not older ones", async () => {
    const m = await buildMatrix({
      ...base(),
      assessments: [
        assessment(profA, credX, "not_met", "2026-09-01T10:00:00Z", {
          assignmentVersion: "old",
          setup: { harness: "x", model: "y", effort: "z" },
        }),
        assessment(profA, credX, "met", "2026-09-02T10:00:00Z"),
      ],
    });
    expect(m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!.flags).toEqual([]);
  });

  it("Covers AE7. A credential where every profile is not met or untested is unmet by anyone, and one with a met cell is not", async () => {
    const m = await buildMatrix({
      ...base(),
      assessments: [
        assessment(profA, credX, "not_met", "2026-09-02T10:00:00Z"),
        assessment(profA, credY, "not_met", "2026-09-02T10:00:00Z"),
        assessment(profB, credY, "met", "2026-09-03T10:00:00Z"),
      ],
    });
    expect(m.unmetByAnyone).toEqual(new Set(["code-review/review-a-pr", "writing/summarize"]));
    expect(m.unmetByAnyone.has("code-review/write-tests")).toBe(false);
  });

  it("counts a met result that was later superseded by not met as unmet", async () => {
    const m = await buildMatrix({
      ...base(),
      assessments: [
        assessment(profA, credY, "met", "2026-09-02T10:00:00Z"),
        assessment(profA, credY, "not_met", "2026-09-03T10:00:00Z"),
      ],
    });
    expect(m.unmetByAnyone.has("code-review/write-tests")).toBe(true);
  });

  it("counts a flagged met result as met for the unmet-by-anyone check", async () => {
    const m = await buildMatrix({
      ...base(),
      credentials: [{ ...credX, task: "Rewritten task." }, credY, credZ],
      profiles: [{ ...profA, model: "haiku" }, profB],
      assessments: [assessment(profA, credX, "met", "2026-09-02T10:00:00Z")],
    });
    expect(m.cells.get(cellKey("agent-a", "code-review/review-a-pr"))!.flags).toHaveLength(2);
    expect(m.unmetByAnyone.has("code-review/review-a-pr")).toBe(false);
  });

  it("ignores assessments whose profile or credential no longer exists", async () => {
    const gone = profile("gone-agent");
    const goneCred = credential("code-review", "deleted-cred");
    const m = await buildMatrix({
      ...base(),
      assessments: [
        assessment(gone, credX, "met", "2026-09-02T10:00:00Z"),
        assessment(profA, goneCred, "met", "2026-09-02T10:00:00Z"),
        assessment(profA, credential("no-such-collection", "review-a-pr"), "met", "2026-09-02T10:00:00Z"),
      ],
    });
    expect(m.cells.size).toBe(6);
    expect([...m.cells.keys()].some((k) => k.startsWith("gone-agent|"))).toBe(false);
    expect([...m.cells.keys()].some((k) => k.endsWith("deleted-cred"))).toBe(false);
    for (const cell of m.cells.values()) {
      expect(cell.status).toBe("untested");
      expect(cell.history).toEqual([]);
    }
    expect(m.unmetByAnyone.has("code-review/review-a-pr")).toBe(true);
  });

  it("handles an empty folder", async () => {
    const m = await buildMatrix(state());
    expect(m.rows).toEqual([]);
    expect(m.columns).toEqual([]);
    expect(m.cells.size).toBe(0);
    expect(m.unmetByAnyone.size).toBe(0);
  });

  it("with credentials but no profiles, every credential is unmet by anyone", async () => {
    const m = await buildMatrix({ ...base(), profiles: [] });
    expect(m.rows).toEqual([]);
    expect(m.columns).toHaveLength(2);
    expect(m.cells.size).toBe(0);
    expect(m.unmetByAnyone).toEqual(
      new Set(["code-review/review-a-pr", "code-review/write-tests", "writing/summarize"]),
    );
  });

  it("with profiles but no credentials, there are rows and no cells", async () => {
    const m = await buildMatrix({ ...base(), collections: [], credentials: [] });
    expect(m.rows).toHaveLength(2);
    expect(m.columns).toEqual([]);
    expect(m.cells.size).toBe(0);
    expect(m.unmetByAnyone.size).toBe(0);
  });

  it("keeps an empty collection as a column group with no credentials", async () => {
    const m = await buildMatrix({ ...base(), collections: [col, colB, collection("empty")] });
    expect(m.columns.map((g) => [g.collection.slug, g.credentials.length])).toEqual([
      ["code-review", 2],
      ["writing", 1],
      ["empty", 0],
    ]);
  });

  it("matches a hand-worked fixture folder", async () => {
    const m = await buildMatrix({
      ...base(),
      credentials: [credX, { ...credY, rubric: "Stricter rubric." }, credZ],
      profiles: [profA, { ...profB, effort: "medium" }],
      assessments: [
        assessment(profA, credX, "met", "2026-09-01T09:00:00Z"),
        assessment(profA, credY, "met", "2026-09-01T10:00:00Z"),
        assessment(profB, credX, "not_met", "2026-09-01T11:00:00Z"),
        assessment(profB, credZ, "not_met", "2026-09-01T12:00:00Z"),
        assessment(profB, credZ, "met", "2026-09-01T13:00:00Z"),
      ],
    });
    const summary = Object.fromEntries(
      [...m.cells.values()].map((c) => [cellKey(c.profileSlug, c.credentialKey), [c.status, ...c.flags].join(" ")]),
    );
    expect(summary).toEqual({
      "agent-a|code-review/review-a-pr": "met",
      "agent-a|code-review/write-tests": "met earlier_version",
      "agent-a|writing/summarize": "untested",
      "agent-b|code-review/review-a-pr": "not_met setup_mismatch",
      "agent-b|code-review/write-tests": "untested",
      "agent-b|writing/summarize": "met setup_mismatch",
    });
    expect(m.unmetByAnyone.size).toBe(0);
  });
});
