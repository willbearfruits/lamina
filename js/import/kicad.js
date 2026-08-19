// LAMINA ← KiCad importer.
//   importKicad(text, opts) → { board, warnings }      board = LAMINA Board (js/model.js newBoard) from a `.kicad_pcb`
//   importKicadFootprint(text) → fp                    LAMINA footprint definition (docs/LIBRARY.md) from a `.kicad_mod`
//   parseSexpr(text) → nested arrays                   generic S-expression parser (quoted strings with escapes)
//
// Frame: KiCad mm Y-down → LAMINA mm Y-up; the board is translated so the outline bbox min = (0,0). Angles map 1:1
// (see js/export/kicad.js header). Footprints become `part` items with an INLINE `fp` (lib 'kicad:<libname>'), so no
// LAMINA library entry is needed; footprints exported by LAMINA as "LAMINA:pad|hole|slot" turn back into pad/hole/slot items.
// Text: KiCad font size == LAMINA cap-height size; KiCad justification (bottom/center/top) is converted to LAMINA's
// first-line-baseline anchor with the measured offsets in KICAD_TEXT_BASELINE. Unknown layers / objects are skipped with a warning.
import { newBoard, makeItem } from '../model.js';
import { bboxOfPoints, polygonArea, ensureCCW, arcPoints, circlePoints, rotPt, dist, R2D, D2R } from '../geom.js';
import { KICAD_TO_LAYER, KICAD_TEXT_SIZE_FACTOR, kicadFirstBaselineOffset, laminaBaselineUp } from '../export/kicad.js';

const TOL = 0.01;

// ---------- S-expression parser ----------
export function parseSexpr(text) {
  const n = text.length; let i = 0;
  const root = [];
  const stack = [root];
  while (i < n) {
    const c = text[i];
    if (c === '(') { const l = []; stack[stack.length - 1].push(l); stack.push(l); i++; continue; }
    if (c === ')') { if (stack.length > 1) stack.pop(); i++; continue; }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n) {
        const d = text[j];
        if (d === '\\' && j + 1 < n) { const e = text[j + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e; j += 2; continue; }
        if (d === '"') break;
        s += d; j++;
      }
      stack[stack.length - 1].push(new Str(s)); i = j + 1; continue;
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '#' || (c === ';' )) { while (i < n && text[i] !== '\n') i++; continue; } // comments (rare)
    let j = i; while (j < n && !' \t\n\r()"'.includes(text[j])) j++;
    stack[stack.length - 1].push(text.slice(i, j)); i = j;
  }
  return root;
}
// quoted strings are wrapped so "1" (a net name) can be told from 1 (a number)
export class Str { constructor(s) { this.s = s; } toString() { return this.s; } valueOf() { return this.s; } }
const S = v => v instanceof Str ? v.s : (v == null ? '' : String(v));
const num = (v, d = 0) => { const x = parseFloat(S(v)); return isFinite(x) ? x : d; };
const head = node => Array.isArray(node) && node.length ? S(node[0]) : '';
const child = (node, key) => Array.isArray(node) ? node.find(c => Array.isArray(c) && S(c[0]) === key) : undefined;
const children = (node, key) => Array.isArray(node) ? node.filter(c => Array.isArray(c) && S(c[0]) === key) : [];
const argN = (node, key, i = 1, d = 0) => { const c = child(node, key); return c ? num(c[i], d) : d; };
const argS = (node, key, i = 1, d = '') => { const c = child(node, key); return c ? S(c[i]) : d; };
const strokeW = (node, d = 0.1) => { const st = child(node, 'stroke'); return st ? argN(st, 'width', 1, d) : argN(node, 'width', 1, d); };
const fillYes = node => { const f = child(node, 'fill'); if (!f) return false; const v = S(f[1]); return v === 'yes' || v === 'solid'; };

