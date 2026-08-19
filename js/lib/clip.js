// LAMINA area engine — raster-backed 2D booleans, offsets, morphology and generative fills.
// Pure ES module: no DOM, no npm, no Math.random / Date.now (deterministic).
// Units: mm, Y up, angles degrees CCW — same frame as js/geom.js (see docs/FORMAT.md).
//
// Data types
//   polygon : [[x,y], ...]                     implicitly closed
//   shape   : { outer:[[x,y]...], holes:[[[x,y]...]] }
//   shapes  : shape[]                          (every function also accepts a bare polygon
//                                               or an array of polygons for convenience)
//   mask    : { w,h,x0,y0,res,data:Uint8Array } pixel (i,j) centre = (x0+(i+.5)res, y0+(j+.5)res)
//   lines   : { lines: [[[x,y],...], ...] }    open/closed polylines (generators)
//
// Common options (every exported function accepts them):
//   res       mm per pixel               default 0.05
//   simplify  Douglas–Peucker tolerance  default res (one pixel); shrinks automatically
//                                         for small features, and structural corners are kept
//   maxPx     mask area cap              default 40e6 (resolution degrades + warns above it)
//   warnings  array to push warnings into / onWarn(msg) callback
//
// Accuracy: boundaries land on the half-pixel grid, so every result is accurate to about
// ±res (±0.05 mm by default). Areas of smooth shapes come out within ~0.2 % at defaults.

import {
  pointInPolygon, polygonArea, bboxOfPoints, distPointSeg, segsForRadius,
  circlePoints, arcPoints, rectPoints, ovalPoints, padPoints, D2R,
} from '../geom.js';

export const DEF_RES = 0.05;
export const MAX_PX = 40e6;
const EPS = 1e-12;

// ---------------------------------------------------------------- small utils
function warn(opts, msg) {
  if (!opts) return;
  if (Array.isArray(opts.warnings)) opts.warnings.push(msg);
  if (typeof opts.onWarn === 'function') opts.onWarn(msg);
}
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
function isPt(p) { return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && isFinite(p[0]) && isFinite(p[1]); }
function unionBB(a, b) { if (!a) return b; if (!b) return a; return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; }
function interBB(a, b) {
  if (!a || !b) return null;
  const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return (r[2] > r[0] && r[3] > r[1]) ? r : null;
}
function padBB(b, p) { return b ? [b[0] - p, b[1] - p, b[2] + p, b[3] + p] : null; }

/** Normalise anything shape-ish into shape[]. Accepts shapes, one shape, a polygon,
 *  an array of polygons, or `{shapes:[...]}`. Never throws; returns [] for junk. */
export function normShapes(input) {
  if (!input) return [];
  if (!Array.isArray(input)) {
    if (Array.isArray(input.shapes)) return normShapes(input.shapes);
    if (Array.isArray(input.outer)) return normShapes([input]);
    return [];
  }
  if (input.length === 0) return [];
  const first = input[0];
  if (first && !Array.isArray(first) && Array.isArray(first.outer)) {
    const out = [];
    for (const s of input) {
      if (!s || !Array.isArray(s.outer) || s.outer.length < 3) continue;
      const holes = Array.isArray(s.holes) ? s.holes.filter(h => Array.isArray(h) && h.length >= 3) : [];
      out.push({ outer: s.outer, holes });
    }
    return out;
  }
  if (isPt(first)) return input.length >= 3 ? [{ outer: input, holes: [] }] : [];
  if (Array.isArray(first)) {
    const out = [];
    for (const p of input) if (Array.isArray(p) && p.length >= 3 && isPt(p[0])) out.push({ outer: p, holes: [] });
    return out;
  }
  return [];
}
export function shapesBBox(shapes) {
  const S = normShapes(shapes);
  let bb = null;
  for (const s of S) bb = unionBB(bb, bboxOfPoints(s.outer));
  return bb;
}
/** Total area (outers minus holes), mm². */
export function shapesArea(shapes) {
  let a = 0;
  for (const s of normShapes(shapes)) {
    a += Math.abs(polygonArea(s.outer));
    for (const h of s.holes) a -= Math.abs(polygonArea(h));
  }
  return a;
}
/** Even-odd-per-shape point test: inside an outer and not inside one of its holes. */
export function pointInShapes(shapes, x, y) {
  for (const s of normShapes(shapes)) {
    if (!pointInPolygon(x, y, s.outer)) continue;
    let hole = false;
    for (const h of s.holes) if (pointInPolygon(x, y, h)) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
export function cloneShapes(shapes) {
  return normShapes(shapes).map(s => ({ outer: s.outer.map(p => [p[0], p[1]]), holes: s.holes.map(h => h.map(p => [p[0], p[1]])) }));
}

// ------------------------------------------------------------- PRNG + noise
/** mulberry32 — deterministic, tiny, good enough for art. Returns ()=>[0,1). */
export function rng(seed = 1) {
  let a = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sstep = t => t * t * (3 - 2 * t);
/** 2D value noise in [0,1). */
export function valueNoise(x, y, seed = 1) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = sstep(x - ix), fy = sstep(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
/** Fractal value noise in [0,1), `oct` octaves. */
export function fbm(x, y, seed = 1, oct = 4) {
  let v = 0, amp = 0.5, tot = 0, fx = x, fy = y;
  for (let i = 0; i < oct; i++) { v += valueNoise(fx, fy, seed + i * 1013) * amp; tot += amp; amp *= 0.5; fx *= 2.03; fy *= 2.03; }
  return v / (tot || 1);
}

// ------------------------------------------------- exact polygon primitives
/** Stadium (round-capped thick segment) as one polygon. Exact. */
export function stadium(ax, ay, bx, by, w, segs) {
  const r = Math.max(w, 0) / 2;
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if (r <= EPS) return len > EPS ? [[ax, ay], [bx, by]] : [];
  if (len < EPS) return circlePoints(ax, ay, r, segs);
  const ux = dx / len, uy = dy / len;
  const a0 = Math.atan2(uy, ux) * 180 / Math.PI;
  const n = Math.max(6, Math.ceil((segs || segsForRadius(r)) / 2));
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (a0 - 90 + 180 * i / n) * D2R; pts.push([bx + r * Math.cos(a), by + r * Math.sin(a)]); }
  for (let i = 0; i <= n; i++) { const a = (a0 + 90 + 180 * i / n) * D2R; pts.push([ax + r * Math.cos(a), ay + r * Math.sin(a)]); }
  return pts;
}
export function discShape(cx, cy, r, segs) { return { outer: circlePoints(cx, cy, Math.max(r, 0), segs), holes: [] }; }
export function ringShape(cx, cy, r, w, segs) {
  const ro = r + w / 2, ri = r - w / 2;
  if (ri <= EPS) return discShape(cx, cy, ro, segs);
  return { outer: circlePoints(cx, cy, ro, segs), holes: [circlePoints(cx, cy, ri, segs)] };
}
function rectShape(x0, y0, x1, y1) { return { outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] }; }

/** Sutherland–Hodgman clip of a convex polygon by the half-plane n·p <= c. */
export function clipConvex(poly, nx, ny, c) {
  if (!poly || poly.length < 3) return [];
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 3 ? out : [];
}
/** Exact inward offset of a CONVEX polygon (mitred). */
export function insetConvex(poly, g) {
  if (g <= 0) return poly;
  let p = polygonArea(poly) < 0 ? poly.slice().reverse() : poly;
  for (let i = 0; i < p.length && p.length >= 3; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    if (l < EPS) continue;
    const nx = dy / l, ny = -dx / l;                 // outward normal for CCW
    p = clipConvex(p, nx, ny, nx * a[0] + ny * a[1] - g);
    if (p.length < 3) return [];
  }
  return p;
}
/** Cheap O(n²) self-intersection test, used only for the exact fast paths. */
function isSimpleRing(pts, cap = 400) {
  const n = pts.length;
  if (n < 3 || n > cap) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS) return false;
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = pts[j], d = pts[(j + 1) % n];
      if (segsCross(a, b, c, d)) return false;
    }
  }
  return true;
}
function segsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const on = (p, q, r) => o(p, q, r) === 0 && Math.min(p[0], q[0]) - EPS <= r[0] && r[0] <= Math.max(p[0], q[0]) + EPS && Math.min(p[1], q[1]) - EPS <= r[1] && r[1] <= Math.max(p[1], q[1]) + EPS;
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

// =====================================================================
//  RASTER LAYER
// =====================================================================

/** Allocate an empty mask covering `bb` (mm) padded by `pad`, at `res` mm/px.
 *  Always leaves a 1 px empty border so contours close and shrinks behave. */
