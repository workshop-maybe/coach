import { describe, expect, it } from "vitest";
import { calibrationOf, callOf } from "./calls";
import { examplesFor, excerptOf, MAX_OPENING_CHARS, MAX_REASON_CHARS, rankExamples, reasonOf } from "./jevExamples";
import type { CriteriaSide, JevExampleEntry } from "./jevRequest";
import type { Assessment, AssessmentResult, Credential, FolderState, HeldReply, JevReading } from "./types";

const KEY = "eng/review";
const MODEL = "jev-1.13.0";

// Two points, "Names the bug" (p1) and "Suggests a fix" (p2), and a note line.
const review: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: ["I can find bugs.", "I can explain a fix."],
  task: "Review the diff.",
  rubric: "- Names the bug\n- Suggests a fix\n\nMet when both hold.",
  extraSections: [],
};

function reading(overall: number): JevReading {
  return { model: MODEL, assignmentVersion: "v1", askedAt: "2026-10-01T08:00:00.000Z", seen: "before", overall, points: [] };
}

/** A result on the badge at the current version "v1", recorded `minute` minutes after 09:00. */
function result(profileSlug: string, verdict: AssessmentResult, minute: number, overrides: Partial<Assessment> = {}): Assessment {
  const mm = String(minute).padStart(2, "0");
  return {
    profileSlug,
    collectionSlug: "eng",
    credentialSlug: "review",
    fileStem: `20261001T09${mm}00Z`,
    result: verdict,
    recordedAt: `2026-10-01T09:${mm}:00.000Z`,
    assignmentVersion: "v1",
    setup: { harness: "codex", model: "gpt-5", effort: "high" },
    note: "",
    handBack: `Reply from ${profileSlug} at 09:${mm}.`,
    ...overrides,
  };
}

function folder(assessments: Assessment[], held: HeldReply[] = []): FolderState {
  return {
    collections: [{ slug: "eng", name: "Engineering", description: "", order: ["review"], codes: { review: 1 } }],
    credentials: [review],
    profiles: [],
    assessments,
    held,
    skeleton: null,
    handoffs: [],
    marks: [],
    errors: [],
    warnings: [],
    raw: {},
  };
}

const id = (a: Assessment) => `${a.profileSlug}/${a.fileStem}`;

function examples(state: FolderState, reply = "A new reply to judge.", version = "v1"): JevExampleEntry[] {
  return examplesFor(rankExamples(state, KEY, version), reply);
}

/** Each question's sides, each side's results in the order they go. */
function sides(entries: readonly JevExampleEntry[]): Record<string, Partial<Record<CriteriaSide, string[]>>> {
  const out: Record<string, Partial<Record<CriteriaSide, string[]>>> = {};
  for (const e of entries) {
    const question = out[e.questionId] ?? {};
    out[e.questionId] = question;
    question[e.side] = [...(question[e.side] ?? []), e.sourceId];
  }
  return out;
}

function side(entries: readonly JevExampleEntry[], questionId: string, s: CriteriaSide): JevExampleEntry[] {
  return entries.filter((e) => e.questionId === questionId && e.side === s);
}

