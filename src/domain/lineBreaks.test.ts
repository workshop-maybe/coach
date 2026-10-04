import { describe, expect, it, vi } from "vitest";
import { JevError } from "../jev/jev";
import { fitsJev } from "./jevBudget";
import type { JevAnswers, LineBreaksRequest } from "./jevRequest";
import { BACKOFF_MS, BATCH_RETRIES as LINE_BREAK_RETRIES } from "./jevBatches";
import {
  JOIN_AFTER_OPEN,
  JOIN_AFTER_STOP,
  LINE_BREAK_CRITERIA,
  askLineBreaks,
  cleanUpLineBreaks,
  joinLines,
  lineBreakBatches,
  lineBreakQuestion,
  lineBreakState,
} from "./lineBreaks";
import { fixPastedText } from "./pasteText";

/** Greedy word wrap at `width` columns, the way a terminal lays out a long line. */
function wrapAt(text: string, width: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

const PROSE =
  "The badge page kept showing the stale flag after a result was saved, because the flag was read once when the page opened and never again. " +
  "Reading it on every render fixes it, and a test now saves a result and checks the flag clears without a reload.";

/** A paste long enough that its candidates fill more than one request. */
const LONG = wrapAt(Array.from({ length: 80 }, () => PROSE).join(" "), 60);

/** AE6 after the fixes: a list item torn by the terminal, and the next item. */
const AE6 = "Fixed two things:\n- the stale flag on the\n  badge page\n- the next item";

/** The text with all whitespace taken out. */
const ink = (text: string) => text.replace(/\s/g, "");

/** Every question id across the batches, in order. */
const idsOf = (batches: LineBreaksRequest[]) => batches.flatMap((b) => Object.keys(b.questions));

/** An ask that answers every id with `p`. */
const answerAll =
  (p: number) =>
  async (r: LineBreaksRequest): Promise<JevAnswers> => ({ answers: Object.fromEntries(Object.keys(r.questions).map((id) => [id, p])) });

const noWait = () => Promise.resolve();

describe("lineBreakState", () => {
  it("tags every line with its id, the line kept verbatim with its indent", () => {
    expect(lineBreakState(AE6)).toBe("L001| Fixed two things:\nL002| - the stale flag on the\nL003|   badge page\nL004| - the next item");
  });

  it("pads ids to the line count, three digits at least", () => {
    const text = Array.from({ length: 1200 }, (_, i) => `line ${i}`).join("\n");
    const tagged = lineBreakState(text).split("\n");
    expect(tagged[0]).toBe("L0001| line 0");
    expect(tagged[1199]).toBe("L1200| line 1199");
  });
});

describe("lineBreakBatches", () => {
  it("Covers AE6. asks one Noul about the torn item line and never about the next item", () => {
    const batches = lineBreakBatches(AE6)!;
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual({
      kind: "lineBreaks",
      state: lineBreakState(AE6),
      questions: {
        L003: { type: "noul", instructions: lineBreakQuestion("L002", "L003"), criteria: LINE_BREAK_CRITERIA },
      },
    });
  });

  it("words each question as the cookbook does, with its criteria", () => {
    expect(lineBreakQuestion("L014", "L015")).toBe("Does line L015 pick up mid-sentence, continuing a sentence left unfinished at the end of line L014?");
    expect(LINE_BREAK_CRITERIA).toEqual({
      true: "The line starts in the middle of a sentence that began on the previous line - the line break tore the sentence apart",
      false: "The line begins a new sentence, item, heading, or thought of its own",
    });
  });

  it("asks nothing across a blank line", () => {
    expect(lineBreakBatches("one paragraph\n\nanother paragraph")).toEqual([]);
  });

  it("asks nothing about a line indented deeper than the previous line's text column", () => {
    expect(lineBreakBatches("Run this\n    npm test\n- item\n    nested code")).toEqual([]);
  });

  it("asks nothing about lines inside a fence", () => {
    expect(lineBreakBatches("Code:\n\n```\nconst a =\n  1;\nlet b\nlet c\n```")).toEqual([]);
  });

  it("with a wrap width, asks about a line filled to the width and not a short unpunctuated one", () => {
    const wrapped = wrapAt(PROSE, 60);
    const text = `Steps\ndo this first\n\n${wrapped}`;
    const ids = idsOf(lineBreakBatches(text)!);
    expect(ids).not.toContain("L002");
    const wrappedLines = wrapped.split("\n").length;
    expect(ids).toEqual(Array.from({ length: wrappedLines - 1 }, (_, i) => `L${String(i + 5).padStart(3, "0")}`));
  });

  it("splits a long paste into several batches, each within both limits, asking about every candidate once", () => {
    const text = LONG;
    const lines = text.split("\n").length;
    const batches = lineBreakBatches(text)!;
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) {
      expect(fitsJev(b)).toBe(true);
      expect(b.state).toBe(lineBreakState(text));
    }
    const ids = idsOf(batches);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(lines - 1);
  });

  it("is null when the paste alone is over Jev's budget, so nothing is asked", () => {
    const text = wrapAt(Array.from({ length: 700 }, () => PROSE).join(" "), 60);
    expect(lineBreakBatches(text)).toBeNull();
  });
});

