// Dev-only Remotion entry (KTD15): registers the intro composition so the Remotion CLI
// can render the trailer. The app never imports this file.

import { Composition, registerRoot } from "remotion";
import { INTRO_HEIGHT, INTRO_WIDTH, Intro } from "../Intro";
import { FPS, TOTAL_FRAMES } from "../timeline";

const Root = () => (
  <Composition
    id="Intro"
    component={Intro}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={INTRO_WIDTH}
    height={INTRO_HEIGHT}
  />
);

registerRoot(Root);