// ---------- geometry helpers ----------
function arcFrom3(s, m, e) { // circle through 3 points; returns {cx,cy,r,a0,a1} CCW (Y-up frame) or null when collinear
  const ax = s[0], ay = s[1], bx = m[0], by = m[1], cx = e[0], cy = e[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const angS = Math.atan2(ay - uy, ax - ux) * R2D, angM = Math.atan2(by - uy, bx - ux) * R2D, angE = Math.atan2(cy - uy, cx - ux) * R2D;
  const norm = a => ((a % 360) + 360) % 360;
  // CCW from s to e passes through m?
  const sweepSE = norm(angE - angS), sweepSM = norm(angM - angS);
  const ccw = sweepSM <= sweepSE + 1e-9;
  return ccw ? { cx: ux, cy: uy, r, a0: angS, a1: angE } : { cx: ux, cy: uy, r, a0: angE, a1: angS };
}
function chainSegments(segs, tol = TOL) {
  // segs: [{pts:[[x,y]...], closed?, ...}] → loops: [{pts, closed:true|false, parts:[seg...]}]
  const open = segs.filter(s => !s.closed && s.pts.length >= 2);
  const out = segs.filter(s => s.closed).map(s => ({ pts: s.pts.slice(), closed: true, parts: [s] }));
  const used = new Array(open.length).fill(false);
  const near = (a, b) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let pts = open[i].pts.slice();
    const parts = [open[i]];
    let grew = true;
    while (grew) {
      grew = false;
      const end = pts[pts.length - 1], start = pts[0];
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue;
        const q = open[j].pts;
        if (near(end, q[0])) { pts = pts.concat(q.slice(1)); used[j] = true; parts.push(open[j]); grew = true; }
        else if (near(end, q[q.length - 1])) { pts = pts.concat(q.slice(0, -1).reverse()); used[j] = true; parts.push(open[j]); grew = true; }
        else if (near(start, q[q.length - 1])) { pts = q.slice(0, -1).concat(pts); used[j] = true; parts.push(open[j]); grew = true; }
        else if (near(start, q[0])) { pts = q.slice(1).reverse().concat(pts); used[j] = true; parts.push(open[j]); grew = true; }
        if (grew) break;
      }
      if (pts.length > 2 && near(pts[0], pts[pts.length - 1])) { pts.pop(); out.push({ pts, closed: true, parts }); pts = null; break; }
    }
    if (pts) out.push({ pts, closed: false, parts });
  }
  return out;
}
function dedupe(pts, tol = 1e-6) { const o = []; for (const p of pts) { const l = o[o.length - 1]; if (!l || Math.abs(l[0] - p[0]) > tol || Math.abs(l[1] - p[1]) > tol) o.push(p); } if (o.length > 2 && Math.abs(o[0][0] - o[o.length - 1][0]) <= tol && Math.abs(o[0][1] - o[o.length - 1][1]) <= tol) o.pop(); return o; }

// ---------- text ----------
function parseEffects(node) {
  const eff = child(node, 'effects');
  const font = eff ? child(eff, 'font') : null;
  const size = font ? argN(font, 'size', 1, 1) : 1; // (size HEIGHT WIDTH) — verified: the first number is the glyph height; LAMINA keeps only the height
  const thickness = font && child(font, 'thickness') ? argN(font, 'thickness') : size * 0.15;
  const just = eff ? child(eff, 'justify') : null;
  const tokens = just ? just.slice(1).map(S) : [];
  const h = tokens.includes('left') ? 'left' : tokens.includes('right') ? 'right' : 'center';
  const v = tokens.includes('top') ? 'top' : tokens.includes('bottom') ? 'bottom' : 'center';
  const mirror = tokens.includes('mirror');
  const hide = (() => { const hd = child(node, 'hide'); if (hd) return S(hd[1]) !== 'no'; return node.slice(1).some(t => S(t) === 'hide'); })();
  return { size, thickness, h, v, mirror, hide };
}
// KiCad text anchor (target frame, Y down, absolute rot) → LAMINA first-line baseline anchor in the same Y-down frame
function baselineFromKicad(ax, ay, absRot, frameRot, eff, text) {
  const n = String(text).split('\n').length;
  const off = kicadFirstBaselineOffset(eff.v, eff.size, n);
  const a = (absRot - (frameRot || 0)) * D2R;
  return [ax + Math.sin(a) * off, ay + Math.cos(a) * off];
}