describe("joinLines", () => {
  it("Covers AE6. a join answer merges the torn line into the item, and the next item keeps its own line", () => {
    expect(joinLines(AE6, { L003: 0.9 })).toEqual({ text: "Fixed two things:\n- the stale flag on the badge page\n- the next item", joined: 1 });
  });

  it("joins at the open cut-off after a line with no terminal punctuation, and not after a period", () => {
    expect(JOIN_AFTER_OPEN).toBe(0.2);
    expect(JOIN_AFTER_STOP).toBe(0.5);
    expect(joinLines("the stale flag on the\nbadge page", { L002: 0.25 }).text).toBe("the stale flag on the badge page");
    expect(joinLines("the stale flag on the\nbadge page", { L002: 0.2 }).text).toBe("the stale flag on the badge page");
    expect(joinLines("the stale flag on the\nbadge page", { L002: 0.19 }).text).toBe("the stale flag on the\nbadge page");
    expect(joinLines("I fixed the parser.\nThe flag clears.", { L002: 0.25 }).text).toBe("I fixed the parser.\nThe flag clears.");
    expect(joinLines("I fixed the parser.\nThe flag clears.", { L002: 0.55 }).text).toBe("I fixed the parser. The flag clears.");
    expect(joinLines("I fixed the parser.\nThe flag clears.", { L002: 0.5 }).text).toBe("I fixed the parser. The flag clears.");
  });

  it.each([".", "!", "?", ":", ";", "…", '."', ".”", ".)", "?]", ".’"])("reads %s at a line's end as terminal punctuation", (end) => {
    expect(joinLines(`It ended here${end}\nNext one`, { L002: 0.4 }).joined).toBe(0);
    expect(joinLines(`It ended here${end}\nNext one`, { L002: 0.6 }).joined).toBe(1);
  });

  it("reads a comma, a closing bracket alone or a word as no terminal punctuation", () => {
    for (const end of [",", ")", "the", "—"]) expect(joinLines(`It went on${end}\nand on`, { L002: 0.3 }).joined).toBe(1);
  });

  it("joins with one space and drops the second line's indent", () => {
    expect(joinLines("- a list item that\n  carries on", { L002: 0.9 }).text).toBe("- a list item that carries on");
    expect(joinLines("10. the first part of\n    the item", { L002: 0.9 }).text).toBe("10. the first part of the item");
  });

  it("joins a run of torn lines into one, reading each break against the line above it", () => {
    expect(joinLines("one torn\nsentence over\nthree lines.\nNext.", { L002: 0.3, L003: 0.3, L004: 0.3 })).toEqual({
      text: "one torn sentence over three lines.\nNext.",
      joined: 2,
    });
  });

  it("keeps a break with no answer, and ignores an answer about a line that is no candidate", () => {
    expect(joinLines(AE6, {})).toEqual({ text: AE6, joined: 0 });
    expect(joinLines(AE6, { L002: 0.99, L004: 0.99 })).toEqual({ text: AE6, joined: 0 });
  });

  it("never changes the text's characters, only its whitespace, whatever the answers", () => {
    // A small seeded generator, so a failure repeats.
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const raws = [
      AE6,
      wrapAt(PROSE, 60),
      `⏺ ${wrapAt(PROSE, 70).split("\n").join("\n  ")}\n\n  ⎿  Wrote 3 lines\n\n⏺ Done. The flag\n  clears now.`,
      "Plan:\n- read the diff and\n  then write\n  the test.\n\n```ts\nconst a =\n  1;\n```\n\n> quoted line that\n> carries on",
    ];
    for (const raw of raws) {
      const text = fixPastedText(raw).text;
      const ids = idsOf(lineBreakBatches(text)!);
      for (let round = 0; round < 25; round++) {
        const answers = Object.fromEntries(ids.map((id) => [id, random()]));
        const { text: joined } = joinLines(text, answers);
        expect(ink(joined)).toBe(ink(text));
      }
      expect(ink(joinLines(text, Object.fromEntries(ids.map((id) => [id, 1]))).text)).toBe(ink(text));
    }
  });
});

