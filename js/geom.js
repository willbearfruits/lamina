// LAMINA geometry core — pure functions, no DOM. See docs/FORMAT.md.
// Units mm, angles degrees CCW, Y up, all coordinates as seen from the top.
import { fontStrokes, getFont, DEFAULT_FONT } from './lib/fonts.js';
import { getFootprint } from './library.js';

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const EPS = 1e-9;

export const COPPER_LAYERS = ['F.Cu', 'B.Cu'];
export const ALL_LAYERS = ['F.Cu', 'B.Cu', 'F.Mask', 'B.Mask', 'F.Silk', 'B.Silk', 'F.Paste', 'B.Paste', 'F.Fab', 'B.Fab', 'Edge.Cuts'];
export const GRAPHIC_LAYERS = ALL_LAYERS.filter(l => l !== 'Edge.Cuts');

export function flipLayer(layer) {
  if (layer.startsWith('F.')) return 'B.' + layer.slice(2);
  if (layer.startsWith('B.')) return 'F.' + layer.slice(2);
  return layer;
}
export function layerSide(layer) { return layer.startsWith('B.') ? 'bottom' : layer.startsWith('F.') ? 'top' : 'both'; }

// ---------- basic vector helpers ----------
export function rotPt(x, y, deg, cx = 0, cy = 0) {
  if (!deg) return [x, y];
  const a = deg * D2R, c = Math.cos(a), s = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}
