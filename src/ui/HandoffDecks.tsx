// Writing handoffs (U7, R2, R3, R4, R5, R9, KTD10). The handoffs deck is the box for one
// badge: its keys drawn, one button per handoff that opens its edit, the default marked,
// and quiet ways to write a new one or edit the skeleton. The edit deck is one beat with a
// plain mono text field, since the rich text editor would rewrite Markdown and slot braces.
// A handoff with results is locked, so its edit adds a beat that saves it as a new one.
// Both decks take the test's detour pick; an edit opened from the test goes back to it
// with the id it saved, so the box lights the handoff the operator was working on.

import { useState } from "react";
import { HandoffBox } from "../cast/HandoffBox";
import { handoffKeys } from "../cast/mappings";
import { SKELETON_PATH, handoffPath, loadFolder } from "../domain/folder";
import { SKELETON_ID, SLOTS, checkHandoff, defaultHandoff, handoffsFor, isHandoffLocked, skeletonOf } from "../domain/handoffs";
import { HandoffProblemError, createHandoff, saveSkeleton, updateHandoff } from "../domain/operations";
import { credentialKey, parseCredentialKey, type Collection, type Credential, type FolderState } from "../domain/types";
import { Deck, type Beat } from "./Deck";
import { useNav } from "./nav";
import type { DeckRoute, HandoffTarget, TestPick } from "./routes";
import { Missing } from "./shared";
import { useFolder } from "./useFolderState";

/** The test this detour came from, lighting the handoff an edit saved (KTD10). */
export function backToTest(pick: TestPick, handoffId?: string): DeckRoute {
  const route: DeckRoute = { view: "deck", deck: "test" };
  if (pick.profileSlug !== undefined) route.profileSlug = pick.profileSlug;
  if (pick.credentialKey !== undefined) route.credentialKey = pick.credentialKey;
  const lit = handoffId ?? pick.handoffId;
  if (lit !== undefined) route.handoffId = lit;
  return route;
}

function badgeOf(state: FolderState | null, key: string): { credential: Credential; collection: Collection } | null {
  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const collection = state?.collections.find((c) => c.slug === credential?.collectionSlug);
  return credential && collection ? { credential, collection } : null;
}

// ---------------------------------------------------------------------------
// The box for one badge (R9)

export interface HandoffsDeckProps {
  credentialKey: string;
  returnTo?: TestPick;
}

