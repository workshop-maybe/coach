// A formatting tool drawn as one of the machine's keys: a sketched square with an inked
// icon, filled with ink when the tool is on. Decorative; the button around it carries the name.

import { INK_FINE, sketchRect } from "./InkDefs";

export type ToolName =
  | "bold"
  | "italic"
  | "code"
  | "link"
  | "heading"
  | "bullets"
  | "numbers"
  | "tasks"
  | "quote"
  | "codeBlock"
  | "video";

/** Icon strokes in a 36 × 30 key, centered on (18, 15). */
const ICONS: Record<ToolName, string> = {
  bold: "M14 8.5V21.5M14 8.5H19A3.2 3.2 0 0 1 19 14.9H14M14 14.9H20A3.3 3.3 0 0 1 20 21.5H14",
  italic: "M16.5 21.5L20 8.5M13.5 21.5H19M17.5 8.5H23",
  code: "M14 10L10 15L14 20M22 10L26 15L22 20",
  link: "M16.5 17.5L14.5 19.5A3 3 0 0 1 10.3 15.3L13 12.6A3 3 0 0 1 17 12.4M19.5 12.5L21.5 10.5A3 3 0 0 1 25.7 14.7L23 17.4A3 3 0 0 1 19 17.6",
  heading: "M12.5 8.5V21.5M23.5 8.5V21.5M12.5 15H23.5",
  bullets: "M15.5 10H26M15.5 15H26M15.5 20H26M10.5 10H11.3M10.5 15H11.3M10.5 20H11.3",
  numbers: "M10 8.8L11.6 8V13M15.5 10H26M15.5 15H26M15.5 20H26M10 17.5A1.4 1.4 0 0 1 12.6 18C12.6 19 10 20.4 10 21.6H12.8",
  tasks: "M9.5 9.5H15V15H9.5ZM10.8 12.3L12.2 13.7L15.6 9.8M18.5 12.2H26.5M9.5 17.5H15V23H9.5ZM18.5 20.2H26.5",
  quote: "M14 10Q10.5 12 10.5 16V20H14.5V16H11.5M24 10Q20.5 12 20.5 16V20H24.5V16H21.5",
  codeBlock: `${sketchRect(11, 9, 14, 12, 1, 0.3)}M16.5 12L14.5 15L16.5 18M19.5 12L21.5 15L19.5 18`,
  // A wide frame, a screen, with the play triangle centered in it.
  video: `${sketchRect(9.5, 8.5, 17, 13, 1, 0.3)}M16.6 12.2L21.2 15L16.6 17.8Z`,
};

export function ToolKey({ tool, on }: { tool: ToolName; on: boolean }) {
  const dot = tool === "bullets";
  return (
    <svg className={`tool-key${on ? " tool-key-on" : ""}`} viewBox="0 0 36 30" width="36" height="30" aria-hidden="true" focusable="false">
      <g filter={INK_FINE}>
        {on && <rect className="tool-key-fill" x="3" y="3" width="30" height="24" />}
        <path className="tool-key-edge" d={sketchRect(3, 3, 30, 24, 1.6, 0.4)} />
        <path className="tool-key-icon" d={ICONS[tool]} strokeWidth={dot ? 2.2 : 2} />
      </g>
    </svg>
  );
}