describe("askLineBreaks", () => {
  const twoBatches = () => {
    const batches = lineBreakBatches(LONG)!;
    expect(batches.length).toBeGreaterThan(1);
    return batches;
  };

  it("sends the batches one at a time, in order, and gathers every answer", async () => {
    const batches = twoBatches();
    let open = 0;
    let most = 0;
    const sent: LineBreaksRequest[] = [];
    const ask = async (r: LineBreaksRequest) => {
      sent.push(r);
      most = Math.max(most, ++open);
      await Promise.resolve();
      open--;
      return answerAll(0.7)(r);
    };
    const answers = await askLineBreaks(batches, ask, { wait: noWait });
    expect(most).toBe(1);
    expect(sent).toEqual(batches);
    expect(Object.keys(answers!)).toEqual(idsOf(batches));
  });

  it("waits out a 429 for its Retry-After, retries, and then succeeds", async () => {
    const [batch] = lineBreakBatches(AE6)!;
    const ask = vi.fn().mockRejectedValueOnce(new JevError("rateLimited", { retryAfter: 2 })).mockResolvedValueOnce({ answers: { L003: 0.9 } });
    const wait = vi.fn(noWait);
    expect(await askLineBreaks([batch], ask, { wait })).toEqual({ L003: 0.9 });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(wait.mock.calls).toEqual([[2000]]);
  });

  it("fails at once on a Retry-After past the cap, rather than holding Next for it", async () => {
    const [batch] = lineBreakBatches(AE6)!;
    const ask = vi.fn().mockRejectedValue(new JevError("rateLimited", { retryAfter: 120 }));
    const wait = vi.fn(noWait);
    await expect(askLineBreaks([batch], ask, { wait })).rejects.toMatchObject({ kind: "rateLimited", retryAfter: 120 });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("honors a Retry-After of zero rather than backing off", async () => {
    const [batch] = lineBreakBatches(AE6)!;
    const ask = vi.fn().mockRejectedValueOnce(new JevError("overloaded", { retryAfter: 0 })).mockResolvedValueOnce({ answers: { L003: 0.9 } });
    const wait = vi.fn(noWait);
    await askLineBreaks([batch], ask, { wait });
    expect(wait.mock.calls).toEqual([[0]]);
  });

  it("backs off exponentially without a Retry-After, and fails after three retries", async () => {
    const [batch] = lineBreakBatches(AE6)!;
    const ask = vi.fn().mockRejectedValue(new JevError("overloaded"));
    const wait = vi.fn(noWait);
    await expect(askLineBreaks([batch], ask, { wait })).rejects.toMatchObject({ kind: "overloaded" });
    expect(LINE_BREAK_RETRIES).toBe(3);
    expect(ask).toHaveBeenCalledTimes(1 + LINE_BREAK_RETRIES);
    expect(wait.mock.calls).toEqual([[BACKOFF_MS], [BACKOFF_MS * 2], [BACKOFF_MS * 4]]);
  });

  it("does not retry any other failure", async () => {
    const [batch] = lineBreakBatches(AE6)!;
    const ask = vi.fn().mockRejectedValue(new JevError("keyRefused"));
    const wait = vi.fn(noWait);
    await expect(askLineBreaks([batch], ask, { wait })).rejects.toMatchObject({ kind: "keyRefused" });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("reads any other rejection as a JevError of kind other", async () => {
    const [batch] = lineBreakBatches(AE6)!;
    await expect(askLineBreaks([batch], () => Promise.reject(new Error("socket said no")), { wait: noWait })).rejects.toMatchObject({ kind: "other" });
  });

  it("fails as other on an answer that is missing an id or is not a probability", async () => {
    const [batch] = lineBreakBatches(AE6)!;
    for (const answers of [{}, { L003: 1.2 }, { L003: -0.1 }, { L003: "0.9" }]) {
      const ask = async () => ({ answers }) as unknown as JevAnswers;
      await expect(askLineBreaks([batch], ask, { wait: noWait })).rejects.toMatchObject({ kind: "other" });
    }
  });

  it("stops before the next batch once cancelled, and resolves to null", async () => {
    const batches = twoBatches();
    let cancelled = false;
    const ask = vi.fn(async (r: LineBreaksRequest) => {
      cancelled = true;
      return answerAll(0.7)(r);
    });
    expect(await askLineBreaks(batches, ask, { wait: noWait, cancelled: () => cancelled })).toBeNull();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("stops after a wait once cancelled, without retrying", async () => {
    const [batch] = lineBreakBatches(AE6)!;
    let cancelled = false;
    const ask = vi.fn().mockRejectedValue(new JevError("rateLimited", { retryAfter: 5 }));
    const wait = vi.fn(async () => {
      cancelled = true;
    });
    expect(await askLineBreaks([batch], ask, { wait, cancelled: () => cancelled })).toBeNull();
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("cleanUpLineBreaks", () => {
  it("Covers AE6. asks about the candidates and joins what Jev calls a wrap", async () => {
    const ask = vi.fn(async () => ({ answers: { L003: 0.9 } }));
    expect(await cleanUpLineBreaks(AE6, ask, { wait: noWait })).toEqual({ text: "Fixed two things:\n- the stale flag on the badge page\n- the next item", joined: 1 });
    expect(ask).toHaveBeenCalledWith(lineBreakBatches(AE6)![0]);
  });

  it("asks nothing and joins nothing when no candidates remain", async () => {
    const ask = vi.fn(answerAll(1));
    expect(await cleanUpLineBreaks("Done.\n\nSaved.", ask, { wait: noWait })).toEqual({ text: "Done.\n\nSaved.", joined: 0 });
    expect(ask).not.toHaveBeenCalled();
  });

  it("applies nothing when a later batch fails after its retries", async () => {
    const text = LONG;
    let calls = 0;
    const ask = async (r: LineBreaksRequest) => {
      if (++calls > 1) throw new JevError("rateLimited", { retryAfter: 1 });
      return answerAll(0.9)(r);
    };
    await expect(cleanUpLineBreaks(text, ask, { wait: noWait })).rejects.toMatchObject({ kind: "rateLimited" });
    expect(calls).toBe(2 + LINE_BREAK_RETRIES);
  });

  it("fails as too long, asking nothing, when the paste alone is over budget", async () => {
    const text = wrapAt(Array.from({ length: 700 }, () => PROSE).join(" "), 60);
    const ask = vi.fn(answerAll(1));
    await expect(cleanUpLineBreaks(text, ask, { wait: noWait })).rejects.toMatchObject({ kind: "tooLong" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("joins every wrap in a wrapped paragraph back into one line", async () => {
    const text = wrapAt(PROSE, 60);
    expect((await cleanUpLineBreaks(text, answerAll(0.9), { wait: noWait }))?.text).toBe(PROSE);
  });
});
