// @vitest-environment jsdom
// A box's images (KTD7): read through a cache cleared on every reload, saved beside the box's
// file with the checks and the notice, counted while in flight, and carried to a new folder.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryStorage } from "../storage/memory";
import { FolderProvider, useFolder } from "./useFolderState";
import { clearImageCache, imageSource } from "./imageSource";
import { useRichImages } from "./useRichImages";
import { pngFile } from "../test/paste";

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

describe("useRichImages", () => {
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
});
