import { describe, expect, it, vi } from "vitest";
import { JevError } from "../jev/jev";
import { fitsJev } from "./jevBudget";
import type { JevAnswers, RouteRequest } from "./jevRequest";
import {
  DIFFICULTY_ID,
  DIFFICULTY_LEVELS,
  MATCH_CRITERIA,
  MATCH_QUESTION,
  MATCH_THRESHOLD,
  askRoute,
  jobFirstLine,
  matchOf,
  ratingOf,
  ROUTINE_BELOW,
  JUDGMENT_BELOW,
  routeBadges,
  routeBatches,
  routeText,
  type RouteBadge,
} from "./router";
import type { Credential } from "./types";

const noWait = async () => {};

function badge(n: number, task = `Task ${n}.`): RouteBadge {
  return { key: `eng/b${n}`, name: `Badge ${n}`, task, learningTargets: [`I can do ${n}.`] };
}

/** Answers every match id from `byKey` (by credential key), and difficulty with `levels`. */
function answering(plan: { batches: { request: RouteRequest; keys: Record<string, string> }[] }, byKey: Record<string, number>, levels = [1, 0, 0]) {
  return async (request: RouteRequest): Promise<JevAnswers> => {
    const keys = plan.batches.find((b) => b.request === request)!.keys;
    const answers = Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, byKey[key] ?? 0.1]));
    return { answers, ...(DIFFICULTY_ID in request.questions ? { levels: { [DIFFICULTY_ID]: levels } } : {}), model: "jev-1.13.0" };
  };
}

describe("the routing ask (KTD3, KTD5)", () => {
  it("asks one match question per badge with its name, task and targets, never its rubric, and the job alone as state", () => {
    const credentials: Credential[] = [
      { slug: "mig", collectionSlug: "eng", name: "Write a migration", learningTargets: [" I can write it ", "", "I can write it"], task: "Write the migration.", rubric: "SECRET RUBRIC", extraSections: [] },
      { slug: "half", collectionSlug: "eng", name: "Half made", learningTargets: [], task: "  ", rubric: "", extraSections: [] },
    ];
    const plan = routeBadges(credentials);
    expect(plan.map((b) => b.key)).toEqual(["eng/mig"]);
    const { batches } = routeBatches("Add a column to users", plan)!;
    expect(batches).toHaveLength(1);
    const { request, keys } = batches[0];
    expect(request.state).toEqual({ job: "Add a column to users" });
    expect(keys).toEqual({ m1: "eng/mig" });
    expect(request.questions.m1).toEqual({
      type: "noul",
      instructions: { badge: { name: "Write a migration", task: "Write the migration.", learning_targets: ["I can write it"] }, question: MATCH_QUESTION },
      criteria: MATCH_CRITERIA,
    });
    expect(JSON.stringify(request)).not.toContain("SECRET RUBRIC");
    expect(request.questions[DIFFICULTY_ID]).toEqual({ type: "score", instructions: expect.any(String), criteria: [...DIFFICULTY_LEVELS] });
  });

  it("removes pictures from the job and each task", () => {
    const { batches } = routeBatches("Fix it\n![](image-1a2b3c4d.png)", [badge(1, "Do it ![](video-9c0d1e2f.mp4) well")])!;
    expect(batches[0].request.state.job).toBe("Fix it");
    expect((batches[0].request.questions.m1 as { instructions: { badge: { task: string } } }).instructions.badge.task).toBe("Do it  well");
  });

  it("three small badges go in one request, with the difficulty question", () => {
    const { batches, sent, tooLong } = routeBatches("A job", [badge(1), badge(2), badge(3)])!;
    expect(batches).toHaveLength(1);
    expect(Object.keys(batches[0].request.questions)).toEqual(["m1", "m2", "m3", DIFFICULTY_ID]);
    expect(sent).toEqual(["eng/b1", "eng/b2", "eng/b3"]);
    expect(tooLong).toEqual([]);
  });

  it("badges that overflow the budget split into requests, ids restarting, difficulty only in the first", () => {
    const long = "x".repeat(60_000);
    const badges = [badge(1, long), badge(2, long), badge(3, long), badge(4, long), badge(5, long)];
    const { batches, sent } = routeBatches("A job", badges)!;
    expect(batches.length).toBeGreaterThan(1);
    expect(sent).toHaveLength(5);
    for (const b of batches) {
      expect(fitsJev(b.request)).toBe(true);
      expect(Object.keys(b.keys)[0]).toBe("m1");
    }
    expect(batches.filter((b) => DIFFICULTY_ID in b.request.questions).map((b) => batches.indexOf(b))).toEqual([0]);
  });

  it("leaves out a badge too long to fit beside the job, and sends the rest", () => {
    const { batches, sent, tooLong } = routeBatches("A job", [badge(1), badge(2, "y".repeat(140_000)), badge(3)])!;
    expect(sent).toEqual(["eng/b1", "eng/b3"]);
    expect(tooLong).toEqual(["eng/b2"]);
    expect(Object.values(batches[0].keys)).toEqual(["eng/b1", "eng/b3"]);
  });

  it("is too long (null) when no badge fits beside the job, and asks nothing with no badges", () => {
    expect(routeBatches("j".repeat(140_000), [badge(1)])).toBeNull();
    expect(routeBatches("A job", [])).toEqual({ batches: [], sent: [], tooLong: [] });
  });
});

