// The intro film on the board (KTD2, KTD5). The Player and the composition load only here,
// through React.lazy, so a launch with a remembered folder never fetches either. The film
// fits inside the board without cropping, shows no controls, and holds its last frame when
// it ends, so the play beat's sheet arrives over it.

import { Component, lazy, Suspense } from "react";
import type { ReactNode, SyntheticEvent } from "react";

/** What the first run can do with a loaded film. */
export interface FilmApi {
  /** Starts the film. Pass the key's own event, so a webview that wants a gesture for sound gets one (KTD8). */
  play(e: SyntheticEvent): void;
  setMuted(muted: boolean): void;
}

export interface FilmProps {
  /** Under reduced motion the film never plays: it holds still `still` and is silent (R13). */
  reducedMotion: boolean;
  /** The remembered mute, read when the film loads (R21). */
  muted: boolean;
  /** The scene whose still shows, under reduced motion. */
  still: number;
  /** The Player has mounted and can play. */
  onReady(api: FilmApi): void;
  /** The film reached its last frame and holds it. */
  onEnded(): void;
  /** The frame playing, as it changes. */
  onFrame(frame: number): void;
  /** The film could not load or draw. The intro skips, so the folder stays reachable. */
  onFailed(): void;
}

const FilmPlayer = lazy(() => import("./FilmPlayer"));

/**
 * Nothing above the first run catches a render error, so a film that fails to load or draw
 * in some webview would blank the window before the folder gate. This boundary skips instead.
 */
class FilmBoundary extends Component<{ onFailed(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailed();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Film(props: FilmProps) {
  return (
    <FilmBoundary onFailed={props.onFailed}>
      <Suspense fallback={null}>
        <FilmPlayer {...props} />
      </Suspense>
    </FilmBoundary>
  );
}
