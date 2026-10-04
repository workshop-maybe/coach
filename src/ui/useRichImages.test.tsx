// @vitest-environment jsdom
// A box's images (KTD7): read through a cache cleared on every reload, saved beside the box's
// file with the checks and the notice, counted while in flight, and carried to a new folder.
// Its adds (U7 of the video plan) copy files into the same folder, tell the person once about
// every file refused, hold the beat while they run, and carry videos along as well.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryStorage } from "../storage/memory";
import { FolderProvider, useFolder } from "./useFolderState";
import { clearImageCache, imageSource, resultImages } from "./imageSource";
import { useRichImages } from "./useRichImages";
import { pngFile } from "../test/paste";
import { mkvBytes, mp4Bytes, webmBytes } from "../test/videoBytes";
import { FILE_NOT_APPROVED, ONLY_VIDEOS_AND_IMAGES, VIDEO_TOO_LARGE } from "../domain/videos";
import { refusalNotice } from "./useRichImages";

afterEach(cleanup);

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function wrapper(storage: MemoryStorage) {
  return ({ children }: { children: ReactNode }) => (
    <FolderProvider storage={storage} folder="/data">
      {children}
    </FolderProvider>
  );
}

/** The hook plus the folder's notice, over `storage`. */
function setup(storage: MemoryStorage, dir: string | null, text = "") {
  return renderHook(
    ({ dir, text }: { dir: string | null; text: string }) => ({ ...useRichImages(dir, text), notice: useFolder().notice }),
    { wrapper: wrapper(storage), initialProps: { dir, text } },
  );
}

describe("imageSource", () => {
  it("reads a bare name from its folder, once per reload", async () => {
    const storage = new MemoryStorage();
    storage.seedImage("agents/shot.png", PNG);
    const source = imageSource(storage, "agents");
    expect(imageSource(storage, "agents")).toBe(source);
    expect(await source.load("shot.png")).toBe(PNG);
    storage.remove("agents/shot.png");
    expect(await source.load("shot.png")).toBe(PNG);
    clearImageCache(storage);
    expect(await source.load("shot.png")).toBeNull();
  });

  it("keeps a missing file missing until the next reload, and answers a failed read with null", async () => {
    const storage = new MemoryStorage({ "agents/notes.png": "not an image" });
    const source = imageSource(storage, "agents");
    expect(await source.load("gone.png")).toBeNull();
    storage.seedImage("agents/gone.png", PNG);
    expect(await source.load("gone.png")).toBeNull();
    clearImageCache(storage);
    expect(await source.load("gone.png")).toBe(PNG);
    expect(await source.load("notes.png")).toBeNull();
  });
});