export function HandoffsDeck({ credentialKey: key, returnTo }: HandoffsDeckProps) {
  const { state } = useFolder();
  const { navigate } = useNav();
  const badge = badgeOf(state, key);
  if (!state) return null;
  if (!badge) return <Missing onHome={() => navigate({ view: "home" })} />;

  const own = handoffsFor(state, key);
  const keys = handoffKeys(own.map((h) => h.id));
  const shown = defaultHandoff(state, key);
  const edit = (handoff: HandoffTarget) => navigate({ view: "deck", deck: "edit-handoff", credentialKey: key, handoff, ...(returnTo ? { returnTo } : {}) });
  const close = () => navigate(returnTo ? backToTest(returnTo) : { view: "item", item: "badge", credentialKey: key });

  const beat: Beat = {
    id: "box",
    title: "Handoffs",
    body: (
      <div className="handoffs">
        <HandoffBox badge={badge} keys={keys} lit={shown.id} screen={shown.text} className="handoffs-box" />
        {own.length === 0 ? (
          <p className="muted">This badge uses the skeleton</p>
        ) : (
          <ul className="choices handoff-choices" aria-label="Handoffs">
            {keys.slice(1).map((k) => (
              <li key={k.id}>
                <button type="button" className={`choice${k.id === shown.id ? " choice-default" : ""}`} onClick={() => edit(k.id)}>
                  <span className="choice-name">{k.id === shown.id ? `${k.label} · default` : k.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="helper">
          <button type="button" className="link" onClick={() => edit("new")}>
            Write a new handoff
          </button>
          <button type="button" className="link" onClick={() => edit(SKELETON_ID)}>
            Edit the skeleton
          </button>
        </p>
      </div>
    ),
  };

  return <Deck label={`Handoffs for ${badge.credential.name}`} beats={[beat]} onClose={close} onFinish={async () => {}} />;
}

// ---------------------------------------------------------------------------
// One handoff, a new one or the skeleton (R3, R4, R5)

export interface EditHandoffDeckProps {
  credentialKey: string;
  handoff: HandoffTarget;
  returnTo?: TestPick;
}

/** What the card edits, as the folder was when it opened. */
type Opened =
  | { kind: "skeleton"; title: string; text: string; base: string | null }
  | { kind: "new"; title: string; text: string }
  | { kind: "handoff"; title: string; id: string; text: string; base: string | null; locked: boolean };

function opening(state: FolderState, key: string, target: HandoffTarget): Opened | null {
  if (target === SKELETON_ID) return { kind: "skeleton", title: "The skeleton", text: skeletonOf(state).text, base: state.raw[SKELETON_PATH] ?? null };
  // A new handoff starts from the skeleton in force (R4).
  if (target === "new") return { kind: "new", title: "Write a handoff", text: skeletonOf(state).text };
  const own = handoffsFor(state, key);
  const i = own.findIndex((h) => h.id === target);
  if (i < 0) return null;
  const h = own[i];
  const label = handoffKeys(own.map((x) => x.id))[i + 1].label;
  return {
    kind: "handoff",
    title: `Handoff ${label}`,
    id: h.id,
    text: h.text,
    base: state.raw[handoffPath(h.collectionSlug, h.credentialSlug, h.id)] ?? null,
    locked: isHandoffLocked(state, key, h.id),
  };
}

export function EditHandoffDeck(props: EditHandoffDeckProps) {
  const { state } = useFolder();
  const { navigate } = useNav();
  const badge = badgeOf(state, props.credentialKey);
  if (!state) return null;
  const opened = badge ? opening(state, props.credentialKey, props.handoff) : null;
  if (!badge || !opened) return <Missing onHome={() => navigate({ view: "home" })} />;
  return <EditHandoff {...props} credential={badge.credential} atOpen={opened} />;
}

function EditHandoff({ credentialKey: key, returnTo, credential, atOpen }: EditHandoffDeckProps & { credential: Credential; atOpen: Opened }) {
  const { storage, state, apply, reload } = useFolder();
  const { navigate } = useNav();
  const { collectionSlug, slug } = parseCredentialKey(key);
  // The card edits what was on disk when it opened; saves are checked against that text.
  const [o] = useState(atOpen);
  const [text, setText] = useState(o.text);
  const locked = o.kind === "handoff" && o.locked;

  const box = () => navigate({ view: "deck", deck: "handoffs", credentialKey: key });
  const close = () => (returnTo ? navigate(backToTest(returnTo)) : box());

  async function finish({ keepMine }: { keepMine: boolean }) {
    const current = keepMine ? await loadFolder(storage) : state;
    if (!current) return;
    let saved: string;
    if (o.kind === "skeleton") {
      apply(await saveSkeleton(storage, text, keepMine ? (current.raw[SKELETON_PATH] ?? null) : o.base));
      saved = SKELETON_ID;
    } else if (o.kind === "new" || o.locked) {
      // A locked handoff keeps the text its results ran with; the edit becomes the newest (R5, R6).
      const made = await createHandoff(storage, current, collectionSlug, slug, text);
      apply(made.state);
      saved = made.id;
    } else {
      const base = keepMine ? (current.raw[handoffPath(collectionSlug, slug, o.id)] ?? null) : o.base;
      apply(await updateHandoff(storage, current, collectionSlug, slug, o.id, text, base));
      saved = o.id;
    }
    if (returnTo) navigate(backToTest(returnTo, saved));
    else box();
  }

  async function useTheirs() {
    await reload();
    close();
  }

  const beats: Beat[] = [
    {
      id: "text",
      title: o.title,
      forward: locked ? "Next" : "Save",
      // A new handoff may keep the skeleton as it is; an edit, or the skeleton, saves only once changed.
      valid: text.trim() !== "" && (o.kind === "new" || text !== o.text),
      // The save check runs here, so its error shows on this card even when a warning follows (KTD2, R7).
      onForward() {
        const problem = checkHandoff(text, o.kind === "skeleton" ? undefined : credential.rubric);
        if (problem) throw new HandoffProblemError(problem);
      },
      body: (
        <>
          <textarea className="handoff-text" aria-label="Handoff" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
          <p className="helper handoff-slots">
            Slots <code>{SLOTS.name}</code> <code>{SLOTS.learningTargets}</code> <code>{SLOTS.task}</code>
          </p>
        </>
      ),
    },
  ];
  if (locked) {
    beats.push({
      id: "locked",
      title: "This handoff has results",
      forward: "Save as a new handoff",
      body: <p>Its results keep the text that ran.</p>,
    });
  }

  return <Deck label={`Edit a handoff for ${credential.name}`} beats={beats} onClose={close} onFinish={finish} onUseTheirs={() => void useTheirs()} />;
}
