/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  calibrationOf,
  calibrationsOf,
  callOf,
  CUT_OFF_STEP,
  DEFAULT_CUT_OFFS,
  fitCutOffs,
  HIGH_CUT_OFF_RANGE,
  isOverrule,
  LOW_CUT_OFF_RANGE,
  MAX_CANT_CALL_PERCENT,
  MIN_JUDGED_READINGS,
  MIN_READINGS_PER_VERDICT,
  ranksAsOverrule,
  trackRecordOf,
  WRONG_CALL_COST,
  wholePercent,
  type CutOffs,
  type JudgedReading,
} from "./calls";
import type { Assessment, AssessmentResult, FolderState, HeldReply, JevReading } from "./types";

const KEY = "eng/review";
const MODEL = "jev-1.13.0";

/** Judged readings from whole percents: the Met ones, then the Not met ones. */
function readings(met: number[], notMet: number[]): JudgedReading[] {
  return [...met.map((p) => ({ overall: p / 100, verdict: "met" as const })), ...notMet.map((p) => ({ overall: p / 100, verdict: "not_met" as const }))];
}

function reading(overall: number, model = MODEL): JevReading {
  return { model, assignmentVersion: "v1", askedAt: "2026-10-01T09:00:00.000Z", seen: "before", overall, points: [] };
}

let seq = 0;
/** A result on the badge, with a reading at this whole percent unless it is null. */
function result(verdict: AssessmentResult, pct: number | null, overrides: Partial<Assessment> = {}, model = MODEL): Assessment {
  seq += 1;
  return {
    profileSlug: "codex",
    collectionSlug: "eng",
    credentialSlug: "review",
    fileStem: `20261001T${String(seq).padStart(6, "0")}Z`,
    result: verdict,
    recordedAt: "2026-10-01T09:00:00.000Z",
    assignmentVersion: "v1",
    setup: { harness: "codex", model: "gpt-5", effort: "high" },
    note: "",
    handBack: "Done",
    ...(pct === null ? {} : { jev: reading(pct / 100, model) }),
    ...overrides,
  };
}

/** The badge's results from whole percents, every reading from one model. */
function results(met: number[], notMet: number[], model = MODEL): Assessment[] {
  return [...met.map((p) => result("met", p, {}, model)), ...notMet.map((p) => result("not_met", p, {}, model))];
}

