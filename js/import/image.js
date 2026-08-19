// Raster image support: load files → dataURL, threshold to a 1-bit bitmap for silk/copper/mask art,
// and provide display canvases. Browser-only (uses Image/canvas); node code paths use fakeBitmap.
export function readFileAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
export function loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image failed to load')); im.src = src; }); }

// Resolution policy: 0.05 mm per pixel (20 px/mm) capped to 1600 px on the long side.
export function bitmapSize(item, img) {
  const pxPerMm = 20;
  let w = Math.round(item.w * pxPerMm), h = Math.round(item.h * pxPerMm);
  const cap = 1600; const s = Math.min(1, cap / Math.max(w, h)); w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  return [w, h];
}
// Build a bitmap {w,h,data(Uint8Array 1=ink)} from an image element for an image item (threshold/invert/dither)
export function makeBitmap(item, img) {
  const [w, h] = bitmapSize(item, img);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  const thr = item.threshold ?? 128, inv = !!item.invert;
  if (item.dither) {
    // Floyd–Steinberg on luminance
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const a = id[i * 4 + 3] / 255; const l = (0.299 * id[i * 4] + 0.587 * id[i * 4 + 1] + 0.114 * id[i * 4 + 2]); lum[i] = l * a + 255 * (1 - a); }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; const old = lum[i]; const nw = old < 128 ? 0 : 255; const err = old - nw; lum[i] = nw;
      if (x + 1 < w) lum[i + 1] += err * 7 / 16; if (y + 1 < h) { if (x > 0) lum[i + w - 1] += err * 3 / 16; lum[i + w] += err * 5 / 16; if (x + 1 < w) lum[i + w + 1] += err * 1 / 16; }
      data[i] = (nw === 0) !== inv ? 1 : 0;
    }
  } else {
    for (let i = 0; i < w * h; i++) { const a = id[i * 4 + 3] / 255; const l = (0.299 * id[i * 4] + 0.587 * id[i * 4 + 1] + 0.114 * id[i * 4 + 2]) * a + 255 * (1 - a); data[i] = (l < thr) !== inv ? 1 : 0; }
  }
  return { w, h, data };
}
// Canvas showing ink pixels in `color` (transparent elsewhere) for display
export function bitmapToCanvas(bm, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = bm.w; c.height = bm.h;
  const ctx = c.getContext('2d'); const id = ctx.createImageData(bm.w, bm.h);
  const rgb = hexToRgb(color);
  for (let i = 0; i < bm.w * bm.h; i++) { if (bm.data[i]) { id.data[i * 4] = rgb[0]; id.data[i * 4 + 1] = rgb[1]; id.data[i * 4 + 2] = rgb[2]; id.data[i * 4 + 3] = 255; } }
  ctx.putImageData(id, 0, 0);
  return c;
}
export function hexToRgb(hex) { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255]; }

// Cache: item.id → { key, img, bitmap, canvases:{color→canvas} }
export class ImageCache {
  constructor() { this.map = new Map(); this.pending = new Map(); }
  key(item) { return [item.src && item.src.length, item.src && item.src.slice(-32), item.w, item.h, item.threshold, item.invert, item.dither].join('|'); }
  get(item) { const e = this.map.get(item.id); if (e && e.key === this.key(item)) return e; return null; }
  ensure(item, onReady) {
    const e = this.get(item); if (e) return e;
    if (!item.src) return null;
    const k = this.key(item);
    if (this.pending.get(item.id) === k) return null;
    this.pending.set(item.id, k);
    loadImage(item.src).then(img => { const bitmap = makeBitmap(item, img); this.map.set(item.id, { key: k, img, bitmap, canvases: {} }); this.pending.delete(item.id); onReady && onReady(); }).catch(() => { this.pending.delete(item.id); });
    return null;
  }
  canvasFor(item, color) { const e = this.get(item); if (!e) return null; if (!e.canvases[color]) e.canvases[color] = bitmapToCanvas(e.bitmap, color); return e.canvases[color]; }
  bitmapFor(item) { const e = this.get(item); return e ? e.bitmap : null; }
}

