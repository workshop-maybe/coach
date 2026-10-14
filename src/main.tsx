import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/fragment-mono";
import "./theme/tokens.css";
import "./theme/app-tokens.css";
import App from "./App";

// Dev only: #intro plays the intro film in place of the app, until the first run shows it (U4).
const DevIntro = import.meta.env.DEV && location.hash.startsWith("#intro") ? React.lazy(() => import("./intro/DevPreview")) : null;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {DevIntro ? (
      <React.Suspense fallback={null}>
        <DevIntro />
      </React.Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