describe("imageSource, videos (KTD4)", () => {
  const DIR = "collections/eng/credentials";
  const PATH = `${DIR}/clip.mp4`;

  function seeded() {
    const storage = new MemoryStorage();
    storage.seedVideo(PATH, mp4Bytes());
    return storage;
  }

  /** Lets the source's deferred last release run. */
  const settle = () => Promise.resolve();

  it("hands one counted URL per path, and lets it go once the last holder does", async () => {
    const storage = seeded();
    const source = imageSource(storage, DIR);
    const a = await source.video!("clip.mp4");
    const b = await source.video!("clip.mp4");
    expect(a?.url).toBe(`blob:memory/${PATH}`);
    expect(b?.url).toBe(a?.url);
    expect(storage.videoUrls).toHaveLength(1);
    a!.release();
    a!.release();
    await settle();
    expect(storage.openVideoUrls()).toEqual([PATH]);
    b!.release();
    await settle();
    expect(storage.videoUrls).toEqual([{ path: PATH, releases: 1 }]);
    const c = await source.video!("clip.mp4");
    expect(storage.videoUrls).toHaveLength(2);
    c!.release();
    await settle();
    expect(storage.openVideoUrls()).toEqual([]);
  });

  it("asks storage once for two views that ask at the same time", async () => {
    const storage = seeded();
    const source = imageSource(storage, DIR);
    const [a, b] = await Promise.all([source.video!("clip.mp4"), source.video!("clip.mp4")]);
    expect(storage.videoUrls).toHaveLength(1);
    a!.release();
    b!.release();
    await settle();
    expect(storage.videoUrls).toEqual([{ path: PATH, releases: 1 }]);
  });

  it("keeps the URL for a view rebuilt in the same go, as ProseMirror rebuilds a node view", async () => {
    const storage = seeded();
    const source = imageSource(storage, DIR);
    const a = await source.video!("clip.mp4");
    a!.release();
    const b = await source.video!("clip.mp4");
    expect(b?.url).toBe(a?.url);
    expect(storage.videoUrls).toEqual([{ path: PATH, releases: 0 }]);
    b!.release();
    await settle();
    expect(storage.videoUrls).toEqual([{ path: PATH, releases: 1 }]);
  });

  it("decides preload from its folder: none for a reply's, metadata for the rest", async () => {
    const storage = new MemoryStorage();
    storage.seedVideo("assessments/opus/eng/review/clip.webm", webmBytes());
    storage.seedVideo("agents/clip.webm", webmBytes());
    storage.seedVideo(`${DIR}/clip.webm`, webmBytes());
    const reply = await resultImages(storage, { profileSlug: "opus", collectionSlug: "eng", credentialSlug: "review" }).video!("clip.webm");
    const notes = await imageSource(storage, "agents").video!("clip.webm");
    const task = await imageSource(storage, DIR).video!("clip.webm");
    expect([reply?.preload, notes?.preload, task?.preload]).toEqual(["none", "metadata", "metadata"]);
    expect(reply?.url).toBe("blob:memory/assessments/opus/eng/review/clip.webm");
  });

  it("keeps the URLs it holds through a reload of the folder", async () => {
    const storage = seeded();
    const source = imageSource(storage, DIR);
    const a = await source.video!("clip.mp4");
    clearImageCache(storage);
    const b = await source.video!("clip.mp4");
    expect(b?.url).toBe(a?.url);
    expect(storage.videoUrls).toEqual([{ path: PATH, releases: 0 }]);
  });

  it("never keeps a missing video missing, and answers a failed read with null", async () => {
    const storage = new MemoryStorage();
    const source = imageSource(storage, DIR);
    expect(await source.video!("clip.mp4")).toBeNull();
    storage.seedVideo(PATH, mp4Bytes());
    expect((await source.video!("clip.mp4"))?.url).toBe(`blob:memory/${PATH}`);
    const failing = new MemoryStorage();
    failing.videoUrl = () => Promise.reject(new Error("gone"));
    expect(await imageSource(failing, DIR).video!("clip.mp4")).toBeNull();
  });
});

