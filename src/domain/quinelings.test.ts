import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QDL_JOB_IDS, QDL_RELEASE, SESSION_MAX_RECORDS, isQdlJobId, loadQuinelings, newSession } from "./quinelings";

const RUNTIME = new URL("../vendor/quinelings/quinelings-runtime.js", import.meta.url);
const README = new URL("../vendor/quinelings/README.md", import.meta.url);

describe("the vendored Quinelings runtime", () => {
  const source = readFileSync(RUNTIME, "utf8");

  it("is the file its README records", () => {
    const readme = readFileSync(README, "utf8");
    const recorded = /SHA-256: `([0-9a-f]{64})`/.exec(readme)?.[1];
    expect(recorded).toBeDefined();
    expect(createHash("sha256").update(readFileSync(RUNTIME)).digest("hex")).toBe(recorded);
    expect(readme).toContain(`\`${QDL_RELEASE}\``);
  });

  it("reaches no network and evaluates no text, apart from Zod's three schema compilers", () => {
    for (const banned of [/\beval\(/, /\bnew Function\b/, /\bfetch\(/, /XMLHttpRequest/, /WebSocket/, /importScripts/, /sendBeacon/, /EventSource/]) {
      expect(source, String(banned)).not.toMatch(banned);
    }
    expect(source.match(/= Function;/g)).toHaveLength(3);
  });
});

describe("the seam", () => {
  it("loads the runtime once", async () => {
    const first = loadQuinelings();
    expect(loadQuinelings()).toBe(first);
    expect(await first).toBe(await loadQuinelings());
  });

  it("names the library's ten jobs in its order", async () => {
    const rt = await loadQuinelings();
    expect(rt.QDLV1Library.programs.map((p) => p.id)).toEqual([...QDL_JOB_IDS]);
    expect(isQdlJobId("water-total")).toBe(true);
    expect(isQdlJobId("water")).toBe(false);
  });

  it("makes sessions that hold far more than the default 256 records", async () => {
    const rt = await loadQuinelings();
    const session = newSession(rt);
    const job = rt.QDLV1Library.get("water-total");
    const artifact = session.compile(job.intent);
    const runs = 300;
    for (let i = 0; i < runs; i++) session.run({ artifactId: artifact.id, inputs: { readings: [i] }, requestId: `r${i}` });
    expect(SESSION_MAX_RECORDS).toBeGreaterThan(runs);
  });
});
