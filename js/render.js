// LAMINA 2D renderer — draws resolved geometry onto a canvas 2D context.
// Board frame → screen via ctx transform (mm units, Y up). Two modes: 'realistic' and 'layers'.
import { arcPoints, GRAPHIC_LAYERS, layerSide } from './geom.js';
import { BOARD_COLORS, SILK_COLORS } from './model.js';

export const LAYER_COLORS = {
  'F.Cu': '#d9432f', 'B.Cu': '#3f7fd6', 'F.Mask': '#c04fc0', 'B.Mask': '#3fb7c9', 'F.Silk': '#f2f2f2', 'B.Silk': '#e8b45a',
  'F.Paste': '#9d9d9d', 'B.Paste': '#6d8f9d', 'F.Fab': '#a8a8a8', 'B.Fab': '#7d7d9d', 'Edge.Cuts': '#f2d21b', 'Drill': '#111', 'Cutout': '#f2d21b',
};
export const LAYER_ORDER_TOP = ['B.Fab', 'B.Paste', 'B.Cu', 'B.Mask', 'B.Silk', 'F.Fab', 'F.Paste', 'F.Cu', 'F.Mask', 'F.Silk'];
export const LAYER_ORDER_BOTTOM = ['F.Fab', 'F.Paste', 'F.Cu', 'F.Mask', 'F.Silk', 'B.Fab', 'B.Paste', 'B.Cu', 'B.Mask', 'B.Silk'];
export const COPPER = { hasl: '#c9cdd1', enig: '#d9b24c', bare: '#c37a3b', underMask: 'rgba(200,120,50,0.55)' };
export const FR4 = '#c9b98a';

// Set canvas transform so that drawing happens in mm, Y up. view = {scale, ox, oy, flip, W}
export function applyView(ctx, view) {
  if (view.flip) ctx.setTransform(-view.scale, 0, 0, -view.scale, view.ox + view.W * view.scale, view.oy);
  else ctx.setTransform(view.scale, 0, 0, -view.scale, view.ox, view.oy);
}
export function screenToBoard(view, sx, sy) {
  const x = view.flip ? view.W - (sx - view.ox) / view.scale : (sx - view.ox) / view.scale;
  const y = (view.oy - sy) / view.scale;
  return [x, y];
}
export function boardToScreen(view, x, y) {
  const sx = view.flip ? view.ox + (view.W - x) * view.scale : view.ox + x * view.scale;
  return [sx, view.oy - y * view.scale];
}

function pathPoly(ctx, pts) { if (!pts.length) return; ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
export function pathOutline(ctx, R) { ctx.beginPath(); pathPoly(ctx, R.outline); for (const c of R.cutouts) pathPoly(ctx, c); }

// draw one prim with current fillStyle/strokeStyle (colour already set)
export function drawPrim(ctx, p, opts = {}) {
  const imgProvider = opts.imageProvider;
  switch (p.t) {
    case 'line': ctx.beginPath(); ctx.lineWidth = Math.max(p.w, opts.minLine || 0); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke(); break;
    case 'polyline': if (p.pts.length < 2) { if (p.pts.length === 1) { ctx.beginPath(); ctx.arc(p.pts[0][0], p.pts[0][1], Math.max(p.w, opts.minLine || 0) / 2, 0, Math.PI * 2); ctx.fill(); } break; } ctx.beginPath(); ctx.lineWidth = Math.max(p.w, opts.minLine || 0); ctx.moveTo(p.pts[0][0], p.pts[0][1]); for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]); if (p.closed) ctx.closePath(); ctx.stroke(); break;
    case 'arc': { ctx.beginPath(); ctx.lineWidth = Math.max(p.w, opts.minLine || 0); let a0 = p.a0 * Math.PI / 180, a1 = p.a1 * Math.PI / 180; while (a1 <= a0) a1 += Math.PI * 2; ctx.arc(p.cx, p.cy, p.r, a0, a1, false); ctx.stroke(); break; }
    case 'circle': ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); if (p.w > 0) { ctx.lineWidth = Math.max(p.w, opts.minLine || 0); ctx.stroke(); } else ctx.fill(); break;
    case 'poly': ctx.beginPath(); pathPoly(ctx, p.pts); for (const h of p.holes || []) pathPoly(ctx, h); ctx.fill('evenodd'); break;
    case 'text': break; // text is always resolved as strokes for display
    case 'image': { const src = imgProvider ? imgProvider(p) : null; if (!src) { ctx.save(); ctx.globalAlpha *= 0.5; ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180); ctx.beginPath(); ctx.rect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.lineWidth = 0.2; ctx.stroke(); ctx.restore(); break; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180); if (p.mirror) ctx.scale(-1, 1); ctx.scale(1, -1); ctx.drawImage(src, -p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); break; }
  }
}
export function drawPrims(ctx, prims, color, opts = {}) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of prims) drawPrim(ctx, p, opts);
}

