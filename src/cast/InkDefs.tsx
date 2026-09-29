// The shared hand-inked line (KTD1): one displacement filter at two strengths, mounted
// once in the app shell. Fixed seeds, so the wobble never shimmers between renders.
// Cast pieces put `filter` on their root group and on each moving part's own group,
// never on a lone line or on badge art.

/** The wobble for full-size pieces. */
export const INK = "url(#cast-ink)";
/** A finer wobble for small pieces (mini machines), so they stay legible. */
export const INK_FINE = "url(#cast-ink-fine)";

export function InkDefs() {
  return (
    <svg className="ink-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {/* Padded well past the bounding box, which leaves out the stroke and the displacement. */}
        <filter id="cast-ink" x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.032" numOctaves="2" seed="11" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="cast-ink-fine" x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="11" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * A rectangle as a sketch draws it: four strokes that run a little past each corner,
 * each with a slight fixed lean. `over` is how far past the corner a stroke runs.
 */
export function sketchRect(x: number, y: number, w: number, h: number, over = 2.5, lean = 0.5): string {
  const r = x + w;
  const b = y + h;
  const o = over;
  const l = lean;
  return [
    `M${x - o} ${y + l}L${r + o * 0.6} ${y - l * 0.4}`,
    `M${r - l * 0.3} ${y - o * 0.7}L${r + l} ${b + o * 0.5}`,
    `M${r + o * 0.5} ${b + l * 0.2}L${x - o * 0.8} ${b - l * 0.6}`,
    `M${x + l * 0.4} ${b + o * 0.6}L${x - l * 0.2} ${y - o}`,
  ].join("");
}
