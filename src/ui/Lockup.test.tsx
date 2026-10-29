// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Lockup } from "./Lockup";

afterEach(cleanup);

describe("Lockup", () => {
  it("is one hand-inked drawing named Coach, with orange only on the brace", () => {
    const { container } = render(<Lockup />);
    const logo = screen.getByRole("img", { name: "Coach" });
    expect(logo.tagName.toLowerCase()).toBe("svg");
    expect(container.querySelector("img")).toBeNull();
    expect(logo.querySelector("g")?.getAttribute("filter")).toBe("url(#cast-ink)");
    expect(logo.querySelectorAll(".lockup-brace")).toHaveLength(1);
  });
});
