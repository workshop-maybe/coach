import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real convertFileSrc reads window.__TAURI_INTERNALS__, which only the webview has. This
// one builds the macOS and Linux form of the URL, as the contract gives it.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${encodeURIComponent(path)}`,
}));

import { invoke } from "@tauri-apps/api/core";
import { TauriStorage } from "./tauri";

const PATH = "collections/c/credentials/video-1a2b3c4d.mp4";
const SCHEME_URL = "media://localhost/collections%2Fc%2Fcredentials%2Fvideo-1a2b3c4d.mp4";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(invoke).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TauriStorage commands (IPC contract)", () => {
  it("sends add_files the folder and where the files come from", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([{ name: "a.mp4", path: "agents/video-1a2b3c4d.mp4", error: null }]);
    const from = { kind: "paste" as const, files: [{ name: "a.mp4", size: 12 }] };
    expect(await new TauriStorage("mac").addFiles("agents", from)).toEqual([{ name: "a.mp4", path: "agents/video-1a2b3c4d.mp4", error: null }]);
    expect(invoke).toHaveBeenCalledWith("add_files", { dir: "agents", from });
  });

  it("sends copy_video the source path, the target root and the target folder", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("c/101/assets/video-1a2b3c4d.mp4");
    expect(await new TauriStorage("mac").copyVideo(PATH, "export", "c/101/assets")).toBe("c/101/assets/video-1a2b3c4d.mp4");
    expect(invoke).toHaveBeenCalledWith("copy_video", { from: PATH, toRoot: "export", toDir: "c/101/assets" });
  });
});

describe("TauriStorage.videoUrl on macOS and Windows (KTD4)", () => {
  it("reads the platform from a Mac user agent, asks with HEAD, and resolves null on a 404", async () => {
    vi.stubGlobal("navigator", { userAgent: MAC_UA });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await new TauriStorage().videoUrl(PATH)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(SCHEME_URL, { method: "HEAD" });
  });

  it("returns the scheme URL itself on a 200, with a release that does nothing", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const got = await new TauriStorage("mac").videoUrl(PATH);
    expect(got?.url).toBe(SCHEME_URL);
    got!.release();
    expect(revoke).not.toHaveBeenCalled();
  });

  // A fetch problem must never blank every video; the <video> error path shows the placeholder.
  it("fails open: a 500, a 413 or a fetch that throws still returns the scheme URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 413 }));
    fetchMock.mockRejectedValueOnce(new TypeError("Load failed"));
    const storage = new TauriStorage("mac");
    for (let i = 0; i < 3; i++) expect((await storage.videoUrl(PATH))?.url).toBe(SCHEME_URL);
  });

  it("asks the same way on Windows", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 206 }));
    const storage = new TauriStorage("windows");
    expect(await storage.videoUrl(PATH)).toBeNull();
    expect((await storage.videoUrl(PATH))?.url).toBe(SCHEME_URL);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "HEAD")).toBe(true);
  });
});

describe("TauriStorage.videoUrl on Linux (KTD4)", () => {
  it("fetches the whole file into a blob, and its release revokes that object URL", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "video/mp4" } }));
    const got = await new TauriStorage("linux").videoUrl(PATH);
    expect(fetchMock).toHaveBeenCalledWith(SCHEME_URL);
    expect(got?.url).toMatch(/^blob:/);
    got!.release();
    expect(revoke).toHaveBeenCalledWith(got!.url);
  });

  it("reads a Linux user agent as Linux", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)" });
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }));
    expect((await new TauriStorage().videoUrl(PATH))?.url).toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledWith(SCHEME_URL);
  });

  // With no URL to fall back on, a failure shows the placeholder.
  it("resolves null on a 404, any other failed status, or a fetch that throws", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 413 }));
    fetchMock.mockRejectedValueOnce(new TypeError("Load failed"));
    const storage = new TauriStorage("linux");
    for (let i = 0; i < 3; i++) expect(await storage.videoUrl(PATH)).toBeNull();
  });
});