export function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }
export function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
export function bboxOfPoints(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return pts.length ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}
export function unionBBox(a, b) {
  if (!a) return b; if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
export function polygonArea(pts) { // signed, CCW positive
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]; a += x1 * y2 - x2 * y1; }
  return a / 2;
}
export function ensureCCW(pts) { return polygonArea(pts) < 0 ? pts.slice().reverse() : pts; }
export function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || EPS) + xi)) inside = !inside;
  }
  return inside;
}
export function centroid(pts) {
  let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
export function segsForRadius(r) { return Math.max(8, Math.min(72, Math.ceil(r * 12))); }

// ---------- shape flattening ----------
export function arcPoints(cx, cy, r, a0, a1, segs) {
  let sweep = a1 - a0; while (sweep < 0) sweep += 360; if (sweep === 0) sweep = 360;
  const n = segs || Math.max(2, Math.ceil(segsForRadius(r) * sweep / 360));
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + sweep * i / n) * D2R; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
export function circlePoints(cx, cy, r, segs) {
  const n = segs || segsForRadius(r);
  const pts = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
// rectangle centred at (cx,cy), size w×h, rotation deg, corner radius rx
export function rectPoints(cx, cy, w, h, rot = 0, rx = 0) {
  const hw = w / 2, hh = h / 2;
  rx = Math.max(0, Math.min(rx || 0, hw, hh));
  let pts;
  if (rx <= EPS) pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  else {
    pts = [];
    const n = Math.max(3, Math.ceil(segsForRadius(rx) / 4));
    const corners = [[hw - rx, -hh + rx, -90], [hw - rx, hh - rx, 0], [-hw + rx, hh - rx, 90], [-hw + rx, -hh + rx, 180]];
    for (const [ox, oy, a0] of corners) for (let i = 0; i <= n; i++) { const a = (a0 + 90 * i / n) * D2R; pts.push([ox + rx * Math.cos(a), oy + rx * Math.sin(a)]); }
  }
  return pts.map(([x, y]) => rotPt(x + cx, y + cy, rot, cx, cy));
}
// stadium (oval pad / slot) centred, length along w
export function ovalPoints(cx, cy, w, h, rot = 0) {
  if (Math.abs(w - h) < EPS) return circlePoints(cx, cy, w / 2);
  const long = Math.max(w, h), short = Math.min(w, h), r = short / 2, half = long / 2 - r;
  const n = Math.max(4, Math.ceil(segsForRadius(r) / 2));
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (-90 + 180 * i / n) * D2R; pts.push([half + r * Math.cos(a), r * Math.sin(a)]); }
  for (let i = 0; i <= n; i++) { const a = (90 + 180 * i / n) * D2R; pts.push([-half + r * Math.cos(a), r * Math.sin(a)]); }
  const extra = w >= h ? 0 : 90;
  return pts.map(([x, y]) => rotPt(x + cx, y + cy, rot + extra, cx, cy));
}
export function padPoints(pad, cx = pad.x, cy = pad.y, rot = pad.rot || 0, grow = 0) {
  const w = pad.w + 2 * grow, h = pad.h + 2 * grow;
  switch (pad.shape) {
    case 'circle': return circlePoints(cx, cy, w / 2);
    case 'oval': return ovalPoints(cx, cy, w, h, rot);
    case 'roundrect': return rectPoints(cx, cy, w, h, rot, (pad.rr ?? 0.25) * Math.min(w, h) + grow);
    default: return rectPoints(cx, cy, w, h, rot, 0);
  }
}
export function transformPts(pts, fn) { return pts.map(([x, y]) => fn(x, y)); }

// ---------- board outline ----------
export function outlinePoints(outline) {
  switch (outline.type) {
    case 'circle': { const r = outline.d / 2; return circlePoints(r, r, r, 96); }
    case 'polygon': { const bb = bboxOfPoints(outline.points); return ensureCCW(outline.points.map(([x, y]) => [x - bb[0], y - bb[1]])); }
    default: return rectPoints(outline.w / 2, outline.h / 2, outline.w, outline.h, 0, outline.r || 0);
  }
}
export function outlineSize(outline) {
  switch (outline.type) {
    case 'circle': return [outline.d, outline.d];
    case 'polygon': { const bb = bboxOfPoints(outline.points); return [bb[2] - bb[0], bb[3] - bb[1]]; }
    default: return [outline.w, outline.h];
  }
}

// ---------- text ----------
export function textPrimsToPolylines(prim) {
  // prim: {x,y,text,size,thickness,rot,mirror,align,font,letterSpacing,arc}
  const lines = String(prim.text ?? '').split('\n');
  const out = [];
  const lineH = prim.size * (prim.lineHeight || 1.6);
  const font = prim.font || DEFAULT_FONT;
  const arcR = prim.arc || 0;   // >0 bends text over a circle (text above the centre), <0 bends it the other way
  lines.forEach((line, li) => {
    const ts = fontStrokes(font, line, prim.size, { letterSpacing: prim.letterSpacing || 0 });
    let ox = 0;
    if (prim.align === 'center') ox = -ts.width / 2; else if (prim.align === 'right') ox = -ts.width;
    const oy = -li * lineH - (prim.valign === 'middle' ? -prim.size / 2 + (lines.length - 1) * lineH / 2 : 0);
    for (const s of ts.strokes) {
      const pts = s.map(([px, py]) => {
        let lx = px + ox, ly = py + oy;
        if (prim.mirror) lx = -lx;
        if (arcR) { // wrap the baseline onto a circle of radius |arcR| centred below (arcR>0) or above the text
          const R = Math.abs(arcR), sgn = arcR > 0 ? 1 : -1;
          const a = Math.PI / 2 - sgn * lx / R;          // angle along the arc
          const rr = R + sgn * ly;
          lx = rr * Math.cos(a); ly = sgn * (rr * Math.sin(a) - R);
        }
        return rotPt(lx + prim.x, ly + prim.y, prim.rot || 0, prim.x, prim.y);
      });
      out.push({ t: 'polyline', pts, w: prim.thickness, closed: false });
    }
  });
  return out;
}
export function textBBox(prim) {
  const pl = textPrimsToPolylines(prim);
  let bb = null; for (const p of pl) bb = unionBBox(bb, bboxOfPoints(p.pts));
  if (!bb) return [prim.x, prim.y, prim.x, prim.y];
  const t = (prim.thickness || 0.15) / 2;
  return [bb[0] - t, bb[1] - t, bb[2] + t, bb[3] + t];
}

// ---------- images → polygons (run-length rects merged) ----------
// bitmap: {w,h,data:Uint8Array (1 = ink)} — produced by js/import/image.js from ImageData.
export function bitmapToRects(bitmap) {
  const { w, h, data } = bitmap;
  const rects = []; // [x0,y0,x1,y1] in pixel coords
  const openRuns = new Map(); // key `${x0}:${x1}` -> rect index
  for (let y = 0; y < h; y++) {
    const rowRuns = new Map();
    let x = 0;
    while (x < w) {
      if (!data[y * w + x]) { x++; continue; }
      const x0 = x; while (x < w && data[y * w + x]) x++;
      const key = x0 + ':' + x;
      const idx = openRuns.get(key);
      if (idx !== undefined && rects[idx][3] === y) { rects[idx][3] = y + 1; rowRuns.set(key, idx); }
      else { rects.push([x0, y, x, y + 1]); rowRuns.set(key, rects.length - 1); }
    }
    openRuns.clear(); for (const [k, v] of rowRuns) openRuns.set(k, v);
  }
  return rects;
}
export function imageToPolys(item, bitmap) {
  // item: {x,y,w,h,rot,mirror}; bitmap pixels map to item rect. Row 0 = top of image.
  const rects = bitmapToRects(bitmap);
  const sx = item.w / bitmap.w, sy = item.h / bitmap.h;
  const out = [];
  for (const [px0, py0, px1, py1] of rects) {
    let x0 = -item.w / 2 + px0 * sx, x1 = -item.w / 2 + px1 * sx;
    const y0 = item.h / 2 - py1 * sy, y1 = item.h / 2 - py0 * sy;
    if (item.mirror) { const t = -x0; x0 = -x1; x1 = t; }
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => rotPt(x + item.x, y + item.y, item.rot || 0, item.x, item.y));
    out.push({ t: 'poly', pts, holes: [] });
  }
  return out;
}

