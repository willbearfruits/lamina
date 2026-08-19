// Shared export helpers: number formatting, minimal ZIP writer (STORE), download/save glue.

export function fmt(n, digits = 4) { // fixed decimals without trailing zeros, no "-0"
  let s = (Math.abs(n) < 1e-9 ? 0 : n).toFixed(digits);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
export function pad2(n) { return String(n).padStart(2, '0'); }
export function stamp() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
export function safeName(s) { return String(s || 'board').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'board'; }

// ---------- CRC32 + ZIP (store only; no compression → zero deps, fine for text + small binaries) ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
const enc = new TextEncoder();
export function toBytes(data) { if (data instanceof Uint8Array) return data; if (data instanceof ArrayBuffer) return new Uint8Array(data); if (typeof data === 'string') return enc.encode(data); throw new Error('unsupported zip entry data'); }
function dosDateTime(d = new Date()) { const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(); return [time, date]; }
// files: [{name, data}] where data = string | Uint8Array | ArrayBuffer. Returns Uint8Array of the .zip
export function makeZip(files) {
  const parts = [], central = []; let offset = 0; const [t, d] = dosDateTime();
  for (const f of files) {
    const nameB = enc.encode(f.name.replace(/\\/g, '/')); const data = toBytes(f.data); const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, t, true); lh.setUint16(12, d, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nameB, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, t, true); ch.setUint16(14, d, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nameB.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  let cdSize = 0; for (const c of central) cdSize += c.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true); eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true); eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true); eocd.setUint16(20, 0, true);
  const total = offset + cdSize + 22; const out = new Uint8Array(total); let p = 0;
  for (const c of parts) { out.set(c, p); p += c.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(new Uint8Array(eocd.buffer), p);
  return out;
}

// ---------- browser save ----------
export function downloadBytes(name, data, mime = 'application/octet-stream') {
  if (typeof window === 'undefined') throw new Error('downloadBytes needs a browser');
  if (window.lamina && window.lamina.saveFile) return window.lamina.saveFile(name, toBytes(data)); // Electron bridge
  const blob = data instanceof Blob ? data : new Blob([toBytes(data)], { type: mime });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}
export function downloadText(name, text, mime = 'text/plain') { return downloadBytes(name, text, mime); }