// Realistic render of a resolved board. side = 'top' | 'bottom' (which side faces the viewer). Uses ctx already transformed to mm.
export function renderRealistic(ctx, R, board, opts = {}) {
  const side = opts.side || 'top';
  const near = side === 'top' ? 'F' : 'B', far = side === 'top' ? 'B' : 'F';
  const bc = BOARD_COLORS[board.color] || BOARD_COLORS.green;
  const finishColor = board.finish === 'ENIG' ? COPPER.enig : COPPER.hasl;
  const silk = SILK_COLORS[board.silkColor] || '#f4f4f4';
  const vis = opts.visible || {};
  const on = l => vis[l] !== false;
  const minLine = opts.minLine || 0;
  const io = { imageProvider: opts.imageProvider, minLine };
  ctx.save();
  // substrate + mask colour
  pathOutline(ctx, R); ctx.fillStyle = bc.mask; ctx.fill('evenodd');
  ctx.save(); pathOutline(ctx, R); ctx.clip('evenodd');
  // far side ghost (optional)
  if (opts.showFar) {
    ctx.globalAlpha = 0.18;
    if (on(far + '.Cu')) drawPrims(ctx, R.layers[far + '.Cu'] || [], '#000', io);
    if (on(far + '.Silk')) drawPrims(ctx, R.layers[far + '.Silk'] || [], '#000', io);
    ctx.globalAlpha = 1;
  }
  // copper under mask (tinted)
  if (on(near + '.Cu')) { ctx.globalAlpha = board.color === 'black' ? 0.35 : board.color === 'white' ? 0.5 : 0.6; drawPrims(ctx, R.layers[near + '.Cu'] || [], bc.maskLight, io); ctx.globalAlpha = 1; }
  // mask openings: show bare substrate then copper in finish colour where copper exists
  if (on(near + '.Mask')) {
    const openings = R.layers[near + '.Mask'] || [];
    if (openings.length) {
      ctx.save(); ctx.beginPath();
      for (const p of openings) { if (p.t === 'poly') { pathPoly(ctx, p.pts); } else if (p.t === 'circle') { ctx.moveTo(p.cx + p.r, p.cy); ctx.arc(p.cx, p.cy, p.r + (p.w || 0) / 2, 0, Math.PI * 2); } }
      ctx.clip();
      // substrate visible in openings
      pathOutline(ctx, R); ctx.fillStyle = FR4; ctx.fill('evenodd');
      // stroke-type openings (lines/polylines/arcs) can't be clipped as regions — draw them directly in FR4 below
      if (on(near + '.Cu')) drawPrims(ctx, R.layers[near + '.Cu'] || [], finishColor, io);
      ctx.restore();
      // stroke-type mask openings drawn as FR4 strokes (approximation)
      const strokes = openings.filter(p => p.t === 'line' || p.t === 'polyline' || p.t === 'arc' || (p.t === 'circle' && p.w > 0));
      if (strokes.length) drawPrims(ctx, strokes, FR4, io);
    }
  }
  // silk
  if (on(near + '.Silk')) drawPrims(ctx, R.layers[near + '.Silk'] || [], silk, io);
  if (on(near + '.Fab') && opts.showFab) { ctx.globalAlpha = 0.5; drawPrims(ctx, R.layers[near + '.Fab'] || [], '#9cf', io); ctx.globalAlpha = 1; }
  if (on(near + '.Paste') && opts.showPaste) { ctx.globalAlpha = 0.5; drawPrims(ctx, R.layers[near + '.Paste'] || [], '#bbb', io); ctx.globalAlpha = 1; }
  ctx.restore();
  // drills (holes through everything) — draw background colour
  ctx.fillStyle = opts.background || '#1b1d22';
  for (const d of R.drills) drawDrill(ctx, d, opts.background || '#1b1d22', d.plated ? finishColor : null);
  // board edge
  pathOutline(ctx, R); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.15; ctx.stroke();
  ctx.restore();
}
export function drawDrill(ctx, d, bg, ringColor) {
  ctx.save();
  ctx.translate(d.x, d.y); ctx.rotate((d.rot || 0) * Math.PI / 180);
  const r = d.d / 2;
  ctx.beginPath();
  if (d.slotLen > r * 2) { const h = (d.slotLen - d.d) / 2; ctx.moveTo(-h, -r); ctx.lineTo(h, -r); ctx.arc(h, 0, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(-h, r); ctx.arc(-h, 0, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); }
  else ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = bg; ctx.fill();
  if (ringColor && d.plated) { ctx.strokeStyle = ringColor; ctx.lineWidth = Math.min(0.15, r * 0.4); ctx.stroke(); }
  ctx.restore();
}

// Layer-colour render (engineering view). activeLayer drawn last & full alpha; others dimmed.
export function renderLayers(ctx, R, board, opts = {}) {
  const side = opts.side || 'top';
  const order = side === 'top' ? LAYER_ORDER_TOP : LAYER_ORDER_BOTTOM;
  const vis = opts.visible || {}; const on = l => vis[l] !== false;
  const active = opts.activeLayer;
  const io = { imageProvider: opts.imageProvider, minLine: opts.minLine || 0 };
  ctx.save();
  pathOutline(ctx, R); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill('evenodd');
  const draw = (l) => { if (!on(l)) return; const prims = R.layers[l] || []; if (!prims.length) return; ctx.globalAlpha = l === active ? 0.95 : (opts.dimOthers ? 0.35 : 0.7); drawPrims(ctx, prims, LAYER_COLORS[l] || '#fff', io); };
  for (const l of order) if (l !== active) draw(l);
  if (active && order.includes(active)) draw(active);
  ctx.globalAlpha = 1;
  // drills
  for (const d of R.drills) { drawDrill(ctx, d, opts.background || '#1b1d22', d.plated ? '#ddd' : '#f6c'); }
  // edge cuts
  ctx.globalAlpha = 1; pathOutline(ctx, R); ctx.strokeStyle = LAYER_COLORS['Edge.Cuts']; ctx.lineWidth = Math.max(0.12, opts.minLine || 0); ctx.stroke();
  ctx.restore();
}

// grid + origin, drawn in mm space
export function drawGrid(ctx, view, W, H, gridMm, opts = {}) {
  if (!gridMm || gridMm * view.scale < 4) { // too dense → coarser
    let g = gridMm || 1; while (g * view.scale < 8) g *= 2; gridMm = g;
  }
  ctx.save();
  ctx.lineWidth = 1 / view.scale; ctx.strokeStyle = opts.color || 'rgba(255,255,255,0.08)';
  const x0 = -Math.ceil(20 / gridMm) * gridMm, x1 = W + 20, y0 = -Math.ceil(20 / gridMm) * gridMm, y1 = H + 20;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += gridMm) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = y0; y <= y1; y += gridMm) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
  // origin
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(3, 0); ctx.moveTo(0, -3); ctx.lineTo(0, 3); ctx.stroke();
  ctx.restore();
}

// draw a bbox highlight in mm space
export function drawBBox(ctx, bb, color, view, dash = true) {
  if (!bb) return;
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5 / view.scale; if (dash) ctx.setLineDash([4 / view.scale, 3 / view.scale]);
  const m = 0.3; ctx.strokeRect(bb[0] - m, bb[1] - m, bb[2] - bb[0] + 2 * m, bb[3] - bb[1] + 2 * m); ctx.restore();
}