export function newMask(bb, opts = {}) {
  let res = num(opts.res, DEF_RES);
  if (!(res > 0)) res = DEF_RES;
  const maxPx = num(opts.maxPx, MAX_PX);
  const pad = num(opts.pad, 0);
  let b = bb ? [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad] : [0, 0, 0, 0];
  let ww = Math.max(b[2] - b[0], res), hh = Math.max(b[3] - b[1], res);
  let w = Math.ceil(ww / res) + 3, h = Math.ceil(hh / res) + 3;
  if (w * h > maxPx) {
    const k = Math.sqrt((w * h) / maxPx) * 1.0005;
    const nres = res * k;
    warn(opts, `clip: mask ${w}×${h} px exceeds ${maxPx} px cap — resolution degraded ${res.toFixed(4)} → ${nres.toFixed(4)} mm/px`);
    res = nres;
    w = Math.ceil(ww / res) + 3; h = Math.ceil(hh / res) + 3;
  }
  return { w, h, x0: b[0] - res, y0: b[1] - res, res, data: new Uint8Array(w * h), warnings: [] };
}
export function maskLike(m, opts = {}) {
  return { w: m.w, h: m.h, x0: m.x0, y0: m.y0, res: m.res, data: new Uint8Array(m.w * m.h), warnings: [] };
}
export const maskToMM = (m, i, j) => [m.x0 + (i + 0.5) * m.res, m.y0 + (j + 0.5) * m.res];
export function maskAt(m, x, y) {
  const i = Math.floor((x - m.x0) / m.res), j = Math.floor((y - m.y0) / m.res);
  if (i < 0 || j < 0 || i >= m.w || j >= m.h) return 0;
  return m.data[j * m.w + i];
}
export function maskCount(m) { let c = 0; const d = m.data; for (let i = 0; i < d.length; i++) if (d[i]) c++; return c; }
/** Area in mm² implied by the set pixels (handy for tests / sanity checks). */
export function maskArea(m) { return maskCount(m) * m.res * m.res; }

// even-odd scanline fill of one shape's rings (outer + holes) into the mask
function fillRings(mask, rings) {
  const { w, h, x0, y0, res, data } = mask;
  let bb = null;
  for (const r of rings) if (r && r.length >= 3) bb = unionBB(bb, bboxOfPoints(r));
  if (!bb) return;
  let j0 = Math.ceil((bb[1] - y0) / res - 0.5), j1 = Math.floor((bb[3] - y0) / res - 0.5);
  if (j0 < 0) j0 = 0; if (j1 > h - 1) j1 = h - 1;
  if (j1 < j0) return;
  // flatten edges, bucket by scanline row (skip horizontal edges, they never cross)
  const ex0 = [], ey0 = [], ex1 = [], ey1 = [], elo = [], ehi = [];
  for (const r of rings) {
    if (!r || r.length < 3) continue;
    for (let k = 0, m = r.length - 1; k < r.length; m = k++) {
      const ay = r[m][1], by = r[k][1];
      if (ay === by) continue;
      const lo = Math.min(ay, by), hi = Math.max(ay, by);
      let a = Math.ceil((lo - y0) / res - 0.5), b = Math.floor((hi - y0) / res - 0.5);
      if (a < j0) a = j0; if (b > j1) b = j1;
      if (b < a) continue;
      ex0.push(r[m][0]); ey0.push(ay); ex1.push(r[k][0]); ey1.push(by); elo.push(a); ehi.push(b);
    }
  }
  const ne = elo.length;
  if (!ne) return;
  const rows = j1 - j0 + 1;
  // counting sort of the edges into per-scanline buckets
  const per = new Int32Array(rows);
  let total = 0;
  for (let e = 0; e < ne; e++) { total += ehi[e] - elo[e] + 1; for (let j = elo[e]; j <= ehi[e]; j++) per[j - j0]++; }
  const bucketed = total <= 6e6;                 // pathological input falls back to a plain scan
  const start = new Int32Array(bucketed ? rows + 1 : 0);
  let bucket = null;
  if (bucketed) {
    for (let i = 0; i < rows; i++) start[i + 1] = start[i] + per[i];
    bucket = new Int32Array(total);
    const fill = start.slice(0, rows);
    for (let e = 0; e < ne; e++) for (let j = elo[e]; j <= ehi[e]; j++) bucket[fill[j - j0]++] = e;
  }
  let xsBuf = new Float64Array(64);
  for (let j = j0; j <= j1; j++) {
    const s = bucketed ? start[j - j0] : 0, en = bucketed ? start[j - j0 + 1] : ne;
    if (en - s < 2) continue;
    if (en - s > xsBuf.length) xsBuf = new Float64Array((en - s) * 2);
    const sy = y0 + (j + 0.5) * res;
    let n = 0;
    for (let k = s; k < en; k++) {
      const e = bucketed ? bucket[k] : k;
      const ay = ey0[e], by = ey1[e];
      if ((ay > sy) === (by > sy)) continue;
      xsBuf[n++] = ex0[e] + (sy - ay) * (ex1[e] - ex0[e]) / (by - ay);
    }
    if (n < 2) continue;
    const arr = Array.prototype.slice.call(xsBuf.subarray(0, n)).sort((a, b) => a - b);
    const row = j * w;
    for (let k = 0; k + 1 < n; k += 2) {
      let i0 = Math.ceil((arr[k] - x0) / res - 0.5), i1 = Math.floor((arr[k + 1] - x0) / res - 0.5);
      if (i1 < 0 || i0 > w - 1) continue;
      if (i0 < 0) i0 = 0; if (i1 > w - 1) i1 = w - 1;
      for (let i = i0; i <= i1; i++) data[row + i] = 1;
    }
  }
}

/** Rasterize shapes into a Uint8 mask. opts: {res, pad, bbox, like, maxPx}. */
export function rasterize(shapes, opts = {}) {
  const S = normShapes(shapes);
  const mask = opts.like ? maskLike(opts.like) : newMask(opts.bbox || shapesBBox(S) || [0, 0, 0, 0], opts);
  for (const s of S) fillRings(mask, [s.outer, ...s.holes]);
  return mask;
}
/** Add shapes to an existing mask (union). */
export function rasterizeInto(mask, shapes) {
  for (const s of normShapes(shapes)) fillRings(mask, [s.outer, ...s.holes]);
  return mask;
}

// --------------------------------------------------- exact Euclidean distance
// Felzenszwalb & Huttenlocher squared distance transform, O(n).
function dt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}
const BIG = 1e18;
/** Squared distance (px²) from every pixel to the nearest pixel with data!==0 (seedInside)
 *  or data===0 (!seedInside). Returns Float32Array(w*h). */
export function edtSq(mask, seedInside) {
  const { w, h, data } = mask;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (seedInside ? data[i] !== 0 : data[i] === 0) ? 0 : BIG;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w; i++) {                       // columns
    for (let j = 0; j < h; j++) f[j] = out[j * w + i];
    dt1d(f, h, d, v, z);
    for (let j = 0; j < h; j++) out[j * w + i] = d[j];
  }
  for (let j = 0; j < h; j++) {                       // rows
    const row = j * w;
    for (let i = 0; i < w; i++) f[i] = out[row + i];
    dt1d(f, w, d, v, z);
    for (let i = 0; i < w; i++) out[row + i] = d[i];
  }
  return out;
}
/** Signed distance in mm from the region boundary (positive inside). Float32Array(w*h). */
export function maskSDF(mask) {
  const di = edtSq(mask, false);     // inside pixels: distance to nearest outside pixel
  const dobuf = edtSq(mask, true);   // outside pixels: distance to nearest inside pixel
  const { data, res } = mask;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ? (Math.sqrt(di[i]) - 0.5) * res : -((Math.sqrt(dobuf[i]) - 0.5) * res);
  }
  return out;
}
/** Grow (d>0) / shrink (d<0) a mask in place by `d` mm, exact Euclidean = round joins. */
export function maskOffset(mask, dmm) {
  const d = dmm / mask.res;
  if (Math.abs(d) < 1e-9) return mask;
  const t = (Math.abs(d) + 0.5) * (Math.abs(d) + 0.5);
  const data = mask.data;
  if (d > 0) { const e = edtSq(mask, true); for (let i = 0; i < data.length; i++) data[i] = e[i] <= t ? 1 : 0; }
  else { const e = edtSq(mask, false); for (let i = 0; i < data.length; i++) data[i] = e[i] > t ? 1 : 0; }
  return mask;
}

