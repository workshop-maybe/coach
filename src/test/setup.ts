// Shared vitest setup (KTD11). Real ProseMirror now mounts in suites that never mounted it,
// since the read-only reply view (U3) imports the editor's extensions directly. jsdom has no
// layout, and ProseMirror asks for rects when it scrolls a selection into view, so the DOM
// suites get the stand-ins below. Most suites run in the node environment, where none of
// these prototypes exist, so there the file does nothing.

if (typeof document !== "undefined") {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  const list = () => Object.assign([rect()], { item: () => rect() });
  Range.prototype.getBoundingClientRect = rect as never;
  Range.prototype.getClientRects = list as never;
  Element.prototype.getClientRects = list as never;
  document.elementFromPoint = () => null;
  // jsdom has no ClipboardEvent; ProseMirror builds one for a text paste.
  globalThis.ClipboardEvent ??= class extends Event {
    clipboardData = null;
  } as never;
}
