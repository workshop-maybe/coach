// Runs a compiled program against its job's fixtures and says where a failure sits (R9, R11, R15,
// R16; KTD6 to KTD9 of docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md). Everything runs
// inside Quinelings' bounded interpreter, in the session the view owns. Results sit beside the
// verdict and never decide it (R10).
//
// A failure carries two marks. The red node is certain: the agent's node behind the first wrong
// output, or the node a failed run names. The likely cause is a guess: the agent's program is
// matched node by node against the job's reference program, and the guess is the first matched
// step whose inputs agree with the reference but whose own value does not.

import type { QdlArtifact, QdlFixture, QdlJobId, QdlNode, QdlSession, QdlTraceStep, QuinelingsRuntime } from "./quinelings";
import { diagnosticOf } from "./programChecks";

/** Outputs are keyed by name: an output's name is the id of the node that produces it. */
export type FixtureOutputs = Record<string, unknown>;

/** How the job says the run should end. A refusal or failure is named by its diagnostic code. */
export type FixtureExpected =
  | { status: "completed"; outputs: FixtureOutputs }
  | { status: "refused" | "failed"; code: string };

/** How the agent's run ended. A refusal happens at binding, so it has no node and no trace. */
export type FixtureActual =
  | { status: "completed"; outputs: FixtureOutputs }
  | { status: "refused"; code: string; message: string }
  | { status: "failed"; code: string; message: string; nodeId: string | null };

/** The guess at a failure's cause: an agent node, its value, and the reference's value there. */
export interface LikelyCause {
  nodeId: string;
  agentValue: unknown;
  referenceValue: unknown;
}

export interface FixtureResult {
  name: string;
  inputs: Record<string, unknown>;
  expected: FixtureExpected;
  actual: FixtureActual;
  matches: boolean;
  /** Expected output names whose value differs or is missing, in the reference's order. */
  differingOutputs: string[];
  /** Expected output names the agent's program does not produce at all. */
  missingOutputs: string[];
  /** The agent's run, step by step, for the run walk and the hover values. Empty when refused. */
  trace: QdlTraceStep[];
  /** The agent node that certainly produced the failure (KTD7), or null. */
  redNodeId: string | null;
  /** A guess from matching against the reference program (KTD8), or null when it cannot match. */
  likelyCause: LikelyCause | null;
}

type Canon = (value: unknown) => string;

/**
 * Runs `artifact` against every fixture of `jobId`, in the library's order. The job's reference
 * program compiles in the same session, so a guess can compare against its run.
 */
export function runFixtures(session: QdlSession, rt: QuinelingsRuntime, artifact: QdlArtifact, jobId: QdlJobId): FixtureResult[] {
  const job = rt.QDLV1Library.get(jobId);
  const canon: Canon = (value) => rt.Quinelings.canon(value);
  const reference = session.compile(job.intent);
  let counterparts: Map<string, string> | undefined;

  return job.fixtures.map((fixture) => {
    const expected = expectedOf(fixture, reference.payload.task.outputs);
    const { actual, trace } = runOnce(session, artifact, fixture.inputs);

    const missingOutputs: string[] = [];
    const differingOutputs: string[] = [];
    if (expected.status === "completed" && actual.status === "completed") {
      for (const [name, value] of Object.entries(expected.outputs)) {
        if (!Object.prototype.hasOwnProperty.call(actual.outputs, name)) {
          missingOutputs.push(name);
          differingOutputs.push(name);
        } else if (canon(actual.outputs[name]) !== canon(value)) {
          differingOutputs.push(name);
        }
      }
    }

    const matches =
      expected.status === "completed"
        ? actual.status === "completed" && differingOutputs.length === 0
        : actual.status === expected.status && actual.code === expected.code;

    const redNodeId = matches ? null : redNodeOf(expected, actual, differingOutputs, missingOutputs);
    let likelyCause: LikelyCause | null = null;
    if (redNodeId) {
      counterparts ??= matchNodes(artifact.payload.task.nodes, reference.payload.task.nodes, canon);
      likelyCause = guessCause(redNodeId, artifact, counterparts, trace, () => runOnce(session, reference, fixture.inputs).trace, canon);
    }

    return { name: fixture.name, inputs: fixture.inputs, expected, actual, matches, differingOutputs, missingOutputs, trace, redNodeId, likelyCause };
  });
}

/** Expected outputs are positional in the reference program's outputs; this keys them by name (KTD6). */
function expectedOf(fixture: QdlFixture, referenceOutputs: string[]): FixtureExpected {
  if (fixture.expectedStatus) return { status: fixture.expectedStatus, code: fixture.expectedDiagnostic ?? "" };
  const values = fixture.expectedOutputs ?? [];
  return { status: "completed", outputs: Object.fromEntries(referenceOutputs.map((name, i) => [name, values[i]])) };
}

/**
 * Run ids must be unique within a session, and a session outlives many runs of the fixtures, so
 * the counter is the module's (KTD9). Never from `Date`, which the screenshot harness freezes.
 */