// ------------------------------------------------------ marching squares
// Cell (i,j) corners = nodes (i,j),(i+1,j),(i+1,j+1),(i,j+1); node (i,j) is the
// centre of pixel (i,j). Segments are emitted with "inside" (>= level) on the LEFT,
// so outer rings come out CCW (positive area) and holes CW.
const MS_SEG = [
  null,            // 0
  [0, 3],          // 1  bl        B->L
  [1, 0],          // 2  br        R->B
  [1, 3],          // 3  bl,br     R->L
  [2, 1],          // 4  tr        T->R
  [0, 1, 2, 3],    // 5  bl,tr     B->R, T->L
  [2, 0],          // 6  br,tr     T->B
  [2, 3],          // 7  !tl       T->L
  [3, 2],          // 8  tl        L->T
  [0, 2],          // 9  bl,tl     B->T
  [3, 0, 1, 2],    // 10 br,tl     L->B, R->T
  [1, 2],          // 11 !tr       R->T
  [3, 1],          // 12 tr,tl     L->R
  [0, 1],          // 13 !br       B->R
  [3, 0],          // 14 !bl       L->B
  null,            // 15
];
/** Trace iso-contours of a field. Returns [{pts:[[gx,gy]..], closed}] in node coords. */
export function traceContours(data, w, h, level, opts = {}) {
  const outside = num(opts.outside, level - 1);
  const border = opts.border !== false;
  const S = (i, j) => (i < 0 || j < 0 || i >= w || j >= h) ? outside : data[j * w + i];
  const i0 = border ? -1 : 0, i1 = border ? w - 1 : w - 2;
  const j0 = border ? -1 : 0, j1 = border ? h - 1 : h - 2;
  const stride = w + 2;
  const from = [], to = [];
  // edge keys: horizontal (i,j)-(i+1,j) => ((j+1)*stride+(i+1))*2 ; vertical (i,j)-(i,j+1) => +1
  for (let j = j0; j <= j1; j++) {
    let bl = S(i0, j), tl = S(i0, j + 1);
    for (let i = i0; i <= i1; i++) {
      const br = S(i + 1, j), tr = S(i + 1, j + 1);
      const code = (bl >= level ? 1 : 0) | (br >= level ? 2 : 0) | (tr >= level ? 4 : 0) | (tl >= level ? 8 : 0);
      const seg = MS_SEG[code];
      if (seg) {
        const base = ((j + 1) * stride + (i + 1)) * 2;
        const E = [base, ((j + 1) * stride + (i + 2)) * 2 + 1, ((j + 2) * stride + (i + 1)) * 2, base + 1];
        for (let k = 0; k < seg.length; k += 2) { from.push(E[seg[k]]); to.push(E[seg[k + 1]]); }
      }
      bl = br; tl = tr;
    }
  }
  if (!from.length) return [];
  const keyPos = (key) => {
    const orient = key & 1, e = key >> 1;
    const i1k = e % stride, j1k = (e - i1k) / stride;
    const i = i1k - 1, j = j1k - 1;
    if (orient === 0) {
      const a = S(i, j), b = S(i + 1, j);
      const t = (b === a) ? 0.5 : (level - a) / (b - a);
      return [i + Math.min(1, Math.max(0, t)), j];
    }
    const a = S(i, j), b = S(i, j + 1);
    const t = (b === a) ? 0.5 : (level - a) / (b - a);
    return [i, j + Math.min(1, Math.max(0, t))];
  };
  const outMap = new Map(), inSet = new Set();
  for (let k = 0; k < from.length; k++) { if (!outMap.has(from[k])) outMap.set(from[k], k); inSet.add(to[k]); }
  const used = new Uint8Array(from.length);
  const paths = [];
  const walk = (start, closed) => {
    const pts = [];
    let k = start, guard = from.length + 4;
    while (k !== undefined && !used[k] && guard-- > 0) {
      used[k] = 1;
      pts.push(keyPos(from[k]));
      const nk = outMap.get(to[k]);
      if (nk === undefined) { pts.push(keyPos(to[k])); break; }
      if (used[nk]) { if (closed) pts.push(pts[0]); else pts.push(keyPos(to[k])); break; }
      k = nk;
    }
    if (pts.length >= 2) paths.push({ pts, closed });
  };
  for (let k = 0; k < from.length; k++) if (!used[k] && !inSet.has(from[k])) walk(k, false);
  for (let k = 0; k < from.length; k++) if (!used[k]) walk(k, true);
  return paths;
}

// ---------------------------------------------------- simplify / smooth
function dp(pts, tol, areaTol) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
  const stack = [0, n - 1];
  while (stack.length) {
    const j = stack.pop(), i = stack.pop();
    if (j <= i + 1) continue;
    const ax = pts[i][0], ay = pts[i][1], bx = pts[j][0], by = pts[j][1];
    let best = -1, idx = -1, area2 = 0;
    for (let k = i + 1; k < j; k++) {
      const d = distPointSeg(pts[k][0], pts[k][1], ax, ay, bx, by);
      if (d > best) { best = d; idx = k; }
      const p = pts[k], q = pts[k + 1];
      area2 += (p[0] - ax) * (q[1] - ay) - (q[0] - ax) * (p[1] - ay);   // signed, chain vs chord
    }
    // split on perpendicular distance OR on swept area (kills long thin slivers at corners)
    if ((best > tol || Math.abs(area2) * 0.5 > areaTol) && idx > i && idx < j) { keep[idx] = 1; stack.push(i, idx, idx, j); }
  }
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[k]);
  return out;
}
function radialFilter(pts, tol) {
  const out = [pts[0]];
  const t2 = tol * tol;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx * dx + dy * dy >= t2) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// drop duplicate and exactly-collinear vertices (lossless)
