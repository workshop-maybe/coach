// @vitest-environment jsdom
// The Jev deep dive's case studies, in the real reply box (docs/plans/2026-10-04-1503-docs-jev-deep-dive-plan.md,
// KTD9). The reply a second opinion sends is the Markdown the reply box holds, and the box's
// editor escapes some characters a plain paste carries, such as square brackets. The
// examples and the UI cross-check (deepDiveFlow.test.tsx) use the paste as the paste's fixes
// leave it, as the deck's textarea stand-in does. This test runs the real editor over both
// case studies' texts and checks it holds them unchanged, so the guide's requests are the
// ones the app sends.

import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { joinLines } from "../../src/domain/lineBreaks";
import { fixPastedText } from "../../src/domain/pasteText";
import { CASE_REPLY, TERMINAL_REPLY } from "../../src/shots/shots";
import { firePaste } from "../../src/test/paste";
import { RichText, type RichTextHandle } from "../../src/ui/RichText";
import { CLEANUP_CALLS } from "../src/deep-dive/examples";

afterEach(cleanup);

function replyBox() {
  const onChange = vi.fn();
  const ref = createRef<RichTextHandle>();
  render(<RichText ref={ref} aria-label="Reply" value="" onChange={onChange} onPaste={() => {}} cleanPaste placeholder="Paste the reply" />);
  return { onChange, ref, box: screen.getByRole("textbox", { name: "Reply" }) };
}

describe("the case studies' texts in the real reply box", () => {
  it("hold the second opinion's reply as the paste's fixes leave it", () => {
    const { onChange, box } = replyBox();
    firePaste(box, { "text/plain": CASE_REPLY });
    expect(onChange).toHaveBeenLastCalledWith(fixPastedText(CASE_REPLY).text);
  });

  it("hold the cleanup's joined text as the cleanup writes it", () => {
    const { ref } = replyBox();
    const joined = joinLines(fixPastedText(TERMINAL_REPLY).text, CLEANUP_CALLS).text;
    let markdown = "";
    act(() => {
      markdown = ref.current!.replaceAsPaste(joined);
    });
    expect(markdown).toBe(joined);
  });
});
