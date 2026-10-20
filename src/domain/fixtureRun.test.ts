import { vi, beforeAll, describe, expect, it } from "vitest";
import { runFixtures, type FixtureResult } from "./fixtureRun";
import { QDL_JOB_IDS, loadQuinelings, newSession, type QdlArtifact, type QdlJobId, type QdlSession, type QuinelingsRuntime } from "./quinelings";

// These tests load and run the real Quinelings runtime: about 1 s to load, about 25 ms a run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// Every test runs against the real vendored runtime (U4's verification), with variant programs
// built from the library's own reference intents, the way an agent's slightly wrong program
// would look.

type Intent = {
  inputs: { id: string; name?: string; value?: unknown; type: unknown }[];
  steps: { id: string; op: string; inputs: string[]; params: Record<string, unknown>; type?: unknown }[];
  outputs: string[];
  thought: {
    observations: { input: string }[];
    goals: { outputs: string[]; completion: string }[];
    decisions: { guard: string }[];
    tasks: { nodes: string[]; outputs: string[] }[];
  };
} & Record<string, unknown>;

let rt: QuinelingsRuntime;
let session: QdlSession;

beforeAll(async () => {
  rt = await loadQuinelings();
  session = newSession(rt);
});

function reference(job: QdlJobId): Intent {
  return structuredClone(rt.QDLV1Library.get(job).intent) as unknown as Intent;
}