function dedupCollinear(pts, eps) {
  let p = [];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i], r = pts[(i + 1) % pts.length];
    if (Math.hypot(q[0] - r[0], q[1] - r[1]) > eps) p.push(q);
  }
  if (p.length < 3) return pts;
  const n = p.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    if (distPointSeg(b[0], b[1], a[0], a[1], c[0], c[1]) > eps) out.push(b);
  }
  return out.length >= 3 ? out : p;
}
// Two long straight runs separated by a one-pixel chamfer are a real corner: put it back.
function reconstructCorners(pts, res) {
  const n = pts.length;
  if (n < 4) return pts;
  const shortMax = res * 3, longMin = res * 8, snap = res * 3;
  const elen = (i) => { const a = pts[i % n], b = pts[(i + 1) % n]; return Math.hypot(b[0] - a[0], b[1] - a[1]); };
  let s = -1;
  for (let i = 0; i < n; i++) if (elen((i - 1 + n) % n) >= longMin) { s = i; break; }
  if (s < 0) return pts;
  const out = [];
  let i = 0;
  while (i < n) {
    const cur = (s + i) % n, prv = (s + i - 1 + n) % n, nxt = (s + i + 1) % n, nn = (s + i + 2) % n;
    if (i + 1 < n && elen(cur) <= shortMax && elen(prv) >= longMin && elen(nxt) >= longMin) {
      const a = pts[prv], b = pts[cur], c = pts[nxt], d = pts[nn];
      const r1x = b[0] - a[0], r1y = b[1] - a[1], r2x = d[0] - c[0], r2y = d[1] - c[1];
      const den = r1x * r2y - r1y * r2x;
      if (Math.abs(den) > 1e-9) {
        const t = ((c[0] - a[0]) * r2y - (c[1] - a[1]) * r2x) / den;
        const px = a[0] + r1x * t, py = a[1] + r1y * t;
        if (Math.hypot(px - b[0], py - b[1]) <= snap && Math.hypot(px - c[0], py - c[1]) <= snap) {
          out.push([px, py]); i += 2; continue;
        }
      }
    }
    out.push(pts[cur]); i++;
  }
  return out.length >= 3 ? out : pts;
}
/** Douglas–Peucker for an open polyline. */
export function simplifyLine(pts, tol, areaTol = Infinity) {
  if (!pts || pts.length < 3 || !(tol > 0)) return pts ? pts.slice() : [];
  let p = pts;
  if (p.length > 5000) p = radialFilter(p, tol);
  return dp(p, tol, areaTol);
}
/** Structural corners of a raw contour: direction change over a +-k window. */
function cornerFlags(pts, k, cosMax) {
  const n = pts.length;
  const flags = new Uint8Array(n);
  if (n < 4 * k) return flags;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - k + n) % n], b = pts[i], c = pts[(i + k) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-12 || lv < 1e-12) continue;
    if ((ux * vx + uy * vy) / (lu * lv) < cosMax) flags[i] = 1;
  }
  return flags;
}
/** Douglas–Peucker for a closed ring (anchored at an extreme vertex or at its corners). */
export function simplifyRing(pts, tol, areaTol = Infinity) {
  let p = pts;
  if (p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p = p.slice(0, -1);
  if (p.length < 4 || !(tol > 0)) return p.slice();
  if (p.length > 5000) p = radialFilter(p.concat([p[0]]), tol).slice(0, -1);
  const corners = cornerFlags(p, 3, Math.cos(55 * Math.PI / 180));
  const idx = [];
  for (let i = 0; i < p.length; i++) if (corners[i]) idx.push(i);
  if (idx.length >= 2) {                       // split the ring at its structural corners
    const out = [];
    for (let c = 0; c < idx.length; c++) {
      const i0 = idx[c], i1 = idx[(c + 1) % idx.length];
      const chain = [];
      for (let k = i0; ; k = (k + 1) % p.length) { chain.push(p[k]); if (k === i1) break; if (chain.length > p.length) break; }
      const s = dp(chain, tol, areaTol);
      for (let k = 0; k < s.length - 1; k++) out.push(s[k]);
    }
    return out.length >= 3 ? out : p.slice();
  }
  let a = 0;
  for (let i = 1; i < p.length; i++) if (p[i][0] < p[a][0] || (p[i][0] === p[a][0] && p[i][1] < p[a][1])) a = i;
  const rot = p.slice(a).concat(p.slice(0, a));
  let b = 0, bd = -1;
  for (let i = 1; i < rot.length; i++) {
    const dx = rot[i][0] - rot[0][0], dy = rot[i][1] - rot[0][1], d = dx * dx + dy * dy;
    if (d > bd) { bd = d; b = i; }
  }
  const s1 = dp(rot.slice(0, b + 1), tol, areaTol);
  const s2 = dp(rot.slice(b).concat([rot[0]]), tol, areaTol);
  const out = s1.concat(s2.slice(1, -1));
  return out.length >= 3 ? out : p.slice();
}
/** One pass of [.25 .5 .25] smoothing; kills the half-pixel staircase before DP. */
export function smoothPath(pts, closed) {
  const n = pts.length;
  if (n < 4) return pts.slice();
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { out[i] = pts[i]; continue; }
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    out[i] = [0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0], 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1]];
  }
  return out;
}
/** Chaikin corner cutting (optional cosmetic rounding). */
export function chaikin(pts, closed, iters = 1) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    if (p.length < 3) break;
    const out = [];
    const n = p.length, last = closed ? n : n - 1;
    if (!closed) out.push(p[0]);
    for (let i = 0; i < last; i++) {
      const a = p[i], b = p[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

/** Mask -> shapes.
 *  opts: simplify (DP tolerance mm, default res = one pixel), areaTol (mm², default 4·res²,
 *  splits long thin slivers so straight edges stay straight), corners (default true,
 *  rebuilds sharp corners from one-pixel chamfers), smooth (default false),
 *  round (Chaikin iterations, default 0), minArea (mm², default 2·res²). */
export function vectorize(mask, opts = {}) {
  if (!mask || !mask.data) return [];
  const res = mask.res;
  const tol = num(opts.simplify, res);
  const areaTol = num(opts.areaTol, Infinity);
  const minArea = num(opts.minArea, 2 * res * res);
  const paths = traceContours(mask.data, mask.w, mask.h, 0.5, { outside: 0, border: true });
  const outers = [], holes = [];
  for (const p of paths) {
    let pts = p.pts;
    if (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
    if (pts.length < 3) continue;
    let mm = pts.map(q => [mask.x0 + (q[0] + 0.5) * res, mask.y0 + (q[1] + 0.5) * res]);
    if (opts.smooth) mm = smoothPath(mm, true);
    // shrink the tolerance for small features so a 1 mm dot does not become an octagon
    const A = Math.abs(polygonArea(mm));
    let per = 0;
    for (let i = 0; i < mm.length; i++) { const a = mm[i], b = mm[(i + 1) % mm.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const rEff = per > 0 ? 2 * A / per : tol;
    const tolEff = Math.min(tol, Math.max(res * 0.5, rEff / 60));
    mm = simplifyRing(mm, tolEff, areaTol);
    mm = dedupCollinear(mm, res * 0.02);
    if (opts.corners !== false) mm = reconstructCorners(mm, res);
    if (opts.round > 0) mm = chaikin(mm, true, opts.round | 0);
    if (mm.length < 3) continue;
    const a = polygonArea(mm);
    if (Math.abs(a) < minArea) continue;
    (a >= 0 ? outers : holes).push({ pts: mm, area: Math.abs(a) });
  }
  outers.sort((x, y) => x.area - y.area);
  const shapes = outers.map(o => ({ outer: o.pts, holes: [] }));
  for (const hl of holes) {
    const t = hl.pts[0];
    let target = -1;
    for (let i = 0; i < outers.length; i++) {          // smallest containing outer wins
      const bb = bboxOfPoints(outers[i].pts);
      if (t[0] < bb[0] || t[0] > bb[2] || t[1] < bb[1] || t[1] > bb[3]) continue;
      if (pointInPolygon(t[0], t[1], outers[i].pts)) { target = i; break; }
    }
    if (target >= 0) shapes[target].holes.push(hl.pts);
  }
  return shapes;
}

// =====================================================================
//  BOOLEANS / OFFSET / MORPHOLOGY
// =====================================================================

function allSimple(S) {
  for (const s of S) {
    if (s.holes.length) return false;
    if (!isSimpleRing(s.outer)) return false;
  }
  return true;
}
function disjointBBoxes(S) {
  for (let i = 0; i < S.length; i++) {
    const a = bboxOfPoints(S[i].outer);
    for (let j = i + 1; j < S.length; j++) if (interBB(a, bboxOfPoints(S[j].outer))) return false;
  }
  return true;
}
function boolOp(A, B, op, opts = {}) {
  const a = normShapes(A), b = normShapes(B);
  if (op === 'or' && !b.length) {
    if (!a.length) return [];
    if (a.length <= 8 && allSimple(a) && disjointBBoxes(a)) return cloneShapes(a);   // exact fast path
  }
  if (op === 'sub' && !b.length) return cloneShapes(a);
  if (op === 'and' && (!a.length || !b.length)) return [];
  if (op === 'sub' && !a.length) return [];
  if (op === 'xor' && !a.length) return boolOp(b, [], 'or', opts);
  if (op === 'xor' && !b.length) return boolOp(a, [], 'or', opts);
  const bbA = shapesBBox(a), bbB = shapesBBox(b);
  let bb;
  if (op === 'sub') bb = bbA;
  else if (op === 'and') { bb = interBB(bbA, bbB); if (!bb) return []; }
  else bb = unionBB(bbA, bbB);
  if (!bb) return [];
  if (op === 'sub' && !interBB(bbA, bbB)) return cloneShapes(a);
  const ma = rasterize(a, { ...opts, bbox: bb });
  const mb = rasterize(b, { ...opts, like: ma });
  const da = ma.data, db = mb.data;
  if (op === 'or') for (let i = 0; i < da.length; i++) da[i] = (da[i] | db[i]) & 1;
  else if (op === 'and') for (let i = 0; i < da.length; i++) da[i] = da[i] & db[i];
  else if (op === 'sub') for (let i = 0; i < da.length; i++) da[i] = da[i] && !db[i] ? 1 : 0;
  else for (let i = 0; i < da.length; i++) da[i] = (da[i] ^ db[i]) & 1;
  for (const w of ma.warnings) warn(opts, w);
  return vectorize(ma, { ...opts, simplify: num(opts.simplify, ma.res) });
}
/** Union of everything in `a` (self-union / cleanup of overlapping or self-intersecting input). */
export function unionShapes(a, opts = {}) { return boolOp(a, [], 'or', opts); }
/** a − b */
export function subtractShapes(a, b, opts = {}) { return boolOp(a, b, 'sub', opts); }
/** a ∩ b */
export function intersectShapes(a, b, opts = {}) { return boolOp(a, b, 'and', opts); }
/** a ⊕ b */
export function xorShapes(a, b, opts = {}) { return boolOp(a, b, 'xor', opts); }

/** Grow (delta>0) / shrink (delta<0) by `delta` mm with round joins. Exact Euclidean. */
export function offsetShapes(shapes, delta, opts = {}) {
  const S = normShapes(shapes);
  if (!S.length) return [];
  if (Math.abs(delta) < 1e-9) return unionShapes(S, opts);
  const res = num(opts.res, DEF_RES);
  const m = rasterize(S, { ...opts, pad: Math.max(delta, 0) + 3 * res });
  for (const w of m.warnings) warn(opts, w);
  maskOffset(m, delta);
  return vectorize(m, { ...opts, simplify: num(opts.simplify, m.res) });
}
/** Round both convex and concave corners by radius r (morphological close then open). */
export function roundCorners(shapes, r, opts = {}) {
  const S = normShapes(shapes);
  if (!S.length || !(r > 0)) return unionShapes(S, opts);
  const res = num(opts.res, DEF_RES);
  const m = rasterize(S, { ...opts, pad: r + 3 * res });
  for (const w of m.warnings) warn(opts, w);
  maskOffset(m, r);        // close: fills concave corners
  maskOffset(m, -2 * r);   // open:  cuts convex corners
  maskOffset(m, r);
  return vectorize(m, { ...opts, simplify: num(opts.simplify, m.res) });
}

// =====================================================================
//  RESOLVED PRIMS -> AREAS
// =====================================================================

/** Resolved LAMINA prims (line/polyline/arc/circle/poly) -> filled shapes.
 *  Strokes become their swept area (round caps + round joins).
 *  opts.union (default false) merges everything into non-overlapping shapes. */
export function shapesFromPrims(prims, opts = {}) {
  const out = [];
  const push = (poly) => { if (poly && poly.length >= 3) out.push({ outer: poly, holes: [] }); };
  const stroke = (pts, w, closed) => {
    if (!pts || pts.length === 0) return;
    if (pts.length === 1) { push(circlePoints(pts[0][0], pts[0][1], Math.max(w, 0) / 2)); return; }
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      push(stadium(a[0], a[1], b[0], b[1], w));
    }
    if (w > 0 && pts.length > 2) {                          // round joins
      const from = closed ? 0 : 1, to = closed ? pts.length : pts.length - 1;
      for (let i = from; i < to; i++) push(circlePoints(pts[i][0], pts[i][1], w / 2));
    }
  };
  for (const p of prims || []) {
    if (!p) continue;
    switch (p.t) {
      case 'line': push(stadium(p.x1, p.y1, p.x2, p.y2, p.w || 0)); break;
      case 'polyline': stroke(p.pts, p.w || 0, !!p.closed); break;
      case 'arc': stroke(arcPoints(p.cx, p.cy, p.r, p.a0, p.a1), p.w || 0, false); break;
      case 'circle':
        if (!(p.w > 0)) push(circlePoints(p.cx, p.cy, p.r));
        else { const rs = ringShape(p.cx, p.cy, p.r, p.w); out.push(rs); }
        break;
      case 'poly': if (p.pts && p.pts.length >= 3) out.push({ outer: p.pts, holes: (p.holes || []).filter(h => h && h.length >= 3) }); break;
      case 'rect': push(rectPoints(p.x ?? p.cx, p.y ?? p.cy, p.w, p.h, p.rot || 0, p.rx || 0)); break;
      default: break;   // text/image: the caller flattens those first (textAsStrokes / imagesAsPolys)
    }
  }
  return opts.union ? unionShapes(out, opts) : out;
}

/** Turn generator polylines into filled areas of the given width. */
export function polylinesToShapes(lines, width, opts = {}) {
  const L = Array.isArray(lines) && lines.lines ? lines.lines : (lines && lines.lines) || lines || [];
  const prims = [];
  for (const pl of L) if (pl && pl.length >= 1) prims.push({ t: 'polyline', pts: pl, w: width, closed: false });
  return shapesFromPrims(prims, { ...opts, union: opts.union !== false });
}

const drillShape = (d, margin) => {
  const r = Math.max(d.d, 0) / 2 + margin;
  if ((d.slotLen || 0) > d.d + 1e-6) return { outer: ovalPoints(d.x, d.y, d.slotLen + 2 * margin, d.d + 2 * margin, d.rot || 0), holes: [] };
  return { outer: circlePoints(d.x, d.y, r), holes: [] };
};

/** Board copper/graphic area of a resolved board: outline minus internal cutouts.
 *  opts.edgeMargin (mm) insets the result if given. */
export function boardArea(resolved, opts = {}) {
  if (!resolved || !resolved.outline) return [];
  const shape = { outer: resolved.outline, holes: (resolved.cutouts || []).filter(c => c && c.length >= 3) };
  const em = num(opts.edgeMargin, 0);
  if (!(em > 0)) return [shape];
  return offsetShapes([shape], -em, opts);
}

function keepoutPieces(resolved, opts = {}) {
  const holeMargin = num(opts.holeMargin, 0.5);
  const padMargin = num(opts.padMargin, 0.4);
  const partMargin = num(opts.partMargin, 0.3);
  const maskMargin = num(opts.maskMargin, 0.05);
  const exact = [];
  for (const d of resolved.drills || []) exact.push(drillShape(d, holeMargin));
  for (const p of resolved.pads || []) {
    const grow = padMargin + (p.mask === false ? 0 : (p.maskMargin ?? maskMargin));
    exact.push({ outer: padPoints(p, p.x, p.y, p.rot || 0, grow), holes: [] });
  }
  if (opts.parts !== false) {
    for (const pt of resolved.parts || []) {
      const bb = pt.bbox;
      if (!bb) continue;
      exact.push(rectShape(bb[0] - partMargin, bb[1] - partMargin, bb[2] + partMargin, bb[3] + partMargin));
    }
  }
  return exact;
}

/** Keepout ("don't draw here") area of a resolved board. Returns shapes.
 *  opts: holeMargin .5, padMargin .4, partMargin .3, edgeMargin .5 (0 = no edge band),
 *        copperLayers ['F.Cu',...] + copperMargin (default padMargin), parts:false to skip courtyards. */
export function keepoutShapes(resolved, opts = {}) {
  const grid = keepoutGrid(resolved, opts);
  const m = keepoutMask(resolved, opts, grid);
  return vectorize(m, { ...opts, simplify: num(opts.simplify, m.res) });
}
function keepoutGrid(resolved, opts) {
  const bb = bboxOfPoints(resolved.outline || []);
  return newMask(bb, { ...opts, pad: num(opts.gridPad, 1) });
}
function keepoutMask(resolved, opts, grid) {
  const m = maskLike(grid);
  for (const w of grid.warnings || []) warn(opts, w);
  rasterizeInto(m, keepoutPieces(resolved, opts));
  // copper of selected layers, grown by copperMargin
  const layers = opts.copperLayers || [];
  if (layers.length) {
    const cm = num(opts.copperMargin, num(opts.padMargin, 0.4));
    const cu = [];
    for (const l of layers) cu.push(...shapesFromPrims((resolved.layers && resolved.layers[l]) || [], {}));
    if (cu.length) {
      const cmask = maskLike(grid);
      rasterizeInto(cmask, cu);
      if (cm > 0) maskOffset(cmask, cm);
      for (let i = 0; i < m.data.length; i++) m.data[i] |= cmask.data[i];
    }
  }
  // inset band along the outline + cutouts
  const em = num(opts.edgeMargin, 0.5);
  if (em > 0 && resolved.outline) {
    const board = maskLike(grid);
    rasterizeInto(board, [{ outer: resolved.outline, holes: (resolved.cutouts || []).filter(c => c && c.length >= 3) }]);
    const inner = maskLike(grid);
    inner.data.set(board.data);
    maskOffset(inner, -em);
    for (let i = 0; i < m.data.length; i++) if (board.data[i] && !inner.data[i]) m.data[i] = 1;
    // everything outside the board is keepout too (so usable stays on the board)
    for (let i = 0; i < m.data.length; i++) if (!board.data[i]) m.data[i] = 1;
  }
  return m;
}
/** boardArea − keepoutShapes: where a generator may draw. */
export function usableArea(resolved, opts = {}) {
  if (!resolved || !resolved.outline) return [];
  const grid = keepoutGrid(resolved, opts);
  const board = maskLike(grid);
  rasterizeInto(board, [{ outer: resolved.outline, holes: (resolved.cutouts || []).filter(c => c && c.length >= 3) }]);
  const ko = keepoutMask(resolved, opts, grid);
  const bd = board.data, kd = ko.data;
  for (let i = 0; i < bd.length; i++) bd[i] = (bd[i] && !kd[i]) ? 1 : 0;
  for (const w of grid.warnings || []) warn(opts, w);
  return vectorize(board, { ...opts, simplify: num(opts.simplify, board.res) });
}

// =====================================================================
//  REGION FIELD (rasterised region + inside distance + edge index)
// =====================================================================

const _fieldCache = new WeakMap();

function buildEdgeIndex(S) {
  const ex = [];
  for (const s of S) for (const ring of [s.outer, ...s.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      ex.push(a[0], a[1], b[0], b[1]);
    }
  }
  const n = ex.length / 4;
  const bb = shapesBBox(S) || [0, 0, 1, 1];
  const nx = Math.max(1, Math.min(96, Math.round(Math.sqrt(n / 2)) || 1));
  const ny = nx;
  const cw = Math.max((bb[2] - bb[0]) / nx, 1e-9), ch = Math.max((bb[3] - bb[1]) / ny, 1e-9);
  const buckets = new Array(nx * ny);
  const cellOf = (x, y) => {
    let i = Math.floor((x - bb[0]) / cw), j = Math.floor((y - bb[1]) / ch);
    if (i < 0) i = 0; if (i >= nx) i = nx - 1; if (j < 0) j = 0; if (j >= ny) j = ny - 1;
    return [i, j];
  };
  for (let e = 0; e < n; e++) {
    const [i0, j0] = cellOf(Math.min(ex[e * 4], ex[e * 4 + 2]), Math.min(ex[e * 4 + 1], ex[e * 4 + 3]));
    const [i1, j1] = cellOf(Math.max(ex[e * 4], ex[e * 4 + 2]), Math.max(ex[e * 4 + 1], ex[e * 4 + 3]));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (buckets[j * nx + i] || (buckets[j * nx + i] = [])).push(e);
  }
  const stamp = new Int32Array(n);
  let tick = 0;
  return {
    n, ex,
    query(x0, y0, x1, y1, out) {
      out.length = 0;
      if (!n) return out;
      const [i0, j0] = cellOf(Math.min(x0, x1), Math.min(y0, y1));
      const [i1, j1] = cellOf(Math.max(x0, x1), Math.max(y0, y1));
      tick++;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const b = buckets[j * nx + i];
        if (!b) continue;
        for (let k = 0; k < b.length; k++) { const e = b[k]; if (stamp[e] !== tick) { stamp[e] = tick; out.push(e); } }
      }
      return out;
    },
  };
}

/** Rasterised view of a region: inside test, distance-to-edge, and edge index for clipping.
 *  Overlapping input shapes are unioned first so every test is unambiguous. Cached per object. */
export function regionField(region, opts = {}) {
  const res = num(opts.res, DEF_RES);
  const cacheKey = (region && typeof region === 'object' && opts.cache !== false) ? region : null;
  if (cacheKey) { const c = _fieldCache.get(cacheKey); if (c && c.res === res) return c; }
  let S = normShapes(region);
  if (S.length > 1 && !disjointBBoxes(S)) S = unionShapes(S, opts);
  const bbox = shapesBBox(S) || [0, 0, 0, 0];
  const mask = rasterize(S, { ...opts, pad: 2 * res });
  for (const w of mask.warnings) warn(opts, w);
  const d2 = edtSq(mask, false);
  const dist = new Float32Array(d2.length);
  for (let i = 0; i < d2.length; i++) dist[i] = mask.data[i] ? (Math.sqrt(d2[i]) - 0.5) * mask.res : -1;
  const idx = buildEdgeIndex(S);
  const F = {
    res, shapes: S, bbox, mask, dist, index: idx,
    /** distance from (x,y) to the region edge in mm; negative outside */
    distAt(x, y) {
      const i = Math.floor((x - mask.x0) / mask.res), j = Math.floor((y - mask.y0) / mask.res);
      if (i < 0 || j < 0 || i >= mask.w || j >= mask.h) return -1;
      return dist[j * mask.w + i];
    },
    inside(x, y) { return pointInShapes(S, x, y); },
    /** true when a disc of radius r at (x,y) is completely inside the region
     *  (half a pixel of slack covers the raster quantisation, so it never lies) */
    fits(x, y, r) { return this.distAt(x, y) >= r + mask.res * 0.5; },
  };
  if (cacheKey) _fieldCache.set(cacheKey, F);
  return F;
}

const _qbuf = [];
/** Inside portions of segment a->b as a flat [t0,t1,t0,t1,...] list. */
function segmentIntervals(F, a, b) {
  const S = F.shapes;
  if (!S.length) return [];
  const ax = a[0], ay = a[1], rx = b[0] - ax, ry = b[1] - ay;
  if (Math.abs(rx) < 1e-15 && Math.abs(ry) < 1e-15) return [];
  const cand = F.index.query(ax, ay, b[0], b[1], _qbuf);
  const ex = F.index.ex;
  const ts = [0, 1];
  for (let k = 0; k < cand.length; k++) {
    const e = cand[k] * 4;
    const cx = ex[e], cy = ex[e + 1], sx = ex[e + 2] - cx, sy = ex[e + 3] - cy;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-15) continue;
    const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
    if (t <= 0 || t >= 1) continue;
    const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    if (u < 0 || u > 1) continue;
    ts.push(t);
  }
  ts.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-12) continue;
    const tm = (t0 + t1) / 2;
    if (!pointInShapes(S, ax + rx * tm, ay + ry * tm)) continue;
    if (out.length && Math.abs(out[out.length - 1] - t0) < 1e-12) out[out.length - 1] = t1;
    else out.push(t0, t1);
  }
  return out;
}
/** Clip one polyline to the region; appends the pieces to `out`. */
export function clipPolyline(F, pts, out = []) {
  if (!pts || pts.length < 2) return out;
  let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const iv = segmentIntervals(F, a, b);
    for (let k = 0; k < iv.length; k += 2) {
      const t0 = iv[k], t1 = iv[k + 1];
      const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      if (cur && t0 <= 1e-12) cur.push(p1);
      else { if (cur && cur.length > 1) out.push(cur); cur = [p0, p1]; }
      if (t1 < 1 - 1e-12) { if (cur.length > 1) out.push(cur); cur = null; }
    }
    if (!iv.length && cur) { if (cur.length > 1) out.push(cur); cur = null; }
  }
  if (cur && cur.length > 1) out.push(cur);
  return out;
}