// ---------- parts ----------
export function partTransform(part) {
  const bottom = part.side === 'bottom';
  const rot = part.rot || 0;
  return (lx, ly) => {
    if (bottom) lx = -lx;
    return rotPt(lx + part.x, ly + part.y, rot, part.x, part.y);
  };
}
export function partLayer(part, layer) { return part.side === 'bottom' ? flipLayer(layer) : layer; }

// Resolve a footprint definition (from library or inline part.fp) into board-frame pads + prims.
export function resolvePart(part, doc) {
  const fp = part.fp || getFootprint(part.lib, part);
  if (!fp) return null;
  const T = partTransform(part);
  const bottom = part.side === 'bottom';
  const rot = part.rot || 0;
  const pads = [];
  for (const p of fp.pads || []) {
    const [x, y] = T(p.x, p.y);
    let layer = p.layer || 'both';
    if (bottom && layer !== 'both') layer = layer === 'F' ? 'B' : 'F';
    const prot = (bottom ? -(p.rot || 0) : (p.rot || 0)) + rot;
    const pad = { ...p, x, y, rot: prot, layer, partRef: part.ref, plated: p.plated !== false, drill: p.drill || 0, slotLen: p.slotLen || 0, name: String(p.name ?? p.n ?? '') };
    pad.poly = padPoints(pad);
    pads.push(pad);
  }
  const holes = (fp.holes || []).map(h => { const [x, y] = T(h.x, h.y); return { x, y, d: h.d, plated: false, slotLen: h.slotLen || 0, rot: (bottom ? -(h.rot || 0) : (h.rot || 0)) + rot }; });
  const prims = []; // {layer, prim}
  const push = (layer, prim) => prims.push({ layer: partLayer(part, layer), prim });
  for (const g of fp.graphics || []) {
    const layer = g.layer || 'F.Silk';
    switch (g.t) {
      case 'line': { const a = T(g.x1, g.y1), b = T(g.x2, g.y2); push(layer, { t: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: g.w ?? 0.15 }); break; }
      case 'circle': { const c = T(g.cx, g.cy); push(layer, { t: 'circle', cx: c[0], cy: c[1], r: g.r, w: g.w ?? 0.15 }); break; }
      case 'arc': { const c = T(g.cx, g.cy); let a0 = g.a0, a1 = g.a1; if (bottom) { const t = 180 - a1; a1 = 180 - a0; a0 = t; } push(layer, { t: 'arc', cx: c[0], cy: c[1], r: g.r, a0: a0 + rot, a1: a1 + rot, w: g.w ?? 0.15 }); break; }
      case 'rect': { const pts = rectPoints(g.cx, g.cy, g.w, g.h, g.rot || 0, g.rx || 0).map(([x, y]) => T(x, y)); if (g.filled) push(layer, { t: 'poly', pts, holes: [] }); else push(layer, { t: 'polyline', pts, w: g.lw ?? 0.15, closed: true }); break; }
      case 'poly': { const pts = g.pts.map(([x, y]) => T(x, y)); if (g.filled !== false) push(layer, { t: 'poly', pts, holes: [] }); else push(layer, { t: 'polyline', pts, w: g.lw ?? 0.15, closed: true }); break; }
      case 'polyline': { push(layer, { t: 'polyline', pts: g.pts.map(([x, y]) => T(x, y)), w: g.w ?? 0.15, closed: !!g.closed }); break; }
      case 'text': { const c = T(g.x, g.y); const txt = g.text === '${REF}' ? part.ref : g.text === '${VALUE}' ? (part.value || '') : g.text; push(layer, { t: 'text', x: c[0], y: c[1], text: txt, size: g.size ?? 1, thickness: g.thickness ?? 0.15, rot: (bottom ? -(g.rot || 0) : (g.rot || 0)) + rot, mirror: bottom, align: g.align || 'center', valign: 'middle' }); break; }
    }
  }
  // reference designator (unless footprint hides it)
  if (fp.refText !== false && !part.hideRef) {
    const rp = fp.refPos || { x: 0, y: (fp.courtyard ? fp.courtyard.h / 2 + 1 : 2) };
    const c = T(rp.x, rp.y);
    push('F.Silk', { t: 'text', x: c[0], y: c[1], text: part.ref || '', size: 1, thickness: 0.15, rot: 0, mirror: bottom, align: 'center', valign: 'middle', isRef: true });
  }
  // courtyard bbox
  let bbox = null;
  const cy = fp.courtyard;
  if (cy) {
    const cp = cy.pts ? cy.pts : rectPoints(cy.x || 0, cy.y || 0, cy.w, cy.h);
    bbox = bboxOfPoints(cp.map(([x, y]) => T(x, y)));
  }
  for (const p of pads) bbox = unionBBox(bbox, bboxOfPoints(p.poly));
  const body3d = (fp.body3d || []).map(b => ({ ...b }));
  return { fp, pads, holes, prims, bbox, body3d, height: fp.height || 0, through: fp.through || null, name: fp.name, ref: part.ref, value: part.value, lib: part.lib, x: part.x, y: part.y, rot, side: part.side || 'top' };
}