describe("examples from a badge's results", () => {
  it("Covers AE2. A Met reply holds for every point and overall, and a Not met reply with point 2 tapped doesn't hold for point 2 and overall", () => {
    const a = result("codex", "met", 1, { handBack: "Names the null check in parse.ts and adds a guard." });
    const b = result("claude", "not_met", 2, { missedPoints: ["Suggests a fix"], handBack: "Found the bug in parse.ts." });
    const entries = examples(folder([a, b]));
    expect(sides(entries)).toEqual({
      p1: { true: [id(a)] },
      p2: { true: [id(a)], false: [id(b)] },
      overall: { true: [id(a)], false: [id(b)] },
    });
    expect(side(entries, "p1", "true")[0].item).toEqual({ reply_opening: a.handBack });
    // One result keeps one rank in every question.
    expect(new Set(entries.filter((e) => e.sourceId === id(a)).map((e) => e.rank)).size).toBe(1);
    // Target questions never carry examples.
    expect(entries.every((e) => e.questionId === "overall" || /^p\d+$/.test(e.questionId))).toBe(true);
  });

  it("Covers AE3. An overrule with a reason leads the overall question's side, ahead of a newer plain result", () => {
    const overruled = result("codex", "not_met", 1, { jev: reading(0.9), note: "skips the rollback" });
    const plain = result("claude", "not_met", 5);
    const no = side(examples(folder([overruled, plain])), "overall", "false");
    expect(no.map((e) => e.sourceId)).toEqual([id(overruled), id(plain)]);
    expect(no[0].item.user_reason).toBe("skips the rollback");
    expect(no[1].item).not.toHaveProperty("user_reason");
    expect(no[0].rank).toBeLessThan(no[1].rank);
  });

  it("Covers AE3. The overrule still leads after the fit moves the high cut-off to 90, where its reading reads can't call", () => {
    const overruled = result("codex", "not_met", 1, { jev: reading(0.9), note: "skips the rollback" });
    const met = [95, 96, 97, 98].map((pct, i) => result("codex", "met", 10 + i, { jev: reading(pct / 100) }));
    const notMet = [85, 80, 10].map((pct, i) => result("codex", "not_met", 20 + i, { jev: reading(pct / 100) }));
    const plain = result("claude", "not_met", 30);
    const state = folder([overruled, ...met, ...notMet, plain]);

    const { pair } = calibrationOf(state, KEY, MODEL);
    expect(pair).toEqual({ low: 30, high: 90 });
    expect(callOf(0.9, pair)).toBe("cant_call");

    const no = side(examples(state), "overall", "false");
    expect(no[0].sourceId).toBe(id(overruled));
    expect(no[0].item.user_reason).toBe("skips the rollback");
  });

  it("Covers AE8. Three Met results with no readings hold for every point: the two newest", () => {
    const [oldest, middle, newest] = [1, 2, 3].map((m) => result("codex", "met", m));
    expect(sides(examples(folder([oldest, middle, newest])))).toEqual({
      p1: { true: [id(newest), id(middle)] },
      p2: { true: [id(newest), id(middle)] },
      overall: { true: [id(newest), id(middle)] },
    });
  });

  it("a Not met result with no missed points feeds only the overall question", () => {
    const notMet = result("codex", "not_met", 1);
    expect(sides(examples(folder([notMet])))).toEqual({ overall: { false: [id(notMet)] } });
  });

  it("a result at an older version feeds only the overall question, and a tapped point whose text is gone is dropped", () => {
    const oldMet = result("codex", "met", 1, { assignmentVersion: "v0" });
    const oldMissed = result("codex", "not_met", 2, { assignmentVersion: "v0", missedPoints: ["Names the bug"] });
    const renamed = result("claude", "not_met", 3, { missedPoints: ["Names a bug", "Suggests a fix"] });
    expect(sides(examples(folder([oldMet, oldMissed, renamed])))).toEqual({
      p2: { false: [id(renamed)] },
      overall: { true: [id(oldMet)], false: [id(renamed), id(oldMissed)] },
    });
  });

  it("missed points on a Met result count for nothing", () => {
    const met = result("codex", "met", 1, { missedPoints: ["Names the bug"] });
    expect(side(examples(folder([met])), "p1", "false")).toEqual([]);
  });

  it("a result whose reply equals the reply being judged, after trimming, is never an example", () => {
    const same = result("codex", "met", 2, { handBack: "  The same reply.\n" });
    const other = result("claude", "met", 1, { handBack: "Another reply." });
    const state = folder([same, other]);
    expect(new Set(examples(state, "The same reply.").map((e) => e.sourceId))).toEqual(new Set([id(other)]));
    expect(side(examples(state, "A different reply."), "overall", "true").map((e) => e.sourceId)).toEqual([id(same), id(other)]);
  });

  it("a reply that cleans to nothing gives no example, and the next result takes its place", () => {
    const imageOnly = result("codex", "met", 3, { handBack: "![screenshot](shot.png)" });
    const secretOnly = result("codex", "met", 2, { handBack: `ghp_${"a1B2c3D4e5".repeat(4)}` });
    const plain = result("claude", "met", 1);
    expect(sides(examples(folder([imageOnly, secretOnly, plain])))).toEqual({
      p1: { true: [id(plain)] },
      p2: { true: [id(plain)] },
      overall: { true: [id(plain)] },
    });
  });

  it("a result no side has room for is never read", () => {
    const [oldest, middle, newest] = [1, 2, 3].map((m) => result("codex", "met", m));
    let reads = 0;
    Object.defineProperty(oldest, "handBack", {
      get: () => {
        reads += 1;
        return "The oldest reply.";
      },
    });
    examples(folder([oldest, middle, newest]));
    expect(reads).toBe(0);
  });

  it("a reason rides on overall examples and a point's doesn't-hold examples, never on a point's holds", () => {
    const met = result("codex", "met", 1, { note: "Shows the\ninstall." });
    const missed = result("claude", "not_met", 2, { missedPoints: ["Names the bug"], note: "No file named." });
    const entries = examples(folder([met, missed]));
    for (const e of side(entries, "p1", "true").concat(side(entries, "p2", "true"))) expect(e.item).not.toHaveProperty("user_reason");
    expect(side(entries, "overall", "true")[0].item.user_reason).toBe("Shows the install.");
    expect(side(entries, "p1", "false")[0].item.user_reason).toBe("No file named.");
    expect(side(entries, "overall", "false")[0].item.user_reason).toBe("No file named.");
  });

  it("a held reply is never an example", () => {
    const held: HeldReply = {
      profileSlug: "codex",
      collectionSlug: "eng",
      credentialSlug: "review",
      fileStem: "20261001T095000Z",
      heldAt: "2026-10-01T09:50:00.000Z",
      assignmentVersion: "v1",
      setup: { harness: "codex", model: "gpt-5", effort: "high" },
      handBack: "A held reply.",
      jev: reading(0.95),
    };
    const met = result("claude", "met", 1);
    expect(examples(folder([], [held]))).toEqual([]);
    expect(new Set(examples(folder([met], [held])).map((e) => e.sourceId))).toEqual(new Set([id(met)]));
  });

  it("a result moved to the trash leaves the examples, and moving it back restores them", () => {
    const a = result("codex", "met", 1);
    const b = result("claude", "not_met", 2);
    const sources = (state: FolderState) => new Set(examples(state).map((e) => e.sourceId));
    expect(sources(folder([a, b]))).toEqual(new Set([id(a), id(b)]));
    expect(sources(folder([b]))).toEqual(new Set([id(b)]));
    expect(sources(folder([a, b]))).toEqual(new Set([id(a), id(b)]));
  });

  it("a badge with no results gives no examples, and only the badge's own results count", () => {
    expect(examples(folder([]))).toEqual([]);
    expect(examples(folder([result("codex", "met", 1, { credentialSlug: "docs" })]))).toEqual([]);
  });

  it("a badge the folder no longer has gives no examples", () => {
    expect(rankExamples(folder([result("codex", "met", 1)]), "eng/gone", "v1")).toEqual([]);
  });
});