// =====================================================================
//  GENERATORS  (all clipped to `region`, all deterministic)
// =====================================================================

/** Parallel lines at `angle`°, `spacing` mm apart, phase `offset`. → {lines} */
export function hatchFill(region, opts = {}) {
  const F = regionField(region, opts);
  const spacing = Math.max(num(opts.spacing, 1), 1e-3);
  const offset = num(opts.offset, 0);
  const angles = [num(opts.angle, 45)];
  if (opts.crosshatch) angles.push(angles[0] + 90);
  const bb = F.bbox, out = [];
  if (!F.shapes.length) return { lines: out };
  for (const ang of angles) {
    const a = ang * D2R, c = Math.cos(a), s = Math.sin(a);
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]]) {
      const u = x * c + y * s, v = -x * s + y * c;
      if (u < umin) umin = u; if (u > umax) umax = u;
      if (v < vmin) vmin = v; if (v > vmax) vmax = v;
    }
    const k0 = Math.ceil((vmin - offset) / spacing), k1 = Math.floor((vmax - offset) / spacing);
    if (k1 - k0 > 200000) { warn(opts, 'clip.hatchFill: spacing too small for this region — clamped'); continue; }
    for (let k = k0; k <= k1; k++) {
      const v = offset + k * spacing;
      const p0 = [(umin - 1) * c - v * s, (umin - 1) * s + v * c];
      const p1 = [(umax + 1) * c - v * s, (umax + 1) * s + v * c];
      clipPolyline(F, [p0, p1], out);
    }
  }
  return { lines: out };
}