// ---------- stack helpers ----------
export function stackLinkItems(doc, board) {
  // returns synthetic items (holes / parts) this board receives from stack links + through-parts.
  const out = [];
  const st = doc.stack; if (!st || !st.enabled) return out;
  const idx = doc.boards.indexOf(board);
  for (const link of st.links || []) {
    const lib = getFootprint(link.lib, link) || {};
    if (link.kind === 'standoff' || link.kind === 'screw') {
      out.push({ id: link.id + ':h', type: 'hole', x: link.x, y: link.y, d: link.opts?.holeD ?? lib.holeD ?? 3.2, fromLink: link.id });
    } else if (link.kind === 'connector') {
      const pair = lib.pair; if (!pair) continue;
      const lowerHalf = link.opts?.flip ? pair.upper : pair.lower;
      const upperHalf = link.opts?.flip ? pair.lower : pair.upper;
      const half = idx === 0 ? lowerHalf : upperHalf;
      out.push({ id: link.id + ':p', type: 'part', lib: half, ref: link.ref || 'J?', x: link.x, y: link.y, rot: link.rot || 0, side: idx === 0 ? 'top' : 'bottom', fromLink: link.id, value: lib.name });
    }
  }
  if (idx === 1) {
    // through-holes for parts on the lower board that poke through the upper board
    const lower = doc.boards[0];
    for (const it of lower.items) {
      if (it.type !== 'part' || !it.through) continue;
      const rp = resolvePart(it, doc); if (!rp || !rp.through) continue;
      const T = partTransform(it);
      const [x, y] = T(rp.through.x || 0, rp.through.y || 0);
      if (rp.through.slot) out.push({ id: it.id + ':thr', type: 'slot', x, y, len: rp.through.slot.len, w: rp.through.slot.w, rot: (it.rot || 0) + (rp.through.slot.rot || 0), fromPart: it.id });
      else out.push({ id: it.id + ':thr', type: 'hole', x, y, d: rp.through.d, fromPart: it.id });
    }
  }
  return out;
}