// ---------- natural size ----------
// Read the pixel density a file declares so images can be placed at their real-world size.
// PNG: pHYs chunk (pixels per metre). JPEG: JFIF APP0 density, else EXIF X/YResolution. SVG: width/height attrs.
export function imageDensity(dataURL) {
  try {
    const comma = dataURL.indexOf(','); if (comma < 0) return { dpi: 96, source: 'assumed 96 dpi' };
    const head = dataURL.slice(0, comma);
    if (/image\/svg/i.test(head)) {
      const svg = decodeURIComponent(escape(atob(dataURL.slice(comma + 1)))).slice(0, 4000);
      const w = /\bwidth\s*=\s*["']([\d.]+)(mm|cm|in|pt|px)?["']/i.exec(svg);
      if (w && w[2] && w[2] !== 'px') return { dpi: 96, source: 'svg ' + w[1] + w[2], svgUnits: w[2], svgWidth: parseFloat(w[1]) };
      return { dpi: 96, source: 'svg px @96' };
    }
    const bin = atob(dataURL.slice(comma + 1, comma + 1 + 8000));
    const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    const be32 = (o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
    const be16 = (o) => (b[o] << 8 | b[o + 1]);
    const le16 = (o) => (b[o + 1] << 8 | b[o]);
    if (b[0] === 0x89 && b[1] === 0x50) { // PNG
      let p = 8;
      while (p + 8 < b.length) {
        const len = be32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
        if (type === 'pHYs' && p + 8 + 9 <= b.length) { const ppuX = be32(p + 8), unit = b[p + 16]; if (unit === 1 && ppuX > 0) return { dpi: +(ppuX * 0.0254).toFixed(2), source: 'PNG pHYs' }; break; }
        if (type === 'IDAT' || type === 'IEND') break;
        p += 12 + len;
      }
      return { dpi: 96, source: 'PNG (no density) @96' };
    }
    if (b[0] === 0xFF && b[1] === 0xD8) { // JPEG
      let p = 2;
      while (p + 4 < b.length && b[p] === 0xFF) {
        const marker = b[p + 1], len = be16(p + 2);
        if (marker === 0xE0 && String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]) === 'JFIF') {
          const units = b[p + 11], x = be16(p + 12);
          if (x > 0 && units === 1) return { dpi: x, source: 'JPEG JFIF' };
          if (x > 0 && units === 2) return { dpi: +(x * 2.54).toFixed(2), source: 'JPEG JFIF (dpcm)' };
        }
        if (marker === 0xE1 && String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]) === 'Exif') {
          const tiff = p + 10; const little = b[tiff] === 0x49;
          const g16 = (o) => little ? le16(o) : be16(o);
          const g32 = (o) => little ? ((b[o + 3] << 24 | b[o + 2] << 16 | b[o + 1] << 8 | b[o]) >>> 0) : be32(o);
          const ifd = tiff + g32(tiff + 4); const n = g16(ifd);
          let xres = 0, unit = 2;
          for (let i = 0; i < n && ifd + 2 + i * 12 + 12 < b.length; i++) {
            const e = ifd + 2 + i * 12, tag = g16(e);
            if (tag === 0x011A) { const off = tiff + g32(e + 8); xres = g32(off) / (g32(off + 4) || 1); }
            if (tag === 0x0128) unit = g16(e + 8);
          }
          if (xres > 0) return { dpi: unit === 3 ? +(xres * 2.54).toFixed(2) : +xres.toFixed(2), source: 'JPEG EXIF' };
        }
        if (marker === 0xDA || marker === 0xD9) break;
        p += 2 + len;
      }
      return { dpi: 96, source: 'JPEG (no density) @96' };
    }
  } catch (e) { /* fall through */ }
  return { dpi: 96, source: 'assumed 96 dpi' };
}
export const MM_PER_IN = 25.4;
// natural size in mm for an <img> + its declared density
export function naturalSizeMm(img, density) {
  const dpi = (density && density.dpi) || 96;
  if (density && density.svgUnits) { // SVG with a physical width: honour it, keep the aspect
    const f = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 }[density.svgUnits] || 1;
    const w = density.svgWidth * f;
    return { w: +w.toFixed(3), h: +(w * img.naturalHeight / img.naturalWidth).toFixed(3), dpi: +(img.naturalWidth / (w / 25.4)).toFixed(1), source: density.source };
  }
  return { w: +(img.naturalWidth / dpi * MM_PER_IN).toFixed(3), h: +(img.naturalHeight / dpi * MM_PER_IN).toFixed(3), dpi, source: density ? density.source : 'assumed 96 dpi' };
}
export async function imagePlacement(src) {
  const img = await loadImage(src);
  const density = imageDensity(src);
  const nat = naturalSizeMm(img, density);
  return { img, src, px: [img.naturalWidth, img.naturalHeight], ...nat };
}