// ---------- footprint conversion ----------
// node = (footprint ...) ; returns { fp, ref, value, x, y, rot, side, hideRef, libname }  (x,y,rot in KiCad frame)
function convertFootprint(node, netName, warn) {
  const libname = S(node[1]);
  const at = child(node, 'at');
  const x = at ? num(at[1]) : 0, y = at ? num(at[2]) : 0, rot = at ? num(at[3]) : 0;
  const side = argS(node, 'layer') === 'B.Cu' ? 'bottom' : 'top';
  const bottom = side === 'bottom';
  // footprint-local file frame (Y down) → LAMINA library-local (Y up, top-side definition)
  const TL = (fx, fy) => bottom ? [-fx, -fy] : [fx, -fy];
  const LYR = kl => { const l = KICAD_TO_LAYER[kl]; if (!l) return null; if (!bottom) return l; return l.startsWith('B.') ? 'F.' + l.slice(2) : l.startsWith('F.') ? 'B.' + l.slice(2) : l; };
  const relRot = a => bottom ? -(a - rot) : (a - rot);
  const fp = { id: 'kicad:' + libname, name: libname.includes(':') ? libname.slice(libname.indexOf(':') + 1) : libname, cat: 'Imported', ref: 'X', tags: ['kicad'], pads: [], holes: [], graphics: [], courtyard: null, refPos: null, height: 3, body3d: [], meta: { source: 'kicad', lib: libname } };
  let ref = '', value = '', hideRef = false;
  const descr = child(node, 'descr'); if (descr) fp.desc = S(descr[1]);
  const tags = child(node, 'tags'); if (tags) fp.tags = S(tags[1]).split(/\s+/).filter(Boolean);
  const crtyd = [];
  for (const c of node) {
    if (!Array.isArray(c)) continue;
    const h = S(c[0]);
    if (h === 'property' || h === 'fp_text') {
      const isProp = h === 'property';
      const key = S(c[1]); // property name, or fp_text kind (reference|value|user)
      const txt = S(c[2]);
      const eff = parseEffects(c);
      const tat = child(c, 'at');
      const tx = tat ? num(tat[1]) : 0, ty = tat ? num(tat[2]) : 0, tabs = tat && tat.length > 3 ? num(tat[3]) : 0; // ABSOLUTE angle (verified with kicad-cli), absent = 0
      if (isProp && key === 'Reference' || (!isProp && key === 'reference')) {
        ref = txt; hideRef = eff.hide;
        const [px, py] = TL(tx, ty); fp.refPos = { x: px, y: py };
        continue;
      }
      if (isProp && key === 'Value' || (!isProp && key === 'value')) { value = txt; continue; }
      if (isProp) continue; // Datasheet / Description / custom fields → not drawn
      const layer = LYR(argS(c, 'layer', 1, 'F.SilkS'));
      if (!layer || eff.hide) continue;
      const [bx, by] = baselineFromKicad(tx, ty, tabs, rot, eff, txt);
      // LAMINA footprint texts are rendered valign 'middle' (resolvePart): anchor = baseline − up·laminaBaselineUp
      const gr = relRot(tabs); const n = txt.split('\n').length;
      const upShift = laminaBaselineUp('middle', eff.size, n);
      let [lx, ly] = TL(bx, by);
      lx -= -Math.sin(gr * D2R) * upShift; ly -= Math.cos(gr * D2R) * upShift;
      const t = txt.replace(/\$\{REFERENCE\}/g, '${REF}');
      fp.graphics.push({ t: 'text', x: lx, y: ly, text: t, size: eff.size / KICAD_TEXT_SIZE_FACTOR, thickness: eff.thickness, rot: gr, align: eff.h, layer });
      continue;
    }
    if (h === 'pad') {
      const name = S(c[1]), type = S(c[2]), shape = S(c[3]);
      const pat = child(c, 'at');
      const px = pat ? num(pat[1]) : 0, py = pat ? num(pat[2]) : 0, prot = pat && pat.length > 3 ? num(pat[3]) : 0; // ABSOLUTE rotation, absent = 0
      const sz = child(c, 'size'); const w = sz ? num(sz[1]) : 1, hh = sz ? num(sz[2], w) : w;
      const dr = child(c, 'drill');
      let drill = 0, slotLen = 0, slotAlongY = false;
      if (dr) {
        const toks = dr.slice(1).filter(t => !Array.isArray(t)).map(S);
        if (toks[0] === 'oval') { const a = num(toks[1]), b = num(toks[2], a); slotLen = Math.max(a, b); drill = Math.min(a, b); slotAlongY = b > a + 1e-9; }
        else drill = num(toks[0]);
      }
      const layersN = child(c, 'layers'); const lyrs = layersN ? layersN.slice(1).map(S) : [];
      const [lx, ly] = TL(px, py);
      let lrot = relRot(prot);
      // LAMINA slots run along the pad's own X: a (drill oval W H) with H > W is expressed by turning the pad 90° and swapping w/h
      let pw = w, ph = hh;
      if (slotAlongY) { lrot += 90; pw = hh; ph = w; }
      if (slotLen > 0 && slotLen <= drill + 1e-9) slotLen = 0;
      if (type === 'np_thru_hole') {
        const d = drill || Math.min(w, hh);
        const hole = { x: lx, y: ly, d };
        if (slotLen > 0) { hole.slotLen = slotLen; hole.rot = lrot; }
        fp.holes.push(hole);
        continue;
      }
      let layer = 'both';
      if (type === 'smd' || type === 'connect') { const onF = lyrs.some(t => t === 'F.Cu'), onB = lyrs.some(t => t === 'B.Cu'); layer = onB && !onF ? 'B' : 'F'; if (bottom) layer = layer === 'F' ? 'B' : 'F'; }
      let lshape = { circle: 'circle', rect: 'rect', oval: 'oval', roundrect: 'roundrect', trapezoid: 'rect', custom: 'rect', chamfered_rect: 'roundrect' }[shape] || 'rect';
      if (shape === 'custom' || shape === 'trapezoid') warn(`pad "${name}" of ${libname}: shape ${shape} approximated as rect`);
      const pad = { name, x: lx, y: ly, shape: lshape, w: pw, h: shape === 'circle' ? pw : ph, drill, layer, rot: lrot };
      if (slotLen > 0) pad.slotLen = slotLen;
      if (lshape === 'roundrect') { const rr = child(c, 'roundrect_rratio'); pad.rr = rr ? num(rr[1], 0.25) : 0.25; }
      const netN = child(c, 'net'); if (netN) { const nn = netName(netN); if (nn) pad.net = nn; }
      const smm = child(c, 'solder_mask_margin'); if (smm) pad.maskMargin = num(smm[1]);
      if (!lyrs.some(t => t.endsWith('.Mask'))) pad.mask = false;
      if ((type === 'smd') && !lyrs.some(t => t.endsWith('.Paste'))) pad.paste = false;
      fp.pads.push(pad);
      continue;
    }
    if (h.startsWith('fp_')) {
      const kl = argS(c, 'layer', 1, 'F.SilkS');
      if (kl === 'F.CrtYd' || kl === 'B.CrtYd') { const g = grToGraphic(c, h, TL, null, kl, warn); if (g) crtyd.push(g); continue; }
      const layer = LYR(kl);
      if (!layer) continue; // Dwgs.User etc.
      const g = grToGraphic(c, h, TL, layer, kl, warn);
      if (g) fp.graphics.push(g);
    }
  }
  // courtyard: bbox of F/B.CrtYd graphics, else bbox of pads
  let cpts = [];
  for (const g of crtyd) cpts = cpts.concat(graphicPts(g));
  if (cpts.length < 2) for (const p of fp.pads) cpts.push([p.x - p.w / 2, p.y - p.h / 2], [p.x + p.w / 2, p.y + p.h / 2]);
  if (cpts.length < 2) for (const g of fp.graphics) cpts = cpts.concat(graphicPts(g));
  if (cpts.length >= 2) {
    const b = bboxOfPoints(cpts);
    fp.courtyard = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, w: Math.max(0.2, b[2] - b[0]), h: Math.max(0.2, b[3] - b[1]) };
  } else fp.courtyard = { w: 1, h: 1 };
  fp.body3d = [{ t: 'box', x: fp.courtyard.x || 0, y: fp.courtyard.y || 0, z: 0, w: fp.courtyard.w, d: fp.courtyard.h, h: fp.height, color: '#333' }];
  if (!fp.refPos) fp.refPos = { x: fp.courtyard.x || 0, y: (fp.courtyard.y || 0) + fp.courtyard.h / 2 + 1 };
  if (hideRef) fp.refText = false;
  const m = /^([A-Za-z]+)/.exec(ref); if (m) fp.ref = m[1];
  return { fp, ref, value, x, y, rot, side, hideRef, libname };
}
function graphicPts(g) {
  switch (g.t) {
    case 'line': return [[g.x1, g.y1], [g.x2, g.y2]];
    case 'circle': return [[g.cx - g.r, g.cy - g.r], [g.cx + g.r, g.cy + g.r]];
    case 'arc': return arcPoints(g.cx, g.cy, g.r, g.a0, g.a1);
    case 'rect': return [[g.cx - g.w / 2, g.cy - g.h / 2], [g.cx + g.w / 2, g.cy + g.h / 2]];
    case 'poly': case 'polyline': return g.pts;
    default: return [];
  }
}
// (fp_line|gr_line ...) etc → LAMINA library-graphic {t,...,layer}. T maps target-frame points to the output frame (Y up).
function grToGraphic(c, h, T, layer, kl, warn) {
  const kind = h.replace(/^(fp|gr)_/, '');
  const w = strokeW(c, 0.12);
  const filled = fillYes(c);
  switch (kind) {
    case 'line': { const s = child(c, 'start'), e = child(c, 'end'); if (!s || !e) return null; const a = T(num(s[1]), num(s[2])), b = T(num(e[1]), num(e[2])); return { t: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], w, layer }; }
    case 'arc': {
      const s = child(c, 'start'), m = child(c, 'mid'), e = child(c, 'end');
      if (!s || !e) return null;
      if (!m) { warn(`${h} without (mid …) (legacy angle syntax) skipped`); return null; }
      const A = arcFrom3(T(num(s[1]), num(s[2])), T(num(m[1]), num(m[2])), T(num(e[1]), num(e[2])));
      if (!A) return null;
      return { t: 'arc', ...A, w, layer };
    }
    case 'circle': { const ce = child(c, 'center'), e = child(c, 'end'); if (!ce || !e) return null; const r = dist(num(ce[1]), num(ce[2]), num(e[1]), num(e[2])); const cc = T(num(ce[1]), num(ce[2])); return { t: 'circle', cx: cc[0], cy: cc[1], r: filled ? r + w / 2 : r, w: filled ? 0 : w, layer }; }
    case 'rect': { const s = child(c, 'start'), e = child(c, 'end'); if (!s || !e) return null; const a = T(num(s[1]), num(s[2])), b = T(num(e[1]), num(e[2])); return { t: 'rect', cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]), rot: 0, rx: 0, filled, lw: w, layer }; }
    case 'poly': { const p = child(c, 'pts'); if (!p) return null; const pts = children(p, 'xy').map(q => T(num(q[1]), num(q[2]))); if (pts.length < 3) return null; return { t: 'poly', pts, filled, lw: w, layer }; }
    case 'curve': warn(`${h} (bezier) skipped`); return null;
    default: return null;
  }
}