/** Grid of discs. grid 'square'|'hex', jitter 0..1 of a cell. → shapes */
export function dotFill(region, opts = {}) {
  const F = regionField(region, opts);
  const spacing = Math.max(num(opts.spacing, 2), 1e-3);
  const d = Math.max(num(opts.d, 0.8), 0);
  const jit = num(opts.jitter, 0);
  const hex = opts.grid === 'hex';
  const rnd = rng(num(opts.seed, 1));
  const bb = F.bbox, out = [];
  if (!F.shapes.length) return out;
  const rowH = hex ? spacing * Math.sqrt(3) / 2 : spacing;
  const nx = Math.floor((bb[2] - bb[0]) / spacing) + 2, ny = Math.floor((bb[3] - bb[1]) / rowH) + 2;
  if (nx * ny > 400000) { warn(opts, 'clip.dotFill: spacing too small — output clamped'); return out; }
  const segs = Math.max(8, Math.min(48, Math.ceil(d * 24)));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let x = bb[0] + i * spacing + (hex && (j & 1) ? spacing / 2 : 0);
      let y = bb[1] + j * rowH;
      if (jit) { x += (rnd() - 0.5) * jit * spacing; y += (rnd() - 0.5) * jit * spacing; }
      else { rnd(); rnd(); }                       // keep the stream stable across jitter changes
      if (!F.fits(x, y, d / 2)) continue;
      out.push({ outer: circlePoints(x, y, d / 2, segs), holes: [] });
    }
  }
  return out;
}

/** Nested outlines: successive inward offsets ('edge') or circles ('point'). → {lines} */
export function concentric(region, opts = {}) {
  const F = regionField(region, opts);
  const spacing = Math.max(num(opts.spacing, 1), 1e-3);
  const maxRings = Math.max(1, Math.min(num(opts.maxRings, 200) | 0, 5000));
  const out = [];
  if (!F.shapes.length) return { lines: out };
  const tol = num(opts.simplify, F.mask.res);
  if ((opts.from || 'edge') === 'edge') {
    let dmax = 0;
    for (let i = 0; i < F.dist.length; i++) if (F.dist[i] > dmax) dmax = F.dist[i];
    const n = Math.min(maxRings, Math.floor(dmax / spacing));
    for (let k = 1; k <= n; k++) {
      const paths = traceContours(F.dist, F.mask.w, F.mask.h, k * spacing, { border: false, outside: -1 });
      for (const p of paths) {
        let pts = p.pts.map(q => [F.mask.x0 + (q[0] + 0.5) * F.mask.res, F.mask.y0 + (q[1] + 0.5) * F.mask.res]);
        pts = p.closed ? simplifyRing(pts, tol).concat([]) : simplifyLine(pts, tol);
        if (p.closed && pts.length >= 3) pts.push(pts[0]);
        if (pts.length >= 2) out.push(pts);
      }
    }
  } else {
    const bb = F.bbox;
    const cx = num(opts.x, (bb[0] + bb[2]) / 2), cy = num(opts.y, (bb[1] + bb[3]) / 2);
    let rmax = 0;
    for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]]) rmax = Math.max(rmax, Math.hypot(x - cx, y - cy));
    const n = Math.min(maxRings, Math.ceil(rmax / spacing));
    for (let k = 1; k <= n; k++) {
      const r = k * spacing;
      const pts = circlePoints(cx, cy, r, Math.max(24, Math.min(720, Math.ceil(r * 24))));
      clipPolyline(F, pts.concat([pts[0]]), out);
    }
  }
  return { lines: out };
}

/** One Archimedean spiral clipped to the region. → {lines} */
export function spiral(region, opts = {}) {
  const F = regionField(region, opts);
  const spacing = Math.max(num(opts.spacing, 1), 1e-3);
  const bb = F.bbox;
  const cx = num(opts.cx, (bb[0] + bb[2]) / 2), cy = num(opts.cy, (bb[1] + bb[3]) / 2);
  let rmax = 0;
  for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]]) rmax = Math.max(rmax, Math.hypot(x - cx, y - cy));
  const turns = Math.max(0.25, Math.min(num(opts.turns, Math.ceil(rmax / spacing)), 5000));
  const out = [];
  if (!F.shapes.length) return { lines: out };
  const pts = [];
  const k = spacing / (2 * Math.PI);
  let th = 0;
  const thMax = turns * 2 * Math.PI;
  let guard = 2000000;
  while (th <= thMax && guard-- > 0) {
    const r = k * th;
    pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
    th += Math.min(0.35, Math.max(0.02, 0.3 / Math.max(r, 0.2)));
  }
  const rEnd = k * thMax;
  pts.push([cx + rEnd * Math.cos(thMax), cy + rEnd * Math.sin(thMax)]);
  clipPolyline(F, pts, out);
  return { lines: out };
}

/** Voronoi cells (exact half-plane clipping), shrunk so `gap` mm of clear space
 *  separates neighbours, then intersected with the region. → shapes */
