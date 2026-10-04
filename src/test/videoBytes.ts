// The smallest video headers the storage stand-ins sort by content (plan KTD6). Each builder
// takes a `body` so two fixtures of one kind can differ in bytes, and so in their names.

const text = (s: string) => new TextEncoder().encode(s);

function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A box with a 4-byte big-endian size and a type, as ISO-BMFF and QuickTime write them. */
function box(type: string, payload: Uint8Array): Uint8Array {
  const size = 8 + payload.length;
  return join(new Uint8Array([size >>> 24, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff]), text(type), payload);
}

/** An MP4 (or M4V) that starts with `ftyp` and the given major brand. */
export function mp4Bytes(body = "", brand = "isom"): Uint8Array {
  return join(box("ftyp", join(text(brand), new Uint8Array(4), text("isommp42"))), text(body));
}

/** A QuickTime movie whose first atom is `atom`: `ftyp` with brand `qt  `, or a bare atom such as `wide` or `moov`. */
export function movBytes(body = "", atom = "ftyp"): Uint8Array {
  const first = atom === "ftyp" ? box("ftyp", join(text("qt  "), new Uint8Array(4), text("qt  "))) : box(atom, new Uint8Array(0));
  return join(first, text(body));
}

/** An EBML file whose header names `docType`: `webm` for WebM, `matroska` for MKV. */
export function ebmlBytes(docType: string, body = ""): Uint8Array {
  const el = (id: number[], value: Uint8Array) => join(new Uint8Array([...id, 0x80 | value.length]), value);
  const header = join(
    el([0x42, 0x86], new Uint8Array([1])), // EBMLVersion
    el([0x42, 0xf7], new Uint8Array([1])), // EBMLReadVersion
    el([0x42, 0xf2], new Uint8Array([4])), // EBMLMaxIDLength
    el([0x42, 0xf3], new Uint8Array([8])), // EBMLMaxSizeLength
    el([0x42, 0x82], text(docType)), // DocType
    el([0x42, 0x87], new Uint8Array([2])), // DocTypeVersion
  );
  return join(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80 | header.length]), header, text(body));
}

export const webmBytes = (body = "") => ebmlBytes("webm", body);
export const mkvBytes = (body = "") => ebmlBytes("matroska", body);
