// One row of a scene's line, rising a word at a time and fading out as the scene ends.

import { WORD_RISE } from "../timeline";
import { ease, tween } from "./motion";

export interface RiseProps {
  text: string;
  /** Absolute frame each word starts to rise. */
  frames: readonly number[];
  frame: number;
  x: number;
  y: number;
  size: number;
  /** Absolute frames over which the row fades out. */
  fade?: readonly [number, number];
  /** Words, by index, lit in data blue. */
  strong?: readonly number[];
}

export function Rise({ text, frames, frame, x, y, size, fade, strong = [] }: RiseProps) {
  const gone = fade ? tween(frame, fade[0], fade[1], 0, 1, ease) : 0;
  return (
    <div
      data-text={text}
      style={{
        position: "absolute",
        left: x,
        top: y,
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        fontSize: size,
        letterSpacing: "var(--display-tracking)",
        lineHeight: 1.05,
        color: "var(--ink)",
        whiteSpace: "nowrap",
      }}
    >
      {text.split(" ").map((word, i) => {
        const rise = tween(frame, frames[i], frames[i] + WORD_RISE);
        return (
          <span key={i}>
            {i > 0 && " "}
            <span
              data-word=""
              style={{
                display: "inline-block",
                opacity: rise * (1 - gone),
                transform: `translateY(${(1 - rise) * 0.42}em)`,
                color: strong.includes(i) ? "var(--data)" : undefined,
              }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </div>
  );
}
