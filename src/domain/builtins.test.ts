import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../storage/memory";
import { BUILT_INS } from "./builtins";
import { parseCredentialMd } from "./credential-md";
import { checkFactoryCredential } from "./factory-checks.testkit";
import { credentialPath, loadFolder, serializeCollection } from "./folder";
import { localRefNames } from "./images";
import { addBuiltinCollection, builtinStatus } from "./operations";
import { QDL_JOB_IDS, QDL_RELEASE, QDL_SPEC_URL, loadQuinelings } from "./quinelings";
import { slugify } from "./slug";

const ROOT = join(__dirname, "..", "collections");

describe("BUILT_INS", () => {
  it("loads the four built-ins in order, with five, five, two and ten badges", () => {
    expect(BUILT_INS.map((b) => [b.slug, b.collection.name, Object.keys(b.credentials).length])).toEqual([
      ["cardano-dev-skills", "Cardano Dev Skills", 5],
      ["course-authoring", "Course authoring", 5],
      ["nostr-relays", "Nostr relays", 2],
      ["bounded-programs", "Bounded programs", 10],
    ]);
  });

  for (const builtIn of BUILT_INS) {
    describe(builtIn.slug, () => {
      const { collection, credentials } = builtIn;

      it("keeps collection.json in the data folder's own format", () => {
        const text = readFileSync(join(ROOT, builtIn.slug, "collection.json"), "utf8");
        expect(serializeCollection(collection)).toBe(text);
        expect(collection.description).not.toBe("");
      });

      it("orders exactly its credential files, each with a distinct positive code", () => {
        expect([...collection.order].sort()).toEqual(Object.keys(credentials).sort());
        expect(new Set(collection.order).size).toBe(collection.order.length);
        expect(Object.keys(collection.codes).sort()).toEqual([...collection.order].sort());
        const codes = Object.values(collection.codes);
        expect(new Set(codes).size).toBe(codes.length);
        for (const code of codes) expect(Number.isInteger(code) && code > 0).toBe(true);
      });

      for (const [slug, markdown] of Object.entries(credentials)) {
        describe(slug, () => {
          checkFactoryCredential(markdown, { slug, collectionSlug: builtIn.slug });

          it("refers to no picture or video, and no heading ends in a period", () => {
            expect(localRefNames(markdown, () => true)).toEqual([]);
            expect(markdown).not.toMatch(/^#{1,6}\s.*\.\s*$/m);
          });
        });
      }
    });
  }
});

describe("Bounded programs (R1 to R4)", () => {
  const builtIn = BUILT_INS.find((b) => b.slug === "bounded-programs")!;
  const badge = (id: string) => parseCredentialMd(builtIn.credentials[id], { slug: id, collectionSlug: builtIn.slug });

  it("has one badge per library job, in library order, each slug the job's id", async () => {
    const rt = await loadQuinelings();
    expect(builtIn.collection.order).toEqual([...QDL_JOB_IDS]);
    expect(rt.QDLV1Library.programs.map((p) => p.id)).toEqual([...QDL_JOB_IDS]);
    expect(Object.keys(builtIn.credentials).sort()).toEqual([...QDL_JOB_IDS].sort());
    for (const id of QDL_JOB_IDS) expect(slugify(badge(id).name)).toBe(id);
  });

  it("has no run of 20 or more letters and digits in any badge", () => {
    for (const id of QDL_JOB_IDS) expect(builtIn.credentials[id]).not.toMatch(/[A-Za-z0-9]{20,}/);
  });

  it("states the spec link at the release tag and every input and output name in each task", async () => {
    const rt = await loadQuinelings();
    for (const program of rt.QDLV1Library.programs) {
      const { task } = badge(program.id);
      expect(QDL_SPEC_URL).toContain(QDL_RELEASE);
      expect(task).toContain(QDL_SPEC_URL);
      expect(task).toContain("`thought`");
      expect(task).toContain("`qdl-intent`");
      const inputs = (program.intent.inputs as { name?: string; value?: unknown }[]).filter((i) => !("value" in i));
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) expect(task).toContain(`\`${input.name}\``);
      // The outputs are listed in order, one numbered line each.
      const listed = [...task.matchAll(/^\d+\. `([^`]+)`/gm)].map((m) => m[1]);
      expect(listed).toEqual(program.intent.outputs);
    }
  });

  it("names every fixture in its rubric, in library order, with its expected result", async () => {
    const rt = await loadQuinelings();
    const canon = (v: unknown) => rt.Quinelings.canon(v);
    for (const program of rt.QDLV1Library.programs) {
      const lines = badge(program.id).rubric.split("\n").filter((l) => l.startsWith("- "));
      expect(lines).toHaveLength(program.fixtures.length);
      program.fixtures.forEach((fixture, i) => {
        const m = /^- (.+?): inputs `(.+?)` (?:give `(.+)`|are refused with diagnostic `([^`]+)`|fail with diagnostic `([^`]+)`)$/.exec(lines[i]);
        expect(m, lines[i]).not.toBeNull();
        const [, name, inputs, outputs, refused, failed] = m!;
        expect(name).toBe(fixture.name);
        expect(canon(JSON.parse(inputs))).toBe(canon(fixture.inputs));
        if (fixture.expectedOutputs !== undefined) {
          expect(outputs).toBeDefined();
          expect(canon(JSON.parse(outputs))).toBe(canon(fixture.expectedOutputs));
        } else if (fixture.expectedStatus === "refused") {
          expect(refused).toBe(fixture.expectedDiagnostic);
        } else {
          expect(fixture.expectedStatus).toBe("failed");
          expect(failed).toBe(fixture.expectedDiagnostic);
        }
      });
    }
  });

  it("an add that fails part way leaves the copy unfinished, and adding again writes only what is missing", async () => {
    const storage = new MemoryStorage();
    const state = await loadFolder(storage);
    const last = builtIn.collection.order[builtIn.collection.order.length - 1];
    const real = storage.writeText.bind(storage);
    const spy = vi.spyOn(storage, "writeText").mockImplementation(async (root, path, text) => {
      if (path === credentialPath("bounded-programs", last)) throw new Error("disk full");
      return real(root, path, text);
    });
    await expect(addBuiltinCollection(storage, state, "bounded-programs")).rejects.toThrow("disk full");
    spy.mockRestore();
    const partial = await loadFolder(storage);
    expect(builtinStatus(partial, builtIn)).toEqual({ kind: "incomplete", slug: "bounded-programs", missing: [last] });

    const writes = vi.spyOn(storage, "writeText");
    const retry = await addBuiltinCollection(storage, state, "bounded-programs");
    expect(writes.mock.calls.map(([, path]) => path)).toEqual([credentialPath("bounded-programs", last)]);
    expect(retry.state.credentials.map((c) => c.slug)).toEqual([...QDL_JOB_IDS]);
    expect(retry.state.collections.find((c) => c.slug === "bounded-programs")?.from).toBe("bounded-programs");
    expect(builtinStatus(retry.state, builtIn)).toEqual({ kind: "added", slug: "bounded-programs" });
  });
});
