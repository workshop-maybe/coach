// jev-in-compare U1, KTD14: the line a failed ask to Jev shows, moved out of the test deck
// so compare says the same thing. `TestDeck.tsx` re-exports it for its tests.

import { toJevError } from "../jev/jev";

/** Where a key problem is fixed (KTD20). */
const FIX_THE_KEY = "Jev Mode in the top bar, on home";

/**
 * One line for a failed ask, and whether asking again can help (KTD20). Nothing from the
 * error's own text: "other" carries at most its status number. A key problem, Jev Mode off,
 * a request TypeSafe refused as invalid or a reply too long can't succeed on a retry, so
 * those take the ask away for the round.
 */
export function jevFailure(e: unknown): { line: string; retry: boolean } {
  const error = toJevError(e);
  switch (error.kind) {
    case "keyRefused":
      return { line: `TypeSafe refused the key. Change it in ${FIX_THE_KEY}.`, retry: false };
    case "keyMissing":
      return { line: `Jev has no key. Add one in ${FIX_THE_KEY}.`, retry: false };
    case "invalidKey":
      return { line: `The key doesn't look right. Change it in ${FIX_THE_KEY}.`, retry: false };
    case "off":
      return { line: `Jev Mode is off. Turn it on in ${FIX_THE_KEY}.`, retry: false };
    case "invalidRequest":
      return { line: "Jev couldn't read the app's request. That's a bug in the app.", retry: false };
    case "tooLong":
      return { line: "This reply is too long for Jev.", retry: false };
    case "rateLimited":
      return { line: "Jev has had too many asks. Try again in a moment.", retry: true };
    case "overloaded":
      return { line: "Jev is overloaded. Try again shortly.", retry: true };
    case "unreachable":
      return { line: "Jev couldn't be reached.", retry: true };
    case "keychain":
      return { line: "The keychain didn't give up the key.", retry: true };
    case "settings":
      return { line: "Jev Mode's settings couldn't be read.", retry: true };
    case "other":
      return { line: error.status === null ? "Jev couldn't answer." : `Jev couldn't answer (${error.status}).`, retry: true };
  }
}
