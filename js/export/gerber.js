// LAMINA → RS-274X (Extended Gerber) exporter. Plain ES module, no DOM.
// Units mm, absolute, format 4.6 (integer coordinates = mm × 1e6). One file per non-empty layer
// per board plus the board profile, Protel extensions (JLCPCB / FlatCAM auto-detect):
//   <stem>.GTL .GBL .GTS .GBS .GTO .GBO .GTP .GBP .GKO   under  gerber/<stem>/
// Everything is drawn in board-local coordinates as seen from the top (bottom layers NOT mirrored),
// Y up, origin = bottom-left corner of the board outline bbox — exactly the LAMINA frame.
import { resolveBoard, arcPoints, circlePoints, ensureCCW, distPointSeg } from '../geom.js';
import { fmt, safeName } from './common.js';

export const GERBER_VERSION = '0.1';
export const MIN_APERTURE = 0.01;      // mm — a zero-width stroke is illegal, clamp to this
export const OUTLINE_WIDTH = 0.1;      // mm — profile stroke width (JLC convention)

// layer → { ext, fn (TF.FileFunction), pol (TF.FilePolarity) }
export const GERBER_LAYERS = {
  'F.Cu':    { ext: 'GTL', fn: 'Copper,L1,Top', pol: 'Positive' },
  'B.Cu':    { ext: 'GBL', fn: 'Copper,L2,Bot', pol: 'Positive' },
  'F.Mask':  { ext: 'GTS', fn: 'Soldermask,Top', pol: 'Negative' },
  'B.Mask':  { ext: 'GBS', fn: 'Soldermask,Bot', pol: 'Negative' },
  'F.Silk':  { ext: 'GTO', fn: 'Legend,Top', pol: 'Positive' },
  'B.Silk':  { ext: 'GBO', fn: 'Legend,Bot', pol: 'Positive' },
  'F.Paste': { ext: 'GTP', fn: 'Paste,Top', pol: 'Positive' },
  'B.Paste': { ext: 'GBP', fn: 'Paste,Bot', pol: 'Positive' },
};
// optional (opts.includeFab) — not part of a JLC order
export const GERBER_FAB_LAYERS = {
  'F.Fab': { ext: 'GTF', fn: 'AssemblyDrawing,Top', pol: 'Positive' },
  'B.Fab': { ext: 'GBF', fn: 'AssemblyDrawing,Bot', pol: 'Positive' },
};
export const OUTLINE_LAYER = { ext: 'GKO', fn: 'Profile,NP', pol: 'Positive' };

const EPS = 1e-6;
// coordinate → integer string in 4.6 format (mm × 1e6, rounded, no decimals, no "-0")
export function gcoord(v) {
  const n = Math.round(v * 1e6);
  return String(n === 0 ? 0 : n); // String(-0) is "0" anyway, but be explicit
}
const XY = (x, y) => `X${gcoord(x)}Y${gcoord(y)}`;
const ap = v => fmt(Math.max(v, 0), 6); // aperture dims
// G04 comment payload: no '*' / '%', printable 7-bit ASCII only (old viewers choke on UTF-8)
export function g04safe(s) { return String(s).replace(/[*%]/g, '_').replace(/[^\x20-\x7e]/g, '_'); }

// ---------- geometry classification of pad polys ----------
// Recognise the polys the resolver produces for pads so we can flash real apertures instead of
// drawing regions: axis-aligned rectangle (4 pts) → R, circle (all pts equidistant) → C,
// axis-aligned stadium → O. Anything else (rotated rect, roundrect, polygon) → region.
function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
export function classifyPadPoly(pts) {
  const n = pts.length;
  if (n < 4) return null;
  if (n === 4) {
    // axis-aligned rectangle: every edge horizontal or vertical (bbox is exact for a rectangle)
    const [x0, y0, x1, y1] = bboxOf(pts);
    const w = x1 - x0, h = y1 - y0;
    if (w < EPS || h < EPS) return null;
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      if (Math.abs(a[0] - b[0]) > EPS && Math.abs(a[1] - b[1]) > EPS) return null;
    }
    return { kind: 'R', cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w, h };
  }
  if (n < 8) return null;
  // vertex centroid: exact centre for the symmetric point sets circlePoints/ovalPoints produce
  let cx = 0, cy = 0; for (const [x, y] of pts) { cx += x; cy += y; } cx /= n; cy /= n;
  // circle: all vertices equidistant from the centre
  const r0 = Math.hypot(pts[0][0] - cx, pts[0][1] - cy);
  if (r0 > EPS) {
    let circ = true;
    for (const [x, y] of pts) if (Math.abs(Math.hypot(x - cx, y - cy) - r0) > 1e-5) { circ = false; break; }
    if (circ) return { kind: 'C', cx, cy, d: 2 * r0 };
  }
  // axis-aligned obround (stadium): all vertices at distance r from the centre segment.
  // r = extreme extent across the short axis (ovalPoints always emits the ±90° arc points),
  // half-length solved from the vertex farthest along the long axis, then verified on every vertex.
  const fit = (horizontal) => {
    let r = 0, far = null, farD = -1;
    for (const [x, y] of pts) {
      const across = horizontal ? Math.abs(y - cy) : Math.abs(x - cx);
      const along = horizontal ? Math.abs(x - cx) : Math.abs(y - cy);
      if (across > r) r = across;
      if (along > farD) { farD = along; far = [x, y]; }
    }
    if (r < EPS || !far) return null;
    const acrossFar = horizontal ? far[1] - cy : far[0] - cx;
    const q = r * r - acrossFar * acrossFar; if (q < -1e-9) return null;
    const half = farD - Math.sqrt(Math.max(0, q));
    if (half < 1e-6) return null; // that would be a circle (handled above)
    const ax = horizontal ? cx - half : cx, ay = horizontal ? cy : cy - half;
    const bx = horizontal ? cx + half : cx, by = horizontal ? cy : cy + half;
    for (const [x, y] of pts) if (Math.abs(distPointSeg(x, y, ax, ay, bx, by) - r) > 1e-5) return null;
    return horizontal ? { kind: 'O', cx, cy, w: 2 * (half + r), h: 2 * r } : { kind: 'O', cx, cy, w: 2 * r, h: 2 * (half + r) };
  };
  return fit(true) || fit(false);
}