// ---------- board ----------
export function importKicad(text, opts = {}) {
  const warnings = [];
  const warn = m => warnings.push(m);
  const root = parseSexpr(text);
  const pcb = root.find(n => Array.isArray(n) && (S(n[0]) === 'kicad_pcb'));
  if (!pcb) throw new Error('Not a KiCad PCB file (no kicad_pcb node)');
  const general = child(pcb, 'general');
  const thickness = general ? argN(general, 'thickness', 1, 1.6) : 1.6;
  // net table
  const netTable = new Map(); // number → name
  for (const n of children(pcb, 'net')) netTable.set(num(n[1]), S(n[2]));
  const netName = netNode => { // (net N "name") | (net N) | (net "name")
    if (!netNode) return '';
    const a = netNode[1], b = netNode[2];
    if (b !== undefined) return S(b);
    if (a instanceof Str) return a.s;
    const k = num(a, -1); return netTable.get(k) || '';
  };
  const layerOf = node => argS(node, 'layer', 1, '');
  const stackColor = (() => { const st = child(child(pcb, 'setup') || [], 'stackup'); if (!st) return null; for (const l of children(st, 'layer')) if (S(l[1]) === 'F.Mask') { const c = child(l, 'color'); if (c) return S(c[1]).toLowerCase(); } return null; })();
  const silkColor = (() => { const st = child(child(pcb, 'setup') || [], 'stackup'); if (!st) return null; for (const l of children(st, 'layer')) if (S(l[1]) === 'F.SilkS') { const c = child(l, 'color'); if (c) return S(c[1]).toLowerCase(); } return null; })();

  // ---- collect Edge.Cuts elements (board level + inside footprints) in KiCad coords ----
  const edgeSegs = []; // {pts, closed, kind, raw}
  const grPts = (c, h, T) => { // → {pts, closed, kind:'line'|'arc'|'rect'|'circle'|'poly', extra}
    const kind = h.replace(/^(fp|gr)_/, '');
    switch (kind) {
      case 'line': { const s = child(c, 'start'), e = child(c, 'end'); if (!s || !e) return null; return { pts: [T(num(s[1]), num(s[2])), T(num(e[1]), num(e[2]))], closed: false, kind }; }
      case 'arc': { const s = child(c, 'start'), m = child(c, 'mid'), e = child(c, 'end'); if (!s || !m || !e) return null; const S0 = T(num(s[1]), num(s[2])), M = T(num(m[1]), num(m[2])), E = T(num(e[1]), num(e[2])); const A = arcFrom3(S0, M, E); if (!A) return { pts: [S0, E], closed: false, kind: 'line' }; let pts = arcPoints(A.cx, A.cy, A.r, A.a0, A.a1); if (Math.abs(pts[0][0] - S0[0]) > TOL || Math.abs(pts[0][1] - S0[1]) > TOL) pts = pts.reverse(); pts[0] = S0; pts[pts.length - 1] = E; return { pts, closed: false, kind, arc: A }; }
      case 'circle': { const ce = child(c, 'center'), e = child(c, 'end'); if (!ce || !e) return null; const r = dist(num(ce[1]), num(ce[2]), num(e[1]), num(e[2])); const cc = T(num(ce[1]), num(ce[2])); return { pts: circlePoints(cc[0], cc[1], r, 96), closed: true, kind, circle: { cx: cc[0], cy: cc[1], r } }; }
      case 'rect': { const s = child(c, 'start'), e = child(c, 'end'); if (!s || !e) return null; const a = T(num(s[1]), num(s[2])), b = T(num(e[1]), num(e[2])); return { pts: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]], closed: true, kind }; }
      case 'poly': { const p = child(c, 'pts'); if (!p) return null; const pts = children(p, 'xy').map(q => T(num(q[1]), num(q[2]))); if (pts.length < 3) return null; return { pts, closed: true, kind }; }
      default: return null;
    }
  };
  const ID = (x, y) => [x, y];
  for (const c of pcb) {
    if (!Array.isArray(c)) continue;
    const h = S(c[0]);
    if (h.startsWith('gr_') && layerOf(c) === 'Edge.Cuts') { const g = grPts(c, h, ID); if (g) edgeSegs.push(g); }
    if (h === 'footprint' || h === 'module') {
      const at = child(c, 'at'); const fx = at ? num(at[1]) : 0, fy = at ? num(at[2]) : 0, fr = at ? num(at[3]) : 0;
      const T = (lx, ly) => { const a = fr * D2R; return [fx + lx * Math.cos(a) + ly * Math.sin(a), fy - lx * Math.sin(a) + ly * Math.cos(a)]; };
      for (const d of c) if (Array.isArray(d) && S(d[0]).startsWith('fp_') && layerOf(d) === 'Edge.Cuts') { const g = grPts(d, S(d[0]), T); if (g) edgeSegs.push(g); }
    }
  }
  // ---- outline ----
  let outline = null, kx0 = 0, ky1 = 0, cutoutLoops = [];
  const loops = chainSegments(edgeSegs);
  const closed = loops.filter(l => l.closed && l.pts.length >= 3);
  if (!closed.length) {
    const openL = loops.filter(l => !l.closed && l.pts.length >= 3);
    if (openL.length) { warn('Edge.Cuts outline is not closed — using the longest open chain'); openL.sort((a, b) => b.pts.length - a.pts.length); closed.push({ ...openL[0], closed: true }); }
  }
  if (!closed.length) {
    warn('no Edge.Cuts outline found — using the bounding box of all copper/graphics (100×100 fallback if empty)');
    outline = { type: 'rect', w: 100, h: 100, r: 0 };
    kx0 = 0; ky1 = 100;
  } else {
    closed.sort((a, b) => Math.abs(polygonArea(b.pts)) - Math.abs(polygonArea(a.pts)));
    const main = closed[0];
    const bb = bboxOfPoints(main.pts);
    kx0 = bb[0]; ky1 = bb[3];
    const W = bb[2] - bb[0], H = bb[3] - bb[1];
    outline = classifyOutline(main, W, H, kx0, ky1);
    cutoutLoops = closed.slice(1);
  }
  const X = x => x - kx0, Y = y => ky1 - y;
  const P = (x, y) => [X(x), Y(y)];
  const board = newBoard({ outline, thickness, name: opts.name || (argS(child(pcb, 'title_block') || [], 'title') || 'KICAD') });
  if (stackColor && ['green', 'red', 'blue', 'black', 'white', 'yellow', 'purple'].includes(stackColor)) board.color = stackColor;
  if (silkColor === 'black' || silkColor === 'white') board.silkColor = silkColor;
  const items = board.items;
  const skipped = new Map();
  const skip = k => skipped.set(k, (skipped.get(k) || 0) + 1);

  // cutouts
  for (const cl of cutoutLoops) {
    if (cl.parts.length === 1 && cl.parts[0].circle) { const c = cl.parts[0].circle; items.push(makeItem('circle', { layer: 'Edge.Cuts', cx: X(c.cx), cy: Y(c.cy), r: c.r, width: 0.1, filled: false })); continue; }
    const cpts = simplifyCollinear(cl.pts.map(([x, y]) => P(x, y)));
    if (isAxisRectPts(cpts)) { const b = bboxOfPoints(cpts); items.push(makeItem('rect', { layer: 'Edge.Cuts', x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, w: b[2] - b[0], h: b[3] - b[1], rot: 0, rx: 0, width: 0.1, filled: false })); continue; }
    items.push(makeItem('polygon', { layer: 'Edge.Cuts', points: cpts, width: 0.1, filled: false }));
  }

  // ---- board-level graphics / tracks / vias / zones / footprints ----
  const netUsed = new Set();
  const segsByKey = new Map();
  for (const c of pcb) {
    if (!Array.isArray(c)) continue;
    const h = S(c[0]);
    if (h.startsWith('gr_')) {
      const kl = layerOf(c);
      if (kl === 'Edge.Cuts') continue;
      const layer = KICAD_TO_LAYER[kl];
      if (!layer) { skip(`${h} on ${kl}`); continue; }
      if (h === 'gr_text') {
        const txt = S(c[1]); const eff = parseEffects(c);
        const at = child(c, 'at'); const ax = at ? num(at[1]) : 0, ay = at ? num(at[2]) : 0, rot = at ? num(at[3]) : 0;
        const [bx, by] = baselineFromKicad(ax, ay, rot, 0, eff, txt);
        const onBottom = layer.startsWith('B.');
        items.push(makeItem('text', { layer, x: X(bx), y: Y(by), text: txt, size: eff.size / KICAD_TEXT_SIZE_FACTOR, thickness: eff.thickness, rot, mirror: eff.mirror !== onBottom, align: eff.h }));
        continue;
      }
      if (h === 'gr_text_box' || h === 'gr_curve' || h === 'gr_bbox') { skip(h); continue; }
      const g = grToGraphic(c, h, P, layer, kl, warn);
      if (!g) { skip(h); continue; }
      const it = graphicToItem(g);
      if (it) items.push(it); else skip(h);
      continue;
    }
    if (h === 'segment') {
      const s = child(c, 'start'), e = child(c, 'end'); if (!s || !e) continue;
      const kl = layerOf(c); const layer = KICAD_TO_LAYER[kl];
      if (!layer || !layer.endsWith('.Cu')) { skip(`segment on ${kl}`); continue; }
      const width = argN(c, 'width', 1, 0.25); const net = netName(child(c, 'net')); if (net) netUsed.add(net);
      const key = `${layer}|${width}|${net}`;
      (segsByKey.get(key) || segsByKey.set(key, []).get(key)).push({ pts: [P(num(s[1]), num(s[2])), P(num(e[1]), num(e[2]))], closed: false, layer, width, net });
      continue;
    }
    if (h === 'arc') { // track arc → flattened trace
      const s = child(c, 'start'), m = child(c, 'mid'), e = child(c, 'end'); if (!s || !m || !e) continue;
      const kl = layerOf(c); const layer = KICAD_TO_LAYER[kl]; if (!layer) continue;
      const A = arcFrom3(P(num(s[1]), num(s[2])), P(num(m[1]), num(m[2])), P(num(e[1]), num(e[2])));
      const net = netName(child(c, 'net')); if (net) netUsed.add(net);
      const pts = A ? arcPoints(A.cx, A.cy, A.r, A.a0, A.a1) : [P(num(s[1]), num(s[2])), P(num(e[1]), num(e[2]))];
      items.push(makeItem('trace', { layer, points: pts, width: argN(c, 'width', 1, 0.25), net }));
      continue;
    }
    if (h === 'via') {
      const at = child(c, 'at'); if (!at) continue;
      const net = netName(child(c, 'net')); if (net) netUsed.add(net);
      const via = makeItem('via', { x: X(num(at[1])), y: Y(num(at[2])), d: argN(c, 'size', 1, 0.8), drill: argN(c, 'drill', 1, 0.4), net });
      const tent = child(c, 'tenting'); if (tent && S(tent[1]) === 'none') via.tented = false;
      items.push(via);
      continue;
    }
    if (h === 'zone') {
      if (child(c, 'keepout')) { skip('keepout zone'); continue; }
      const lay = child(c, 'layers') ? child(c, 'layers').slice(1).map(S) : [layerOf(c)];
      const poly = child(c, 'polygon'); const p = poly ? child(poly, 'pts') : null;
      if (!p) { skip('zone without polygon'); continue; }
      const pts = children(p, 'xy').map(q => P(num(q[1]), num(q[2])));
      const net = argS(c, 'net_name') || netName(child(c, 'net')); if (net) netUsed.add(net);
      let any = false;
      for (const kl of lay) {
        const layer = KICAD_TO_LAYER[kl === 'F&B.Cu' ? 'F.Cu' : kl];
        const layers = kl === 'F&B.Cu' || kl === '*.Cu' ? ['F.Cu', 'B.Cu'] : layer && layer.endsWith('.Cu') ? [layer] : [];
        for (const l of layers) { items.push(makeItem('region', { layer: l, points: dedupe(pts), net })); any = true; }
      }
      if (!any) skip(`zone on ${lay.join(',')}`);
      continue;
    }
    if (h === 'footprint' || h === 'module') {
      const cf = convertFootprint(c, netName, warn);
      for (const pd of cf.fp.pads) if (pd.net) netUsed.add(pd.net);
      const [x, y] = P(cf.x, cf.y);
      // LAMINA-exported helpers turn back into plain items
      if (cf.libname === 'LAMINA:hole' && cf.fp.holes.length === 1 && !cf.fp.pads.length) { const hh = cf.fp.holes[0]; const [ox, oy] = rotPt(hh.x, hh.y, cf.rot); items.push(makeItem('hole', { x: x + ox, y: y + oy, d: hh.d })); continue; }
      if (cf.libname === 'LAMINA:slot' && cf.fp.holes.length === 1 && !cf.fp.pads.length) { const hh = cf.fp.holes[0]; const [ox, oy] = rotPt(hh.x, hh.y, cf.rot); items.push(makeItem('slot', { x: x + ox, y: y + oy, len: hh.slotLen || hh.d, w: hh.d, rot: (hh.rot || 0) + cf.rot })); continue; }
      if (cf.libname === 'LAMINA:pad' && cf.fp.pads.length === 1 && !cf.fp.holes.length) {
        const pd = cf.fp.pads[0]; const [ox, oy] = rotPt(pd.x, pd.y, cf.rot);
        items.push(makeItem('pad', { x: x + ox, y: y + oy, shape: pd.shape, w: pd.w, h: pd.h, rot: pd.rot + cf.rot, drill: pd.drill, slot: pd.slotLen || 0, layer: pd.layer, plated: true, name: pd.name || (cf.ref !== 'PAD' ? cf.ref : ''), net: pd.net || '', ...(pd.rr != null ? { rr: pd.rr } : {}) }));
        continue;
      }
      items.push(makeItem('part', { lib: 'kicad:' + cf.libname, ref: cf.ref, value: cf.value, x, y, rot: cf.rot, side: cf.side, through: false, fp: cf.fp, ...(cf.hideRef ? { hideRef: true } : {}) }));
      continue;
    }
    if (h === 'dimension' || h === 'target' || h === 'group' || h === 'generated' || h === 'image' || h === 'table' || h === 'embedded_fonts' || h === 'embedded_files') { if (h !== 'group' && h !== 'embedded_fonts') skip(h); continue; }
  }
  // merge touching segments into polylines (same layer/width/net)
  for (const segs of segsByKey.values()) {
    const { layer, width, net } = segs[0];
    for (const loop of chainSegments(segs, TOL)) {
      const pts = loop.closed ? loop.pts.concat([loop.pts[0]]) : loop.pts;
      items.push(makeItem('trace', { layer, points: dedupe(pts, 1e-7), width, net }));
    }
  }
  for (const [k, v] of skipped) warn(`skipped ${v} × ${k}`);
  return { board, warnings, nets: Array.from(netUsed).sort() };
}

