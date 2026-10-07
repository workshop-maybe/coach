import { describe, expect, it } from "vitest";
import { calibrationOf, callOf } from "./calls";
import { assessmentDir } from "./folder";
import { examplesFor, excerptOf, rankExamples, reasonOf } from "./jevExamples";
import { MAX_OPENING_CHARS, MAX_REASON_CHARS } from "./jevRequest";
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
    heldReadings: [],
    headToHeads: [],
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

  it("Covers AE3. A result with a reason still ranks first after saving it moves the cut-offs so its reading reads can't call", () => {
    const met = [62, 90, 95].map((pct, i) => result("codex", "met", 10 + i, { jev: reading(pct / 100) }));
    const notMet = [5, 10, 12, 15, 20].map((pct, i) => result("claude", "not_met", 20 + i, { jev: reading(pct / 100) }));
    // Before the save, the fitted pair calls 65% meets, so a Not yet there asks "What did Jev miss".
    const before = calibrationOf(folder([...met, ...notMet]), KEY, MODEL).pair;
    expect(before).toEqual({ low: 30, high: 60 });
    expect(callOf(0.65, before)).toBe("meets");

    const reasoned = result("codex", "not_met", 1, { jev: reading(0.65), note: "skips the rollback" });
    const state = folder([reasoned, ...met, ...notMet]);
    // Saving it refits the pair, and 65% now reads can't call under the fitted and the default pair alike.
    const after = calibrationOf(state, KEY, MODEL).pair;
    expect(after).toEqual({ low: 30, high: 70 });
    expect(callOf(0.65, after)).toBe("cant_call");

    expect(rankExamples(state, KEY, "v1")[0].sourceId).toBe(id(reasoned));
    const no = side(examples(state), "overall", "false");
    expect(no[0].sourceId).toBe(id(reasoned));
    expect(no[0].item.user_reason).toBe("skips the rollback");
  });

  it("a hand-written note ranks its result as an overrule even with no reading", () => {
    const noted = result("codex", "not_met", 1, { note: "Never ran the tests it names." });
    const plain = result("claude", "not_met", 5);
    expect(rankExamples(folder([noted, plain]), KEY, "v1").map((c) => c.sourceId)).toEqual([id(noted), id(plain)]);
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

describe("examples from replies with items (reply-artifacts KTD8)", () => {
  const NOTES = "files/file-0000000a.md";
  const notesPath = `${assessmentDir("codex", "eng", "review")}/${NOTES}`;
  const withFile = (handBack: string, minute: number, overrides: Partial<Assessment> = {}) =>
    result("codex", "met", minute, {
      handBack,
      items: [
        { kind: "text", text: handBack },
        { kind: "file", name: "notes.md", ref: NOTES },
        { kind: "video", name: "demo.mp4", ref: "video-1a2b3c4d.mp4" },
      ],
      ...overrides,
    });
  const overall = (entries: readonly JevExampleEntry[]) => side(entries, "overall", "true").map((e) => e.item.reply_opening);

  it("an earlier reply's excerpt starts from the reply as Jev reads it: text, its Markdown file, a line for its video", () => {
    const state = folder([withFile("Wrote the notes.", 1)]);
    const texts = (path: string) => (path === notesPath ? "The fix is in parse.ts." : undefined);
    expect(overall(examplesFor(rankExamples(state, KEY, "v1"), "A new reply.", texts))).toEqual([
      "Wrote the notes.\n\nFile: notes.md\nThe fix is in parse.ts.\n\nA video Jev cannot see: demo.mp4",
    ]);
  });

  it("names the file texts still loading, and rebuilds an excerpt built before they loaded", () => {
    const state = folder([withFile("Wrote the notes.", 1)]);
    const ranked = rankExamples(state, KEY, "v1");
    const pending: string[] = [];
    expect(overall(examplesFor(ranked, "A new reply.", () => undefined, pending))).toEqual([
      "Wrote the notes.\n\nA file Jev cannot see: notes.md\n\nA video Jev cannot see: demo.mp4",
    ]);
    expect(new Set(pending)).toEqual(new Set([notesPath]));
    const after: string[] = [];
    const loaded = (path: string) => (path === notesPath ? "Loaded now." : undefined);
    expect(overall(examplesFor(ranked, "A new reply.", loaded, after))).toEqual([
      "Wrote the notes.\n\nFile: notes.md\nLoaded now.\n\nA video Jev cannot see: demo.mp4",
    ]);
    expect(after).toEqual([]);
  });

  it("compares projections to drop the reply being judged: the same items read the same way are never an example", () => {
    const state = folder([withFile("Same reply.", 2), result("claude", "met", 1, { handBack: "Another reply." })]);
    const texts = (path: string) => (path === notesPath ? "Notes." : undefined);
    const judged = "Same reply.\n\nFile: notes.md\nNotes.\n\nA video Jev cannot see: demo.mp4";
    expect(overall(examplesFor(rankExamples(state, KEY, "v1"), judged, texts))).toEqual(["Another reply."]);
    // A text-only reply equal to the earlier reply's text alone is not the same reply.
    expect(overall(examplesFor(rankExamples(state, KEY, "v1"), "Same reply.", texts))).toHaveLength(2);
  });

  it("drops a secret-looking line in an earlier reply's Markdown file", () => {
    const state = folder([withFile("Wrote the notes.", 1)]);
    const texts = (path: string) => (path === notesPath ? "export API_KEY=abcdefghijklmnopqrstuvwxyz\nKept line." : undefined);
    expect(overall(examplesFor(rankExamples(state, KEY, "v1"), "A new reply.", texts))[0]).toContain("File: notes.md\nKept line.");
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

  it("strips a video reference as it strips a picture, and inline video data", () => {
    const reply = "Recorded the fix.\n\n![](video-1a2b3c4d.mp4)\n\nIt plays ![clip](video-9c0d1e2f.webm) end to end.\n[clip]: data:video/mp4;base64,AAAAIGZ0eXA=\nRaw data:video/webm;base64,GkXfo59Ch here.";
    // The line the video stood on goes; the reply's own blank lines stay, as with a picture.
    expect(excerptOf(reply)).toBe("Recorded the fix.\n\n\nIt plays  end to end.\nRaw  here.");
    expect(excerptOf("![](video-1a2b3c4d.mp4)")).toBe("");
  });

  it("gives no example from an earlier reply that is only a video, and quotes the words around one", () => {
    const video = result("codex", "met", 1, { handBack: "![](video-1a2b3c4d.mp4)" });
    const narrated = result("claude", "met", 2, { handBack: "Shows the fix.\n![](video-5e6f7a8b.mov)" });
    const yes = side(examples(folder([video, narrated])), "overall", "true");
    expect(yes.map((e) => e.sourceId)).toEqual([id(narrated)]);
    expect(yes[0].item.reply_opening).toBe("Shows the fix.");
  });

  it("cuts back to the last line end inside the first 300 characters", () => {
    expect(excerptOf(`First line of the reply\nSecond line ${"word ".repeat(80)}`)).toBe("First line of the reply");
  });

  it("cuts back to the last sentence end inside the first 300 characters", () => {
    expect(excerptOf(`One. Two "three." ${"x".repeat(400)}`)).toBe('One. Two "three."');
  });

  it("shows an earlier reply as a reader sees it, without the reply box's escapes, code as written", () => {
    expect(excerptOf("Fixed \\[the parser\\] in `a\\_b` &amp; snake\\_case.")).toBe("Fixed [the parser] in `a\\_b` & snake_case.");
    expect(excerptOf("```\n\\[x\\]\n```\nThen \\[y\\].")).toBe("```\n\\[x\\]\n```\nThen [y].");
    // A picture whose alt the box escaped still goes, and a token the box escaped is still a secret.
    expect(excerptOf("Shot ![a\\]b](x.png) here.")).toBe("Shot  here.");
    expect(excerptOf(`Pushed.\ntoken ghp\\_${"a1B2".repeat(6)}\nDone.`)).toBe("Pushed.\nDone.");
  });

  it("never ends on a list marker with nothing after it, though the cut falls right after one", () => {
    // The cut lands after "3.", which reads as a sentence end; the excerpt stops at item 2.
    const second = `2. ${"step ".repeat(50)}done.`;
    const reply = ["1. Fixed the parser.", second, `3. ${"more words without an end ".repeat(10)}`].join("\n");
    expect(excerptOf(reply)).toBe(`1. Fixed the parser.\n${second}`);
    // A bare bullet, or a marker with an empty task box, on the last kept line goes too.
    expect(excerptOf(`Intro line.\n-\n${"x".repeat(400)}`)).toBe("Intro line.");
    expect(excerptOf(`Plan:\n- [ ]\n${"x".repeat(400)}`)).toBe("Plan:");
  });

  it("drops a bare marker that ends a short reply, and keeps periods that end a sentence", () => {
    expect(excerptOf("1. Done.\n2.")).toBe("1. Done.");
    expect(excerptOf("1. Done.\n2)\n  -")).toBe("1. Done.");
    expect(excerptOf("We ship version 2.\n3. Done.")).toBe("We ship version 2.\n3. Done.");
    expect(excerptOf("3.")).toBe("");
  });

  it("gives no example from a reply that is only a list marker", () => {
    const bare = result("codex", "met", 1, { handBack: "1." });
    const words = result("claude", "met", 2, { handBack: "1. Fixed it." });
    expect(side(examples(folder([bare, words])), "overall", "true").map((e) => e.sourceId)).toEqual([id(words)]);
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

  it("reads a long line before cutting it, so a line that reads shorter keeps its whole first line and every emoji", () => {
    // 110 `&lt;` are 440 units as written and 110 characters as read: cut first, the line's
    // cut fell inside the opening, on the emoji's first half, and Rust refuses a lone half.
    const line = `${"<".repeat(110)}${"to the left. ".repeat(12)}zzzzz😀 and more…`;
    const opening = excerptOf(`${line.replace(/</g, "&lt;")}\n\nSecond paragraph.`);
    expect(opening).toBe(line);
    expect(opening).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("drops zero-width, bidi and tag characters, and reads every line break as one", () => {
    const reply = "Fi\u200bxed \u202ethe\u202c bug\u{E0041}\u{E0042}.\u2066\u2069\r\nDone\u00ad.\rAll\u2028good\u000Bnow\ufeff.";
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

  it("drops a password given a value in any case, however the line is marked up", () => {
    const reply = [
      "Set up the database.",
      "password = hunter2",
      "db_password: s3cret-value",
      '  "password": "hunter2",',
      "**Password:** hunter2",
      "- **Password**: `hunter2`",
      "db_password: hunter2 # dev only",
      '  "passphrase": "correct horse battery staple",',
      'password: "hunter two"',
      "password: 'my dog spot'",
      "db_password: hunter2,",
      "export PGPASSWORD=hunter2",
      "client_secret = 'abc123'",
      "Tests pass.",
    ].join("\n");
    expect(excerptOf(reply)).toBe("Set up the database.\nTests pass.");
  });

  it("drops a link that carries a password, with or without a user", () => {
    const reply = [
      "Pushed the fix.",
      "Cloned https://deploy:hunter2@git.example.com/app.git first.",
      "Connected with postgres://admin:pa55@localhost:5432/app.",
      "Cache at redis://:pa55@localhost:6379/0",
      "Done.",
    ].join("\n");
    expect(excerptOf(reply)).toBe("Pushed the fix.\nDone.");
  });

  it("keeps prose that mentions a password, and links with no password in them", () => {
    const lines = [
      "Reset the password in the settings screen.",
      "The password field now trims spaces, and a wrong password says so.",
      "Password: at least 12 characters, checked as you type.",
      "**Password:** at least 12 characters",
      "Compared password == confirm before saving.",
      "Docs at https://example.com/docs and the app at http://localhost:5173/.",
      "Pushed to git@github.com:you/app.git and https://user@example.com/app.",
    ];
    // One at a time, since an excerpt stops at 300 characters.
    for (const line of lines) expect(excerptOf(line)).toBe(line);
  });

  it("reads a very long line in one pass, however it is made", () => {
    const lines = [
      `${"a.".repeat(50_000)}x`,
      "b://".repeat(20_000),
      "password".repeat(25_000),
      `password: x${" ".repeat(100_000)}y`,
      `${"password:x".repeat(20_000)} y`,
      "\\".repeat(100_000),
      "`\\_".repeat(30_000),
    ];
    // One at a time, since an excerpt stops reading once it has enough.
    for (const line of lines) {
      const start = performance.now();
      excerptOf(line);
      expect(performance.now() - start, line.slice(0, 20)).toBeLessThan(1000);
    }
  });

  it("checks a long line only as far as an excerpt can show it", () => {
    // The password sits past the cut, so the opening that goes is the same either way.
    const line = `${"word ".repeat(200)}password = hunter2`;
    expect(excerptOf(line)).toBe("word ".repeat(60).trimEnd());
    expect(excerptOf(`password = hunter2 ${"word ".repeat(200)}`)).toBe("");
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
    expect(reasonOf("Skips the rollback.\r\nNever runs the migration.\u2028Names no file.")).toBe("Skips the rollback. Never runs the migration. Names no file.");
    expect(reasonOf("a\u000Bb\u000Cc\u0085d\u2029e")).toBe("a b c d e");
  });

  it("is capped at 200 characters, counting an emoji as one", () => {
    expect(Array.from(reasonOf(`${"word ".repeat(30)}\n${"more ".repeat(30)}\n${"last ".repeat(30)}`)).length).toBeLessThanOrEqual(MAX_REASON_CHARS);
    expect(reasonOf("😀".repeat(250))).toBe("😀".repeat(MAX_REASON_CHARS));
  });

  it("is cleaned as an excerpt is", () => {
    expect(reasonOf(`Misses\u200b the point.\nAPI_TOKEN=${"q".repeat(30)}\n![shot](a.png)`)).toBe("Misses the point.");
    expect(reasonOf("Logs in with the wrong account.\npassword = hunter2")).toBe("Logs in with the wrong account.");
  });

  it("is empty for a blank note", () => {
    expect(reasonOf("  \n\t\n")).toBe("");
  });
});
