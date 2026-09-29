// The Andamio lockup (mark + logotype). The app is drawn light only, so one variant.

import lockup from "../assets/brand/lockup.png";

export function Lockup({ className }: { className?: string }) {
  return <img className={`lockup ${className ?? ""}`.trim()} src={lockup} alt="Andamio" />;
}
