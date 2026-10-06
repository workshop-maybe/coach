// Add a collection (collections plan U4, R7-R11): the first card offers an empty one and each
// built-in, drawn as a cartridge of its first badge. An added built-in is marked and does
// nothing. A copy whose add stopped partway is offered again, and its card finishes the copy
// (KTD2). The empty path asks a name. A quiet "Request a collection" link sits at the first
// card's foot once a public repo is set (KTD9), and opens in the browser.

import { useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BUILT_INS, type BuiltIn } from "../domain/builtins";
import { parseCredentialMd } from "../domain/credential-md";
import { loadFolder } from "../domain/folder";
import { addBuiltinCollection, builtinStatus, createCollection } from "../domain/operations";
import type { Credential, Slug } from "../domain/types";
import { Cartridge } from "../cast/Cartridge";
import { Outline } from "../cast/Outline";
import { COLLECTION_REQUESTS_REPO, collectionRequestUrl } from "./collectionRequest";
import { Deck, type Beat } from "./Deck";
import { useNav } from "./nav";
import { useFolder } from "./useFolderState";

/** The first card's answer: an empty one, or a built-in's slug. */
const EMPTY = "empty";

/** A built-in's badges as the cartridges and names show them, in its order. */
function badgesOf(builtin: BuiltIn): Credential[] {
  return builtin.collection.order
    .filter((s) => builtin.credentials[s] !== undefined)
    .map((s) => parseCredentialMd(builtin.credentials[s], { slug: s, collectionSlug: builtin.slug }));
}

/** The request page, for the system browser only: the webview never follows, offers or drags the link. */
function RequestLink({ repo }: { repo: string }) {
  const url = collectionRequestUrl(repo);
  const open = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    openUrl(url).catch(() => undefined);
  };
  const stop = (e: ReactMouseEvent<HTMLAnchorElement> | ReactDragEvent<HTMLAnchorElement>) => e.preventDefault();
  return (
    <p className="collection-request">
      <a href={url} draggable={false} onClick={open} onAuxClick={(e) => (e.button === 1 ? open(e) : stop(e))} onContextMenu={stop} onDragStart={stop}>
        Request a collection
      </a>
    </p>
  );
}

export function CollectionDeck() {
  const { storage, state, apply } = useFolder();
  const { navigate } = useNav();
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState("");
  // Set once the empty collection exists, so a retry after a failed reload never makes a second.
  const made = useRef<Slug | null>(null);

  const picked = BUILT_INS.find((b) => b.slug === start);
  const home = () => navigate({ view: "home" });

  // Home lights the new collection's group.
  async function finish({ keepMine }: { keepMine: boolean }) {
    if (!state) return;
    const current = keepMine ? await loadFolder(storage) : state;
    if (picked) {
      // Adding again resumes a copy that stopped partway, so a retry never makes a second.
      const result = await addBuiltinCollection(storage, current, picked.slug);
      apply(result.state);
      return navigate({ view: "home", litCollection: result.slug });
    }
    if (made.current === null) {
      const result = await createCollection(storage, current, name);
      made.current = result.slug;
      apply(result.state);
    }
    navigate({ view: "home", litCollection: made.current });
  }

  const repo = COLLECTION_REQUESTS_REPO;
  const first: Beat = {
    id: "start",
    title: "Add a collection",
    body: ({ advance }) => (
      <>
        <ul className="choices choices-badges">
          <li>
            <button
              type="button"
              className="choice choice-door"
              aria-pressed={start === EMPTY}
              onClick={() => {
                setStart(EMPTY);
                advance();
              }}
            >
              <Outline kind="cartridge" width={40} />
              <span className="choice-name">Start an empty one</span>
            </button>
          </li>
          {BUILT_INS.map((b) => {
            const added = state !== null && builtinStatus(state, b).kind === "added";
            const cover = badgesOf(b)[0];
            return (
              <li key={b.slug}>
                <button
                  type="button"
                  className={added ? "choice choice-added" : "choice"}
                  aria-pressed={start === b.slug}
                  aria-disabled={added || undefined}
                  onClick={() => {
                    if (added) return;
                    setStart(b.slug);
                    advance();
                  }}
                >
                  {cover ? <Cartridge collection={b.collection} credential={cover} width={48} /> : <Outline kind="cartridge" width={40} />}
                  <span className="choice-name">{b.collection.name}</span>
                  {added && <span className="choice-note">Added</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {repo !== null && <RequestLink repo={repo} />}
      </>
    ),
  };

  const beats: Beat[] = picked
    ? [
        first,
        {
          id: "built-in",
          title: picked.collection.name,
          forward: "Add the collection",
          body: (
            <>
              {picked.collection.description && <p>{picked.collection.description}</p>}
              <ol className="preset-targets" aria-label="Badges">
                {badgesOf(picked).map((c) => (
                  <li key={c.slug}>{c.name}</li>
                ))}
              </ol>
            </>
          ),
        },
      ]
    : start === EMPTY
      ? [
          first,
          {
            id: "name",
            title: "What is it called",
            forward: "Make the collection",
            valid: name.trim() !== "",
            body: <input aria-label="Name" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />,
          },
        ]
      : [first];

  return <Deck label="Add a collection" beats={beats} onClose={home} onFinish={finish} />;
}