export function voronoi(region, opts = {}) {
  const F = regionField(region, opts);
  if (!F.shapes.length) return [];
  const count = Math.max(1, Math.min(num(opts.count, 60) | 0, 5000));
  const gap = Math.max(num(opts.gap, 0.4), 0);
  const relax = Math.max(0, Math.min(num(opts.relax, 1) | 0, 20));
  const rnd = rng(num(opts.seed, 1));
  const bb = F.bbox;
  const frame = [[bb[0] - 1, bb[1] - 1], [bb[2] + 1, bb[1] - 1], [bb[2] + 1, bb[3] + 1], [bb[0] - 1, bb[3] + 1]];
  let sites = [];
  let guard = count * 400;
  while (sites.length < count && guard-- > 0) {
    const x = bb[0] + rnd() * (bb[2] - bb[0]), y = bb[1] + rnd() * (bb[3] - bb[1]);
    if (F.distAt(x, y) > 0) sites.push([x, y]);
  }
  if (!sites.length) return [];
  const cellFor = (i) => {
    let poly = frame;
    const p = sites[i];
    for (let j = 0; j < sites.length && poly.length >= 3; j++) {
      if (j === i) continue;
      const q = sites[j];
      const nx = 2 * (q[0] - p[0]), ny = 2 * (q[1] - p[1]);
      const c = (q[0] * q[0] + q[1] * q[1]) - (p[0] * p[0] + p[1] * p[1]);
      if (Math.abs(nx) + Math.abs(ny) < 1e-12) continue;
      poly = clipConvex(poly, nx, ny, c);
    }
    return poly;
  };
  for (let it = 0; it < relax; it++) {
    const next = [];
    for (let i = 0; i < sites.length; i++) {
      const cell = cellFor(i);
      if (cell.length < 3) { next.push(sites[i]); continue; }
      let ax = 0, ay = 0, a2 = 0;
      for (let k = 0; k < cell.length; k++) {
        const p = cell[k], q = cell[(k + 1) % cell.length];
        const cr = p[0] * q[1] - q[0] * p[1];
        a2 += cr; ax += (p[0] + q[0]) * cr; ay += (p[1] + q[1]) * cr;
      }
      if (Math.abs(a2) < 1e-12) { next.push(sites[i]); continue; }
      const cx = ax / (3 * a2), cy = ay / (3 * a2);
      next.push(F.distAt(cx, cy) > 0 ? [cx, cy] : sites[i]);
    }
    sites = next;
  }
  const cells = [];
  for (let i = 0; i < sites.length; i++) {
    const cell = insetConvex(cellFor(i), gap / 2);
    if (cell.length >= 3) cells.push({ outer: cell, holes: [] });
  }
  if (!cells.length) return [];
  return intersectShapes(cells, F.shapes, opts);
}

/** Perfect maze (randomised DFS) drawn as walls. → {lines, width} */
export function mazeFill(region, opts = {}) {
  const F = regionField(region, opts);
  const out = [];
  const width = num(opts.width, 0.5);
  if (!F.shapes.length) return { lines: out, width };
  const cell = Math.max(num(opts.cell, 3), 1e-2);
  const rnd = rng(num(opts.seed, 1));
  const bb = F.bbox;
  const nx = Math.max(1, Math.floor((bb[2] - bb[0]) / cell)), ny = Math.max(1, Math.floor((bb[3] - bb[1]) / cell));
  if (nx * ny > 250000) { warn(opts, 'clip.mazeFill: cell too small — output clamped'); return { lines: out, width }; }
  const ox = bb[0] + ((bb[2] - bb[0]) - nx * cell) / 2, oy = bb[1] + ((bb[3] - bb[1]) - ny * cell) / 2;
  const alive = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (F.distAt(ox + (i + 0.5) * cell, oy + (j + 0.5) * cell) > 0) alive[j * nx + i] = 1;
  }
  const openE = new Uint8Array(nx * ny), openN = new Uint8Array(nx * ny);
  const seen = new Uint8Array(nx * ny);
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  for (let s = 0; s < nx * ny; s++) {
    if (!alive[s] || seen[s]) continue;
    seen[s] = 1;
    const stack = [s];
    let guard = nx * ny * 8;
    while (stack.length && guard-- > 0) {
      const c = stack[stack.length - 1];
      const ci = c % nx, cj = (c - ci) / nx;
      const order = [0, 1, 2, 3];
      for (let k = 3; k > 0; k--) { const r = (rnd() * (k + 1)) | 0; const t = order[k]; order[k] = order[r]; order[r] = t; }
      let moved = false;
      for (const dir of order) {
        const ni = ci + DX[dir], nj = cj + DY[dir];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const nc = nj * nx + ni;
        if (!alive[nc] || seen[nc]) continue;
        if (dir === 0) openE[c] = 1; else if (dir === 2) openE[nc] = 1;
        else if (dir === 1) openN[c] = 1; else openN[nc] = 1;
        seen[nc] = 1; stack.push(nc); moved = true; break;
      }
      if (!moved) stack.pop();
    }
  }
  const wall = (x0, y0, x1, y1) => clipPolyline(F, [[x0, y0], [x1, y1]], out);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (!alive[c]) continue;
    const x0 = ox + i * cell, y0 = oy + j * cell, x1 = x0 + cell, y1 = y0 + cell;
    if (!openE[c]) wall(x1, y0, x1, y1);          // east wall (shared with the neighbour)
    if (!openN[c]) wall(x0, y1, x1, y1);          // north wall
    if (i === 0 || !alive[c - 1]) wall(x0, y0, x0, y1);
    if (j === 0 || !alive[c - nx]) wall(x0, y0, x1, y0);
  }
  return { lines: out, width };
}

/** Truchet tiling — quarter arcs or diagonals. → {lines, width} */
export function truchet(region, opts = {}) {
  const F = regionField(region, opts);
  const out = [];
  const width = num(opts.width, 0.5);
  if (!F.shapes.length) return { lines: out, width };
  const cell = Math.max(num(opts.cell, 4), 1e-2);
  const style = opts.style === 'lines' ? 'lines' : 'arcs';
  const rnd = rng(num(opts.seed, 1));
  const bb = F.bbox;
  const nx = Math.max(1, Math.ceil((bb[2] - bb[0]) / cell)), ny = Math.max(1, Math.ceil((bb[3] - bb[1]) / cell));
  if (nx * ny > 250000) { warn(opts, 'clip.truchet: cell too small — output clamped'); return { lines: out, width }; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const flip = rnd() < 0.5;
    const x0 = bb[0] + i * cell, y0 = bb[1] + j * cell, x1 = x0 + cell, y1 = y0 + cell;
    if (style === 'lines') {
      const seg = flip ? [[x0, y0], [x1, y1]] : [[x0, y1], [x1, y0]];
      clipPolyline(F, seg, out);
    } else {
      const r = cell / 2;
      const c1 = flip ? [x0, y0] : [x1, y0];
      const c2 = flip ? [x1, y1] : [x0, y1];
      const a1 = flip ? arcPoints(c1[0], c1[1], r, 0, 90, 12) : arcPoints(c1[0], c1[1], r, 90, 180, 12);
      const a2 = flip ? arcPoints(c2[0], c2[1], r, 180, 270, 12) : arcPoints(c2[0], c2[1], r, 270, 360, 12);
      clipPolyline(F, a1, out); clipPolyline(F, a2, out);
    }
  }
  return { lines: out, width };
}

/** Streamlines of a value-noise flow field. → {lines} */
export function flowLines(region, opts = {}) {
  const F = regionField(region, opts);
  const out = [];
  if (!F.shapes.length) return { lines: out };
  const spacing = Math.max(num(opts.spacing, 1.5), 1e-3);
  const step = Math.max(num(opts.step, 0.4), 1e-3);
  const scale = Math.max(num(opts.scale, 12), 1e-3);
  const seed = num(opts.seed, 1);
  const maxLen = Math.max(num(opts.len, 40), step);
  const bb = F.bbox;
  const nx = Math.floor((bb[2] - bb[0]) / spacing) + 1, ny = Math.floor((bb[3] - bb[1]) / spacing) + 1;
  if (nx * ny > 200000) { warn(opts, 'clip.flowLines: spacing too small — output clamped'); return { lines: out }; }
  const steps = Math.min(4000, Math.ceil(maxLen / step));
  const ang = (x, y) => (fbm(x / scale, y / scale, seed, 4) * 2 - 0.5) * Math.PI * 2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let x = bb[0] + i * spacing, y = bb[1] + j * spacing;
    if (F.distAt(x, y) <= 0) continue;
    const pts = [[x, y]];
    for (let k = 0; k < steps; k++) {
      const a = ang(x, y);
      const nxp = x + Math.cos(a) * step, nyp = y + Math.sin(a) * step;
      if (!isFinite(nxp) || !isFinite(nyp)) break;
      x = nxp; y = nyp;
      pts.push([x, y]);
      if (x < bb[0] - spacing || x > bb[2] + spacing || y < bb[1] - spacing || y > bb[3] + spacing) break;
    }
    if (pts.length > 1) clipPolyline(F, pts, out);
  }
  return { lines: out };
}

/** Iso-lines of a value-noise field ("topographic" look). → {lines} */
export function contourNoise(region, opts = {}) {
  const F = regionField(region, opts);
  const out = [];
  if (!F.shapes.length) return { lines: out };
  const levels = Math.max(1, Math.min(num(opts.levels, 6) | 0, 200));
  const scale = Math.max(num(opts.scale, 15), 1e-3);
  const seed = num(opts.seed, 1);
  const bb = F.bbox;
  const fres = Math.max(num(opts.fieldRes, Math.max(F.res * 4, 0.15)), 1e-3);
  const w = Math.min(2048, Math.max(4, Math.ceil((bb[2] - bb[0]) / fres) + 3));
  const h = Math.min(2048, Math.max(4, Math.ceil((bb[3] - bb[1]) / fres) + 3));
  const sx = (bb[2] - bb[0]) / (w - 3 || 1), sy = (bb[3] - bb[1]) / (h - 3 || 1);
  const field = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = bb[0] + (i - 1) * sx, y = bb[1] + (j - 1) * sy;
    field[j * w + i] = fbm(x / scale, y / scale, seed, 4);
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < field.length; i++) { if (field[i] < lo) lo = field[i]; if (field[i] > hi) hi = field[i]; }
  if (!(hi > lo)) return { lines: out };
  const tol = num(opts.simplify, F.mask.res);
  for (let k = 1; k <= levels; k++) {
    const lv = lo + (hi - lo) * k / (levels + 1);
    for (const p of traceContours(field, w, h, lv, { border: false, outside: lo - 1 })) {
      let pts = p.pts.map(q => [bb[0] + (q[0] - 1) * sx, bb[1] + (q[1] - 1) * sy]);
      if (p.closed && pts.length >= 3) pts = pts.concat([pts[0]]);
      pts = simplifyLine(pts, tol);
      if (pts.length >= 2) clipPolyline(F, pts, out);
    }
  }
  return { lines: out };
}

