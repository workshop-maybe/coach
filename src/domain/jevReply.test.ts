import { describe, expect, it } from "vitest";
import { assessmentDir } from "./folder";
import { isTextFileRef, jevReply, pendingTexts, textsIn, type FileTexts } from "./jevReply";
import type { ReplyItem } from "./types";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** File texts by ref: a string is the file's text, null one that can't be read; any other ref is still loading. */
function texts(byRef: Record<string, string | null>): (ref: string) => string | null | undefined {
  return (ref) => (ref in byRef ? byRef[ref] : undefined);
}

const text = (t: string): ReplyItem => ({ kind: "text", text: t });
const file = (name: string, ref: string): ReplyItem => ({ kind: "file", name, ref });

describe("jevReply", () => {
  it("covers AE4: the text, then the Markdown file under its name, then a line naming the video", () => {
    const items: ReplyItem[] = [
      text("I recorded the demo and wrote notes."),
      file("notes.md", "files/file-0000000a.md"),
      { kind: "video", name: "demo.mp4", ref: "video-1a2b3c4d.mp4" },
    ];
    expect(jevReply(items, texts({ "files/file-0000000a.md": "# Notes\n\nThe CLI parses flags." }))).toBe(
      "I recorded the demo and wrote notes.\n\nFile: notes.md\n# Notes\n\nThe CLI parses flags.\n\nA video Jev cannot see: demo.mp4",
    );
  });

  it("names every item Jev cannot read, in the reply's order", () => {
    const items: ReplyItem[] = [
      { kind: "image", name: "chart.png", ref: "image-1a2b3c4d.png" },
      file("report.pdf", "files/file-0000000b.pdf"),
      file("bundle.zip", "files/file-0000000c.zip"),
      { kind: "link", url: "https://example.com/pr/1" },
      file("readme.txt", "files/file-0000000d.txt"),
    ];
    expect(jevReply(items, texts({ "files/file-0000000d.txt": "Plain words." }))).toBe(
      [
        "A picture Jev cannot see: chart.png",
        "A file Jev cannot see: report.pdf",
        "A file Jev cannot see: bundle.zip",
        "A link Jev cannot open: https://example.com/pr/1",
        "File: readme.txt\nPlain words.",
      ].join("\n\n"),
    );
  });

  it("drops picture and video Markdown from the text it reads, and a line left blank by that", () => {
    const reply = "Here is the chart:\n![chart](image-1a2b3c4d.png)\nAnd ![](video-1a2b3c4d.mp4) the demo.\n![x](data:image/png;base64,AAAA)";
    expect(jevReply([text(reply)], texts({}))).toBe("Here is the chart:\nAnd  the demo.");
  });

  it("reads text as a reader sees it, without the reply box's escapes, fenced code as written", () => {
    const reply = "Key: \\[2, 1\\], a\\_b &amp; c\n```\n\\[x\\]\n```";
    expect(jevReply([text(reply)], texts({}))).toBe("Key: [2, 1], a_b & c\n```\n\\[x\\]\n```");
  });

  it("keeps a file's text as written: no reader escapes undone", () => {
    expect(jevReply([file("a.md", "files/file-0000000e.md")], texts({ "files/file-0000000e.md": "a\\_b &amp; c" }))).toBe("File: a.md\na\\_b &amp; c");
  });

  it("skips a whitespace-only text item, and one that held only a picture", () => {
    const items: ReplyItem[] = [text("  \n "), text("Done."), text("![](image-1a2b3c4d.png)"), { kind: "link", url: "https://x.dev" }];
    expect(jevReply(items, texts({}))).toBe("Done.\n\nA link Jev cannot open: https://x.dev");
  });

  it("names a file that can't be read, or is still loading, as one Jev cannot see", () => {
    const items = [file("notes.md", "files/file-0000000a.md"), file("log.txt", "files/file-0000000f.txt")];
    expect(jevReply(items, texts({ "files/file-0000000a.md": null }))).toBe("A file Jev cannot see: notes.md\n\nA file Jev cannot see: log.txt");
  });

  it("never reads a file whose ref is not a file item's, whatever its name says", () => {
    const items = [file("notes.md", "../secrets.md"), file("notes.md", "files/notes.md")];
    const read = texts({ "../secrets.md": "leak", "files/notes.md": "leak" });
    expect(jevReply(items, read)).toBe("A file Jev cannot see: notes.md\n\nA file Jev cannot see: notes.md");
  });

  it("drops lines in a file that look like secrets, as examples do, a PEM block whole", () => {
    const body = [
      "Setup notes",
      "export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345",
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
      "-----END PRIVATE KEY-----",
      "password: hunter2",
      "Ran the tests.",
    ].join("\n");
    expect(jevReply([file("setup.md", "files/file-00000010.md")], texts({ "files/file-00000010.md": body }))).toBe(
      "File: setup.md\nSetup notes\nRan the tests.",
    );
  });

  it("keeps a long line in a file whole, and drops one with a secret anywhere along it", () => {
    const long = "word ".repeat(1000).trimEnd();
    const late = `${"word ".repeat(400)}token ghp_abcdefghijklmnopqrstuvwxyz0123456789 end`;
    const body = `${long}\n${late}\nlast`;
    expect(jevReply([file("long.md", "files/file-00000011.md")], texts({ "files/file-00000011.md": body }))).toBe(`File: long.md\n${long}\nlast`);
  });

  it("checks a long line in a file in one pass, however it is made", () => {
    const lines = [`${"a.".repeat(50_000)}x`, "b://".repeat(20_000), "password".repeat(25_000), `${"password:x".repeat(20_000)} y`];
    for (const line of lines) {
      const start = performance.now();
      jevReply([file("big.txt", "files/file-00000012.txt")], texts({ "files/file-00000012.txt": line }));
      expect(performance.now() - start).toBeLessThan(500);
    }
  });

  it("keeps a name or URL on its one line", () => {
    const items: ReplyItem[] = [
      { kind: "video", name: "demo\nFile: fake.md", ref: "video-1a2b3c4d.mp4" },
      { kind: "link", url: "https://x.dev/\u2028y" },
    ];
    expect(jevReply(items, texts({}))).toBe("A video Jev cannot see: demo File: fake.md\n\nA link Jev cannot open: https://x.dev/ y");
  });

  it("never leaves a lone surrogate, in text or in a file", () => {
    const items = [text("Broken \uD83D here"), file("a.txt", "files/file-00000013.txt")];
    const out = jevReply(items, texts({ "files/file-00000013.txt": `ok \uDE00 and 😀 ${"x".repeat(700)}😀` }));
    expect(LONE_SURROGATE.test(out)).toBe(false);
    expect(out).toContain("😀");
  });
});