function folder(assessments: Assessment[], held: HeldReply[] = []): FolderState {
  return {
    collections: [],
    credentials: [],
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

/** The fit's own score, worked out independently: matches minus twice the wrong calls. */
function score(rs: JudgedReading[], pair: CutOffs): number {
  let total = 0;
  for (const r of rs) {
    const call = callOf(r.overall, pair);
    if (call === "cant_call") continue;
    total += (call === "meets") === (r.verdict === "met") ? 1 : -WRONG_CALL_COST;
  }
  return total;
}

function cantCalls(rs: JudgedReading[], pair: CutOffs): number {
  return rs.filter((r) => callOf(r.overall, pair) === "cant_call").length;
}

// AE6's readings: every one of 60% or more is Met.
const AE6_MET = [60, 65, 75, 90, 95];
const AE6_NOT_MET = [10, 20, 40];

describe("calls under a pair", () => {
  it("covers AE5: the default reads 90% meets, 30 to 70% inclusive can't call, 20% misses", () => {
    expect(DEFAULT_CUT_OFFS).toEqual({ low: 30, high: 70 });
    expect(callOf(0.9, DEFAULT_CUT_OFFS)).toBe("meets");
    for (const p of [0.7, 0.5, 0.3]) expect(callOf(p, DEFAULT_CUT_OFFS)).toBe("cant_call");
    expect(callOf(0.2, DEFAULT_CUT_OFFS)).toBe("misses");
  });

  it("covers AE5: a badge with no judged results reads with the default", () => {
    expect(calibrationOf(folder([]), KEY, MODEL)).toEqual({ pair: DEFAULT_CUT_OFFS, fitted: false, judged: 0, trackRecord: null });
  });

  it("calls the whole percent the reading shows, so the call and the percent never disagree", () => {
    expect(wholePercent(0.695)).toBe(70);
    expect(callOf(0.695, DEFAULT_CUT_OFFS)).toBe("cant_call");
    expect(wholePercent(0.705)).toBe(71);
    expect(callOf(0.705, DEFAULT_CUT_OFFS)).toBe("meets");
    expect(wholePercent(0.295)).toBe(30);
    expect(callOf(0.295, DEFAULT_CUT_OFFS)).toBe("cant_call");
    expect(wholePercent(0.29)).toBe(29);
    expect(callOf(0.29, DEFAULT_CUT_OFFS)).toBe("misses");
  });

  it("reads with whatever pair it is given, ends inclusive", () => {
    const pair = { low: 45, high: 55 };
    expect(callOf(0.65, pair)).toBe("meets");
    expect(callOf(0.55, pair)).toBe("cant_call");
    expect(callOf(0.45, pair)).toBe("cant_call");
    expect(callOf(0.44, pair)).toBe("misses");
  });
});

describe("fitting a badge's pair", () => {
  it("keeps the default with 7 judged readings", () => {
    // AE6's readings less one: a full set would move the pair.
    expect(fitCutOffs(readings([60, 65, 75, 90], AE6_NOT_MET))).toEqual(DEFAULT_CUT_OFFS);
  });

  it("keeps the default when every verdict is Met, or only one is Not met", () => {
    expect(fitCutOffs(readings([60, 65, 75, 80, 85, 90, 95, 99], []))).toEqual(DEFAULT_CUT_OFFS);
    expect(fitCutOffs(readings([60, 65, 75, 80, 85, 90, 95], [40]))).toEqual(DEFAULT_CUT_OFFS);
  });

  it("covers AE6: when every reading of 60% or more is Met, the high cut-off falls to 55 and 65% reads meets", () => {
    // (45, 55) is the only pair that calls all eight right: 60 needs high 55, and 40 needs low 45.
    const pair = fitCutOffs(readings(AE6_MET, AE6_NOT_MET));
    expect(pair).toEqual({ low: 45, high: 55 });
    expect(callOf(0.65, pair)).toBe("meets");
  });

  it("covers AE6: a past reading at 65% re-reads as meets from the folder, and the record shows", () => {
    const past = result("met", 65);
    const state = folder([past, ...results([60, 75, 90, 95], AE6_NOT_MET)]);
    expect(callOf(past.jev!.overall, DEFAULT_CUT_OFFS)).toBe("cant_call");
    const calibration = calibrationOf(state, KEY, MODEL);
    expect(calibration).toEqual({ pair: { low: 45, high: 55 }, fitted: true, judged: 8, trackRecord: { matches: 8, calls: 8, cantCalls: 0 } });
    expect(callOf(past.jev!.overall, calibration.pair)).toBe("meets");
  });

  it("holds the default when readings cluster near 0 and 1 and all agree with the user", () => {
    // Every candidate calls all eight right, so the pair closest to 30/70 is the default itself.
    const rs = readings([92, 95, 97, 99], [2, 4, 6, 8]);
    expect(score(rs, { low: 10, high: 90 })).toBe(score(rs, DEFAULT_CUT_OFFS));
    expect(score(rs, { low: 45, high: 55 })).toBe(score(rs, DEFAULT_CUT_OFFS));
    const state = folder(results([92, 95, 97, 99], [2, 4, 6, 8]));
    const calibration = calibrationOf(state, KEY, MODEL);
    expect(calibration.pair).toEqual(DEFAULT_CUT_OFFS);
    expect(calibration.fitted).toBe(false);
    expect(callOf(0.56, calibration.pair)).toBe("cant_call");
  });

  it("holds the default with Met 95, 90, 58 and Not met 10, 15, 56, 60, 62, though half are can't call", () => {
    // The default scores 4 and leaves 4 of 8 at can't call. A pair within the cap needs high 60
    // (score 2: 62 reads meets on a Not met) or 55 (score -1).
    const rs = readings([95, 90, 58], [10, 15, 56, 60, 62]);
    expect(score(rs, DEFAULT_CUT_OFFS)).toBe(4);
    expect(cantCalls(rs, DEFAULT_CUT_OFFS)).toBe(4);
    expect(fitCutOffs(rs)).toEqual(DEFAULT_CUT_OFFS);
    const state = folder(results([95, 90, 58], [10, 15, 56, 60, 62]));
    expect(calibrationOf(state, KEY, MODEL)).toEqual({
      pair: DEFAULT_CUT_OFFS,
      fitted: false,
      judged: 8,
      trackRecord: { matches: 4, calls: 4, cantCalls: 4 },
    });
  });

  it("among equal scores picks the pair closest to 30/70", () => {
    // Every low from 30 to 45 calls 25 a miss and nothing else differs, so each scores 8 with high 55.
    const rs = readings(AE6_MET, [10, 20, 25]);
    expect(score(rs, { low: 30, high: 55 })).toBe(8);
    expect(score(rs, { low: 45, high: 55 })).toBe(8);
    expect(fitCutOffs(rs)).toEqual({ low: 30, high: 55 });
  });

  it("at equal distance from 30/70, picks the narrower band", () => {
    // 95, 96 and 97 read meets under every high, so high stays at 70. Low 25 leaves 27, 31 and
    // 32 at can't call (score 5, 3 of 8 within the cap); low 35 calls 27 wrong and 31 and 32 right
    // (also 5). The default calls 27 wrong and leaves 31 and 32 (score 3). Both are 5 from 30/70.
    const rs = readings([27, 95, 96, 97], [5, 6, 31, 32]);
    expect(score(rs, { low: 25, high: 70 })).toBe(5);
    expect(score(rs, { low: 35, high: 70 })).toBe(5);
    expect(score(rs, DEFAULT_CUT_OFFS)).toBe(3);
    expect(cantCalls(rs, { low: 25, high: 70 }) * 100).toBeLessThanOrEqual(rs.length * MAX_CANT_CALL_PERCENT);
    expect(fitCutOffs(rs)).toEqual({ low: 35, high: 70 });
  });

  it("never takes a pair that leaves over 40% at can't call, however well it scores", () => {
    // Low 20 would score 4 but leaves 22, 25, 26 and 28 (4 of 8) at can't call. Low 25 scores 2
    // with 3 of 8, and the default scores -4.
    const rs = readings([22, 25, 26, 28, 95, 96], [5, 6]);
    expect(score(rs, { low: 20, high: 70 })).toBe(4);
    expect(cantCalls(rs, { low: 20, high: 70 })).toBe(4);
    expect(score(rs, { low: 25, high: 70 })).toBe(2);
    expect(score(rs, DEFAULT_CUT_OFFS)).toBe(-4);
    expect(fitCutOffs(rs)).toEqual({ low: 25, high: 70 });
  });

  it("stays on the grid and inside the clamps, within the cap unless the default holds, and never scores below the default", () => {
    // A small seeded generator (Park-Miller), so the run is the same every time.
    let s = 7;
    const next = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    let moved = 0;
    for (let run = 0; run < 300; run++) {
      const n = MIN_JUDGED_READINGS + Math.floor(next() * 12);
      const rs: JudgedReading[] = [];
      for (let i = 0; i < n; i++) rs.push({ overall: Math.floor(next() * 101) / 100, verdict: next() < 0.5 ? "met" : "not_met" });
      const pair = fitCutOffs(rs);
      expect(pair.low % CUT_OFF_STEP).toBe(0);
      expect(pair.high % CUT_OFF_STEP).toBe(0);
      expect(pair.low).toBeGreaterThanOrEqual(LOW_CUT_OFF_RANGE.min);
      expect(pair.low).toBeLessThanOrEqual(LOW_CUT_OFF_RANGE.max);
      expect(pair.high).toBeGreaterThanOrEqual(HIGH_CUT_OFF_RANGE.min);
      expect(pair.high).toBeLessThanOrEqual(HIGH_CUT_OFF_RANGE.max);
      expect(score(rs, pair)).toBeGreaterThanOrEqual(score(rs, DEFAULT_CUT_OFFS));
      const isDefault = pair.low === DEFAULT_CUT_OFFS.low && pair.high === DEFAULT_CUT_OFFS.high;
      if (!isDefault) {
        moved++;
        expect(cantCalls(rs, pair) * 100).toBeLessThanOrEqual(rs.length * MAX_CANT_CALL_PERCENT);
      }
    }
    // The runs exercise the fit, not only the default.
    expect(moved).toBeGreaterThan(0);
  });

  it("needs 8 readings and 2 of each verdict, as named constants", () => {
    expect(MIN_JUDGED_READINGS).toBe(8);
    expect(MIN_READINGS_PER_VERDICT).toBe(2);
  });
});

describe("a badge's calibration per Jev model", () => {
  it("fits each model's readings apart, and a model with none reads with the default", () => {
    const state = folder([...results(AE6_MET, AE6_NOT_MET, "jev-1.13.0"), ...results([92, 95, 97, 99], [2, 4, 6, 8], "jev-1.14.0")]);
    expect(calibrationOf(state, KEY, "jev-1.13.0").pair).toEqual({ low: 45, high: 55 });
    expect(calibrationOf(state, KEY, "jev-1.14.0")).toMatchObject({ pair: DEFAULT_CUT_OFFS, fitted: false, judged: 8 });
    expect(calibrationOf(state, KEY, "jev-2.0.0")).toEqual({ pair: DEFAULT_CUT_OFFS, fitted: false, judged: 0, trackRecord: null });
    expect([...calibrationsOf(state, KEY).keys()]).toEqual(["jev-1.13.0", "jev-1.14.0"]);
  });

  it("groups model ids such as __proto__, constructor and toString like any other", () => {
    const state = folder([...results(AE6_MET, AE6_NOT_MET, "__proto__"), ...results([90], [10, 20], "constructor")]);
    expect(calibrationOf(state, KEY, "__proto__")).toMatchObject({ pair: { low: 45, high: 55 }, fitted: true, judged: 8 });
    expect(calibrationOf(state, KEY, "constructor")).toEqual({ pair: DEFAULT_CUT_OFFS, fitted: false, judged: 3, trackRecord: null });
    expect(calibrationOf(state, KEY, "toString")).toEqual({ pair: DEFAULT_CUT_OFFS, fitted: false, judged: 0, trackRecord: null });
    expect([...calibrationsOf(state, KEY).keys()]).toEqual(["__proto__", "constructor"]);
  });

  it("counts readings at older assignment versions", () => {
    const all = results(AE6_MET, AE6_NOT_MET);
    const state = folder(all.map((a, i) => (i % 2 === 0 ? { ...a, assignmentVersion: "v0", jev: { ...a.jev!, assignmentVersion: "v0" } } : a)));
    expect(calibrationOf(state, KEY, MODEL).pair).toEqual({ low: 45, high: 55 });
  });

  it("never counts held replies, other badges' results, or results without a reading", () => {
    const own = results([60, 65, 75, 90], AE6_NOT_MET);
    const otherBadge = result("met", 95, { credentialSlug: "docs" });
    const otherCollection = result("met", 95, { collectionSlug: "ops" });
    const noReading = result("met", null);
    const held: HeldReply = {
      profileSlug: "codex",
      collectionSlug: "eng",
      credentialSlug: "review",
      fileStem: "20261002T090000Z",
      heldAt: "2026-10-02T09:00:00.000Z",
      assignmentVersion: "v1",
      setup: { harness: "codex", model: "gpt-5", effort: "high" },
      handBack: "Done",
      jev: reading(0.95),
    };
    const state = folder([...own, otherBadge, otherCollection, noReading], [held]);
    // Seven judged readings: either Met at 95% on another badge, counted, would make eight and move the pair.
    expect(calibrationOf(state, KEY, MODEL)).toEqual({ pair: DEFAULT_CUT_OFFS, fitted: false, judged: 7, trackRecord: null });
  });
});

describe("Jev's track record", () => {
  it("counts matches over calls made, with can't calls apart", () => {
    // Under the default: 90, 10, 15 and 25 match; 20 on a Met and 80 on a Not met are wrong; both 50s can't call.
    const rs = readings([90, 20, 50], [10, 80, 15, 25, 50]);
    expect(trackRecordOf(rs, DEFAULT_CUT_OFFS)).toEqual({ matches: 4, calls: 6, cantCalls: 2 });
  });

  it("shows nothing below 8 judged readings", () => {
    expect(trackRecordOf(readings([90, 95, 99], [5, 10, 15, 20]), DEFAULT_CUT_OFFS)).toBeNull();
  });

  it("shows from 8 judged readings even when every verdict is the same and the fit can't run", () => {
    const state = folder(results([60, 65, 75, 80, 85, 90, 95, 99], []));
    expect(calibrationOf(state, KEY, MODEL)).toEqual({
      pair: DEFAULT_CUT_OFFS,
      fitted: false,
      judged: 8,
      trackRecord: { matches: 6, calls: 6, cantCalls: 2 },
    });
  });

  it("shows nothing when every reading was can't call", () => {
    // From 46 to 54% is inside every candidate band, so no fit can call these.
    const state = folder(results([48, 50, 52, 54], [46, 48, 50, 52]));
    expect(calibrationOf(state, KEY, MODEL)).toEqual({ pair: DEFAULT_CUT_OFFS, fitted: false, judged: 8, trackRecord: null });
  });
});

describe("overrules", () => {
  it("is a meets call on a Not met result, or a misses call on a Met one", () => {
    expect(isOverrule(result("not_met", 90), DEFAULT_CUT_OFFS)).toBe(true);
    expect(isOverrule(result("met", 10), DEFAULT_CUT_OFFS)).toBe(true);
  });

  it("is never a can't call, a call that agrees, or a result with no reading", () => {
    expect(isOverrule(result("not_met", 50), DEFAULT_CUT_OFFS)).toBe(false);
    expect(isOverrule(result("met", 50), DEFAULT_CUT_OFFS)).toBe(false);
    expect(isOverrule(result("met", 90), DEFAULT_CUT_OFFS)).toBe(false);
    expect(isOverrule(result("not_met", 10), DEFAULT_CUT_OFFS)).toBe(false);
    expect(isOverrule(result("not_met", null), DEFAULT_CUT_OFFS)).toBe(false);
  });

  it("reads with the pair it is given, so a reading in hand can use the pair frozen with it", () => {
    expect(isOverrule({ result: "not_met", jev: { overall: 0.65 } }, DEFAULT_CUT_OFFS)).toBe(false);
    expect(isOverrule({ result: "not_met", jev: { overall: 0.65 } }, { low: 45, high: 55 })).toBe(true);
  });

  it("ranks a result opposed under the default as an overrule after a fit widens the band to absorb it", () => {
    // Highs below 90 call the 90% Not met wrong, so the fit moves high to 90, where 90% reads can't call.
    const overruled = result("not_met", 90);
    const state = folder([overruled, ...results([95, 96, 97], [5, 6, 12, 15])]);
    const { pair } = calibrationOf(state, KEY, MODEL);
    expect(pair).toEqual({ low: 30, high: 90 });
    expect(isOverrule(overruled, pair)).toBe(false);
    expect(ranksAsOverrule(overruled, pair)).toBe(true);
  });

  it("ranks a result opposed only under the badge's current pair as an overrule, and one opposed under neither as not", () => {
    expect(ranksAsOverrule(result("not_met", 65), { low: 45, high: 55 })).toBe(true);
    expect(ranksAsOverrule(result("not_met", 50), { low: 45, high: 55 })).toBe(false);
    expect(ranksAsOverrule(result("met", 90), { low: 45, high: 55 })).toBe(false);
  });
});

describe("the calls module", () => {
  it("imports nothing from the UI", () => {
    const source = readFileSync(join(__dirname, "calls.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*\/ui\//);
  });
});
