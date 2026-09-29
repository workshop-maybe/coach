// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";
import { SaveBar, type DraftWithBase } from "./useDraftWithBase";

afterEach(cleanup);

describe("PageHeader", () => {
  it("renders the kicker, the title as the page heading, the lead and actions", () => {
    render(
      <PageHeader kicker="Your agents" title="Agents" lead="Every agent setup you run." actions={<button type="button">New agent</button>} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Agents" })).toBeTruthy();
    expect(screen.getByText("Your agents")).toBeTruthy();
    expect(screen.getByText("Every agent setup you run.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New agent" })).toBeTruthy();
  });

  it("hides the kicker's square from assistive tech", () => {
    const { container } = render(<PageHeader kicker="Your agents" title="Agents" />);
    const mark = container.querySelector(".kicker-mark");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
  });

  it("leaves out the lead and actions when none are given", () => {
    const { container } = render(<PageHeader kicker="Your agents" title="Agents" />);
    expect(container.querySelector(".page-header-lead")).toBeNull();
    expect(container.querySelector(".page-header-actions")).toBeNull();
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
