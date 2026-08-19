// PNG / JPEG renders (browser). Uses the realistic renderer at a chosen DPI, top and bottom views.
import { resolveBoard } from '../geom.js';
import { renderRealistic, renderLayers, applyView } from '../render.js';
import { safeName } from './common.js';
import { SILK_COLORS } from '../model.js';

export function renderBoardImage(board, doc, opts = {}) {
  const R = opts.resolved || resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: false });
  const [W, H] = R.size; const dpi = opts.dpi || 600; const px = dpi / 25.4; const margin = opts.margin ?? 2;
  const c = document.createElement('canvas'); c.width = Math.round((W + 2 * margin) * px); c.height = Math.round((H + 2 * margin) * px);
  const ctx = c.getContext('2d');
  ctx.fillStyle = opts.background || (opts.transparent ? 'rgba(0,0,0,0)' : '#ffffff'); if (!opts.transparent) ctx.fillRect(0, 0, c.width, c.height);
  const flip = opts.side === 'bottom' && opts.mirror !== false;
  const imageProvider = opts.imageProviderFor ? opts.imageProviderFor(SILK_COLORS[board.silkColor] || '#f4f4f4') : opts.imageProvider;
  const view = { scale: px, ox: margin * px, oy: c.height - margin * px, flip, W };
  applyView(ctx, view);
  if (opts.mode === 'layers') renderLayers(ctx, R, board, { side: opts.side || 'top', imageProvider, background: opts.background || '#fff' });
  else renderRealistic(ctx, R, board, { side: opts.side || 'top', imageProvider, background: opts.transparent ? 'rgba(0,0,0,0)' : (opts.background || '#ffffff'), showFar: false });
  return c;
}
export function canvasToBytes(canvas, type = 'image/png', quality = 0.92) {
  return new Promise(res => canvas.toBlob(b => { b.arrayBuffer().then(ab => res(new Uint8Array(ab))); }, type, quality));
}
export async function exportRaster(doc, opts = {}) {
  const files = []; const dpi = opts.dpi || 600; const fmtType = opts.format === 'jpeg' ? 'image/jpeg' : 'image/png'; const ext = opts.format === 'jpeg' ? 'jpg' : 'png';
  for (const bi of (opts.boards || doc.boards.map((_, i) => i))) {
    const b = doc.boards[bi]; const stem = safeName(b.name);
    for (const side of ['top', 'bottom']) {
      const c = renderBoardImage(b, doc, { ...opts, side, dpi, transparent: opts.transparent && ext === 'png' });
      files.push({ name: `images/${stem}-${side}.${ext}`, data: await canvasToBytes(c, fmtType, opts.quality || 0.92) });
    }
  }
  return files;
}