/** Classic halftone screen. `image` = {w,h,data,x,y,wmm,hmm} — data is 0..255 grey
 *  or a 1-bit ink mask (1 = dark), (x,y) = image centre, row 0 = top. → shapes */
export function halftone(region, image, opts = {}) {
  if (!image || !image.data || !image.w || !image.h) return [];
  const F = regionField(region, opts);
  if (!F.shapes.length) return [];
  const spacing = Math.max(num(opts.spacing, 1.2), 1e-3);
  const minD = Math.max(num(opts.minD, 0.1), 0);
  const maxD = Math.max(num(opts.maxD, 1.1), minD);
  const ang = num(opts.angle, 15) * D2R;
  const iw = image.w, ih = image.h, data = image.data;
  let oneBit = true;
  for (let i = 0; i < data.length; i++) if (data[i] > 1) { oneBit = false; break; }
  const wmm = num(image.wmm, iw * 0.1), hmm = num(image.hmm, ih * 0.1);
  const ix0 = num(image.x, 0) - wmm / 2, iy0 = num(image.y, 0) - hmm / 2;
  // average darkness of the source pixels under one screen cell
  const darkness = (x, y) => {
    const u = (x - ix0) / wmm, v = 1 - (y - iy0) / hmm;
    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
    const du = Math.max(0.5, spacing / wmm * iw / 2), dv = Math.max(0.5, spacing / hmm * ih / 2);
    let c0 = Math.round(u * iw - du), c1 = Math.round(u * iw + du), r0 = Math.round(v * ih - dv), r1 = Math.round(v * ih + dv);
    if (c0 < 0) c0 = 0; if (r0 < 0) r0 = 0; if (c1 > iw - 1) c1 = iw - 1; if (r1 > ih - 1) r1 = ih - 1;
    let sum = 0, n = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { sum += data[r * iw + c]; n++; }
    if (!n) return -1;
    const avg = sum / n;
    return oneBit ? avg : 1 - avg / 255;
  };
  const bb = F.bbox, out = [];
  const c = Math.cos(ang), s = Math.sin(ang);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]]) {
    const u = x * c + y * s, v = -x * s + y * c;
    if (u < umin) umin = u; if (u > umax) umax = u;
    if (v < vmin) vmin = v; if (v > vmax) vmax = v;
  }
  const nu = Math.floor((umax - umin) / spacing) + 1, nv = Math.floor((vmax - vmin) / spacing) + 1;
  if (nu * nv > 400000) { warn(opts, 'clip.halftone: spacing too small — output clamped'); return out; }
  for (let jv = 0; jv <= nv; jv++) for (let iu = 0; iu <= nu; iu++) {
    const u = umin + iu * spacing, v = vmin + jv * spacing;
    const x = u * c - v * s, y = u * s + v * c;
    const dk = darkness(x, y);
    if (dk < 0) continue;
    const d = minD + dk * (maxD - minD);
    if (d < Math.max(minD, 1e-3) || d <= 0) continue;
    if (!F.fits(x, y, d / 2)) continue;
    out.push({ outer: circlePoints(x, y, d / 2, Math.max(8, Math.min(40, Math.ceil(d * 24)))), holes: [] });
  }
  return out;
}

/** Poisson-ish scattered shapes. shape 'circle'|'square'|'triangle'. → shapes */
export function scatter(region, opts = {}) {
  const F = regionField(region, opts);
  if (!F.shapes.length) return [];
  const count = Math.max(0, Math.min(num(opts.count, 200) | 0, 100000));
  const minD = Math.max(num(opts.minD, 0.5), 1e-3);
  const maxD = Math.max(num(opts.maxD, 2), minD);
  const minGap = Math.max(num(opts.minGap, 0.3), 0);
  const kind = opts.shape || 'circle';
  const rnd = rng(num(opts.seed, 1));
  const bb = F.bbox;
  const placed = [];
  const cellSize = maxD + minGap;
  const buckets = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  const near = (x, y, r) => {
    const i0 = Math.floor((x - r - cellSize - bb[0]) / cellSize), i1 = Math.floor((x + r + cellSize - bb[0]) / cellSize);
    const j0 = Math.floor((y - r - cellSize - bb[1]) / cellSize), j1 = Math.floor((y + r + cellSize - bb[1]) / cellSize);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const b = buckets.get(key(i, j));
      if (!b) continue;
      for (const p of b) if (Math.hypot(p[0] - x, p[1] - y) < r + p[2] + minGap) return true;
    }
    return false;
  };
  let guard = count * 40 + 2000;
  while (placed.length < count && guard-- > 0) {
    const x = bb[0] + rnd() * (bb[2] - bb[0]), y = bb[1] + rnd() * (bb[3] - bb[1]);
    const d = minD + rnd() * (maxD - minD), r = d / 2;
    if (!F.fits(x, y, r)) continue;
    if (near(x, y, r)) continue;
    placed.push([x, y, r]);
    const i = Math.floor((x - bb[0]) / cellSize), j = Math.floor((y - bb[1]) / cellSize);
    const k = key(i, j);
    (buckets.get(k) || buckets.set(k, []).get(k)).push([x, y, r]);
  }
  const out = [];
  for (const [x, y, r] of placed) {
    if (kind === 'square') out.push({ outer: rectPoints(x, y, r * Math.SQRT2, r * Math.SQRT2, 0, 0), holes: [] });
    else if (kind === 'triangle') {
      const pts = [];
      for (let k = 0; k < 3; k++) { const a = (90 + k * 120) * D2R; pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
      out.push({ outer: pts, holes: [] });
    } else out.push({ outer: circlePoints(x, y, r, Math.max(8, Math.min(48, Math.ceil(r * 48)))), holes: [] });
  }
  return out;
}

// =====================================================================
//  LAMINA ITEM CONVERTERS
// =====================================================================

function idMaker(idFn) {
  if (typeof idFn === 'function') return idFn;
  let n = 0;
  return () => 'g' + (++n);
}
/** shapes -> LAMINA polygon items. LAMINA polygons have no holes, so each hole is
 *  emitted as its own item (and a warning says so). Returns {items, warnings}. */
export function shapesToItems(shapes, opts = {}) {
  const S = normShapes(shapes);
  const id = idMaker(opts.idFn);
  const layer = opts.layer || 'F.Silk';
  const filled = opts.filled !== false;
  const width = num(opts.width, 0.2);
  const items = [], warnings = [];
  let holes = 0;
  for (const s of S) {
    items.push({ id: id(), type: 'polygon', layer, points: s.outer.map(p => [p[0], p[1]]), filled, width });
    for (const h of s.holes) { items.push({ id: id(), type: 'polygon', layer, points: h.map(p => [p[0], p[1]]), filled, width }); holes++; }
  }
  if (holes) warnings.push(`${holes} hole ring${holes > 1 ? 's were' : ' was'} emitted as separate polygon item${holes > 1 ? 's' : ''} — LAMINA polygons cannot carry holes, so overlap them with the mask/board colour or subtract them yourself.`);
  return { items, warnings };
}
/** polylines -> LAMINA items: `path` on graphic layers, `trace` on copper,
 *  closed rings as unfilled polygons. Returns {items, warnings}. */
export function linesToItems(lines, opts = {}) {
  const L = (lines && Array.isArray(lines.lines)) ? lines.lines : (Array.isArray(lines) ? lines : []);
  const id = idMaker(opts.idFn);
  const layer = opts.layer || 'F.Silk';
  const width = num(opts.width, num(lines && lines.width, 0.2));
  const mode = opts.mode || 'auto';
  const cu = layer === 'F.Cu' || layer === 'B.Cu';
  const items = [], warnings = [];
  let segs = 0;
  for (const pl of L) {
    if (!pl || pl.length < 2) continue;
    const closed = pl.length > 3 && Math.abs(pl[0][0] - pl[pl.length - 1][0]) < 1e-9 && Math.abs(pl[0][1] - pl[pl.length - 1][1]) < 1e-9;
    const pts = (closed ? pl.slice(0, -1) : pl).map(p => [p[0], p[1]]);
    if (mode === 'lines' || (mode === 'auto' && pts.length === 2 && !closed)) {
      for (let i = 0; i + 1 < pts.length; i++) { items.push({ id: id(), type: 'line', layer, x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1], width }); segs++; }
      if (closed) items.push({ id: id(), type: 'line', layer, x1: pts[pts.length - 1][0], y1: pts[pts.length - 1][1], x2: pts[0][0], y2: pts[0][1], width });
    } else if (mode === 'polygon' || (mode === 'auto' && closed && pts.length >= 3)) {
      items.push({ id: id(), type: 'polygon', layer, points: pts, filled: false, width });
    } else if (mode === 'trace' || (mode === 'auto' && cu)) {
      items.push({ id: id(), type: 'trace', layer: cu ? layer : 'F.Cu', points: pts, width, net: opts.net || '' });
    } else {
      items.push({ id: id(), type: 'path', layer, points: pts, width, closed: false });
    }
  }
  if (mode === 'lines' && segs > 2000) warnings.push(`${segs} line items — consider mode:'path' or filling the art instead.`);
  return { items, warnings };
}