// drop points that are collinear with their neighbours (and duplicates)
function simplifyCollinear(pts, tol = 1e-4) {
  pts = dedupe(pts, tol);
  if (pts.length < 4) return pts;
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cross) / len > tol) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}
function isAxisRectPts(pts, tol = TOL) {
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; if (Math.abs(a[0] - b[0]) > tol && Math.abs(a[1] - b[1]) > tol) return false; }
  return true;
}
// closed main loop → LAMINA outline (rect / rounded rect / circle / polygon), in LAMINA frame (bbox min at 0,0)
function classifyOutline(main, W, H, kx0, ky1) {
  const parts = main.parts || [];
  const P = ([x, y]) => [x - kx0, ky1 - y];
  if (parts.length === 1 && parts[0].circle) return { type: 'circle', d: +(2 * parts[0].circle.r).toFixed(4) };
  const lines = parts.filter(p => p.kind === 'line'), arcs = parts.filter(p => p.kind === 'arc');
  const axisAligned = lines.every(l => Math.abs(l.pts[0][0] - l.pts[1][0]) < TOL || Math.abs(l.pts[0][1] - l.pts[1][1]) < TOL);
  if (lines.length === 4 && arcs.length === 4 && parts.length === 8 && axisAligned) {
    const r0 = arcs[0].arc.r;
    if (arcs.every(a => Math.abs(a.arc.r - r0) < TOL)) return { type: 'rect', w: +W.toFixed(4), h: +H.toFixed(4), r: +r0.toFixed(3) };
  }
  let pts = simplifyCollinear(main.pts.map(P));
  if (isAxisRectPts(pts)) return { type: 'rect', w: +W.toFixed(4), h: +H.toFixed(4), r: 0 };
  if (Math.abs(polygonArea(pts)) < 1e-9) pts = [[0, 0], [W, 0], [W, H], [0, H]];
  return { type: 'polygon', points: ensureCCW(pts) };
}

