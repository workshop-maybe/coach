import { describe, expect, it } from "vitest";
import { scanLines } from "./markdownLines";

/** Each line as [text, fence, inFence], the shape most cases check. */
function flags(text: string) {
  return scanLines(text).map((l) => [l.text, l.fence, l.inFence]);
}

describe("scanLines", () => {
  it("returns every line, with none in a fence when there is no fence", () => {
    expect(flags("one\n\n- two")).toEqual([
      ["one", false, false],
      ["", false, false],
      ["- two", false, false],
    ]);
  });

  it("marks a closed backtick fence: delimiters as fences, the lines between as inside", () => {
    expect(flags("before\n```python\nx = 1\n\n```\nafter")).toEqual([
      ["before", false, false],
      ["```python", true, false],
      ["x = 1", false, true],
      ["", false, true],
      ["```", true, false],
      ["after", false, false],
    ]);
  });

  it("marks a closed tilde fence", () => {
    expect(flags("~~~\n- not an item\n~~~\n- an item")).toEqual([
      ["~~~", true, false],
      ["- not an item", false, true],
      ["~~~", true, false],
      ["- an item", false, false],
    ]);
  });

  it("runs an unclosed fence to the end of the text", () => {
    expect(flags("text\n```\ncode\n- still code")).toEqual([
      ["text", false, false],
      ["```", true, false],
      ["code", false, true],
      ["- still code", false, true],
    ]);
  });

  it("closes only on the same character, at least as long, with nothing after it", () => {
    expect(flags("````\n```\n~~~~\n```` js\n`````\nafter")).toEqual([
      ["````", true, false],
      ["```", false, true],
      ["~~~~", false, true],
      ["```` js", false, true],
      ["`````", true, false],
      ["after", false, false],
    ]);
  });

  it("does not open a fence on an inline code span", () => {
    expect(flags("```js```\n- an item")).toEqual([
      ["```js```", false, false],
      ["- an item", false, false],
    ]);
  });

  it("does not open a fence on fewer than three marks", () => {
    expect(flags("``\n~~\n- an item")).toEqual([
      ["``", false, false],
      ["~~", false, false],
      ["- an item", false, false],
    ]);
  });

  it("opens and closes an indented fence, as under a list item or a terminal's gutter", () => {
    expect(flags("- item\n    ```\n    code\n    ```\n- next")).toEqual([
      ["- item", false, false],
      ["    ```", true, false],
      ["    code", false, true],
      ["    ```", true, false],
      ["- next", false, false],
    ]);
  });

  it("measures indent in columns, a tab advancing to the next multiple of four", () => {
    expect(scanLines("none\n  two\n\tfour\n \tfour\n\t  six\n   ").map((l) => l.indent)).toEqual([0, 2, 4, 4, 6, 3]);
  });

  it("drops CRLF line endings from the line text", () => {
    expect(flags("a\r\n```\r\ncode\r\n```\r\nb")).toEqual([
      ["a", false, false],
      ["```", true, false],
      ["code", false, true],
      ["```", true, false],
      ["b", false, false],
    ]);
  });

  it("reads an empty text as one empty line", () => {
    expect(scanLines("")).toEqual([{ text: "", indent: 0, fence: false, inFence: false }]);
  });
});
