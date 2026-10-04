import { describe, expect, it } from "vitest";
import { JEV_MODEL, type LineBreaksRequest, type MatchQuestion, type RouteRequest } from "../domain/jevRequest";
import { FAKE_ANSWER, FAKE_LEVELS, FAKE_ON, FakeJev } from "./fakeJev";

const match = (name: string): MatchQuestion => ({
  type: "noul",
  instructions: {
    badge: { name, task: "Review the diff.", learning_targets: ["I can find a bug in a diff"] },
    question: "Does the `job` ask for the same kind of work as the `badge`?",
  },
});

/** A route asking about `matches` badges, with the difficulty question when `difficulty`. */
function route(matches: number, difficulty = true): RouteRequest {
  const questions: RouteRequest["questions"] = {};
  for (let i = 1; i <= matches; i++) questions[`m${i}`] = match(`Badge ${i}`);
  if (difficulty) questions.difficulty = { type: "score", instructions: "How demanding is the `job`?", criteria: ["routine", "needs judgment", "unusual or high-stakes"] };
  return { kind: "route", state: { job: "Fix the flaky login test." }, questions };
}

const lineBreaks: LineBreaksRequest = {
  kind: "lineBreaks",
  state: "L001| a long line that\nL002| wrapped here",
  questions: { L002: { type: "noul", instructions: "Does L002 continue L001?" } },
};

describe("FakeJev's ask with nothing queued", () => {
  it("answers each match with FAKE_ANSWER and the difficulty with routine-certain levels", async () => {
    expect(FAKE_LEVELS).toEqual([1, 0, 0]);
    expect(await new FakeJev(FAKE_ON).ask(route(2))).toEqual({
      answers: { m1: FAKE_ANSWER, m2: FAKE_ANSWER },
      levels: { difficulty: [1, 0, 0] },
      model: JEV_MODEL,
    });
  });

  it("answers matches from the map it was made with, and never puts a Score in the answers", async () => {
    const answers = await new FakeJev(FAKE_ON, { m2: 0.91, difficulty: 0.3 }).ask(route(2));
    expect(answers.answers).toEqual({ m1: FAKE_ANSWER, m2: 0.91 });
    expect(answers.levels).toEqual({ difficulty: [...FAKE_LEVELS] });
  });

  it("leaves levels out when the request asks no Score", async () => {
    const fake = new FakeJev(FAKE_ON);
    const alone = await fake.ask(route(1, false));
    expect(alone).toEqual({ answers: { m1: FAKE_ANSWER }, model: JEV_MODEL });
    expect(alone).not.toHaveProperty("levels");
    const cleanup = await fake.ask(lineBreaks);
    expect(cleanup).toEqual({ answers: { L002: FAKE_ANSWER }, model: JEV_MODEL });
    expect(cleanup).not.toHaveProperty("levels");
  });

  it("gives each answer its own levels, so changing one never changes the next", async () => {
    const fake = new FakeJev(FAKE_ON);
    const first = await fake.ask(route(1));
    first.levels!.difficulty[0] = 0;
    expect((await fake.ask(route(1))).levels).toEqual({ difficulty: [1, 0, 0] });
    expect(FAKE_LEVELS).toEqual([1, 0, 0]);
  });

  it("answers a Score from the levels map it was made with, a fresh copy each time", async () => {
    const fake = new FakeJev(FAKE_ON, { m1: 0.8 }, { difficulty: [0.6, 0.3, 0.1] });
    const first = await fake.ask(route(1));
    expect(first).toEqual({ answers: { m1: 0.8 }, levels: { difficulty: [0.6, 0.3, 0.1] }, model: JEV_MODEL });
    first.levels!.difficulty[0] = 0;
    expect((await fake.ask(route(1))).levels).toEqual({ difficulty: [0.6, 0.3, 0.1] });
  });

  it("returns a queued answer as queued", async () => {
    const fake = new FakeJev(FAKE_ON);
    const queued = { answers: { m1: 0.2 }, levels: { difficulty: [0.1, 0.3, 0.6] }, model: "jev-1.14.0" };
    fake.queue("ask", queued);
    expect(await fake.ask(route(1))).toEqual(queued);
    expect(fake.asks).toEqual([route(1)]);
  });
});
