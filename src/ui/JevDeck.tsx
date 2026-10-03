// Jev Mode, from the top bar (U3, KTD6). One beat whose single forward action follows Jev
// Mode's state: with no key, or on with its key gone, the key field and "Turn on Jev Mode";
// with a key, "Turn on Jev Mode" or "Turn off Jev Mode", with quiet ways to use a new key
// or remove it. "Use a new key" swaps the beat for the key field, whose one forward action
// replaces the key and leaves the switch as it was; Back returns to the state before.
// Every change returns home. A failure keeps the deck open with one line saying so.
//
// The deck says what leaves the machine (R5): it names TypeSafe, what each use sends, and
// that TypeSafe keeps what it receives under its terms, which open in the system browser.
// The key field is masked, with autocomplete and spellcheck off. The key leaves React state
// the moment it is sent and when the deck closes, and is never shown again, only its hint.

import { useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toJevError, type JevStatus } from "../jev/jev";
import { Deck, type Beat } from "./Deck";
import { useJev } from "./jevContext";
import { useNav } from "./nav";

/** TypeSafe's terms, which govern what it keeps of what it receives. */
export const TYPESAFE_TERMS = "https://docs.typesafe.ai/legal";

const KEY_GONE = "The key is gone. Paste it again.";

/** One line for a change that failed. The native side changes nothing on these (KTD3). */
function failureLine(e: unknown): string {
  switch (toJevError(e).kind) {
    case "invalidKey":
      return "That doesn't look like a TypeSafe key.";
    case "keychain":
      return "The keychain didn't allow it, so nothing changed.";
    case "settings":
      return "The app's settings couldn't be read, so nothing changed.";
    case "keyMissing":
      return KEY_GONE;
    default:
      return "That didn't work. Try again.";
  }
}

function openTerms(e: ReactMouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  openUrl(TYPESAFE_TERMS).catch(() => undefined);
}

/** The terms, for the system browser only: the webview never follows, offers or drags the link. */
function TermsLink() {
  const stop = (e: ReactMouseEvent<HTMLAnchorElement> | ReactDragEvent<HTMLAnchorElement>) => e.preventDefault();
  return (
    <a
      href={TYPESAFE_TERMS}
      draggable={false}
      onClick={openTerms}
      onAuxClick={(e) => (e.button === 1 ? openTerms(e) : stop(e))}
      onContextMenu={stop}
      onDragStart={stop}
    >
      its terms
    </a>
  );
}

/** What leaves the machine, and when (R5). It promises no more than that. */
function About() {
  return (
    <div className="jev-about">
      <p>Jev Mode asks TypeSafe's Jev model, with your own key. Nothing is sent until you ask.</p>
      <ul>
        <li>A second opinion sends the reply, the badge's task and its rubric.</li>
        <li>A cleanup sends only the text you pasted.</li>
      </ul>
      <p>
        TypeSafe keeps what it receives under <TermsLink />.
      </p>
    </div>
  );
}

export function JevDeck() {
  const jev = useJev();
  const { navigate } = useNav();
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Until status is read, the state, and so the forward action, is unknown.
  if (jev.phase === "loading") return null;
  const { status } = jev;
  const home = () => navigate({ view: "home" });

  /**
   * Runs one change: home when it lands, or one line and the deck as it was when it fails.
   * A key the app can hold only for this session keeps the deck open, so its line is read.
   */
  async function change(run: () => Promise<unknown>) {
    setLine(null);
    setWorking(true);
    try {
      const next = await run();
      if ((next as JevStatus | undefined)?.storage === "session") {
        setReplacing(false);
        setWorking(false);
        return;
      }
      home();
    } catch (e) {
      setLine(failureLine(e));
      setWorking(false);
    }
  }

  /** The key as sent. It leaves state before anything is awaited, so no failure keeps it. */
  function takeKey(): string {
    const key = draft.trim();
    setDraft("");
    return key;
  }

  function swap(to: boolean) {
    setDraft("");
    setLine(null);
    setReplacing(to);
  }

  const failure = line && (
    <p className="deck-error" role="alert">
      {line}
    </p>
  );
  const keyField = (
    <input
      type="password"
      aria-label="TypeSafe API key"
      value={draft}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      // A key copied from a terminal can carry a newline; it is no part of the key.
      onChange={(e) => setDraft(e.target.value.replace(/[\r\n]/g, ""))}
    />
  );
  const hasDraft = draft.trim() !== "" && !working;

  const view = !status.hasKey ? "key" : replacing ? "replace" : "status";
  let beat: Beat;
  let finish: () => Promise<void>;
  switch (view) {
    case "key":
      // Off with no key, or on with its key gone (removed from the keychain, or a session key after a restart).
      beat = {
        id: "key",
        title: "Your TypeSafe key",
        forward: "Turn on Jev Mode",
        valid: hasDraft,
        focusBody: true,
        body: (
          <div className="jev">
            {status.on && <p className="muted">{KEY_GONE}</p>}
            {keyField}
            {failure}
            <About />
          </div>
        ),
      };
      // Setting a key turns Jev Mode on (KTD3).
      finish = () => change(() => jev.setKey(takeKey()));
      break;
    case "replace": {
      const wasOn = status.on;
      beat = {
        id: "replace",
        title: "A new key",
        forward: "Replace the key",
        valid: hasDraft,
        focusBody: true,
        body: (
          <div className="jev">
            {keyField}
            {failure}
          </div>
        ),
      };
      finish = () =>
        change(async () => {
          const next = await jev.setKey(takeKey());
          // Setting a key turns Jev Mode on; replacing one leaves the switch as it was (KTD6).
          return wasOn ? next : jev.setOn(false);
        });
      break;
    }
    case "status": {
      const on = status.on;
      beat = {
        id: "status",
        title: on ? "Jev Mode is on" : "Jev Mode is off",
        forward: on ? "Turn off Jev Mode" : "Turn on Jev Mode",
        valid: !working,
        body: (
          <div className="jev">
            <p>{status.hint ? `Your key ends in ${status.hint}.` : "Your key is saved."}</p>
            {status.storage === "session" && <p className="muted">There's no keychain to hold it, so it won't be remembered after you quit.</p>}
            <p className="helper">
              <button type="button" className="link" onClick={() => swap(true)} disabled={working}>
                Use a new key
              </button>
              <button type="button" className="link" onClick={() => void change(() => jev.clearKey())} disabled={working}>
                Remove the key
              </button>
            </p>
            {failure}
            <About />
          </div>
        ),
      };
      // Turning off keeps the key, so turning on again asks for none.
      finish = () => change(() => jev.setOn(!on));
      break;
    }
  }

  // The swap is its own deck, so arriving puts focus in the field, and its way out (Back,
  // Escape or the corner control) is back to the state before rather than home.
  return (
    <Deck
      key={view === "replace" ? "replace" : "main"}
      label="Jev Mode"
      beats={[beat]}
      onClose={view === "replace" ? () => swap(false) : home}
      onFinish={finish}
    />
  );
}
