// LAMINA ← DipTrace ASCII PCB importer.
//   importDiptraceAsc(text, opts) → { board, warnings, nets }
// Input: the text file DipTrace PCB Layout writes with File → Save As → "DipTrace ASCII (*.asc)" (the binary .dip cannot
// be read). Reverse-engineered from real exports (Source "DipTrace-PCB"): a parenthesised tree that parseSexpr() reads.
//
// Facts verified on real files (see test/fixtures/diptrace-mini.asc):
//   • every coordinate / size is stored in 1/3 mm, whatever the "Units" line says (0.1" header pitch = 7.62, 0.5 mm QFP
//     pitch = 1.5, 0805 pad gap 6.858, 12 mil trace = 0.914 …) → mm = value / 3;
//   • Y grows DOWN (QFP pin numbering runs counter-clockwise on screen only if +Y is down) → LAMINA y = −y;
//   • component pads are listed already rotated/mirrored into the board frame relative to the component anchor (X,Y);
//     (Inverted "Y") swaps a pad's width/height; PadWidth −1 means "use the component defaults";
//   • BottomSide "Y" parts have their pads pre-mirrored, so we un-mirror to LAMINA's top-view local frame and let the
//     resolver mirror them again;
//   • pattern silk (Component → Shapes) is stored NORMALISED: coordinates in −0.5…0.5 of the pattern's (Width, Height),
//     in the UN-rotated pattern frame; Orientation k = k×90° clockwise on screen (derived from a SIL header whose origin
//     sits on pin 1) — this rotation direction is the one thing not double-checked, so a warning says so;
//   • traces live in Nets → Net → Lines → Line → Points: (pt x y layer segType width …); layer 0 = Top, 1 = Bottom;
//     a layer change between consecutive points is a via (net ViaSize/ViaRing);
//   • board Shapes: ShapeType 6 = text (Name, FontSize, two-point box), Type 1/4 = top/bottom silk, Type 2 = copper on
//     (Layer n). Copper pours are NOT imported (LAMINA regions have no automatic clearance) — a warning lists them.
import { parseSexpr } from './kicad.js';
import { newBoard, makeItem } from '../model.js';
import { ensureCCW, polygonArea } from '../geom.js';

const K = 1 / 3;                       // file unit → mm
const S = v => (v && typeof v === 'object' && 's' in v) ? v.s : (v == null ? '' : String(v));
const num = (v, d = 0) => { const x = parseFloat(S(v)); return Number.isFinite(x) ? x : d; };
const head = n => Array.isArray(n) && n.length ? S(n[0]) : '';
const child = (n, key) => Array.isArray(n) ? n.find(c => Array.isArray(c) && S(c[0]) === key) : undefined;
const children = (n, key) => Array.isArray(n) ? n.filter(c => Array.isArray(c) && S(c[0]) === key) : [];
const argN = (n, key, d = 0) => { const c = child(n, key); return c ? num(c[1], d) : d; };
const argS = (n, key, d = '') => { const c = child(n, key); return c ? S(c[1]) : d; };
const yes = (n, key) => argS(n, key) === 'Y';
const r3 = v => Math.round(v * 1000) / 1000;
const D2R = Math.PI / 180;

function arc3(p0, pm, p1, segs = 12) { // points along the arc p0→pm→p1 (excluding p0, including p1); straight when collinear
  const [ax, ay] = p0, [bx, by] = pm, [cx, cy] = p1;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [p1];
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(am - a0) <= norm(a1 - a0);
  const sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
  const out = [];
  for (let i = 1; i <= segs; i++) { const a = a0 + sweep * i / segs; out.push([ux + r * Math.cos(a), uy + r * Math.sin(a)]); }
  return out;
}
const rot = (x, y, deg) => { const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return [x * c - y * s, x * s + y * c]; };

