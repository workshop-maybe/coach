// Pieces shared by the decks and the opened items: focus on mount, the copy helper, a part
// card, the not-found card, display names for a palette and a file, and Escape.

import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { PALETTES } from "../badge/palettes";
import { describeError } from "./useFolderState";

/** A stable ref callback that focuses a card's heading once, when it appears. */
export const focusOnMount = (el: HTMLElement | null) => el?.focus();

/** Runs the latest `handler` on Escape, unless something already handled the key. */
export function useEscape(handler: () => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) latest.current();
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

/** The card for a badge or agent that is no longer in the folder. */
export function Missing({ onHome }: { onHome(): void }) {
  return (
    <section className="deck" aria-label="Not found">
      <div className="deck-card">
        <h2 tabIndex={-1} ref={focusOnMount}>
          Not in the folder
        </h2>
        <p className="muted">It may have been moved or deleted outside the app.</p>
        <div className="deck-actions">
          <button type="button" className="ghost" onClick={onHome}>
            Home
          </button>
        </div>
      </div>
    </section>
  );
}

export function paletteName(slug: string | undefined | null): string {
  return PALETTES.find((p) => p.slug === slug)?.name ?? "Default colors";
}

export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