let requests = 0;

function runOnce(session: QdlSession, artifact: QdlArtifact, inputs: Record<string, unknown>): { actual: FixtureActual; trace: QdlTraceStep[] } {
  let occurrence;
  try {
    // Every library program has one occurrence (KTD6).
    occurrence = session.run({ artifactId: artifact.id, inputs, requestId: `fixture-${++requests}` }).result.occurrences[0];
  } catch (error) {
    // The runtime refuses bad bindings by throwing, before any node runs.
    return { actual: { status: "refused", ...diagnosticOf(error) }, trace: [] };
  }
  const trace = occurrence?.trace ?? [];
  if (occurrence?.status === "completed") {
    const outputs = Object.fromEntries(artifact.payload.task.outputs.map((name, i) => [name, occurrence.outputs[i]]));
    return { actual: { status: "completed", outputs }, trace };
  }
  // Any other end is a failed evaluation; its diagnostic names the node where it stopped.
  const diagnostic = occurrence?.diagnostic;
  const actual: FixtureActual = {
    status: "failed",
    code: diagnostic?.code ?? occurrence?.status ?? "failed",
    message: diagnostic?.message ?? "",
    nodeId: diagnostic?.nodeId ?? null,
  };
  return { actual, trace };
}

/**
 * The certain mark (KTD7): the node behind the first differing output the program does produce,
 * or a failed run's diagnostic node. A run refused at binding, one that completed where a refusal
 * or failure was expected, or a failure where a refusal was expected has no node to mark.
 */
function redNodeOf(expected: FixtureExpected, actual: FixtureActual, differing: string[], missing: string[]): string | null {
  if (actual.status === "completed") {
    if (expected.status !== "completed") return null;
    return differing.find((name) => !missing.includes(name)) ?? null;
  }
  if (actual.status === "failed" && expected.status !== "refused") return actual.nodeId;
  return null;
}

/**
 * Matches each agent node to a reference node, bottom up (KTD8): runtime inputs by name, authored
 * constants by canonical value, steps by operation plus already-matched inputs in order. Params
 * are ignored, so a changed operator still matches; they only break ties, then the id does, and a
 * node still tied stays unmatched. Compiled nodes come in dependency order.
 */
function matchNodes(agent: QdlNode[], reference: QdlNode[], canon: Canon): Map<string, string> {
  const matched = new Map<string, string>();
  for (const node of agent) {
    const candidates = reference.filter((ref) => {
      if (ref.op !== node.op) return false;
      if (node.op === "input") return ref.params.name === node.params.name;
      if (node.op === "literal") return canon(ref.params.value) === canon(node.params.value);
      return ref.inputs.length === node.inputs.length && node.inputs.every((id, i) => matched.get(id) === ref.inputs[i]);
    });
    const chosen = breakTie(node, candidates, canon);
    if (chosen) matched.set(node.id, chosen.id);
  }
  return matched;
}

function breakTie(node: QdlNode, candidates: QdlNode[], canon: Canon): QdlNode | undefined {
  if (candidates.length <= 1) return candidates[0];
  const sameParams = candidates.filter((ref) => canon(ref.params) === canon(node.params));
  if (sameParams.length === 1) return sameParams[0];
  const pool = sameParams.length > 1 ? sameParams : candidates;
  const sameId = pool.filter((ref) => ref.id === node.id);
  return sameId.length === 1 ? sameId[0] : undefined;
}

/**
 * The guess (KTD8). Shown only when the red node and every node it depends on matched the
 * reference. Then the reference runs on the same inputs, and the guess is the first node in the
 * agent's run whose inputs carry the reference's values but whose own value differs.
 */
function guessCause(
  redNodeId: string,
  artifact: QdlArtifact,
  counterparts: Map<string, string>,
  trace: QdlTraceStep[],
  referenceTrace: () => QdlTraceStep[],
  canon: Canon,
): LikelyCause | null {
  const cone = ancestorCone(redNodeId, artifact.payload.task.nodes);
  if (!cone || [...cone].some((id) => !counterparts.has(id))) return null;

  const referenceSteps = new Map(referenceTrace().map((step) => [step.nodeId, step]));
  for (const step of trace) {
    if (!cone.has(step.nodeId)) continue;
    const ref = referenceSteps.get(counterparts.get(step.nodeId)!);
    if (!ref) continue;
    if (canon(step.inputs) === canon(ref.inputs) && canon(step.value) !== canon(ref.value)) {
      return { nodeId: step.nodeId, agentValue: step.value, referenceValue: ref.value };
    }
  }
  return null;
}

/** The node and every node it depends on, or null when the id is not in the program. */
function ancestorCone(nodeId: string, nodes: QdlNode[]): Set<string> | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(nodeId)) return null;
  const cone = new Set<string>();
  const pending = [nodeId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (cone.has(id)) continue;
    cone.add(id);
    pending.push(...(byId.get(id)?.inputs ?? []));
  }
  return cone;
}
