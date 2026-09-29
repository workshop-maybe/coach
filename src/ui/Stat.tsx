// A figure, a bar filled to its share, and what it means under it.

import type { ReactNode } from "react";

export function Stat({ value, of, children }: { value: number; of: number; children: ReactNode }) {
  const share = of === 0 ? 0 : Math.min(1, value / of);
  return (
    <figure className="stat" aria-label={`${value} of ${of}`}>
      <div className="stat-value">
        {value} <span className="stat-of">of {of}</span>
      </div>
      <div className="stat-bar" aria-hidden="true">
        <div className="stat-fill" style={{ width: `${share * 100}%` }} />
      </div>
      <figcaption className="stat-meaning">{children}</figcaption>
    </figure>
  );
}
