/** Minimal PNG chunk reader/writer for character card metadata (tEXt chunks). */

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const isPng = (b: Uint8Array) => b.length > 8 && SIG.every((v, i) => b[i] === v);

interface Chunk {
  type: string;
  data: Uint8Array;
}

function readChunks(b: Uint8Array): Chunk[] {
  if (!isPng(b)) throw new Error('not-png');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Chunk[] = [];
  let p = 8;
  while (p + 8 <= b.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    const data = b.subarray(p + 8, p + 8 + len);
    out.push({ type, data });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** All tEXt chunks as keyword → text. */
export function readTextChunks(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of readChunks(b)) {
    if (c.type !== 'tEXt') continue;
    const z = c.data.indexOf(0);
    if (z < 0) continue;
    out[latin1(c.data.subarray(0, z))] = latin1(c.data.subarray(z + 1));
  }
  return out;
}

function encodeChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Replaces the given tEXt keywords (values must be ASCII, e.g. base64) and returns a new PNG. */
export function writeTextChunks(b: Uint8Array, entries: Record<string, string>): Uint8Array {
  const keys = new Set(Object.keys(entries));
  const parts: Uint8Array[] = [new Uint8Array(SIG)];
  for (const c of readChunks(b)) {
    if (c.type === 'tEXt') {
      const z = c.data.indexOf(0);
      if (z >= 0 && keys.has(latin1(c.data.subarray(0, z)))) continue;
    }
    if (c.type === 'IEND') {
      for (const [k, v] of Object.entries(entries)) {
        const data = new Uint8Array(k.length + 1 + v.length);
        for (let i = 0; i < k.length; i++) data[i] = k.charCodeAt(i);
        for (let i = 0; i < v.length; i++) data[k.length + 1 + i] = v.charCodeAt(i) & 0xff;
        parts.push(encodeChunk('tEXt', data));
      }
    }
    parts.push(encodeChunk(c.type, c.data));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