describe("an excerpt", () => {
  it("strips image Markdown and image data and keeps the words", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const reply = [
      "![screenshot](shot.png)",
      `Fixed the parser. ![inline](${png}) Added a test.`,
      "See ![the diagram][diagram] above.",
      `Raw ${png.replace("png", "jpeg")} data.`,
      `[diagram]: ${png}`,
      "Done.",
    ].join("\n");
    expect(excerptOf(reply)).toBe("Fixed the parser.  Added a test.\nSee  above.\nRaw  data.\nDone.");
  });

  it("answers at once for a long line of unclosed images, which once took seconds", () => {
    for (const start of ["![a](", "![", "![a](<", "data:image/"]) {
      const started = performance.now();
      expect(Array.from(excerptOf(start.repeat(20_000)))).toHaveLength(MAX_OPENING_CHARS);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });

  it("is empty for a reply that is only images", () => {
    expect(excerptOf("![one](a.png)\n\n![two](data:image/png;base64,iVBORw0KGgo=)")).toBe("");
  });

  it("cuts back to the last line end inside the first 300 characters", () => {
    expect(excerptOf(`First line of the reply\nSecond line ${"word ".repeat(80)}`)).toBe("First line of the reply");
  });

  it("cuts back to the last sentence end inside the first 300 characters", () => {
    expect(excerptOf(`One. Two "three." ${"x".repeat(400)}`)).toBe('One. Two "three."');
  });

  it("keeps the first 300 characters when nothing inside them ends a line or sentence", () => {
    const excerpt = excerptOf(`Edited parse.ts then ${"y".repeat(400)}`);
    expect(Array.from(excerpt)).toHaveLength(MAX_OPENING_CHARS);
    expect(excerpt.startsWith("Edited parse.ts then y")).toBe(true);
  });

  it("keeps a reply of 300 characters or fewer whole", () => {
    const reply = `${"z".repeat(290)} no stop`;
    expect(excerptOf(reply)).toBe(reply);
  });

  it("never splits an emoji at the 300th character", () => {
    // Not hex letters, which a run of 32 or more would drop as a secret.
    expect(excerptOf(`${"w".repeat(299)}😀${"v".repeat(10)}`)).toBe(`${"w".repeat(299)}😀`);
    expect(excerptOf(`${"w".repeat(300)}😀v`)).toBe("w".repeat(300));
  });

  it("drops zero-width, bidi and tag characters, and reads every line break as one", () => {
    const reply = "Fi​xed ‮the‬ bug\u{E0041}\u{E0042}.⁦⁩\r\nDone­.\rAll good\u000Bnow﻿.";
    expect(excerptOf(reply)).toBe("Fixed the bug.\nDone.\nAll\ngood\nnow.");
  });

  it("drops lines that look like secrets", () => {
    const reply = [
      "Opened the PR.",
      `Pushed with ghp_${"a1B2c3D4e5".repeat(4)} as the token.`,
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjE",
      "-----END OPENSSH PRIVATE KEY-----",
      "Commit 0123456789abcdef0123456789abcdef01234567 is on main.",
      'API_KEY="sk_test_abcdefghijklmnop"',
      "aws_secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "Tests pass.",
    ].join("\n");
    expect(excerptOf(reply)).toBe("Opened the PR.\nTests pass.");
  });

  it("is empty for a reply that is only secret lines", () => {
    expect(excerptOf(`sk-${"x".repeat(40)}\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC`)).toBe("");
  });

  it("keeps a line with a long path, a mention of a token prefix, or a short assignment", () => {
    const reply = "Edited src/components/settings/AdvancedPanel.tsx and src/domain/jevExamples/rankingHelpers.\nSet ghp_ tokens aside.\nPORT=8080";
    expect(excerptOf(reply)).toBe(reply);
  });
});

describe("a reason", () => {
  it("turns a note of three lines into one", () => {
    expect(reasonOf("Skips the rollback.\r\nNever runs the migration. Names no file.")).toBe("Skips the rollback. Never runs the migration. Names no file.");
    expect(reasonOf("a\u000Bb\u000Cc\u0085d e")).toBe("a b c d e");
  });

  it("is capped at 200 characters, counting an emoji as one", () => {
    expect(Array.from(reasonOf(`${"word ".repeat(30)}\n${"more ".repeat(30)}\n${"last ".repeat(30)}`)).length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    expect(reasonOf("😀".repeat(250))).toBe("😀".repeat(MAX_REASON_CHARS));
  });

  it("is cleaned as an excerpt is", () => {
    expect(reasonOf(`Misses​ the point.\nAPI_TOKEN=${"q".repeat(30)}\n![shot](a.png)`)).toBe("Misses the point.");
  });

  it("is empty for a blank note", () => {
    expect(reasonOf("  \n\t\n")).toBe("");
  });
});
