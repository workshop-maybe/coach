// The Andamio lockup (mark + logotype). Both variants render; CSS shows the one
// that matches the `.dark` class, so the swap needs no JavaScript.

import lockupLight from "../assets/brand/lockup.png";
import lockupDark from "../assets/brand/lockup-dark.png";

export function Lockup({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <img className="lockup lockup-light" src={lockupLight} alt="Andamio" />
      <img className="lockup lockup-dark" src={lockupDark} alt="" aria-hidden="true" />
    </span>
  );
}