// ---------- the resolver ----------
export function defaultMaskMargin(doc) { return doc?.drc?.maskMargin ?? 0.05; }

export function resolveBoard(board, doc, opts = {}) {
  const textAsStrokes = !!opts.textAsStrokes;
  const imagesAsPolys = !!opts.imagesAsPolys;
  const bitmapFor = opts.bitmapFor || (() => null); // (imageItem) => bitmap
  const includeLinks = opts.includeLinks !== false;
  const layers = {}; for (const l of GRAPHIC_LAYERS) layers[l] = [];
  const drills = [], pads = [], parts = [], cutouts = [];
  const outline = outlinePoints(board.outline);
  const maskMargin = defaultMaskMargin(doc);
  const addPrim = (layer, prim, srcId) => {
    if (!layers[layer]) layers[layer] = [];
    if (prim.t === 'text' && textAsStrokes) { for (const pl of textPrimsToPolylines(prim)) layers[layer].push({ ...pl, src: srcId }); }
    else layers[layer].push({ ...prim, src: srcId });
  };
  const items = includeLinks ? board.items.concat(stackLinkItems(doc, board)) : board.items;
  const addPad = (pad, srcId) => {
    pad.poly = pad.poly || padPoints(pad);
    pads.push(pad);
    const cuLayers = pad.layer === 'both' ? ['F.Cu', 'B.Cu'] : pad.layer === 'B' ? ['B.Cu'] : ['F.Cu'];
    for (const l of cuLayers) addPrim(l, { t: 'poly', pts: pad.poly, holes: [] , net: pad.net, isPad: true, padName: pad.name}, srcId);
    if (pad.mask !== false) {
      const mm = pad.maskMargin ?? maskMargin;
      const mpoly = padPoints(pad, pad.x, pad.y, pad.rot, mm);
      for (const l of cuLayers) addPrim(l.replace('.Cu', '.Mask'), { t: 'poly', pts: mpoly, holes: [], isPad: true }, srcId);
    }
    if (!pad.drill && pad.paste !== false) {
      const l = pad.layer === 'B' ? 'B.Paste' : 'F.Paste';
      addPrim(l, { t: 'poly', pts: pad.poly, holes: [], isPad: true }, srcId);
    }
    if (pad.drill > 0) drills.push({ x: pad.x, y: pad.y, d: pad.drill, plated: pad.plated !== false, slotLen: pad.slotLen || 0, rot: pad.rot || 0, src: srcId });
  };
  for (const it of items) {
    const L = it.layer;
    switch (it.type) {
      case 'line': addPrim(L, { t: 'line', x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, w: it.width }, it.id); break;
      case 'arc': addPrim(L, { t: 'arc', cx: it.cx, cy: it.cy, r: it.r, a0: it.a0, a1: it.a1, w: it.width }, it.id); break;
      case 'circle':
        if (L === 'Edge.Cuts') { cutouts.push(circlePoints(it.cx, it.cy, it.r)); break; }
        addPrim(L, { t: 'circle', cx: it.cx, cy: it.cy, r: it.r, w: it.filled ? 0 : it.width }, it.id); break;
      case 'rect': {
        const pts = rectPoints(it.x, it.y, it.w, it.h, it.rot || 0, it.rx || 0);
        if (L === 'Edge.Cuts') { cutouts.push(pts); break; }
        if (it.filled) addPrim(L, { t: 'poly', pts, holes: [] }, it.id); else addPrim(L, { t: 'polyline', pts, w: it.width, closed: true }, it.id);
        break;
      }
      case 'polygon': {
        if (L === 'Edge.Cuts') { cutouts.push(it.points.slice()); break; }
        if (it.filled) addPrim(L, { t: 'poly', pts: it.points.slice(), holes: [] }, it.id); else addPrim(L, { t: 'polyline', pts: it.points.slice(), w: it.width, closed: true }, it.id);
        break;
      }
      case 'text': addPrim(L, { t: 'text', x: it.x, y: it.y, text: it.text, size: it.size, thickness: it.thickness, rot: it.rot || 0, mirror: !!it.mirror !== (layerSide(L) === 'bottom'), align: it.align || 'left', valign: it.valign || 'baseline', letterSpacing: it.letterSpacing || 0, font: it.font || DEFAULT_FONT, arc: it.arc || 0, lineHeight: it.lineHeight }, it.id); break;
      case 'image': {
        if (imagesAsPolys) { const bm = bitmapFor(it); if (bm) for (const p of imageToPolys({ ...it, mirror: !!it.mirror !== (layerSide(L) === 'bottom') }, bm)) addPrim(L, p, it.id); }
        else addPrim(L, { t: 'image', x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot || 0, src: it.src, threshold: it.threshold ?? 128, invert: !!it.invert, mirror: !!it.mirror !== (layerSide(L) === 'bottom'), id: it.id }, it.id);
        break;
      }
      case 'pad': addPad({ ...it, rot: it.rot || 0, layer: it.layer || 'both', plated: it.plated !== false, drill: it.drill || 0, slotLen: it.slot || 0, name: it.name || '', poly: null }, it.id); break;
      case 'hole': drills.push({ x: it.x, y: it.y, d: it.d, plated: false, slotLen: 0, rot: 0, src: it.id }); break;
      case 'slot': drills.push({ x: it.x, y: it.y, d: it.w, plated: false, slotLen: it.len, rot: it.rot || 0, src: it.id }); break;
      case 'via': {
        const ring = { t: 'circle', cx: it.x, cy: it.y, r: it.d / 2, w: 0, net: it.net, isVia: true };
        addPrim('F.Cu', ring, it.id); addPrim('B.Cu', ring, it.id);
        if (it.tented === false) { const m = { t: 'circle', cx: it.x, cy: it.y, r: it.d / 2 + maskMargin, w: 0 }; addPrim('F.Mask', m, it.id); addPrim('B.Mask', m, it.id); }
        drills.push({ x: it.x, y: it.y, d: it.drill, plated: true, slotLen: 0, rot: 0, src: it.id, via: true });
        break;
      }
      case 'trace': addPrim(it.layer, { t: 'polyline', pts: it.points.slice(), w: it.width, closed: false, net: it.net }, it.id); break;
      case 'path': addPrim(it.layer, { t: 'polyline', pts: it.points.slice(), w: it.width, closed: !!it.closed }, it.id); break;
      case 'region': addPrim(it.layer, { t: 'poly', pts: it.points.slice(), holes: [], net: it.net }, it.id); break;
      case 'part': {
        const rp = resolvePart(it, doc); if (!rp) break;
        for (const p of rp.pads) addPad(p, it.id);
        for (const h of rp.holes) drills.push({ ...h, src: it.id });
        for (const { layer, prim } of rp.prims) addPrim(layer, prim, it.id);
        parts.push({ ref: it.ref, value: it.value, lib: it.lib, name: rp.name, x: it.x, y: it.y, rot: rp.rot, side: rp.side, height: rp.height, body3d: rp.body3d, bbox: rp.bbox, id: it.id, fromLink: it.fromLink, through: !!it.through, fp: rp.fp });
        break;
      }
    }
  }
  const [W, H] = outlineSize(board.outline);
  return { outline, cutouts, layers, drills, pads, parts, bbox: [0, 0, W, H], size: [W, H], board };
}

