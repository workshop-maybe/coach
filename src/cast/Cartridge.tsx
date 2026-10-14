// A credential, drawn as a cartridge (R4, KTD3): a chunky hand-inked shell with grip
// ridges, a key notch, contacts along the edge that goes into the slot, and a label
// window showing the whole badge, uncropped and crisp. Decorative: the credential's
// name and the badge's alt text belong to the text around it.

import type { Collection, Credential } from "../domain/types";
import { useBadgeSrc } from "../ui/Badge";
import { CARTRIDGE_H, CARTRIDGE_W, CartridgeArt } from "./cartridgeArt";

export { CARTRIDGE_H, CARTRIDGE_W, CartridgeArt, SHELL, WINDOW } from "./cartridgeArt";

export interface CartridgeProps {
  collection: Collection;
  credential: Pick<Credential, "slug" | "name">;
  /** Rendered width in pixels. The height follows the cartridge's shape. */
  width?: number;
  className?: string;
}

export function Cartridge({ collection, credential, width = 96, className }: CartridgeProps) {
  const src = useBadgeSrc(collection, credential);
  return (
    <svg
      className={`cast cast-cartridge${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${CARTRIDGE_W} ${CARTRIDGE_H}`}
      width={width}
      height={(width * CARTRIDGE_H) / CARTRIDGE_W}
      aria-hidden="true"
      focusable="false"
    >
      <CartridgeArt src={src} fine={width < 72} />
    </svg>
  );
}
