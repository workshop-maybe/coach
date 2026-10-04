import { describe, expect, it } from "vitest";
import { goToLine } from "./format";

describe("the go-to line (KTD8, KTD9)", () => {
  it("names the agent, then each flag in a few words", () => {
    expect(goToLine("Codex", [])).toBe("Go-to: Codex");
    expect(goToLine("Codex", ["not_met"])).toBe("Go-to: Codex · not met");
    expect(goToLine("Codex", ["not_met", "setup_mismatch"])).toBe("Go-to: Codex · not met · setup changed");
  });
});