// LAMINA library-style graphic (from grToGraphic, board frame) → LAMINA item
function graphicToItem(g) {
  switch (g.t) {
    case 'line': return makeItem('line', { layer: g.layer, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, width: g.w });
    case 'arc': return makeItem('arc', { layer: g.layer, cx: g.cx, cy: g.cy, r: g.r, a0: g.a0, a1: g.a1, width: g.w });
    case 'circle': return makeItem('circle', { layer: g.layer, cx: g.cx, cy: g.cy, r: g.r, width: g.w || 0.1, filled: !(g.w > 0) });
    case 'rect': return makeItem('rect', { layer: g.layer, x: g.cx, y: g.cy, w: g.w, h: g.h, rot: 0, rx: 0, width: g.lw, filled: !!g.filled });
    case 'poly': return makeItem('polygon', { layer: g.layer, points: g.pts, width: g.lw, filled: !!g.filled });
    default: return null;
  }
}

// ---------- .kicad_mod ----------
export function importKicadFootprint(text, opts = {}) {
  const root = parseSexpr(text);
  const node = root.find(n => Array.isArray(n) && (S(n[0]) === 'footprint' || S(n[0]) === 'module'));
  if (!node) throw new Error('Not a KiCad footprint file');
  const warnings = [];
  const cf = convertFootprint(node, nn => (nn && nn[2] !== undefined ? S(nn[2]) : (nn && nn[1] instanceof Str ? nn[1].s : '')), m => warnings.push(m));
  const fp = cf.fp;
  fp.id = opts.id || ('kicad:' + cf.libname);
  fp.warnings = warnings;
  return fp;
}
