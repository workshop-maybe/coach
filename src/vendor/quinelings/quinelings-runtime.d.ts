// Types for the parts of Quinelings' bundled runtime the app calls (KTD1 of
// docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md). The runtime itself is vendored
// byte for byte; see README.md beside it. Only src/domain/quinelings.ts imports it.

/** A QDL 1 authoring record (`format: "qdl-intent"`). Its shape is the agent's to get right. */
export type QdlIntent = { format: "qdl-intent" } & Record<string, unknown>;

export interface QdlNode {
  id: string;
  op: string;
  inputs: string[];
  params: Record<string, unknown>;
  type?: unknown;
}

export interface QdlArtifact {
  id: string;
  sourceHash: string;
  payload: { task: { nodes: QdlNode[]; outputs: string[] } };
}

export interface QdlTraceStep {
  nodeId: string;
  op: string;
  /** The values of the step's inputs, in order. Their node ids are on the compiled node. */
  inputs: unknown[];
  value: unknown;
}

export interface QdlDiagnostic {
  code: string;
  message?: string;
  nodeId?: string;
  path?: string;
}

export interface QdlOccurrence {
  status: string;
  outputs: unknown[];
  trace: QdlTraceStep[];
  diagnostic?: QdlDiagnostic;
}

export interface QdlRunRecord {
  result: { status: string; occurrences: QdlOccurrence[] };
}

export interface QdlFrame {
  /** x, y, z, w for each sampled point. */
  points: ArrayLike<number>;
  /** Three per point. */
  normals: ArrayLike<number>;
  /** Index into `nodeIds` of the operation each point belongs to. */
  owners: ArrayLike<number>;
  nodeIds: string[];
  nodeRoles: string[];
}

export interface QdlFixture {
  name: string;
  inputs: Record<string, unknown>;
  expectedOutputs?: unknown[];
  expectedStatus?: "refused" | "failed";
  expectedDiagnostic?: string;
}

export interface QdlLibraryProgram {
  id: string;
  name: string;
  description: string;
  intent: QdlIntent & { outputs: string[] };
  fixtures: QdlFixture[];
}

/** Thrown by the runtime: `code` names the diagnostic. */
export interface QdlError extends Error {
  code: string;
  path?: string;
}

export class V1Session {
  constructor(options?: { maxArtifacts?: number; maxRecords?: number });
  compile(intent: unknown): QdlArtifact;
  verify(artifactId: string): { sourceHash: string };
  run(request: { artifactId: string; inputs: Record<string, unknown>; requestId: string }): QdlRunRecord;
  frame(artifactId: string, phase: number, options: { budget: number; crests?: number }): QdlFrame;
}

export const QDLV1Library: {
  programs: readonly QdlLibraryProgram[];
  get(id: string): QdlLibraryProgram;
};

export const Quinelings: {
  canon(value: unknown): string;
};
