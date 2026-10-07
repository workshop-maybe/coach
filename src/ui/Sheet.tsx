// The working paper, set into the window's board as a sheet (the drawn chassis plan, KTD1).
// The sheet carries the drawn edge and the scroller inside it carries the scroll: an edge drawn
// on the element that scrolls would scroll away with the content. Home's doors and a deck's
// actions stick to the scroller's foot, which is the sheet's foot.

import type { ReactNode, Ref } from "react";

export function Sheet({ scroller, children }: { scroller?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div className="sheet">
      <div className="sheet-scroll" ref={scroller}>
        {children}
      </div>
    </div>
  );
}
