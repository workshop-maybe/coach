// A pasted program's checks (R8, KTD10 of docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md).
// The program reaches the runtime only as parsed data; compiling it runs nothing (R18). The view
// owns the session (KTD9), so the session comes in from the caller.

import type { QdlArtifact, QdlSession } from "./quinelings";

export type ProgramChecks =
  | {
      compiles: true;
      artifact: QdlArtifact;
      /** The agent's own steps: every compiled node that is not a runtime input or an authored constant. */
      operations: number;
      /** Verifying the artifact gives back the source hash it compiled to. */
      reproducesSource: boolean;
    }
  | { compiles: false; code: string; message: string };

/** Compiles the program and checks that it reproduces its own source. */
export function checkProgram(session: Pick<QdlSession, "compile" | "verify">, intent: unknown): ProgramChecks {
  let artifact: QdlArtifact;
  try {
    artifact = session.compile(intent);
  } catch (error) {
    return { compiles: false, ...diagnosticOf(error) };
  }
  const operations = artifact.payload.task.nodes.filter((node) => !AUTHORED.has(node.op)).length;
  return { compiles: true, artifact, operations, reproducesSource: reproduces(session, artifact) };
}

/** Node kinds the compiler makes from the program's declared inputs and constants. */
const AUTHORED = new Set(["input", "literal"]);

function reproduces(session: Pick<QdlSession, "verify">, artifact: QdlArtifact): boolean {
  try {
    return session.verify(artifact.id).sourceHash === artifact.sourceHash;
  } catch {
    return false;
  }
}

/** The runtime throws errors with a `code`; anything else still reads as a diagnostic. */
export function diagnosticOf(error: unknown): { code: string; message: string } {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return {
    code: typeof code === "string" && code ? code : "error",
    message: typeof message === "string" ? message : String(error),
  };
}
