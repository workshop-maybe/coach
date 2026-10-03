// Pieces shared by the decks and the opened items: focus on mount, the copy helper, the
// target check's hint and line move, a part card, the not-found card, a result's verdict,
// display names for a palette and a file, and Escape.

import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { PALETTES } from "../badge/palettes";
import { checkTarget, type TargetMove } from "../domain/target-check";
import type { Assessment } from "../domain/types";
import { resultLabel } from "./format";
import { describeError } from "./useFolderState";

/** A stable ref callback that focuses a card's heading once, when it appears. */
export const focusOnMount = (el: HTMLElement | null) => el?.focus();

/** Runs the latest `handler` on Escape, unless something already handled the key. The handler gets the event, to look at its target or claim it. */
export function useEscape(handler: (e: KeyboardEvent) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) latest.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** A quiet helper that copies a prompt for the person to paste into any agent (R12). */
export function CopyHelper({ label, text }: { label: string; text(): string }) {
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "copied" } | { kind: "error"; message: string }>({ kind: "idle" });
  async function copy() {
    try {
      await writeText(text());
      setStatus({ kind: "copied" });
    } catch (e) {
      setStatus({ kind: "error", message: describeError(e) });
    }
  }
  return (
    <p className="helper">
      <button type="button" className="link" onClick={() => void copy()}>
        {label}
      </button>
      <span className="helper-status" role="status">
        {status.kind === "copied" ? "Copied. Paste it into any agent" : status.kind === "error" ? status.message : ""}
      </span>
    </p>
  );
}

/**
 * A quiet hint under a learning target. A list, a quantity or a how clause offers to move
 * to the rubric; two skills in one target are only asked about. Nothing here blocks.
 */
export function TargetHint({ text, onMove }: { text: string; onMove(move: TargetMove): void }) {
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const hit = checkTarget(text);
  if (hit?.kind === "move") {
    return (
      <p className="helper">
        <button
          type="button"
          className="link"
          onClick={() => {
            setMovedTo(hit.target);
            onMove(hit);
          }}
        >
          Move to the rubric
        </button>
        <span className="helper-status">{hit.rubricLine}</span>
      </p>
    );
  }
  if (hit?.kind === "ask") return <p className="helper helper-status">Two skills, or one workflow?</p>;
  if (movedTo !== null && movedTo === text.trim()) return <p className="helper helper-status" role="status">Moved to the rubric</p>;
  return null;
}

/** The move for a settled target, when the check finds detail in it. */
export function LineMove({ text, onMove }: { text: string; onMove(move: TargetMove): void }) {
  const hit = checkTarget(text);
  if (hit?.kind !== "move") return null;
  return (
    <button type="button" className="link" aria-label={`Move to the rubric: ${hit.rubricLine}`} onClick={() => onMove(hit)}>
      Move to the rubric
    </button>
  );
}

/** One part of a badge or an agent, as a small card that opens its edit. */
export function PartCard({ name, value, onOpen }: { name: string; value: string; onOpen(): void }) {
  return (
    <li>
      <button type="button" className="part" onClick={onOpen}>
        <span className="part-name">{name}</span>
        <span className="part-value">{value}</span>
      </button>
    </li>
  );
}

/** The card for a badge, agent or take that is no longer in the folder. `label` names where its button goes. */
export function Missing({ onHome, label = "Home" }: { onHome(): void; label?: string }) {
  return (
    <section className="deck" aria-label="Not found">
      <div className="deck-card">
        <h2 tabIndex={-1} ref={focusOnMount}>
          Not in the folder
        </h2>
        <p className="muted">It may have been moved or deleted outside the app.</p>
        <div className="deck-actions">
          <button type="button" className="ghost" onClick={onHome}>
            {label}
          </button>
        </div>
      </div>
    </section>
  );
}

/** A result's verdict in words, green when it met. */
export function Verdict({ result: a }: { result: Assessment }) {
  return <span className={`verdict verdict-${a.result}`}>{resultLabel(a.result)}</span>;
}

export function paletteName(slug: string | undefined | null): string {
  return PALETTES.find((p) => p.slug === slug)?.name ?? "Default colors";
}

export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
