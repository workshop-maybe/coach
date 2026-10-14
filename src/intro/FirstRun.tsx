// The first run (KTD5 of the first-run intro plan): a title card, the film on the board,
// the play beat on the sheet, then the folder gate. It sits in `FolderGate`'s branch for a
// folder never remembered, below the gate bar, so the window moves and closes through the
// whole intro. The newcomer's line is held in local storage from the play beat until the
// badge is saved in the folder they choose (KTD6, R20).

import { useEffect, useState } from "react";
import type { ClipboardEvent, CSSProperties, ReactNode } from "react";
import { Deck } from "../ui/Deck";
import { Sheet } from "../ui/Sheet";
import { badgeName, flattenWhitespace, LINE_MAX, normalizeLine } from "./badgeName";
import { clearHeldLine, writeHeldLine } from "./heldLine";
import { FilmStage, IntroStrip, TitleCard } from "./IntroParts";
import { useIntroFilm } from "./useIntroFilm";
import { INTRO_HEIGHT, INTRO_WIDTH, TEXT } from "./scenes/stage";
import "./intro.css";

type Step = "title" | "film" | "play" | "gate";

export interface FirstRunProps {
  /** Today's ask for a folder. `held` is true when a line waits to be saved as a badge there. */
  gate(held: boolean): ReactNode;
}

/** Where the film's text ends, so the play beat's sheet stops below the last scene's line. */
const FILM_GEOMETRY = {
  "--film-w": INTRO_WIDTH,
  "--film-h": INTRO_HEIGHT,
  "--film-text-end": TEXT.rows[TEXT.rows.length - 1] + TEXT.size * 1.6,
} as CSSProperties;

export function FirstRun({ gate }: FirstRunProps) {
  const [after, setAfter] = useState<"play" | "gate" | null>(null);
  const [line, setLine] = useState("");
  const [held, setHeld] = useState(false);
  const { phase, ready, begin, stage, filmProps, stripProps, start, skip } = useIntroFilm({
    listening: after === null,
    onEnd: () => setAfter((a) => a ?? "play"),
    onSkip: () => {
      setLine("");
      setAfter("gate");
    },
  });
  const step: Step = after ?? phase;

  // With no folder remembered, a held line can only be from a run quit before a folder was
  // chosen, and R20 plays that run again from the start.
  useEffect(() => clearHeldLine(), []);

  if (step === "gate") return <>{gate(held)}</>;

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    e.preventDefault();
    const el = e.currentTarget;
    const from = el.selectionStart ?? line.length;
    const to = el.selectionEnd ?? from;
    setLine((line.slice(0, from) + flattenWhitespace(text) + line.slice(to)).slice(0, LINE_MAX));
  }

  async function makeBadge() {
    const kept = normalizeLine(line);
    setHeld(writeHeldLine({ line: kept, name: badgeName(kept) }));
    setLine("");
    setAfter("gate");
  }

  function closeCard() {
    clearHeldLine();
    setHeld(false);
    setLine("");
    setAfter("gate");
  }

  const playing = step === "title" || step === "film";

  return (
    <div className="intro-stage" data-step={step} style={FILM_GEOMETRY}>
      <FilmStage stage={stage} hidden={step === "title"} filming={step === "film"} film={filmProps} label="Intro" />

      {step === "title" && <TitleCard ready={ready} begin={begin} onBegin={start} onSkip={skip} />}

      {step === "play" && (
        <div className="intro-sheet">
          <Sheet>
            <Deck
              label="Your first badge"
              beats={[
                {
                  id: "line",
                  title: "What would a good result look like",
                  body: (
                    <>
                      <p className="muted">Pick one thing you hand to an agent. Say what it has to do for you to call it good.</p>
                      <input
                        type="text"
                        aria-label="What good looks like"
                        placeholder="It finds the bug and names the line that causes it"
                        maxLength={LINE_MAX}
                        value={line}
                        onChange={(e) => setLine(e.target.value)}
                        onPaste={onPaste}
                      />
                    </>
                  ),
                  forward: "Make it a badge",
                  valid: normalizeLine(line) !== "",
                  focusBody: true,
                },
              ]}
              onClose={closeCard}
              onFinish={makeBadge}
            />
          </Sheet>
        </div>
      )}

      {playing && (
        <IntroStrip filming={step === "film"} {...stripProps} />
      )}
    </div>
  );
}
