// @vitest-environment jsdom
// Jev's reading panel (growing context U5, R9, R11, R12, KTD8, KTD13, KTD15): each rubric
// point, the overall row and each learning target read as a call under the pair it is
// given, the probability after each call as smaller mono text, a point Jev can't call
// flagged in words. Jev's track record and the fitted line show only when they are passed.
// No reasons and no colored fills. Read-only, it is a saved reading.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { JevReading } from "../domain/types";
import { JevReadingPanel } from "./JevReading";

afterEach(cleanup);

const reading = {
  overall: 0.38,
  points: [
    { text: "Names the off-by-one", probability: 0.94 },
    { text: "Points to the line", probability: 0.52 },
    { text: "Suggests a fix", probability: 0.12 },
  ],
};

const panel = () => screen.getByRole("region", { name: "Jev's reading" });
/** The rubric points' rows, in order. */
const pointRows = () => [...panel().querySelectorAll<HTMLElement>("ol.jev-points > li")];
const overallRow = () => panel().querySelector<HTMLElement>(".jev-overall")!;
const targetsList = () => within(panel()).queryByRole("list", { name: "Learning targets" });
const targetRows = () => within(targetsList()!).getAllByRole("listitem");
const callIn = (row: Element) => row.querySelector(".jev-call")?.textContent;
const percentIn = (row: Element) => row.querySelector(".jev-p")?.textContent;