// bounding box of a resolved prim
export function primBBox(p) {
  switch (p.t) {
    case 'line': { const h = p.w / 2; return [Math.min(p.x1, p.x2) - h, Math.min(p.y1, p.y2) - h, Math.max(p.x1, p.x2) + h, Math.max(p.y1, p.y2) + h]; }
    case 'polyline': { const b = bboxOfPoints(p.pts), h = p.w / 2; return [b[0] - h, b[1] - h, b[2] + h, b[3] + h]; }
    case 'arc': { const b = bboxOfPoints(arcPoints(p.cx, p.cy, p.r, p.a0, p.a1)), h = p.w / 2; return [b[0] - h, b[1] - h, b[2] + h, b[3] + h]; }
    case 'circle': { const r = p.r + (p.w || 0) / 2; return [p.cx - r, p.cy - r, p.cx + r, p.cy + r]; }
    case 'poly': return bboxOfPoints(p.pts);
    case 'text': return textBBox(p);
    case 'image': { return bboxOfPoints(rectPoints(p.x, p.y, p.w, p.h, p.rot)); }
  }
  return null;
}

// bounding box of a raw item (board frame) — used by editor hit-testing/selection
export function itemBBox(item, doc) {
  switch (item.type) {
    case 'line': { const h = item.width / 2; return [Math.min(item.x1, item.x2) - h, Math.min(item.y1, item.y2) - h, Math.max(item.x1, item.x2) + h, Math.max(item.y1, item.y2) + h]; }
    case 'arc': return primBBox({ t: 'arc', cx: item.cx, cy: item.cy, r: item.r, a0: item.a0, a1: item.a1, w: item.width });
    case 'circle': { const r = item.r + (item.filled ? 0 : item.width / 2); return [item.cx - r, item.cy - r, item.cx + r, item.cy + r]; }
    case 'rect': { const b = bboxOfPoints(rectPoints(item.x, item.y, item.w, item.h, item.rot || 0)); const h = item.filled ? 0 : item.width / 2; return [b[0] - h, b[1] - h, b[2] + h, b[3] + h]; }
    case 'polygon': case 'region': { const b = bboxOfPoints(item.points); const h = item.filled === false ? item.width / 2 : 0; return [b[0] - h, b[1] - h, b[2] + h, b[3] + h]; }
    case 'trace': case 'path': { const b = bboxOfPoints(item.points), h = item.width / 2; return [b[0] - h, b[1] - h, b[2] + h, b[3] + h]; }
    case 'text': return textBBox({ ...item, rot: item.rot || 0, mirror: !!item.mirror !== (layerSide(item.layer) === 'bottom'), align: item.align || 'left', font: item.font || DEFAULT_FONT, arc: item.arc || 0 });
    case 'image': return bboxOfPoints(rectPoints(item.x, item.y, item.w, item.h, item.rot || 0));
    case 'pad': return bboxOfPoints(padPoints({ ...item, rot: item.rot || 0 }));
    case 'hole': return [item.x - item.d / 2, item.y - item.d / 2, item.x + item.d / 2, item.y + item.d / 2];
    case 'slot': return bboxOfPoints(ovalPoints(item.x, item.y, item.len, item.w, item.rot || 0));
    case 'via': return [item.x - item.d / 2, item.y - item.d / 2, item.x + item.d / 2, item.y + item.d / 2];
    case 'part': { const rp = resolvePart(item, doc); return rp && rp.bbox ? rp.bbox : [item.x - 1, item.y - 1, item.x + 1, item.y + 1]; }
  }
  return null;
}

