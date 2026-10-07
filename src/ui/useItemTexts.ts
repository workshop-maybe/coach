// File texts read ahead for Jev (U6 of docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md,
// KTD8). Jev's reply string holds the text of a reply's Markdown and plain-text files, and the
// memos that build it are synchronous, so the texts are read before they are needed.
//
// The hook hands out a lookup by data-root path. Asking it for a path it has no answer for
// returns undefined ("still loading") and asks for that path; after the render, the hook reads
// every path asked for through the capped `readItemText` (1 MiB), and renders again with a new
// lookup once each lands. So whatever a memo looks up, whether the reply being judged or an
// earlier reply chosen as an example, is what gets read, and the memo runs again with it.
//
// A text read is kept per storage and path for the session: file items are content-addressed
// (`files/file-<hash8>.<ext>`), so a path's text never changes. A file that can't be read
// (missing, over the cap, not UTF-8) reads as null for this hook until `epoch` changes, then
// is read again, since a copy that had not landed yet, or a carry into a new folder, can make
// it readable later.

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { FileTexts } from "../domain/jevReply";
import type { Storage } from "../storage/storage";

/** Texts read, by storage and data-root path. Only texts: a miss is never kept here. */
const known = new WeakMap<Storage, Map<string, string>>();
/** Reads in flight, by storage and path, so two hooks asking for one path read it once. */
const reading = new WeakMap<Storage, Map<string, Promise<string | null>>>();

function mapOf<V>(store: WeakMap<Storage, Map<string, V>>, storage: Storage): Map<string, V> {
  let map = store.get(storage);
  if (!map) store.set(storage, (map = new Map()));
  return map;
}

/** One read of a path, shared while it is in flight. A text is kept; a miss is null. */
function readText(storage: Storage, path: string): Promise<string | null> {
  const inFlight = mapOf(reading, storage);
  let read = inFlight.get(path);
  if (!read) {
    read = storage
      .readItemText(path)
      .catch(() => null)
      .then((text) => {
        if (text !== null) mapOf(known, storage).set(path, text);
        inFlight.delete(path);
        return text;
      });
    inFlight.set(path, read);
  }
  return read;
}

/**
 * File texts by data-root path, read ahead (KTD8). The lookup's identity changes whenever a
 * text lands, so memos that depend on it build again. A miss is read again once `epoch`
 * changes, such as when a copy in flight lands or the folder reloads.
 */
export function useItemTexts(storage: Storage, epoch?: unknown): FileTexts {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  // Paths a lookup was asked for and has no answer for yet: the next effect reads them.
  const asked = useRef(new Set<string>());
  // Paths that could not be read this epoch.
  const missed = useRef(new Set<string>());

  const lookup = useCallback<FileTexts>(
    (path) => {
      const text = known.get(storage)?.get(path);
      if (text !== undefined) return text;
      if (missed.current.has(path)) return null;
      asked.current.add(path);
      return undefined;
    },
    // A new lookup on every landed text, and for a new storage or epoch.
    [storage, version, epoch], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // A new epoch forgets the misses, so they are asked for and read again.
  const lastEpoch = useRef(epoch);
  if (lastEpoch.current !== epoch) {
    lastEpoch.current = epoch;
    missed.current = new Set();
  }

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // After every render: read what the render's lookups asked for. A read outlives later
  // renders, since a memo that already asked may not ask again.
  useEffect(() => {
    if (asked.current.size === 0) return;
    const paths = [...asked.current];
    asked.current.clear();
    for (const path of paths) {
      const startedIn = missed.current;
      void readText(storage, path).then((text) => {
        if (!mounted.current) return;
        if (text === null) startedIn.add(path);
        bump();
      });
    }
  });

  return lookup;
}
