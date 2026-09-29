// The Andamio lockup (mark + logotype). The <picture> source follows the same OS
// setting as the `.dark` class, so only the matching variant is loaded.

import lockupLight from "../assets/brand/lockup.png";
import lockupDark from "../assets/brand/lockup-dark.png";

export function Lockup({ className }: { className?: string }) {
  return (
    <picture className={className}>
      <source media="(prefers-color-scheme: dark)" srcSet={lockupDark} />
      <img className="lockup" src={lockupLight} alt="Andamio" />
    </picture>
  );
}