// ---------- one Gerber file ----------
export class GerberWriter {
  constructor({ fileFunction, polarity, comment }) {
    this.fileFunction = fileFunction; this.polarity = polarity || 'Positive'; this.comment = comment || '';
    this.apertures = new Map(); // key → Dnn
    this.nextD = 10;
    this.body = [];
    this.curAp = null;
    this.stats = { d01: 0, d02: 0, d03: 0, regions: 0 };
  }
  aperture(key) { // key like 'C,0.400000' | 'R,1.600000X1.600000' | 'O,2.200000X1.600000'
    let d = this.apertures.get(key);
    if (d === undefined) { d = this.nextD++; this.apertures.set(key, d); }
    return d;
  }
  select(key) {
    const d = this.aperture(key);
    if (this.curAp !== d) { this.body.push(`D${d}*`); this.curAp = d; }
    return d;
  }
  comment_(s) { this.body.push(`G04 ${g04safe(s)}*`); }
  strokeWidthKey(w) { return `C,${ap(Math.max(w || 0, MIN_APERTURE))}`; }
  // polyline stroke with round aperture of width w
  polyline(pts, w, closed = false) {
    if (!pts || pts.length < 2) return;
    this.select(this.strokeWidthKey(w));
    this.body.push(`${XY(pts[0][0], pts[0][1])}D02*`); this.stats.d02++;
    for (let i = 1; i < pts.length; i++) { this.body.push(`${XY(pts[i][0], pts[i][1])}D01*`); this.stats.d01++; }
    if (closed && (Math.abs(pts[0][0] - pts[pts.length - 1][0]) > EPS || Math.abs(pts[0][1] - pts[pts.length - 1][1]) > EPS)) {
      this.body.push(`${XY(pts[0][0], pts[0][1])}D01*`); this.stats.d01++;
    }
  }
  line(x1, y1, x2, y2, w) { this.polyline([[x1, y1], [x2, y2]], w); }
  flash(key, x, y) { this.select(key); this.body.push(`${XY(x, y)}D03*`); this.stats.d03++; }
  // filled region (single contour). Polarity handled by the caller.
  regionContour(pts) {
    if (!pts || pts.length < 3) return;
    this.body.push('G36*');
    this.body.push(`${XY(pts[0][0], pts[0][1])}D02*`);
    for (let i = 1; i < pts.length; i++) this.body.push(`${XY(pts[i][0], pts[i][1])}D01*`);
    this.body.push(`${XY(pts[0][0], pts[0][1])}D01*`); // close
    this.body.push('G37*');
    this.stats.regions++;
  }
  // filled poly with optional holes: outer as dark region, holes as clear regions immediately after,
  // then back to dark. Local polarity dance = later features are unaffected.
  poly(pts, holes) {
    // regions need *some* current aperture for old viewers; select the default one if none yet
    if (this.curAp === null) this.select(this.strokeWidthKey(OUTLINE_WIDTH));
    this.regionContour(pts);
    if (holes && holes.length) {
      this.body.push('%LPC*%');
      for (const h of holes) this.regionContour(h);
      this.body.push('%LPD*%');
    }
  }
  toString() {
    const out = [];
    out.push(`%TF.GenerationSoftware,LAMINA,lamina,${GERBER_VERSION}*%`);
    out.push(`%TF.CreationDate,${new Date().toISOString()}*%`);
    if (this.fileFunction) out.push(`%TF.FileFunction,${this.fileFunction}*%`);
    out.push(`%TF.FilePolarity,${this.polarity}*%`);
    out.push('%TF.SameCoordinates,Original*%');
    out.push('%FSLAX46Y46*%');
    out.push('%MOMM*%');
    if (this.comment) for (const c of String(this.comment).split('\n')) out.push(`G04 ${g04safe(c)}*`);
    out.push('G04 Coordinates: mm, absolute, 4.6 (integer = mm x 1e6), Y up, origin = board bottom-left*');
    out.push('G01*'); // linear interpolation for everything (arcs are flattened)
    out.push('%LPD*%');
    // aperture dictionary (in D-code order)
    const list = Array.from(this.apertures.entries()).sort((a, b) => a[1] - b[1]);
    for (const [key, d] of list) out.push(`%ADD${d}${key}*%`);
    if (!list.length) { out.push(`%ADD10C,${ap(OUTLINE_WIDTH)}*%`); } // empty file still needs a valid dictionary
    out.push(...this.body);
    out.push('M02*');
    return out.join('\n') + '\n';
  }
}

