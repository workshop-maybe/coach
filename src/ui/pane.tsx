// Pane mode (KTD3): a view that needs the whole window claims it, and the shell slims its
// top bar to the window keys and the brand (R8) and hands the view the height below the
// bar (R7, KTD4). Decks and item views claim through the same hook, since the shell cannot
// see a deck's beat from the route. A view claims in a layout effect, so the bar never
// paints full and then slims, and each claim releases only itself, so one view's cleanup
// cannot clear another's. The context's default ignores claims, so a view renders alone in
// its tests.

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";

export interface PaneClaims {
  /** Puts the shell in pane mode until the returned release is called. A second call to the same release does nothing. */
  claim(): () => void;
}

const ignored: PaneClaims = { claim: () => () => undefined };

export const PaneContext = createContext<PaneClaims>(ignored);

/** Claims pane mode while `active` holds, and releases this view's claim when it stops holding or the view unmounts. */
export function usePane(active: boolean): void {
  const { claim } = useContext(PaneContext);
  useLayoutEffect(() => (active ? claim() : undefined), [active, claim]);
}

/** The shell's half: whether any view holds a claim, and the claims to provide to the views below. */
export function usePaneClaims(): { pane: boolean; claims: PaneClaims } {
  const [held, setHeld] = useState(0);
  const claim = useCallback(() => {
    setHeld((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setHeld((n) => n - 1);
    };
  }, []);
  const claims = useMemo(() => ({ claim }), [claim]);
  return { pane: held > 0, claims };
}
