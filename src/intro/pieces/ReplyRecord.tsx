// A record: a crisp square card with a header bar. Records carry facts, so they are
// never inked. With no text it is a reply's grey lines; with text it speaks in the mono.

import { memo, useMemo } from "react";

export interface ReplyRecordProps {
  w?: number;
  h?: number;
  /** Varies the grey lines between replies. */
  seed?: number;
  /** A word on the header bar. */
  title?: string;
  /** Rows of mono text in place of the grey lines. */
  text?: readonly string[];
}

const BAR = 14;

/** The grey lines' widths, 0-1, varied by seed. */
function rowsFor(seed: number): number[] {
  return [0.86, 0.7, 0.92, 0.58, 0.8].map((v, i) => v - ((seed * (i + 3)) % 7) / 40);
}

export const ReplyRecord = memo(function ReplyRecord({ w = 132, h = 96, seed = 1, title, text }: ReplyRecordProps) {
  const rows = useMemo(() => rowsFor(seed), [seed]);
  return (
    <g data-piece="record">
      <rect x={0} y={0} width={w} height={h} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
      <rect x={0} y={0} width={w} height={BAR} fill="var(--ink)" />
      <rect x={6} y={5} width={4} height={4} fill="var(--on-ink)" />
      {title && (
        <text x={16} y={10.5} fontFamily="var(--font-mono)" fontSize={8} letterSpacing="0.06em" fill="var(--on-ink)">
          {title}
        </text>
      )}
      {text
        ? text.map((t, i) => (
            <text key={i} x={10} y={BAR + 18 + i * 14} fontFamily="var(--font-mono)" fontSize={10.5} fill="var(--ink)">
              {t}
            </text>
          ))
        : rows.map((r, i) => <rect key={i} x={10} y={26 + i * 13} width={(w - 20) * r} height={4} fill="var(--ink-faint)" />)}
    </g>
  );
});