describe("JevReadingPanel", () => {
  it("Covers AE1. Four points, three targets and an overall show eight calls, with Learning targets after Overall", () => {
    const targets = [
      { text: "I can find bugs in a diff.", probability: 0.92 },
      { text: "I can explain a fix.", probability: 0.85 },
      { text: "I can name the risk.", probability: 0.2 },
    ];
    const points = [0.94, 0.88, 0.75, 0.9].map((probability, i) => ({ text: `Point ${i + 1}`, probability }));
    render(<JevReadingPanel reading={{ overall: 0.81, points, targets }} />);

    expect([...panel().querySelectorAll(".jev-call")].map((c) => c.textContent)).toEqual([
      "Meets",
      "Meets",
      "Meets",
      "Meets",
      "Meets",
      "Meets",
      "Meets",
      "Misses",
    ]);
    expect(pointRows().map(callIn)).toEqual(["Meets", "Meets", "Meets", "Meets"]);
    expect(callIn(overallRow())).toBe("Meets");
    expect(targetRows().map((li) => li.querySelector(".jev-point-text")?.textContent)).toEqual(targets.map((t) => t.text));
    expect(targetRows().map(callIn)).toEqual(["Meets", "Meets", "Misses"]);
    expect(targetRows().map(percentIn)).toEqual(["92%", "85%", "20%"]);

    const label = within(panel()).getByText("Learning targets");
    expect(overallRow().compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(overallRow().compareDocumentPosition(targetsList()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Covers AE5. Under the default pair 90% reads Meets, 50% can't call and 20% Misses, on points, overall and targets", () => {
    const at = (probability: number, i: number) => ({ text: `Line ${i + 1}`, probability });
    render(<JevReadingPanel reading={{ overall: 0.5, points: [0.9, 0.5, 0.2].map(at), targets: [0.9, 0.5, 0.2].map(at) }} />);

    expect(pointRows().map(callIn)).toEqual(["Meets", "Can't call: sharpen this point", "Misses"]);
    expect(pointRows().map(percentIn)).toEqual(["90%", "50%", "20%"]);
    expect(callIn(overallRow())).toBe("Jev can't call the whole bar");
    expect(percentIn(overallRow())).toBe("50%");
    expect(targetRows().map(callIn)).toEqual(["Meets", "Can't call", "Misses"]);
    cleanup();

    render(<JevReadingPanel reading={{ overall: 0.9, points: [] }} />);
    expect(callIn(overallRow())).toBe("Meets");
    cleanup();
    render(<JevReadingPanel reading={{ overall: 0.2, points: [] }} />);
    expect(callIn(overallRow())).toBe("Misses");
  });

  it("the can't-call band takes both its ends and nothing past them, read as the whole percent shown", () => {
    const edges = [0.29, 0.296, 0.3, 0.7, 0.704, 0.71].map((probability, i) => ({ text: `Point ${i + 1}`, probability }));
    render(<JevReadingPanel reading={{ overall: 0.05, points: edges }} />);
    const sharpen = "Can't call: sharpen this point";
    expect(pointRows().map(callIn)).toEqual(["Misses", sharpen, sharpen, sharpen, sharpen, "Meets"]);
    expect(pointRows().map(percentIn)).toEqual(["29%", "30%", "30%", "70%", "70%", "71%"]);
  });

  it("reads with the pair it is given, so a fitted pair moves a saved probability's call", () => {
    const points = [{ text: "Points to the line", probability: 0.65 }];
    render(<JevReadingPanel reading={{ overall: 0.4, points }} />);
    expect(callIn(pointRows()[0])).toBe("Can't call: sharpen this point");
    expect(callIn(overallRow())).toBe("Jev can't call the whole bar");
    cleanup();

    render(<JevReadingPanel reading={{ overall: 0.4, points }} pair={{ low: 45, high: 55 }} />);
    expect(callIn(pointRows()[0])).toBe("Meets");
    expect(callIn(overallRow())).toBe("Misses");
    expect(percentIn(pointRows()[0])).toBe("65%");
  });

  it("a rubric with no list and no targets shows only the overall reading", () => {
    render(<JevReadingPanel reading={{ overall: 0.8, points: [] }} />);
    expect(within(panel()).queryByRole("list")).toBeNull();
    expect(callIn(overallRow())).toBe("Meets");
    expect(percentIn(overallRow())).toBe("80%");
  });

  it("a reading saved before targets were asked, or with none asked, shows no targets list", () => {
    render(<JevReadingPanel reading={reading} />);
    expect(targetsList()).toBeNull();
    expect(within(panel()).queryByText("Learning targets")).toBeNull();
    cleanup();

    render(<JevReadingPanel reading={{ ...reading, targets: [] }} />);
    expect(targetsList()).toBeNull();
    expect(within(panel()).queryByText("Learning targets")).toBeNull();
  });

  it("shows Jev's track record when it is passed, with the can't calls only when there were any", () => {
    render(<JevReadingPanel reading={reading} trackRecord={{ matches: 7, calls: 9, cantCalls: 0 }} />);
    expect(within(panel()).getByText("Jev matched your verdict 7 of 9 times on this badge")).toBeTruthy();
    expect(within(panel()).queryByText(/couldn't call/)).toBeNull();
    cleanup();

    render(<JevReadingPanel reading={reading} trackRecord={{ matches: 5, calls: 6, cantCalls: 2 }} />);
    expect(within(panel()).getByText("Jev matched your verdict 5 of 6 times on this badge, and couldn't call 2")).toBeTruthy();
    cleanup();

    for (const none of [null, undefined]) {
      render(<JevReadingPanel reading={reading} trackRecord={none} />);
      expect(within(panel()).queryByText(/Jev matched/)).toBeNull();
      cleanup();
    }
  });

  it("says the cut-offs were fitted only when the pair was moved off the default", () => {
    render(<JevReadingPanel reading={reading} pair={{ low: 30, high: 55 }} fitted />);
    expect(within(panel()).getByText("Cut-offs fitted to your verdicts")).toBeTruthy();
    cleanup();

    render(<JevReadingPanel reading={reading} />);
    expect(within(panel()).queryByText("Cut-offs fitted to your verdicts")).toBeNull();
    cleanup();
    render(<JevReadingPanel reading={reading} fitted={false} trackRecord={{ matches: 7, calls: 9, cantCalls: 0 }} />);
    expect(within(panel()).queryByText("Cut-offs fitted to your verdicts")).toBeNull();
  });

  it("speaks in words and numbers: each call in ink with no green and no fill, its probability after it in the mono", () => {
    render(<JevReadingPanel reading={{ ...reading, targets: [{ text: "I can find bugs in a diff.", probability: 0.9 }] }} />);
    const calls = [...panel().querySelectorAll(".jev-call")];
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.className).toBe("jev-call");
      const p = call.nextElementSibling!;
      expect(p.tagName).toBe("DATA");
      expect(p.className).toBe("jev-p");
    }
    expect([...panel().querySelectorAll(".jev-p")].map((p) => p.getAttribute("value"))).toEqual(["0.94", "0.52", "0.12", "0.38", "0.9"]);
    expect(panel().querySelectorAll(".verdict-met, .holder, [style]")).toHaveLength(0);
    expect(panel().textContent).toBe(
      "JevNames the off-by-oneMeets 94%Points to the lineCan't call: sharpen this point 52%Suggests a fixMisses 12%" +
        "OverallJev can't call the whole bar 38%Learning targetsI can find bugs in a diff.Meets 90%",
    );
  });

  it("on the judge pane it carries its own head; read-only, a saved reading leaves the head to the view around it", () => {
    render(<JevReadingPanel reading={reading} />);
    expect(panel().querySelector(".jev-reading-head")?.textContent).toBe("Jev");
    cleanup();

    const saved: JevReading = {
      model: "jev-1.13.0",
      assignmentVersion: "v1",
      askedAt: "2026-10-03T10:00:00.000Z",
      seen: "after",
      verdictWhenSeen: "not_met",
      verdictChanged: true,
      ...reading,
    };
    render(<JevReadingPanel reading={saved} readOnly />);
    expect(panel().querySelector(".jev-reading-head")).toBeNull();
    expect(panel().classList.contains("jev-reading-saved")).toBe(true);
    expect(pointRows().map(percentIn)).toEqual(["94%", "52%", "12%"]);
    expect(within(panel()).queryByRole("button")).toBeNull();
  });
});
