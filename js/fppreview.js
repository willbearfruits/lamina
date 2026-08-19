// Small footprint preview renderer for pickers/dialogs.
import { resolvePart, bboxOfPoints, unionBBox } from './geom.js';
import { drawPrims } from './render.js';

export function footprintBBox(fp) {
  let bb = null;
  for (const p of fp.pads || []) bb = unionBBox(bb, [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2]);
  for (const h of fp.holes || []) bb = unionBBox(bb, [h.x - h.d / 2, h.y - h.d / 2, h.x + h.d / 2, h.y + h.d / 2]);
  const cy = fp.courtyard;
  if (cy) { if (cy.pts) bb = unionBBox(bb, bboxOfPoints(cy.pts)); else bb = unionBBox(bb, [(cy.x || 0) - cy.w / 2, (cy.y || 0) - cy.h / 2, (cy.x || 0) + cy.w / 2, (cy.y || 0) + cy.h / 2]); }
  return bb || [-5, -5, 5, 5];
}
// canvas: HTMLCanvasElement (CSS-sized); fp: footprint def; opts {lib, bg, scaleFit}
export function drawFootprint(canvas, fp, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const W = Math.max(40, r.width || opts.w || 150), H = Math.max(30, r.height || opts.h || 78);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = opts.bg || '#12141a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rp = resolvePart({ lib: opts.lib || fp.id, fp, ref: opts.ref || '', value: '', x: 0, y: 0, rot: 0, side: 'top', hideRef: true }, null);
  if (!rp) return;
  const bb = footprintBBox(fp);
  const bw = Math.max(0.5, bb[2] - bb[0]), bh = Math.max(0.5, bb[3] - bb[1]);
  const m = 6 * dpr;
  const s = Math.min((canvas.width - 2 * m) / bw, (canvas.height - 2 * m) / bh);
  const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  ctx.setTransform(s, 0, 0, -s, canvas.width / 2 - cx * s, canvas.height / 2 + cy * s);
  const minLine = 1 * dpr / s;
  // courtyard
  const cyd = fp.courtyard;
  if (cyd && !cyd.pts) { ctx.strokeStyle = 'rgba(140,170,255,0.35)'; ctx.lineWidth = minLine; ctx.strokeRect((cyd.x || 0) - cyd.w / 2, (cyd.y || 0) - cyd.h / 2, cyd.w, cyd.h); }
  // pads
  for (const p of rp.pads) {
    ctx.beginPath(); p.poly.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
    ctx.fillStyle = p.layer === 'B' ? '#3f7fd6' : '#d9432f'; ctx.fill();
    if (p.drill > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, p.drill / 2, 0, Math.PI * 2); ctx.fillStyle = '#12141a'; ctx.fill(); }
  }
  for (const h of rp.holes) { ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2, 0, Math.PI * 2); ctx.fillStyle = '#12141a'; ctx.fill(); ctx.strokeStyle = '#f6c'; ctx.lineWidth = minLine; ctx.stroke(); }
  const silk = rp.prims.filter(x => x.layer.endsWith('Silk')).map(x => x.prim).filter(x => x.t !== 'text');
  drawPrims(ctx, silk, '#e8e8e8', { minLine });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
