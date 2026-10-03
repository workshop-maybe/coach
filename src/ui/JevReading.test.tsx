// @vitest-environment jsdom
// Jev's reading panel (U6, R10, R11, KTD13): each rubric point with its probability as a
// whole percentage in the mono, a point Jev can't call flagged in words, and one overall
// reading. No reasons and no colored fills. Read-only, it is a saved reading (U7, R14).
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
const rows = () => within(panel()).getAllByRole("listitem");

describe("JevReadingPanel", () => {
  it("Covers AE4. Shows three points as percentages and the overall reading, and marks the 0.52 point as one to sharpen", () => {
    render(<JevReadingPanel reading={reading} />);
    expect(rows().map((li) => li.querySelector(".jev-point-text")?.textContent)).toEqual(["Names the off-by-one", "Points to the line", "Suggests a fix"]);
    expect(rows().map((li) => li.querySelector(".jev-p")?.textContent)).toEqual(["94%", "52%", "12%"]);
    expect(rows().map((li) => within(li).queryByText("Can't call: sharpen this point") !== null)).toEqual([false, true, false]);

    const overall = panel().querySelector(".jev-overall")!;
    expect(overall.querySelector(".jev-point-text")?.textContent).toBe("Overall");
    expect(overall.querySelector(".jev-p")?.textContent).toBe("38%");
    expect(within(overall as HTMLElement).getByText("Jev can't call the whole bar")).toBeTruthy();
  });

  it("an overall reading Jev can call says only its percentage", () => {
    render(<JevReadingPanel reading={{ ...reading, overall: 0.91 }} />);
    const overall = panel().querySelector(".jev-overall")!;
    expect(overall.querySelector(".jev-p")?.textContent).toBe("91%");
    expect(screen.queryByText("Jev can't call the whole bar")).toBeNull();
  });

  it("the can't-call band takes both its ends and nothing past them", () => {
    const edges = [0.29, 0.3, 0.7, 0.71].map((probability, i) => ({ text: `Point ${i + 1}`, probability }));
    render(<JevReadingPanel reading={{ overall: 0.05, points: edges }} />);
    expect(rows().map((li) => within(li).queryByText("Can't call: sharpen this point") !== null)).toEqual([false, true, true, false]);
    expect(rows().map((li) => li.querySelector(".jev-p")?.textContent)).toEqual(["29%", "30%", "70%", "71%"]);
  });

  it("a rubric with no list shows only the overall reading", () => {
    render(<JevReadingPanel reading={{ overall: 0.8, points: [] }} />);
    expect(within(panel()).queryByRole("list")).toBeNull();
    expect(panel().querySelector(".jev-overall .jev-p")?.textContent).toBe("80%");
  });

  it("speaks in numbers and words: the percentages in the mono, no reasons, no colored fills", () => {
    render(<JevReadingPanel reading={reading} />);
    for (const p of panel().querySelectorAll(".jev-p")) expect(p.tagName).toBe("DATA");
    expect([...panel().querySelectorAll(".jev-p")].map((p) => p.getAttribute("value"))).toEqual(["0.94", "0.52", "0.12", "0.38"]);
    expect(panel().querySelectorAll("[style]")).toHaveLength(0);
    expect(panel().textContent).toBe(
      "JevNames the off-by-one94%Points to the line52%Can't call: sharpen this pointSuggests a fix12%Overall38%Jev can't call the whole bar",
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
    expect(rows().map((li) => li.querySelector(".jev-p")?.textContent)).toEqual(["94%", "52%", "12%"]);
    expect(within(panel()).queryByRole("button")).toBeNull();
  });
});
