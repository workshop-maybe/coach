import { describe, expect, it } from "vitest";
import { findProgram, findProgramInItems, PROGRAM_TEXT_CAP } from "./programReply";
import type { ReplyItem } from "./types";

const intent = {
  format: "qdl-intent",
  version: 1,
  name: "gather-readiness",
  inputs: [{ name: "items", type: "list" }],
  body: { op: "all", of: ["ready_a", "ready_b"] },
};
const other = { ...intent, name: "craft-quote" };
const json = (v: unknown, indent = 2) => JSON.stringify(v, null, indent);

describe("findProgram", () => {
  it("finds the program in a fenced json block among prose", () => {
    const text = `Here is my program.\n\n\`\`\`json\n${json(intent)}\n\`\`\`\n\nIt gathers readiness.`;
    expect(findProgram(text)).toEqual({ kind: "program", intent });
  });

  it("finds it in a fenced block with no language tag, or a tilde fence", () => {
    expect(findProgram(`\`\`\`\n${json(intent)}\n\`\`\``)).toEqual({ kind: "program", intent });
    expect(findProgram(`~~~qdl\n${json(intent)}\n~~~`)).toEqual({ kind: "program", intent });
  });

  it("finds an unfenced intent stored with the reply box's escapes", () => {
    const withMarks = { ...intent, note: "a[0] < b_c & d" };
    const escaped = json(withMarks).replace(/[[\]_]/g, (c) => `\\${c}`).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    expect(escaped).toContain("\\[");
    expect(escaped).toContain("\\_");
    expect(escaped).toContain("&lt;");
    expect(findProgram(`My program:\n\n${escaped}\n\nDone.`)).toEqual({ kind: "program", intent: withMarks });
  });

  it("finds an unfenced intent pasted on one line, beside stray braces in prose", () => {
    const text = `Use { to open a group. The program is ${JSON.stringify(intent)} and a } closes.`;
    expect(findProgram(text)).toEqual({ kind: "program", intent });
  });

  it("covers AE4: prose only returns no program", () => {
    expect(findProgram("I looked at the job and I think it needs more inputs. Can you say more?")).toEqual({ kind: "none" });
    expect(findProgram("")).toEqual({ kind: "none" });
  });

  it("falls back to the unfenced scan when fenced blocks hold other JSON", () => {
    const text = `\`\`\`json\n{"fixtures": [1, 2]}\n\`\`\`\n\nThe program:\n\n${json(intent)}`;
    expect(findProgram(text)).toEqual({ kind: "program", intent });
  });

  it("returns more than one for two different intents, and one program for the same intent twice", () => {
    expect(findProgram(`\`\`\`json\n${json(intent)}\n\`\`\`\n\n\`\`\`json\n${json(other)}\n\`\`\``)).toEqual({ kind: "several", count: 2 });
    const reordered = Object.fromEntries(Object.entries(intent).reverse());
    expect(findProgram(`\`\`\`json\n${json(intent)}\n\`\`\`\n\n\`\`\`\n${json(reordered, 0)}\n\`\`\``)).toEqual({ kind: "program", intent });
    expect(findProgram(`${JSON.stringify(intent)}\n\nand again\n\n${json(intent)}`)).toEqual({ kind: "program", intent });
  });

  it("returns unreadable with the parser's message for a fenced qdl-intent block that does not parse", () => {
    const broken = `\`\`\`json\n{"format": "qdl-intent", "version": 1,}\n\`\`\``;
    let message = "";
    try {
      JSON.parse(`{"format": "qdl-intent", "version": 1,}`);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(findProgram(broken)).toEqual({ kind: "unreadable", message });
  });

  it("returns unreadable for an unclosed unfenced intent", () => {
    const result = findProgram(`Here: {"format": "qdl-intent", "body": {"op": "all"`);
    expect(result.kind).toBe("unreadable");
  });

  it("finds an intent nested inside a wrapper object, outermost first", () => {
    const wrapped = { answer: { program: intent }, notes: "see above" };
    expect(findProgram(`\`\`\`json\n${json(wrapped)}\n\`\`\``)).toEqual({ kind: "program", intent });
    expect(findProgram(json(wrapped))).toEqual({ kind: "program", intent });
    const holder = { ...intent, body: { op: "embed", inner: other } };
    expect(findProgram(json(holder))).toEqual({ kind: "program", intent: holder });
  });

  it("parses a string literal holding U+2028 and U+2029", () => {
    const withSeparators = { ...intent, note: "one two three" };
    expect(findProgram(`\`\`\`json\n${json(withSeparators)}\n\`\`\``)).toEqual({ kind: "program", intent: withSeparators });
    expect(findProgram(`Program: ${JSON.stringify(withSeparators)}`)).toEqual({ kind: "program", intent: withSeparators });
  });

  it("returns promptly for a single line over the length cap", () => {
    const line = `{"format": "qdl-intent", "x": "${"a".repeat(PROGRAM_TEXT_CAP)}"}`;
    const start = performance.now();
    const result = findProgram(line);
    expect(performance.now() - start).toBeLessThan(500);
    expect(result.kind).toBe("unreadable");
    expect(findProgram("x".repeat(PROGRAM_TEXT_CAP + 1)).kind).toBe("none");
  });

  it("reads long hostile lines under the cap in linear time", () => {
    const lines = ["{".repeat(500_000) + '"qdl-intent"', '{"a":'.repeat(100_000), `{"format":"qdl-intent"${'"'.repeat(200_000)}`, "\\".repeat(400_000)];
    for (const line of lines) {
      const start = performance.now();
      findProgram(line);
      expect(performance.now() - start, line.slice(0, 12)).toBeLessThan(1500);
    }
  });

  it("keeps a <script> string inside the program as inert data", () => {
    const scripted = { ...intent, note: "<script>globalThis.__ran = true</script>" };
    const result = findProgram(`\`\`\`json\n${json(scripted)}\n\`\`\``);
    expect(result).toEqual({ kind: "program", intent: scripted });
    expect((globalThis as Record<string, unknown>).__ran).toBeUndefined();
  });

  it("reads a __proto__ key as data, without changing the intent's prototype", () => {
    const text = '```json\n{"format": "qdl-intent", "__proto__": {"polluted": true}}\n```';
    const result = findProgram(text);
    expect(result.kind).toBe("program");
    if (result.kind !== "program") return;
    expect(Object.getPrototypeOf(result.intent)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not take a format nested only in a prototype or a string", () => {
    expect(findProgram('```json\n{"note": "format: qdl-intent"}\n```').kind).toBe("none");
    expect(findProgram('```json\n["qdl-intent"]\n```').kind).toBe("none");
  });
});

describe("findProgramInItems", () => {
  it("reads the take's text items joined, and ignores other items", () => {
    const items: ReplyItem[] = [
      { kind: "text", text: "Here it is." },
      { kind: "file", name: "program.json", ref: "program.json" },
      { kind: "text", text: `\`\`\`json\n${json(intent)}\n\`\`\`` },
    ];
    expect(findProgramInItems(items)).toEqual({ kind: "program", intent });
  });
});
