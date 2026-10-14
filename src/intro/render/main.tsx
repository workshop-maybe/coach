// The trailer render's page script (KTD15): the intro at INTRO_WIDTH × INTRO_HEIGHT, one frame
// at a time. Once it has mounted, <html> carries `data-ready`, and `window.__introFrame(n)` draws frame n and resolves once it is painted, with the
// fonts loaded, so scripts/intro-render.mjs can capture it.

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useEffect, useState } from "react";
import { Intro, INTRO_HEIGHT, INTRO_WIDTH } from "../Intro";

declare global {
  interface Window {
    __introFrame?: (frame: number) => Promise<void>;
  }
}

let show: (frame: number) => void = () => undefined;

function Page() {
  const [frame, setFrame] = useState(0);
  show = setFrame;
  useEffect(() => document.documentElement.setAttribute("data-ready", ""), []);
  return (
    <div style={{ position: "relative", width: INTRO_WIDTH, height: INTRO_HEIGHT, overflow: "hidden" }}>
      <Intro frame={frame} />
    </div>
  );
}

const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

createRoot(document.getElementById("root")!).render(<Page />);

window.__introFrame = async (frame: number) => {
  flushSync(() => show(frame));
  await document.fonts.ready;
  await painted();
};