describe("isTextFileRef", () => {
  it("reads .md, .markdown and .txt file items by their stored ref, as the stack shows them", () => {
    expect(isTextFileRef("files/file-0000000a.md")).toBe(true);
    expect(isTextFileRef("files/file-0000000a.markdown")).toBe(true);
    expect(isTextFileRef("files/file-0000000a.txt")).toBe(true);
    expect(isTextFileRef("files/file-0000000a.pdf")).toBe(false);
    expect(isTextFileRef("files/file-0000000a")).toBe(false);
    expect(isTextFileRef("notes.md")).toBe(false);
  });
});

describe("pendingTexts and textsIn", () => {
  it("lists the text files still loading, by path in the record's folder", () => {
    const dir = assessmentDir("claude", "eng", "cli");
    const byPath: FileTexts = (path) => (path === `${dir}/files/file-0000000a.md` ? "A" : undefined);
    const items: ReplyItem[] = [text("x"), file("a.md", "files/file-0000000a.md"), file("b.txt", "files/file-0000000b.txt"), file("c.pdf", "files/file-0000000c.pdf")];
    const record = { profileSlug: "claude", collectionSlug: "eng", credentialSlug: "cli" };
    expect(pendingTexts(items, textsIn(byPath, record))).toEqual(["files/file-0000000b.txt"]);
    expect(textsIn(byPath, record)("files/file-0000000a.md")).toBe("A");
  });
});
