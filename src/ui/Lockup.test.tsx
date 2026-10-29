// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Lockup } from "./Lockup";

afterEach(cleanup);

describe("Lockup", () => {
  it("is one drawing named Coach: a clean mark, hand-inked lettering, orange only on the clip, the prompt and the lit keys", () => {
    const { container } = render(<Lockup />);
    const logo = screen.getByRole("img", { name: "Coach" });
    expect(logo.tagName.toLowerCase()).toBe("svg");
    expect(container.querySelector("img")).toBeNull();
    expect(logo.querySelector(".lockup-mark")?.getAttribute("filter")).toBeNull();
    expect(logo.querySelector(".lockup-mark + g")?.getAttribute("filter")).toBe("url(#cast-ink)");
    expect(logo.querySelectorAll(".lockup-accent")).toHaveLength(4);
  });
});