// hit test: does point (px,py) hit item within tolerance tol (mm)?
export function hitItem(item, px, py, tol, doc) {
  const bb = itemBBox(item, doc); if (!bb) return false;
  if (px < bb[0] - tol || px > bb[2] + tol || py < bb[1] - tol || py > bb[3] + tol) return false;
  switch (item.type) {
    case 'line': return distPointSeg(px, py, item.x1, item.y1, item.x2, item.y2) <= item.width / 2 + tol;
    case 'trace': case 'path': { for (let i = 0; i + 1 < item.points.length; i++) if (distPointSeg(px, py, ...item.points[i], ...item.points[i + 1]) <= item.width / 2 + tol) return true; if (item.closed && item.points.length > 2) return distPointSeg(px, py, ...item.points[item.points.length - 1], ...item.points[0]) <= item.width / 2 + tol; return false; }
    case 'circle': { const d = dist(px, py, item.cx, item.cy); return item.filled ? d <= item.r + tol : Math.abs(d - item.r) <= item.width / 2 + tol; }
    case 'arc': { const d = dist(px, py, item.cx, item.cy); if (Math.abs(d - item.r) > item.width / 2 + tol) return false; let a = Math.atan2(py - item.cy, px - item.cx) * R2D; let s = item.a1 - item.a0; while (s <= 0) s += 360; let rel = a - item.a0; while (rel < 0) rel += 360; return rel <= s + 5; }
    case 'rect': { const pts = rectPoints(item.x, item.y, item.w, item.h, item.rot || 0, item.rx || 0); if (item.filled) return pointInPolygon(px, py, pts) || nearPolyEdge(px, py, pts, tol); return nearPolyEdge(px, py, pts, item.width / 2 + tol); }
    case 'polygon': case 'region': { if (item.filled !== false) return pointInPolygon(px, py, item.points) || nearPolyEdge(px, py, item.points, tol); return nearPolyEdge(px, py, item.points, item.width / 2 + tol); }
    default: return true; // bbox hit is enough for text/image/pads/holes/parts
  }
}
export function nearPolyEdge(px, py, pts, tol) {
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if (distPointSeg(px, py, a[0], a[1], b[0], b[1]) <= tol) return true; }
  return false;
}