describe("askRoute", () => {
  it("reads every badge's answer by key and the difficulty levels, from one request", async () => {
    const plan = routeBatches("A job", [badge(1), badge(2)])!;
    const outcome = await askRoute("A job", plan, answering(plan, { "eng/b1": 0.82, "eng/b2": 0.91 }, [0.1, 0.3, 0.6]), { wait: noWait });
    expect(outcome).toEqual({ job: "A job", keys: ["eng/b1", "eng/b2"], answers: { "eng/b1": 0.82, "eng/b2": 0.91 }, levels: [0.1, 0.3, 0.6], model: "jev-1.13.0" });
  });

  it("two batches' m1 answers stay with each batch's own badge", async () => {
    const long = "x".repeat(60_000);
    const plan = routeBatches("A job", [1, 2, 3, 4, 5].map((n) => badge(n, long)))!;
    expect(plan.batches.length).toBeGreaterThan(1);
    const ask = vi.fn(async (request: RouteRequest): Promise<JevAnswers> => {
      const first = request === plan.batches[0].request;
      const answers = Object.fromEntries(Object.keys(request.questions).filter((id) => id !== DIFFICULTY_ID).map((id) => [id, first && id === "m1" ? 0.9 : 0.1]));
      return { answers, ...(first ? { levels: { [DIFFICULTY_ID]: [1, 0, 0] } } : {}) };
    });
    const outcome = (await askRoute("A job", plan, ask, { wait: noWait }))!;
    expect(ask).toHaveBeenCalledTimes(plan.batches.length);
    expect(matchOf(outcome.answers, outcome.keys).best).toBe(plan.batches[0].keys.m1);
  });

  it("fails as other on a missing id or missing levels, before the next request goes", async () => {
    const plan = routeBatches("A job", [badge(1), badge(2)])!;
    await expect(askRoute("A job", plan, async () => ({ answers: { m1: 0.9 }, levels: { difficulty: [1, 0, 0] } }), { wait: noWait })).rejects.toMatchObject({ kind: "other" });
    await expect(askRoute("A job", plan, async () => ({ answers: { m1: 0.9, m2: 0.1 } }), { wait: noWait })).rejects.toMatchObject({ kind: "other" });
    await expect(askRoute("A job", plan, async () => ({ answers: { m1: 0.9, m2: 0.1 }, levels: { difficulty: [1, 0] } }), { wait: noWait })).rejects.toMatchObject({ kind: "other" });
  });

  it("retries a rate-limited request and stops once cancelled", async () => {
    const plan = routeBatches("A job", [badge(1)])!;
    const ok = answering(plan, { "eng/b1": 0.9 });
    const ask = vi.fn().mockRejectedValueOnce(new JevError("rateLimited", { retryAfter: 1 })).mockImplementationOnce(ok);
    const wait = vi.fn(noWait);
    expect((await askRoute("A job", plan, ask, { wait }))?.answers).toEqual({ "eng/b1": 0.9 });
    expect(wait.mock.calls).toEqual([[1000]]);
    expect(await askRoute("A job", plan, ok, { wait: noWait, cancelled: () => true })).toBeNull();
  });
});

