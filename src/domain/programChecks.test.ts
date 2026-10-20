import { vi, beforeAll, describe, expect, it } from "vitest";
import { checkProgram } from "./programChecks";
import { loadQuinelings, newSession, type QdlSession, type QuinelingsRuntime } from "./quinelings";

// These tests load and run the real Quinelings runtime: about 1 s to load, about 25 ms a run.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let rt: QuinelingsRuntime;
let session: QdlSession;

beforeAll(async () => {
  rt = await loadQuinelings();
  session = newSession(rt);
});

describe("a program's checks", () => {
  it("reports a compiled reference: compiles, its step count and reproduces its own source", () => {
    const checks = checkProgram(session, rt.QDLV1Library.get("gather-readiness").intent);
    expect(checks.compiles).toBe(true);
    if (!checks.compiles) return;
    expect(checks.operations).toBe(8);
    expect(checks.reproducesSource).toBe(true);
    expect(checks.artifact.payload.task.outputs).toEqual(["proposal", "ready"]);
  });

  it("reports false when the verified source does not match the compiled one", () => {
    const lying = {
      compile: session.compile.bind(session),
      verify: () => ({ sourceHash: "ql_not-the-same" }),
    };
    const checks = checkProgram(lying, rt.QDLV1Library.get("water-total").intent);
    expect(checks).toMatchObject({ compiles: true, reproducesSource: false });
  });

  it("reports false when verify itself throws", () => {
    const broken = {
      compile: session.compile.bind(session),
      verify: () => {
        throw new Error("gone");
      },
    };
    expect(checkProgram(broken, rt.QDLV1Library.get("water-total").intent)).toMatchObject({ compiles: true, reproducesSource: false });
  });

  it("reports the compile diagnostic for an intent with no thought", () => {
    const { thought: _thought, ...intent } = rt.QDLV1Library.get("gather-readiness").intent;
    const checks = checkProgram(session, intent);
    expect(checks.compiles).toBe(false);
    if (checks.compiles) return;
    expect(checks.code).toBe("invalid-input");
    expect(checks.message).toBeTruthy();
  });

  it("reports a diagnostic for something that is not a program at all", () => {
    expect(checkProgram(session, "not a program")).toMatchObject({ compiles: false });
  });
});