// ---------- prim → gerber ----------
export function emitPrim(g, p) {
  switch (p.t) {
    case 'line': g.line(p.x1, p.y1, p.x2, p.y2, p.w); break;
    case 'polyline': g.polyline(p.pts, p.w, !!p.closed); break;
    case 'arc': g.polyline(arcPoints(p.cx, p.cy, p.r, p.a0, p.a1), p.w, false); break;
    case 'circle':
      if (!p.w) g.flash(`C,${ap(2 * p.r)}`, p.cx, p.cy);
      else g.polyline(circlePoints(p.cx, p.cy, p.r), p.w, true);
      break;
    case 'poly': {
      if (p.isPad && !(p.holes && p.holes.length)) {
        const c = classifyPadPoly(p.pts);
        if (c) {
          if (c.kind === 'C') g.flash(`C,${ap(c.d)}`, c.cx, c.cy);
          else if (c.kind === 'R') g.flash(`R,${ap(c.w)}X${ap(c.h)}`, c.cx, c.cy);
          else g.flash(`O,${ap(c.w)}X${ap(c.h)}`, c.cx, c.cy);
          break;
        }
      }
      g.poly(p.pts, p.holes);
      break;
    }
    // 'text' / 'image' only appear when the resolver was not asked to flatten them — we always ask.
    default: break;
  }
}

function boardComment(doc, board, res) {
  return `LAMINA ${GERBER_VERSION} - ${doc.name || 'untitled'} / ${board.name} (${fmt(res.size[0], 3)} x ${fmt(res.size[1], 3)} mm, ${fmt(board.thickness ?? 1.6, 2)} mm, ${board.color || 'green'} mask, ${board.finish || 'HASL'})`;
}

// Build gerber files for one resolved board. Returns [{name,data,layer}].
export function gerberFilesForBoard(doc, board, res, opts = {}) {
  const stem = safeName(board.name);
  const dir = (opts.dir === undefined ? 'gerber' : opts.dir);
  const prefix = dir ? `${dir}/${stem}/` : '';
  const files = [];
  const comment = boardComment(doc, board, res);
  const layerDefs = { ...GERBER_LAYERS, ...(opts.includeFab ? GERBER_FAB_LAYERS : {}) };
  for (const [layer, def] of Object.entries(layerDefs)) {
    const prims = res.layers[layer] || [];
    if (!prims.length && !(opts.emptyLayers && GERBER_LAYERS[layer])) continue;
    const g = new GerberWriter({ fileFunction: def.fn, polarity: def.pol, comment: `${comment}\nLayer: ${layer}` });
    for (const p of prims) emitPrim(g, p);
    files.push({ name: `${prefix}${stem}.${def.ext}`, data: g.toString(), layer, stats: g.stats });
  }
  // profile: outline + cutouts as 0.1 mm closed strokes (always)
  const g = new GerberWriter({ fileFunction: OUTLINE_LAYER.fn, polarity: OUTLINE_LAYER.pol, comment: `${comment}\nLayer: Edge.Cuts (board profile + internal cutouts)` });
  g.polyline(ensureCCW(res.outline), OUTLINE_WIDTH, true);
  for (const c of res.cutouts) g.polyline(ensureCCW(c), OUTLINE_WIDTH, true);
  files.push({ name: `${prefix}${stem}.${OUTLINE_LAYER.ext}`, data: g.toString(), layer: 'Edge.Cuts', stats: g.stats });
  return files;
}

export function resolveForFab(board, doc, opts = {}) {
  return resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: opts.bitmapFor });
}

// opts: { boards:[idx...], bitmapFor, dir:'gerber', includeFab:false, emptyLayers:false }
export function exportGerber(doc, opts = {}) {
  const idxs = opts.boards || doc.boards.map((_, i) => i);
  const out = [];
  for (const i of idxs) {
    const board = doc.boards[i]; if (!board) continue;
    const res = resolveForFab(board, doc, opts);
    for (const f of gerberFilesForBoard(doc, board, res, opts)) out.push({ name: f.name, data: f.data });
  }
  return out;
}
