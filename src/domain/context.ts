// What a result says about the context its test started with (R6, R7). Derived when
// shown, never stored, and never a matrix flag, so it can't mark a result out of date
// or change who holds a badge (R8, R9).

import { MEMORY_NOT_READ, type Assessment, type TestContext } from "./types";

/** A complete context: all four fields non-empty text. Anything else reads as no context. */
export function isTestContext(v: unknown): v is TestContext {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return [c.machineId, c.machine, c.memory, c.capturedAt].every((f) => typeof f === "string" && f !== "");
}

export interface ContextLine {
  /** The machine the test ran on. */
  machine: string;
  /**
   * `changed` when the fingerprint differs from this agent's most recent earlier result on
   * the same machine that has one. `unchanged` when it matches or there is no such result.
   */
  memory: "changed" | "unchanged" | "not-read";
}

/** The context line for `result`, or null when it has no context. */
export function contextLine(assessments: readonly Assessment[], result: Assessment): ContextLine | null {
  const context = result.context;
  if (!context) return null;
  if (context.memory === MEMORY_NOT_READ) return { machine: context.machine, memory: "not-read" };

  let baseline: Assessment["context"];
  for (const other of assessments) {
    const c = other.context;
    if (other.profileSlug !== result.profileSlug || !c) continue;
    if (c.machineId !== context.machineId || c.memory === MEMORY_NOT_READ) continue;
    if (c.capturedAt >= context.capturedAt) continue;
    if (!baseline || c.capturedAt > baseline.capturedAt) baseline = c;
  }
  const changed = baseline !== undefined && baseline.memory !== context.memory;
  return { machine: context.machine, memory: changed ? "changed" : "unchanged" };
}