export function importDiptraceAsc(text, opts = {}) {
  const warnings = []; const warn = m => warnings.push(m);
  const root = parseSexpr(text);
  const src = argS(root, 'Source');
  if (!/DipTrace/i.test(src)) throw new Error('Not a DipTrace ASCII file (no "(Source "DipTrace-PCB")" header)');
  if (/Schematic/i.test(src)) throw new Error('This is a DipTrace SCHEMATIC ASCII export — save the PCB Layout as DipTrace ASCII instead');
  const boardNode = child(root, 'Board');
  if (!boardNode) throw new Error('No (Board …) section in this DipTrace ASCII file');
  const units = argS(root, 'Units');

  // ---------- layers ----------
  const layerByNum = new Map();
  for (const l of children(child(boardNode, 'Layers'), 'Name')) {
    const name = S(l[1]); const n = argN(l, 'Number', -1);
    layerByNum.set(n, /top/i.test(name) ? 'F.Cu' : /bottom/i.test(name) ? 'B.Cu' : null);
  }
  if (!layerByNum.size) { layerByNum.set(0, 'F.Cu'); layerByNum.set(1, 'B.Cu'); }
  const cuLayer = n => layerByNum.has(n) ? layerByNum.get(n) : (n === 0 ? 'F.Cu' : n === 1 ? 'B.Cu' : null);
  const inner = new Set();

  // ---------- geometry collectors (file frame, mm, Y down) ----------
  const items = [];                                   // LAMINA items with x/y in "file mm" (Y down) — translated + flipped at the end
  const P = (x, y) => [x * K, y * K];

  // ---------- board outline ----------
  let outlinePts = [];
  const bp = child(boardNode, 'Points');
  if (bp) {
    const raw = children(bp, 'pt').map(p => ({ x: num(p[1]) * K, y: num(p[2]) * K, arc: S(p[3]) === 'Y' }));
    // "Y" points are arc mid-points between their neighbours
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (p.arc && i > 0 && i < raw.length - 1) { const prev = raw[i - 1], next = raw[i + 1]; const pts = arc3([prev.x, prev.y], [p.x, p.y], [next.x, next.y]); outlinePts.push(...pts.slice(0, -1)); }
      else outlinePts.push([p.x, p.y]);
    }
    // drop the duplicated closing point
    if (outlinePts.length > 2) { const a = outlinePts[0], b = outlinePts[outlinePts.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) outlinePts.pop(); }
  }

  // ---------- nets ----------
  const netName = new Map();
  const netsNode = child(boardNode, 'Nets');
  for (const n of children(netsNode, 'Net')) netName.set(argN(n, 'Number', -1), S(n[1]));
  const viaStyles = children(child(boardNode, 'ViaStyles'), 'ViaStyle').map(v => ({ d: num(v[3]) * K, drill: num(v[4]) * K }));
  const defVia = viaStyles[0] && viaStyles[0].d > 0 ? viaStyles[0] : { d: 1.0, drill: 0.5 };

  // ---------- components ----------
  const parts = [];
  let padCount = 0, silkShapes = 0, unknownShape = new Map(), viaCount = 0, holeCount = 0;
  for (const c of children(child(boardNode, 'Components'), 'Component')) {
    const libname = S(c[1]); const ref = S(c[2]) || libname;
    const cx = argN(c, 'X') * K, cy = argN(c, 'Y') * K;
    const bottom = yes(c, 'BottomSide');
    const orient = argN(c, 'Orientation', 0), angle = argN(c, 'Angle', 0);
    const W = argN(c, 'Width') * K, H = argN(c, 'Height') * K;
    const dW = argN(c, 'PadWidth', 0), dH = argN(c, 'PadHeight', 0), dHole = argN(c, 'PadHole', 0), dHoleH = argN(c, 'PadHoleH', 0), dShape = argN(c, 'PadShape', 0), dSurf = yes(c, 'SurfacePad');
    // pads (already in the board frame relative to the anchor; un-mirror bottom parts for LAMINA's local frame)
    const pads = [];
    for (const p of children(child(c, 'Pads'), 'Pad')) {
      const name = S(p[2]); const px = num(p[4]) * K, py = num(p[5]) * K;
      const number = argN(p, 'Number', 0);
      let w = argN(p, 'PadWidth', -1), h = argN(p, 'PadHeight', -1), hole = argN(p, 'PadHole', -1), holeH = argN(p, 'PadHoleH', -1);
      if (w < 0) w = dW; if (h < 0) h = dH; if (hole < 0) hole = dHole; if (holeH < 0) holeH = dHoleH;
      w *= K; h *= K; hole *= K; holeH *= K;
      const shapeCode = child(p, 'PadShape') ? argN(p, 'PadShape', 0) : dShape;
      const surface = child(p, 'SurfacePad') ? yes(p, 'SurfacePad') : dSurf;
      if (!(w > 0) || !(h > 0)) { if (name) warn(`${ref}: pad "${name}" has no size — skipped`); continue; }
      if (!name && number <= 0) continue;                       // placeholder pads (0 / last) DipTrace writes around the list
      if (yes(p, 'Inverted')) { const t = w; w = h; h = t; }
      const th = hole > 0 && !surface;
      let shape = 'rect';
      if (shapeCode === 0) shape = Math.abs(w - h) < 1e-6 ? 'circle' : 'oval';
      else if (shapeCode === 1) shape = 'oval';
      else if (shapeCode === 2) shape = 'rect';
      else if (shapeCode === 4) shape = 'roundrect';
      else if (shapeCode === 3) { shape = 'rect'; warn(`${ref}: polygon pad "${name}" imported as a rectangle`); }
      const isSlot = th && holeH > 0 && Math.abs(holeH - hole) > 0.17;   // PadHole/PadHoleH differ by <0.05 mm on round holes (drill vs finished size)
      const pad = { name, x: r3(bottom ? -px : px), y: r3(-py), shape, w: r3(w), h: r3(h), drill: th ? r3(isSlot ? Math.min(hole, holeH) : Math.max(hole, holeH > 0 ? holeH : 0)) : 0, layer: th ? 'both' : 'F' };
      if (isSlot) { pad.slotLen = r3(Math.max(hole, holeH)); if (holeH > hole) { pad.rot = 90; const t = pad.w; pad.w = pad.h; pad.h = t; } }  // LAMINA slots run along the pad's local X
      const nn = argN(p, 'NetNumber', -1); if (nn >= 0 && netName.has(nn)) pad.net = netName.get(nn);
      pads.push(pad); padCount++;
    }
    // pattern silk: normalised shapes → mm, rotate by orientation (k × 90° clockwise on screen), mirror for bottom
    const graphics = [];
    const rotDeg = -90 * orient - angle;               // screen-clockwise → negative in a Y-up frame; applied on Y-flipped coords below
    const XY = (nx, ny) => { let x = nx * W, y = -(ny * H); [x, y] = rot(x, y, rotDeg); return [r3(x), r3(y)]; };  // local (top-view) frame: the resolver mirrors bottom parts
    const silk = 'F.Silk';
    for (const s of children(child(c, 'Shapes'), 'Shape')) {
      const t = num(s[1]); if (t <= 0) continue;
      const nums = s.slice(4, 10).map(v => num(v));   // (Shape type "N" layer x1 y1 x2 y2 x3 y3 …)
      const [x1, y1, x2, y2, x3, y3] = nums;
      if (t === 1 || t === 5) { const a = XY(x1, y1), b = XY(x2, y2); if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6) graphics.push({ t: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: 0.15, layer: silk }); }
      else if (t === 2) { const a = XY(x1, y1), b = XY(x2, y2); graphics.push({ t: 'polyline', pts: [a, [b[0], a[1]], b, [a[0], b[1]]], w: 0.15, closed: true, layer: silk }); }
      else if (t === 3) { const a = XY(x1, y1), b = XY(x2, y2); const cxx = (a[0] + b[0]) / 2, cyy = (a[1] + b[1]) / 2, rx = Math.abs(a[0] - b[0]) / 2, ry = Math.abs(a[1] - b[1]) / 2; graphics.push({ t: 'circle', cx: r3(cxx), cy: r3(cyy), r: r3(Math.max(rx, ry)), w: 0.15, layer: silk }); }
      else if (t === 6) { const a = XY(x1, y1), m = XY(x2, y2), b = XY(x3, y3); const pts = [a, ...arc3(a, m, b, 10)]; graphics.push({ t: 'polyline', pts: pts.map(q => [r3(q[0]), r3(q[1])]), w: 0.15, closed: false, layer: silk }); }
      else unknownShape.set(t, (unknownShape.get(t) || 0) + 1);
      silkShapes++;
    }
    // component-level NPTH holes: (Holes (Hole "Y" "N" x y outerD holeD)) — DipTrace "Hole" components carry only these
    const holes = [];
    for (const hh of children(child(c, 'Holes'), 'Hole')) { if (S(hh[1]) !== 'Y') continue; const hd = num(hh[6]) * K; if (!(hd > 0)) continue; const hx = num(hh[3]) * K, hy = num(hh[4]) * K; holes.push({ x: r3(bottom ? -hx : hx), y: r3(-hy), d: r3(hd) }); }
    // DipTrace "Static Via" components (one plated pad, empty pattern) → LAMINA vias; hole-only components → hole items
    if (/^static ?via/i.test(libname) && pads.length === 1 && pads[0].drill > 0) { const pd = pads[0]; items.push({ type: 'via', x: cx + (bottom ? -pd.x : pd.x), y: cy - pd.y, d: pd.w, drill: pd.drill, net: pd.net }); viaCount++; continue; }
    if (!pads.length && holes.length && !children(child(c, 'Shapes'), 'Shape').some(s => num(s[1]) > 0)) { for (const hh of holes) { items.push({ type: 'hole', x: cx + (bottom ? -hh.x : hh.x), y: cy - hh.y, d: hh.d }); holeCount++; } continue; }
    const xs = pads.map(p => p.x), ys = pads.map(p => p.y);
    const bw = W > 0 ? W : (xs.length ? Math.max(...xs) - Math.min(...xs) + 2 : 2), bh = H > 0 ? H : (ys.length ? Math.max(...ys) - Math.min(...ys) + 2 : 2);
    const [cw, ch] = (orient % 2 === 1) ? [bh, bw] : [bw, bh];
    const fp = { id: 'diptrace:' + (argS(c, 'Pattern') || libname), name: argS(c, 'Pattern') || libname, cat: 'Imported', ref: ref.replace(/\d+$/, '') || 'X', tags: ['diptrace'], desc: `DipTrace pattern ${argS(c, 'Pattern')} (${libname})`, verify: false,
      pads, holes, graphics, courtyard: { w: r3(cw + 0.5), h: r3(ch + 0.5) }, refPos: { x: 0, y: r3(ch / 2 + 1) }, height: 2, body3d: [], meta: { source: 'diptrace-ascii', libname, orientation: orient } };
    parts.push({ ref, value: argS(c, 'Value'), x: cx, y: cy, side: bottom ? 'bottom' : 'top', fp });
  }
  if (unknownShape.size) warn(`pattern silk: unknown shape codes skipped: ${Array.from(unknownShape).map(([k, v]) => `${k}×${v}`).join(', ')}`);
  if (parts.some(p => p.fp.graphics.length && p.fp.meta.orientation % 4 !== 0)) warn('pattern silk of rotated parts: rotation direction (Orientation = 90° steps clockwise) is inferred — check one rotated part; pads are exact');

  // ---------- traces (Nets → Lines) ----------
  let traceCount = 0;
  for (const n of children(netsNode, 'Net')) {
    const name = S(n[1]); const netW = argN(n, 'Width', 0) * K;
    const viaD = argN(n, 'ViaSize', 0) * K, viaRing = argN(n, 'ViaRing', 0) * K;
    const via = viaD > 0 ? { d: viaD, drill: Math.max(0.2, viaD - 2 * viaRing) } : defVia;
    for (const ln of children(child(n, 'Lines'), 'Line')) {
      const pts = children(child(ln, 'Points'), 'pt').map(p => ({ x: num(p[1]) * K, y: num(p[2]) * K, layer: num(p[3]), w: num(p[5]) * K }));
      if (pts.length < 2) continue;
      // split into runs of one layer; a layer change = via at the shared vertex
      let run = [pts[0]], runLayer = pts[1].layer;
      const flush = () => { if (run.length >= 2) { const l = cuLayer(runLayer); if (!l) inner.add(runLayer); else { items.push({ type: 'trace', layer: l, points: run.map(q => [q.x, q.y]), width: r3(Math.max(0.1, (run.find(q => q.w > 0) || {}).w || netW || 0.25)), net: name }); traceCount++; } } };
      for (let i = 1; i < pts.length; i++) {
        const q = pts[i];
        if (q.layer !== runLayer) { flush(); const last = run[run.length - 1]; items.push({ type: 'via', x: last.x, y: last.y, d: r3(via.d), drill: r3(via.drill), net: name }); viaCount++; run = [last]; runLayer = q.layer; }
        run.push(q);
      }
      flush();
    }
  }
  if (inner.size) warn(`traces on inner/unknown layers skipped (layer numbers ${Array.from(inner).join(', ')}) — LAMINA is 2-layer`);

  // ---------- board-level shapes ----------
  const shapeLayer = (s) => { const t = argN(s, 'Type', -1), l = argN(s, 'Layer', 0); if (t === 2) return cuLayer(l); if (t === 4) return 'B.Silk'; if (t === 1 || t === 0) return 'F.Silk'; if (t === 3) return 'B.Silk'; return null; };
  let textCount = 0, shapeCount = 0;
  const unknownBoardShape = new Map();
  for (const s of children(child(boardNode, 'Shapes'), 'Shape')) {
    if (argS(s, 'Enabled', 'Y') !== 'Y') continue;
    const st = argN(s, 'ShapeType', -1); const layer = shapeLayer(s); if (!layer) { unknownBoardShape.set(argN(s, 'Type', -1), 1); continue; }
    const pts = children(child(s, 'Points'), 'pt').map(p => [num(p[1]) * K, num(p[2]) * K]);
    const pw = argN(s, 'PenWidth', 0.6) * K;
    if (st === 6) { // text: 2-point box, Name = the text
      const txt = argS(s, 'Name'); if (!txt || pts.length < 1) continue;
      const box = pts.length >= 2 ? pts : [pts[0], pts[0]];
      const size = Math.max(0.5, argN(s, 'FontSize', 4) * K);
      items.push({ type: 'text', layer, x: (box[0][0] + box[1][0]) / 2, y: (box[0][1] + box[1][1]) / 2, text: txt, size, thickness: Math.max(0.1, pw > 0 ? pw : size * 0.15), rot: 0, align: 'center', vcenter: true }); textCount++;
      continue;
    }
    if (pts.length === 2 && (st === 3 || st === 2)) { // rectangle / ellipse from a 2-point box
      const [a, b] = pts; const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
      if (st === 3) items.push({ type: 'circle', layer, cx, cy, r: Math.max(w, h) / 2, width: pw || 0.15, filled: false });
      else items.push({ type: 'rect', layer, x: cx, y: cy, w, h, rot: 0, rx: 0, width: pw || 0.15, filled: false });
      shapeCount++; continue;
    }
    if (pts.length >= 2) { items.push({ type: 'trace-ish', layer, points: pts, width: pw || 0.15, closed: pts.length > 2 && st !== 1 }); shapeCount++; continue; }
    unknownBoardShape.set(`ShapeType ${st}`, 1);
  }
  if (unknownBoardShape.size) warn(`board shapes not understood: ${Array.from(unknownBoardShape.keys()).join(', ')}`);
  const pours = children(child(boardNode, 'CopperPours'), 'CopperPour').length;
  if (pours) warn(`${pours} copper pour(s) not imported — LAMINA regions have no automatic clearance; redraw as a region if you need the fill`);

  // ---------- assemble: bbox → LAMINA frame (Y up, bbox min at 0,0) ----------
  const allX = [], allY = [];
  const push = (x, y) => { allX.push(x); allY.push(y); };
  for (const p of outlinePts) push(p[0], p[1]);
  if (!outlinePts.length) {
    for (const p of parts) for (const pd of p.fp.pads) push(p.x + (p.side === 'bottom' ? -pd.x : pd.x), p.y - pd.y);
    for (const it of items) { if (it.points) for (const q of it.points) push(q[0], q[1]); else if (it.x != null) push(it.x, it.y); }
  }
  if (!allX.length) throw new Error('DipTrace file has no board outline, parts or traces');
  const minX = Math.min(...allX) - (outlinePts.length ? 0 : 3), maxX = Math.max(...allX) + (outlinePts.length ? 0 : 3);
  const minY = Math.min(...allY) - (outlinePts.length ? 0 : 3), maxY = Math.max(...allY) + (outlinePts.length ? 0 : 3);
  const TX = x => r3(x - minX), TY = y => r3(maxY - y);          // Y flip + translate
  const board = newBoard({ name: (opts.name || 'DIPTRACE').replace(/\.asc$/i, '').toUpperCase().slice(0, 24) || 'DIPTRACE' });
  if (outlinePts.length >= 3) {
    let pts = outlinePts.map(([x, y]) => [TX(x), TY(y)]);
    const W = maxX - minX, H = maxY - minY;
    const axisRect = pts.length === 4 && pts.every((p, i) => { const q = pts[(i + 1) % 4]; return Math.abs(p[0] - q[0]) < 1e-3 || Math.abs(p[1] - q[1]) < 1e-3; });
    if (axisRect) board.outline = { type: 'rect', w: r3(W), h: r3(H), r: 0 };
    else if (Math.abs(polygonArea(pts)) < 1e-6) board.outline = { type: 'rect', w: r3(W), h: r3(H), r: 0 };
    else board.outline = { type: 'polygon', points: ensureCCW(pts) };
  } else board.outline = { type: 'rect', w: r3(maxX - minX), h: r3(maxY - minY), r: 0 };
  for (const p of parts) board.items.push(makeItem('part', { lib: p.fp.id, ref: p.ref, value: p.value, x: TX(p.x), y: TY(p.y), rot: 0, side: p.side, through: false, fp: p.fp }));
  for (const it of items) {
    if (it.type === 'trace') board.items.push(makeItem('trace', { layer: it.layer, points: it.points.map(([x, y]) => [TX(x), TY(y)]), width: it.width, net: it.net }));
    else if (it.type === 'via') board.items.push(makeItem('via', { x: TX(it.x), y: TY(it.y), d: it.d, drill: it.drill, net: it.net }));
    else if (it.type === 'hole') board.items.push(makeItem('hole', { x: TX(it.x), y: TY(it.y), d: it.d }));
    else if (it.type === 'text') board.items.push(makeItem('text', { layer: it.layer, x: TX(it.x), y: r3(TY(it.y) - it.size / 2), text: it.text, size: r3(it.size), thickness: r3(it.thickness), rot: 0, align: 'center' }));
    else if (it.type === 'circle') board.items.push(makeItem('circle', { layer: it.layer, cx: TX(it.cx), cy: TY(it.cy), r: r3(it.r), width: r3(it.width), filled: false }));
    else if (it.type === 'rect') board.items.push(makeItem('rect', { layer: it.layer, x: TX(it.x), y: TY(it.y), w: r3(it.w), h: r3(it.h), rot: 0, rx: 0, width: r3(it.width), filled: false }));
    else if (it.type === 'trace-ish') {
      const pts = it.points.map(([x, y]) => [TX(x), TY(y)]);
      if (it.layer.endsWith('.Cu')) board.items.push(makeItem('trace', { layer: it.layer, points: it.closed ? pts.concat([pts[0]]) : pts, width: r3(it.width) }));
      else if (it.closed) board.items.push(makeItem('polygon', { layer: it.layer, points: pts, width: r3(it.width), filled: false }));
      else for (let i = 1; i < pts.length; i++) board.items.push(makeItem('line', { layer: it.layer, x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], width: r3(it.width) }));
    }
  }
  warnings.unshift(`DipTrace ASCII (${src}${units ? ', ' + units : ''}): ${parts.length} parts / ${padCount} pads, ${traceCount} traces, ${viaCount} vias (incl. Static Via parts), ${holeCount} holes, ${textCount} texts, ${shapeCount} shapes, ${silkShapes} pattern silk elements — coordinates ÷3 → mm, Y flipped`);
  return { board, warnings, nets: Array.from(new Set(Array.from(netName.values()))).sort() };
}
