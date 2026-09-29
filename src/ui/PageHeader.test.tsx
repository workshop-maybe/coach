// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";
import { Stat } from "./Stat";
import { SaveBar, type DraftWithBase } from "./useDraftWithBase";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders the title as the page heading, the lead and actions", () => {
    render(<PageHeader title="Agents" lead="Every agent setup you run." actions={<button type="button">New agent</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Agents" })).toBeTruthy();
    expect(screen.getByText("Every agent setup you run.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New agent" })).toBeTruthy();
  });

  it("renders no kicker above the heading (R3)", () => {
    const { container } = render(<PageHeader title="Agents" />);
    expect(container.querySelector(".kicker")).toBeNull();
    expect(container.querySelector(".page-header")?.firstElementChild?.className).toBe("page-header-row");
  });

  it("leaves out the lead and actions when none are given", () => {
    const { container } = render(<PageHeader title="Agents" />);
    expect(container.querySelector(".page-header-lead")).toBeNull();
    expect(container.querySelector(".page-header-actions")).toBeNull();
  });
});

describe("Stat", () => {
  it("fills its bar to the share, and never past full", () => {
    const { container, rerender } = render(<Stat value={1} of={4}>met</Stat>);
    expect((container.querySelector(".stat-fill") as HTMLElement).style.width).toBe("25%");
    rerender(<Stat value={0} of={0}>met</Stat>);
    expect((container.querySelector(".stat-fill") as HTMLElement).style.width).toBe("0%");
  });
});

describe("SaveBar", () => {
  const d = { saving: false, dirty: false, justSaved: false } as unknown as DraftWithBase<unknown>;

  it("is the orange primary action by default", () => {
    render(<SaveBar d={d} />);
    expect(screen.getByRole("button", { name: "Save" }).className).toBe("primary");
  });

  it("renders as ink when a view already has its primary action", () => {
    render(<SaveBar d={d} label="Save badge" variant="ink" />);
    expect(screen.getByRole("button", { name: "Save badge" }).className).toBe("ink");
  });
});