// translate / rotate items in place (used by editor + importers)
export function translateItem(item, dx, dy) {
  switch (item.type) {
    case 'line': item.x1 += dx; item.y1 += dy; item.x2 += dx; item.y2 += dy; break;
    case 'arc': case 'circle': item.cx += dx; item.cy += dy; break;
    case 'polygon': case 'region': case 'trace': case 'path': item.points = item.points.map(([x, y]) => [x + dx, y + dy]); break;
    default: if ('x' in item) { item.x += dx; item.y += dy; }
  }
}
export function rotateItem(item, deg, cx, cy) {
  const R = (x, y) => rotPt(x, y, deg, cx, cy);
  switch (item.type) {
    case 'line': { [item.x1, item.y1] = R(item.x1, item.y1); [item.x2, item.y2] = R(item.x2, item.y2); break; }
    case 'arc': { [item.cx, item.cy] = R(item.cx, item.cy); item.a0 += deg; item.a1 += deg; break; }
    case 'circle': { [item.cx, item.cy] = R(item.cx, item.cy); break; }
    case 'polygon': case 'region': case 'trace': case 'path': item.points = item.points.map(([x, y]) => R(x, y)); break;
    case 'hole': case 'via': { [item.x, item.y] = R(item.x, item.y); break; }
    default: { [item.x, item.y] = R(item.x, item.y); if ('rot' in item || ['rect', 'text', 'image', 'pad', 'slot', 'part'].includes(item.type)) item.rot = ((item.rot || 0) + deg) % 360; }
  }
}
export function itemCenter(item, doc) { const b = itemBBox(item, doc); return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0]; }