describe("matchOf (KTD4)", () => {
  const keys = ["eng/a", "eng/b", "eng/c"];

  it("Covers AE9. matches the strongest yes over the threshold, and lists the other as also like", () => {
    expect(matchOf({ "eng/a": 0.82, "eng/b": 0.91, "eng/c": 0.2 }, keys)).toEqual({ best: "eng/b", alsoLike: ["eng/a"] });
  });

  it("Covers AE4 (domain). matches nothing below the threshold", () => {
    expect(MATCH_THRESHOLD).toBe(0.7);
    expect(matchOf({ "eng/a": 0.69, "eng/b": 0.5 }, keys)).toEqual({ best: null, alsoLike: [] });
  });

  it("a tie goes to the badge first on Home", () => {
    expect(matchOf({ "eng/b": 0.9, "eng/c": 0.9 }, keys).best).toBe("eng/b");
  });

  it("a badge no longer in the folder never matches, and the next one over the threshold does", () => {
    expect(matchOf({ "eng/a": 0.75, "eng/gone": 0.95 }, keys)).toEqual({ best: "eng/a", alsoLike: [] });
  });
});

describe("ratingOf (KTD2)", () => {
  it("rates below ROUTINE_BELOW as routine, below JUDGMENT_BELOW as needing judgment, and the rest as unusual or high-stakes", () => {
    expect([ROUTINE_BELOW, JUDGMENT_BELOW]).toEqual([0.5, 1.5]);
    // Expected levels of 0.49, 0.5, 1.49 and 1.5.
    expect(ratingOf([0.51, 0.49, 0])).toBe("routine");
    expect(ratingOf([0.5, 0.5, 0])).toBe("judgment");
    expect(ratingOf([0, 0.51, 0.49])).toBe("judgment");
    expect(ratingOf([0, 0.5, 0.5])).toBe("high-stakes");
  });

  it("rates the level nearest the expected level", () => {
    expect(ratingOf([0.1, 0.3, 0.6])).toBe("high-stakes");
    expect(ratingOf([0.2, 0.6, 0.2])).toBe("judgment");
    expect(ratingOf([0.7, 0.3, 0])).toBe("routine");
    expect(ratingOf([0.5, 0, 0.5])).toBe("judgment");
    expect(ratingOf(null)).toBeNull();
  });
});

describe("routeText (KTD6)", () => {
  it("removes image and video Markdown and their data URIs, and drops a line left blank by that", () => {
    const job = "Fix the chart.\n![](image-1a2b3c4d.png)\nSee ![shot](video-9c0d1e2f.mp4) here.\n[ref]: data:image/png;base64,AAAA\nInline data:image/png;base64,AAAA too.";
    expect(routeText(job)).toBe("Fix the chart.\nSee  here.\nInline  too.");
  });

  it("drops invisible and format characters line by line, and keeps every line break", () => {
    expect(routeText("Do​ this‮ now then\u{E0041}\u{E0042} that\r\nlast")).toBe("Do this now\nthen that\nlast");
  });

  it("keeps the user's words and their order, tabs included", () => {
    expect(routeText("  - one\n\t- two\n\n3. three  ")).toBe("- one\n\t- two\n\n3. three");
  });
});

describe("jobFirstLine (KTD10)", () => {
  it("is the first line with words, without heading marks", () => {
    expect(jobFirstLine("\n\n## Fix the flaky login test\nIt fails one run in ten.")).toBe("Fix the flaky login test");
  });

  it("skips a line that only held a picture", () => {
    expect(jobFirstLine("![](image-1a2b3c4d.png)\nWrite the release note")).toBe("Write the release note");
  });

  it("ends at any Unicode line break, so a separator can't carry a second line in", () => {
    expect(jobFirstLine("Ship it --- ## now")).toBe("Ship it");
  });

  it("strips invisible characters and caps at 200 code points", () => {
    expect(jobFirstLine("A‮B")).toBe("AB");
    expect(Array.from(jobFirstLine("é".repeat(250)))).toHaveLength(200);
  });

  it("is empty for a job with no words", () => {
    expect(jobFirstLine("![](image-1a2b3c4d.png)\n\n")).toBe("");
  });
});