describe("useRichImages", () => {
  it("answers videos from its folder, and none with no folder", async () => {
    const storage = new MemoryStorage();
    storage.seedVideo("agents/clip.mp4", mp4Bytes());
    const { result, rerender } = setup(storage, "agents");
    const video = await result.current.images.video!("clip.mp4");
    expect(video).toMatchObject({ url: "blob:memory/agents/clip.mp4", preload: "metadata" });
    video!.release();
    await Promise.resolve();
    expect(storage.openVideoUrls()).toEqual([]);
    rerender({ dir: null, text: "" });
    expect((await result.current.images.video?.("clip.mp4")) ?? null).toBeNull();
  });

  it("saves a pasted PNG beside the box's file and gives back its name", async () => {
    const storage = new MemoryStorage();
    const { result } = setup(storage, "collections/eng/credentials");
    let name = "";
    await act(async () => {
      name = await result.current.images.save!(pngFile());
    });
    expect(name).toMatch(/^image-[0-9a-f]{8}\.png$/);
    expect(storage.image(`collections/eng/credentials/${name}`)).toMatch(/^data:image\/png;base64,/);
    expect(await result.current.images.load(name)).toMatch(/^data:image\/png;base64,/);
  });

  it("shows a missing file once it is pasted, without waiting for a reload", async () => {
    const storage = new MemoryStorage();
    const { result } = setup(storage, "agents");
    const file = pngFile();
    const name = await new MemoryStorage().saveImage("data", "agents", new Uint8Array(await file.arrayBuffer()));
    const bare = name.slice("agents/".length);
    expect(await result.current.images.load(bare)).toBeNull();
    await act(async () => {
      await result.current.images.save!(file);
    });
    expect(await result.current.images.load(bare)).toMatch(/^data:image\/png;base64,/);
  });

  it("refuses another format or an image over 10 MB with one notice, and writes nothing", async () => {
    const storage = new MemoryStorage();
    const { result } = setup(storage, "agents");
    await act(async () => {
      await expect(result.current.images.save!(pngFile("a.gif", "image/gif"))).rejects.toThrow();
    });
    expect(result.current.notice).toBe("Only PNG and JPEG images can be pasted.");
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    await act(async () => {
      await expect(result.current.images.save!(big)).rejects.toThrow();
    });
    expect(result.current.notice).toBe("That image is larger than 10 MB.");
    expect(await storage.listFiles("data", "agents")).toEqual([]);
  });

  it("turns a failed write into the notice", async () => {
    const storage = new MemoryStorage();
    const { result } = setup(storage, "agents");
    const lie = new File([new TextEncoder().encode("not a png")], "x.png", { type: "image/png" });
    await act(async () => {
      await expect(result.current.images.save!(lie)).rejects.toThrow();
    });
    expect(result.current.notice).toBe("That file is not a JPEG or PNG image.");
  });

  it("is busy while a save is in flight", async () => {
    const storage = new MemoryStorage();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const save = storage.saveImage.bind(storage);
    storage.saveImage = async (...args) => {
      await gate;
      return save(...args);
    };
    const { result } = setup(storage, "agents");
    let done: Promise<string> = Promise.resolve("");
    act(() => {
      done = result.current.images.save!(pngFile());
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    await act(async () => {
      release();
      await done;
    });
    expect(result.current.busy).toBe(false);
  });

  it("carries the images it saved, and the text still names, into a new folder (R10)", async () => {
    const storage = new MemoryStorage();
    const { result, rerender } = setup(storage, "assessments/opus/eng/review");
    let name = "";
    await act(async () => {
      name = await result.current.images.save!(pngFile());
    });
    await act(async () => {
      rerender({ dir: "assessments/codex/eng/review", text: `Look: ![](${name})` });
    });
    await waitFor(() => expect(storage.image(`assessments/codex/eng/review/${name}`)).toMatch(/^data:image\/png;base64,/));
    expect(result.current.busy).toBe(false);
  });

  it("carries nothing the text no longer names, and never a ref it did not save", async () => {
    const storage = new MemoryStorage();
    storage.seedImage("assessments/opus/eng/review/hand.png", PNG);
    const { result, rerender } = setup(storage, "assessments/opus/eng/review");
    await act(async () => {
      await result.current.images.save!(pngFile());
    });
    await act(async () => {
      rerender({ dir: "assessments/codex/eng/review", text: "![](hand.png)" });
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(await storage.listFiles("data", "assessments/codex")).toEqual([]);
  });

  it("refuses to save with no folder", async () => {
    const { result } = setup(new MemoryStorage(), null);
    await act(async () => {
      await expect(result.current.images.save!(pngFile())).rejects.toThrow();
    });
  });

  it("has no add with no folder, so the box shows no Video key", () => {
    const { result } = setup(new MemoryStorage(), null);
    expect(result.current.images.add).toBeUndefined();
  });
});

describe("useRichImages, adding files (U7)", () => {
  const DIR = "collections/eng/credentials";

  it("copies picked files into its folder and gives back their bare names, in order", async () => {
    const storage = new MemoryStorage();
    const png = new Uint8Array(await pngFile().arrayBuffer());
    storage.queueAdd([
      { name: "clip.mp4", bytes: mp4Bytes() },
      { name: "shot.png", bytes: png },
    ]);
    const { result } = setup(storage, DIR);
    let names: string[] = [];
    await act(async () => {
      names = await result.current.images.add!({ kind: "pick" });
    });
    expect(storage.adds).toEqual([{ dir: DIR, from: { kind: "pick" } }]);
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^video-[0-9a-f]{8}\.mp4$/);
    expect(names[1]).toMatch(/^image-[0-9a-f]{8}\.png$/);
    expect(storage.video(`${DIR}/${names[0]}`)).toEqual(mp4Bytes());
    expect(await result.current.images.load(names[1])).toMatch(/^data:image\/png;base64,/);
    expect(result.current.notice).toBeNull();
  });

  it("shows a picture added by path at once, even one read as missing before", async () => {
    const storage = new MemoryStorage();
    const png = new Uint8Array(await pngFile().arrayBuffer());
    const bare = (await new MemoryStorage().saveImage("data", DIR, png)).slice(DIR.length + 1);
    const { result } = setup(storage, DIR);
    expect(await result.current.images.load(bare)).toBeNull();
    storage.queueAdd([{ name: "shot.png", bytes: png }]);
    await act(async () => {
      await result.current.images.add!({ kind: "drop", paths: ["/Users/me/shot.png"] });
    });
    expect(await result.current.images.load(bare)).toMatch(/^data:image\/png;base64,/);
  });

  it("gives back nothing and says nothing for a cancelled pick", async () => {
    const storage = new MemoryStorage();
    const { result } = setup(storage, DIR);
    let names: string[] = ["x"];
    await act(async () => {
      names = await result.current.images.add!({ kind: "pick" });
    });
    expect(names).toEqual([]);
    expect(result.current.notice).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("Covers R5. Names every refused file on one notice, and still gives back the rest", async () => {
    const storage = new MemoryStorage();
    storage.queueAdd([
      { name: "clip.mkv", bytes: mkvBytes() },
      { name: "clip.mp4", bytes: mp4Bytes() },
      { name: "notes.txt", bytes: new TextEncoder().encode("hello") },
      { name: "photo.heic", error: FILE_NOT_APPROVED },
    ]);
    const { result } = setup(storage, DIR);
    let names: string[] = [];
    await act(async () => {
      names = await result.current.images.add!({ kind: "drop", paths: ["/a/clip.mkv", "/a/clip.mp4", "/a/notes.txt", "/a/photo.heic"] });
    });
    expect(names).toEqual([expect.stringMatching(/^video-[0-9a-f]{8}\.mp4$/)]);
    expect(result.current.notice).toBe(
      "clip.mkv and notes.txt: Only MP4, MOV, M4V and WebM videos, and PNG and JPEG images, can be added. " +
        "photo.heic: That file can't be added. Drag it from Finder or use the Video key.",
    );
    expect(await storage.listFiles("data", DIR)).toEqual([`${DIR}/${names[0]}`]);
  });

  it("gives back nothing when every file is refused, having said why", async () => {
    const storage = new MemoryStorage();
    storage.queueAdd([{ name: "clip.mkv", bytes: mkvBytes() }]);
    const { result } = setup(storage, DIR);
    let names: string[] = ["x"];
    await act(async () => {
      names = await result.current.images.add!({ kind: "pick" });
    });
    expect(names).toEqual([]);
    expect(result.current.notice).toBe(`clip.mkv: ${ONLY_VIDEOS_AND_IMAGES}`);
  });

  it("turns an add that fails outright into one notice, and rejects", async () => {
    const storage = new MemoryStorage();
    storage.queueAdd(new Error("The folder is read-only."));
    const { result } = setup(storage, DIR);
    await act(async () => {
      await expect(result.current.images.add!({ kind: "pick" })).rejects.toThrow("The folder is read-only.");
    });
    expect(result.current.notice).toBe("The folder is read-only.");
    expect(result.current.busy).toBe(false);
  });

  it("Covers R7. Is busy while an add is in flight, and keeps the same images", async () => {
    const storage = new MemoryStorage();
    storage.queueAdd([{ name: "clip.mp4", bytes: mp4Bytes() }]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const addFiles = storage.addFiles.bind(storage);
    storage.addFiles = async (...args) => {
      await gate;
      return addFiles(...args);
    };
    const { result } = setup(storage, DIR);
    const images = result.current.images;
    let done: Promise<string[]> = Promise.resolve([]);
    act(() => {
      done = result.current.images.add!({ kind: "pick" });
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(result.current.images).toBe(images);
    await act(async () => {
      release();
      await done;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.images).toBe(images);
  });

  it("Covers R13. Carries the videos it added, and the text still names, into a new folder", async () => {
    const storage = new MemoryStorage();
    storage.queueAdd([
      { name: "a.mp4", bytes: mp4Bytes("a") },
      { name: "b.webm", bytes: webmBytes("b") },
    ]);
    const { result, rerender } = setup(storage, "assessments/opus/eng/review");
    let names: string[] = [];
    await act(async () => {
      names = await result.current.images.add!({ kind: "pick" });
    });
    const copy = vi.spyOn(storage, "copyVideo");
    await act(async () => {
      rerender({ dir: "assessments/codex/eng/review", text: `Look: ![](${names[0]})` });
    });
    await waitFor(() => expect(storage.video(`assessments/codex/eng/review/${names[0]}`)).toEqual(mp4Bytes("a")));
    expect(copy).toHaveBeenCalledWith(`assessments/opus/eng/review/${names[0]}`, "data", "assessments/codex/eng/review");
    expect(await storage.listFiles("data", "assessments/codex")).toEqual([`assessments/codex/eng/review/${names[0]}`]);
    expect(result.current.busy).toBe(false);
    // Carried again from where it now is, should the folder change once more.
    await act(async () => {
      rerender({ dir: "assessments/gemini/eng/review", text: `Look: ![](${names[0]})` });
    });
    await waitFor(() => expect(copy).toHaveBeenLastCalledWith(`assessments/codex/eng/review/${names[0]}`, "data", "assessments/gemini/eng/review"));
  });

  it("turns a carry that fails into the notice", async () => {
    const storage = new MemoryStorage();
    storage.queueAdd([{ name: "a.mp4", bytes: mp4Bytes() }]);
    const { result, rerender } = setup(storage, "assessments/opus/eng/review");
    let names: string[] = [];
    await act(async () => {
      names = await result.current.images.add!({ kind: "pick" });
    });
    storage.copyVideo = () => Promise.reject(new Error("The folder is read-only."));
    await act(async () => {
      rerender({ dir: "assessments/codex/eng/review", text: `![](${names[0]})` });
    });
    await waitFor(() => expect(result.current.notice).toBe("The folder is read-only."));
    expect(result.current.busy).toBe(false);
  });
});

describe("refusalNotice", () => {
  const refused = (name: string, error: string | null) => ({ name, path: null, error });

  it("names one file before its reason", () => {
    expect(refusalNotice([refused("big.mp4", VIDEO_TOO_LARGE)])).toBe("big.mp4: That video is larger than 100 MB.");
  });

  it("names the files that share a reason together, in order", () => {
    expect(refusalNotice([refused("a.mkv", ONLY_VIDEOS_AND_IMAGES), refused("b.avi", ONLY_VIDEOS_AND_IMAGES), refused("c.txt", ONLY_VIDEOS_AND_IMAGES)])).toBe(
      `a.mkv, b.avi and c.txt: ${ONLY_VIDEOS_AND_IMAGES}`,
    );
    expect(refusalNotice([refused("big.mp4", VIDEO_TOO_LARGE), refused("a.mkv", ONLY_VIDEOS_AND_IMAGES), refused("huge.mov", VIDEO_TOO_LARGE)])).toBe(
      `big.mp4 and huge.mov: ${VIDEO_TOO_LARGE} a.mkv: ${ONLY_VIDEOS_AND_IMAGES}`,
    );
  });

  it("never prints a missing reason as null", () => {
    expect(refusalNotice([refused("odd.mp4", null)])).toBe("odd.mp4: It could not be added.");
  });
});
