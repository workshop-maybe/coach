import { describe, expect, it } from "vitest";
import {
  chooseBreak,
  displayNameOf,
  hasContent,
  isBreakLine,
  itemName,
  joinSlots,
  normalizeReply,
  previewText,
  replyItems,
  replyKey,
  splitSlots,
  textOf,
} from "./replyItems";
import type { ReplyItem } from "./types";

const pdf: ReplyItem = { kind: "file", name: "report.pdf", ref: "files/file-1a2b3c4d.pdf" };
const video: ReplyItem = { kind: "video", name: "demo.mov", ref: "video-5e6f7a8b.mov" };
const image: ReplyItem = { kind: "image", name: "shot.png", ref: "image-0a1b2c3d.png" };
const link: ReplyItem = { kind: "link", url: "https://example.com/pr/12" };
const text = (t: string): ReplyItem => ({ kind: "text", text: t });

describe("replyItems (R12)", () => {
  it("reads a reply with no items as one text item holding its hand-back", () => {
    expect(replyItems({ handBack: "Done.\n\n![](image-ab.png)" })).toEqual([text("Done.\n\n![](image-ab.png)")]);
    expect(replyItems({ handBack: "" })).toEqual([text("")]);
  });

  it("reads a reply's items when it has them", () => {
    expect(replyItems({ handBack: "a", items: [text("a"), pdf] })).toEqual([text("a"), pdf]);
  });
});

describe("hasContent (R4, AE2)", () => {
  it("is false for nothing, or only empty and whitespace-only text items", () => {
    expect(hasContent([])).toBe(false);
    expect(hasContent([text("")])).toBe(false);
    expect(hasContent([text("  \n\t")])).toBe(false);
    expect(hasContent([text(""), text(" ")])).toBe(false);
  });

  it("is true for a lone link, file, image or video item, or any text with something in it", () => {
    expect(hasContent([link])).toBe(true);
    expect(hasContent([text(""), link])).toBe(true);
    expect(hasContent([pdf])).toBe(true);
    expect(hasContent([image])).toBe(true);
    expect(hasContent([video])).toBe(true);
    expect(hasContent([text(" x ")])).toBe(true);
  });
});

describe("normalizeReply", () => {
  it("keeps one text item as a hand-back with no items, verbatim", () => {
    expect(normalizeReply([text("  edge  \n")])).toEqual({ handBack: "  edge  \n" });
  });

  it("drops whitespace-only text items, so one empty text item plus a PDF saves as one PDF item", () => {
    expect(normalizeReply([text(" "), pdf])).toEqual({ handBack: "", items: [pdf] });
    expect(normalizeReply([text(""), text("Kept."), text("\n")])).toEqual({ handBack: "Kept." });
  });

  it("joins the text items with a blank line, and keeps every item in order", () => {
    const items = [text("One."), pdf, video, link, text("Two.")];
    expect(normalizeReply(items)).toEqual({ handBack: "One.\n\nTwo.", items });
  });

  it("refuses a reply with nothing in it", () => {
    expect(normalizeReply([])).toBeNull();
    expect(normalizeReply([text("  ")])).toBeNull();
  });
});

describe("text slots and the break line (KTD1)", () => {
  it("joins the text items with no break line when there is one, and one empty slot when there are none", () => {
    expect(textOf([text("a"), pdf, text("b")])).toBe("a\n\nb");
    expect(textOf([pdf])).toBe("");
  });

  it("chooses a token that occurs in no text item, drawing again until it does", () => {
    const draws = ["aaaa", "bbbb", "cccc"];
    const random = () => draws.shift()!;
    const line = chooseBreak(["has aaaa in it", "and <!-- item bbbb --> too"], random);
    expect(line).toBe("<!-- item cccc -->");
    expect(isBreakLine(line)).toBe(true);
  });

  it("chooses a fresh random token by default that is not in any text", () => {
    const texts = ["<!-- item 0123456789ab -->", "---", "## Handback"];
    const line = chooseBreak(texts);
    expect(isBreakLine(line)).toBe(true);
    const token = /<!-- item ([0-9a-f]+) -->/.exec(line)![1];
    expect(token.length).toBeGreaterThanOrEqual(12);
    for (const t of texts) expect(t).not.toContain(token);
  });

  it("only takes a break line of its own shape", () => {
    expect(isBreakLine("<!-- item 7f3a9c -->")).toBe(true);
    expect(isBreakLine("<!-- item -->")).toBe(false);
    expect(isBreakLine("<!-- item 7F3A9C -->")).toBe(false);
    expect(isBreakLine("<!-- item 7f3a9c --> extra")).toBe(false);
    expect(isBreakLine("<!-- item .* -->")).toBe(false);
  });

  it("splits what it joined, whatever the slots hold", () => {
    const slots = ["", "a\n", "\n", "<!-- item other -->\n---\n## Handback", "x\u2028<!-- item 7f3a9c -->\u2029y", "end\r"];
    const line = chooseBreak(slots);
    expect(splitSlots(joinSlots(slots, line), line)).toEqual(slots);
  });

  it("splits only at a whole line, and reads a CRLF file's break lines", () => {
    const line = "<!-- item 7f3a9c -->";
    expect(splitSlots(`a ${line}\nb`, line)).toEqual([`a ${line}\nb`]);
    expect(splitSlots(`a\r\n${line}\r\nb`, line)).toEqual(["a", "b"]);
    expect(splitSlots(`${line}`, line)).toEqual(["", ""]);
  });
});

describe("names, previews and keys", () => {
  it("takes the original file name from a path on any platform", () => {
    expect(displayNameOf("/Users/me/out/report.pdf")).toBe("report.pdf");
    expect(displayNameOf("C:\\out\\demo.mov")).toBe("demo.mov");
    expect(displayNameOf("plain.md")).toBe("plain.md");
    expect(displayNameOf("/trailing/")).toBe("trailing");
  });

  it("names an item by its display name, a link by its URL, and text by nothing", () => {
    expect(itemName(pdf)).toBe("report.pdf");
    expect(itemName(link)).toBe("https://example.com/pr/12");
    expect(itemName(text("hi"))).toBe("");
  });

  it("previews the first text item with something in it, then the first item's name", () => {
    expect(previewText([text(" "), pdf, text("Second."), text("Third.")])).toBe("Second.");
    expect(previewText([text(""), video, link])).toBe("demo.mov");
    expect(previewText([link])).toBe("https://example.com/pr/12");
    expect(previewText([])).toBe("");
  });

  it("keys a one-text reply by its text, and any other reply by every item in order", () => {
    expect(replyKey([text("Done.")])).toBe("Done.");
    const a = replyKey([text("Done."), pdf]);
    expect(a).not.toBe("Done.");
    expect(replyKey([text("Done."), { ...pdf }])).toBe(a);
    expect(replyKey([pdf, text("Done.")])).not.toBe(a);
    expect(replyKey([text("Done."), { ...pdf, ref: "files/file-ffffffff.pdf" }])).not.toBe(a);
  });
});