function step(intent: Intent, id: string) {
  const found = intent.steps.find((s) => s.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
}

/** Lists the task's nodes again after steps were added or removed. */
function retask(intent: Intent): Intent {
  intent.thought.tasks[0].nodes = [...intent.inputs.map((i) => i.id), ...intent.steps.map((s) => s.id)];
  return intent;
}

/** Renames node ids everywhere an intent refers to them, keeping runtime input names. */
function renameNodes(intent: Intent, names: Record<string, string>): Intent {
  const to = (id: string) => names[id] ?? id;
  for (const input of intent.inputs) input.id = to(input.id);
  for (const s of intent.steps) {
    s.id = to(s.id);
    s.inputs = s.inputs.map(to);
  }
  intent.outputs = intent.outputs.map(to);
  const { thought } = intent;
  for (const o of thought.observations) o.input = to(o.input);
  for (const g of thought.goals) {
    g.outputs = g.outputs.map(to);
    g.completion = to(g.completion);
  }
  for (const d of thought.decisions) d.guard = to(d.guard);
  for (const t of thought.tasks) {
    t.nodes = t.nodes.map(to);
    t.outputs = t.outputs.map(to);
  }
  return intent;
}

function compile(intent: unknown): QdlArtifact {
  return session.compile(intent);
}

function run(intent: unknown, job: QdlJobId): FixtureResult[] {
  return runFixtures(session, rt, compile(intent), job);
}

function byName(results: FixtureResult[], name: string): FixtureResult {
  const found = results.find((r) => r.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found;
}

const BOUNDARY = "inclusive freshness boundary";
const MISSING_SNAPSHOT = "missing required snapshot";
const CYCLIC = "cyclic supplied jobs fail evaluation";

/** gather-readiness with `young` comparing with `lt` where the job uses `lte` (AE1). */
function strictYoung(): Intent {
  const intent = reference("gather-readiness");
  step(intent, "young").params = { operator: "lt" };
  return intent;
}

describe("running a job's fixtures", () => {
  it("passes every library reference program on all 44 of its own fixtures, with no mark and no guess", () => {
    let total = 0;
    for (const job of QDL_JOB_IDS) {
      const results = run(rt.QDLV1Library.get(job).intent, job);
      expect(results.map((r) => r.name)).toEqual(rt.QDLV1Library.get(job).fixtures.map((f) => f.name));
      for (const result of results) {
        expect(result.matches, `${job}: ${result.name}`).toBe(true);
        expect(result.redNodeId).toBeNull();
        expect(result.likelyCause).toBeNull();
        expect(result.differingOutputs).toEqual([]);
      }
      total += results.length;
    }
    expect(total).toBe(44);
  });

  it("passes evidence-ledger's reference although its output keys come back in another order", () => {
    const results = run(rt.QDLV1Library.get("evidence-ledger").intent, "evidence-ledger");
    expect(results.every((r) => r.matches)).toBe(true);
    const { actual, expected } = byName(results, "inclusive age and revision");
    if (actual.status !== "completed" || expected.status !== "completed") throw new Error("expected completed runs");
    expect(JSON.stringify(actual.outputs)).not.toBe(JSON.stringify(expected.outputs));
  });

  it("carries the agent's trace for each run", () => {
    const [first] = run(rt.QDLV1Library.get("gather-readiness").intent, "gather-readiness");
    expect(first.trace.map((t) => t.nodeId)).toContain("young");
  });

  it("covers AE1: a strict comparison differs only at the boundary, marks the output red and guesses young", () => {
    const results = run(strictYoung(), "gather-readiness");
    const boundary = byName(results, BOUNDARY);
    expect(boundary.matches).toBe(false);
    expect(results.filter((r) => r.name !== BOUNDARY).every((r) => r.matches)).toBe(true);
    expect(boundary.differingOutputs).toEqual(["proposal", "ready"]);
    expect(boundary.redNodeId).toBe("proposal");
    expect(boundary.likelyCause).toEqual({ nodeId: "young", agentValue: false, referenceValue: true });
  });

  it("covers AE1: the same bug with every step and input id renamed still guesses the renamed young", () => {
    // The output nodes keep their ids: they are the program's interface, and the fixtures read
    // outputs by those names (R3).
    const renamed = renameNodes(strictYoung(), {
      checks: "c",
      observedAt: "seen",
      now: "clock",
      maxAge: "limit",
      no: "nope",
      quantity: "amount",
      eligible: "s1",
      notFuture: "s2",
      safeTime: "s3",
      age: "s4",
      young: "s5",
      fresh: "s6",
    });
    const results = run(renamed, "gather-readiness");
    const boundary = byName(results, BOUNDARY);
    expect(results.filter((r) => !r.matches).map((r) => r.name)).toEqual([BOUNDARY]);
    expect(boundary.redNodeId).toBe("proposal");
    expect(boundary.likelyCause?.nodeId).toBe("s5");
  });

  it("covers AE2: a fixture expecting a missing-input refusal matches when the program refuses that way", () => {
    const missing = byName(run(rt.QDLV1Library.get("gather-readiness").intent, "gather-readiness"), MISSING_SNAPSHOT);
    expect(missing.expected).toEqual({ status: "refused", code: "missing-input" });
    expect(missing.actual).toMatchObject({ status: "refused", code: "missing-input" });
    expect(missing.matches).toBe(true);
    expect(missing.trace).toEqual([]);
  });

  it("matches work-schedule's cyclic fixture on a failed run, and not when the program refuses with the same code", () => {
    const cyclic = byName(run(rt.QDLV1Library.get("work-schedule").intent, "work-schedule"), CYCLIC);
    expect(cyclic.actual).toMatchObject({ status: "failed", code: "refinement", nodeId: "schedule" });
    expect(cyclic.matches).toBe(true);

    // A deadline floor of 6 makes every fixture refuse at binding with `refinement`.
    const refusing = reference("work-schedule");
    (refusing.inputs[1].type as { min: number }).min = 6;
    const refused = byName(run(refusing, "work-schedule"), CYCLIC);
    expect(refused.actual).toMatchObject({ status: "refused", code: "refinement" });
    expect(refused.matches).toBe(false);
    expect(refused.redNodeId).toBeNull();
    expect(refused.likelyCause).toBeNull();
  });

  it("covers AE3: a program of a different shape that gets one fixture wrong has a red mark and no guess", () => {
    // young becomes `now < observedAt + maxAge`, through a step the reference does not have.
    const other = reference("gather-readiness");
    other.steps = other.steps.filter((s) => s.id !== "safeTime" && s.id !== "age");
    other.steps.splice(1, 0, {
      id: "limit",
      op: "arithmetic",
      inputs: ["observedAt", "maxAge"],
      params: { kind: "add" },
      type: { kind: "number", unit: "tick", integer: true, min: 0 },
    });
    Object.assign(step(other, "young"), { inputs: ["now", "limit"], params: { operator: "lt" } });
    const results = run(retask(other), "gather-readiness");
    expect(results.filter((r) => !r.matches).map((r) => r.name)).toEqual([BOUNDARY]);
    const boundary = byName(results, BOUNDARY);
    expect(boundary.redNodeId).toBe("proposal");
    expect(boundary.likelyCause).toBeNull();
  });

  it("matches outputs by name when the program declares them in another order", () => {
    const reordered = reference("gather-readiness");
    reordered.outputs = ["ready", "proposal"];
    reordered.thought.goals[0].outputs = ["ready", "proposal"];
    reordered.thought.tasks[0].outputs = ["ready", "proposal"];
    const results = run(reordered, "gather-readiness");
    expect(compile(reordered).payload.task.outputs).toEqual(["ready", "proposal"]);
    expect(results.every((r) => r.matches)).toBe(true);
  });

  it("differs on every completed fixture when an output name is missing, and names it", () => {
    // Every node must reach an output, so the proposal step and its quantity go too.
    const short = reference("gather-readiness");
    short.steps = short.steps.filter((s) => s.id !== "proposal");
    short.inputs = short.inputs.filter((i) => i.id !== "quantity");
    retask(short);
    short.outputs = ["ready"];
    short.thought.goals[0].outputs = ["ready"];
    short.thought.tasks[0].outputs = ["ready"];
    const results = run(short, "gather-readiness");
    // The refusal fixture never reaches the outputs, so it still matches.
    for (const result of results.filter((r) => r.name !== MISSING_SNAPSHOT)) {
      expect(result.matches, result.name).toBe(false);
      expect(result.missingOutputs).toEqual(["proposal"]);
      expect(result.differingOutputs).toEqual(["proposal"]);
      expect(result.redNodeId).toBeNull();
      expect(result.likelyCause).toBeNull();
    }
    expect(byName(results, MISSING_SNAPSHOT).matches).toBe(true);
  });

  it("refuses with missing-input when a runtime input is renamed, with no mark and no guess", () => {
    const renamed = reference("gather-readiness");
    renamed.inputs.find((i) => i.id === "now")!.name = "currentTime";
    const results = run(renamed, "gather-readiness");
    for (const result of results) {
      expect(result.actual).toMatchObject({ status: "refused", code: "missing-input" });
      expect(result.redNodeId).toBeNull();
      expect(result.likelyCause).toBeNull();
    }
    expect(results.filter((r) => r.matches).map((r) => r.name)).toEqual([MISSING_SNAPSHOT]);
  });

  it("differs with no mark when a fixture expects a refusal and the program completes", () => {
    // observedAt becomes an authored constant, so leaving it out no longer refuses.
    const fixed = reference("gather-readiness");
    fixed.inputs = fixed.inputs.map((i) => (i.id === "observedAt" ? { id: "observedAt", value: 10, type: i.type } : i));
    fixed.thought.observations = fixed.thought.observations.filter((o) => o.input !== "observedAt");
    const missing = byName(run(fixed, "gather-readiness"), MISSING_SNAPSHOT);
    expect(missing.actual.status).toBe("completed");
    expect(missing.matches).toBe(false);
    expect(missing.redNodeId).toBeNull();
    expect(missing.likelyCause).toBeNull();
  });

  it("marks a failed run's diagnostic node red", () => {
    // age subtracts the other way round, which overflows below zero.
    const backwards = reference("gather-readiness");
    step(backwards, "age").inputs = ["safeTime", "now"];
    const boundary = byName(run(backwards, "gather-readiness"), BOUNDARY);
    expect(boundary.matches).toBe(false);
    expect(boundary.actual).toMatchObject({ status: "failed", code: "integer-overflow", nodeId: "age" });
    expect(boundary.redNodeId).toBe("age");
    // Its inputs are in another order from the reference's, so it does not match: no guess.
    expect(boundary.likelyCause).toBeNull();
  });

  // The record cap a long-lived view needs is pinned in quinelings.test.ts; this checks that
  // repeated runs in one session neither collide on request ids nor drift.
  it("runs the fixtures again and again in one view's session with the same results", () => {
    const own = newSession(rt);
    const artifact = own.compile(strictYoung());
    for (let i = 0; i < 5; i++) {
      const results = runFixtures(own, rt, artifact, "gather-readiness");
      expect(results.filter((r) => r.matches)).toHaveLength(4);
      expect(byName(results, BOUNDARY).likelyCause?.nodeId).toBe("young");
    }
  });
});
