// The screenshot harness page's entry (U3, KTD6, R19): shots.html loads this. It takes the
// app's fonts and styles as src/main.tsx and src/App.tsx do, squares the window's corners
// before anything paints, and renders the shot named by ?shot= (src/shots/harness.tsx).
// Dev only: `vite build` builds index.html alone, so this never reaches the app bundle.

import "@fontsource-variable/inter";
import "@fontsource/fragment-mono";
import "../theme/tokens.css";
import "../theme/app-tokens.css";
import "../App.css";
import "../cast/cast.css";
import { startShot } from "./harness";

document.documentElement.setAttribute("data-window", "maximized");
void startShot(document.getElementById("root") as HTMLElement, window.location.search);
