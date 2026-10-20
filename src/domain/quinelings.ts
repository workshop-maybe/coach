// Quinelings' bundled runtime behind one seam (KTD1, KTD2 and KTD9 of
// docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md). The runtime is vendored byte for
// byte from the qdl-v1.0.0 release (src/vendor/quinelings/README.md) and is about 1.2 MB, so it
// loads on demand, in a chunk of its own, the first time a program reply opens. Nothing else
// imports it. A pasted program only ever reaches the runtime as parsed JSON, which its bounded
// interpreter reads as data (R18). Tests that cannot load it mock this module.

import type * as Runtime from "../vendor/quinelings/quinelings-runtime.js";

export type { QdlArtifact, QdlFixture, QdlFrame, QdlLibraryProgram, QdlNode, QdlOccurrence, QdlTraceStep } from "../vendor/quinelings/quinelings-runtime.js";
export type QuinelingsRuntime = typeof Runtime;
export type QdlSession = Runtime.V1Session;

/** The Quinelings release the app checks programs against, and every badge's task links to. */
export const QDL_RELEASE = "qdl-v1.0.0";
export const QDL_SPEC_URL = `https://github.com/CharlesHoskinson/quinelings/blob/${QDL_RELEASE}/docs/QDL-V1.md`;

/**
 * The ten jobs in the release's QDL 1 library, in its order. Each is also the slug of its badge
 * in the Bounded programs collection (KTD3), so routing can tell a program badge without loading
 * the runtime.
 */
export const QDL_JOB_IDS = [
  "gather-readiness",
  "craft-quote",
  "confirmed-checkpoints",
  "evidence-ledger",
  "route-preview",
  "trade-preview",
  "needs-triage",
  "receipt-reconciliation",
  "water-total",
  "work-schedule",
] as const;
export type QdlJobId = (typeof QDL_JOB_IDS)[number];

export function isQdlJobId(value: string): value is QdlJobId {
  return (QDL_JOB_IDS as readonly string[]).includes(value);
}

/**
 * The runtime's run store never evicts and holds 256 records by default; every run of the
 * fixtures also runs the job's reference program, so a view would fill it in about 20 runs.
 * 4096 is the runtime's maximum (KTD9).
 */
export const SESSION_MAX_RECORDS = 4096;

let runtime: Promise<QuinelingsRuntime> | null = null;

/** Loads the runtime once; every caller shares the load. */
export function loadQuinelings(): Promise<QuinelingsRuntime> {
  runtime ??= import("../vendor/quinelings/quinelings-runtime.js").catch((error: unknown) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

/** A fresh session for one open view (KTD9). */
export function newSession(rt: QuinelingsRuntime): QdlSession {
  return new rt.V1Session({ maxRecords: SESSION_MAX_RECORDS });
}
