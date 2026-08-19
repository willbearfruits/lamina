// LAMINA "Design studio": generators that fill the board with art, and effects that transform a selection.
// All geometry comes from js/lib/clip.js (raster-backed booleans/offsets) and the resolver, so everything
// produced is hole-, pad- and part-aware by construction.
import { h, clear, modal, toast, field, numInput, select, checkbox, textInput } from './ui.js';
import { resolveBoard, bboxOfPoints, unionBBox } from './geom.js';
import { makeItem, boardSize, uid } from './model.js';
import { GRAPHIC_LAYERS } from './geom.js';
import * as C from './lib/clip.js';

const LAYERS = GRAPHIC_LAYERS.concat(['Edge.Cuts']);
const num = (v, d) => Number.isFinite(v) ? v : d;

// ---------- parameter specs ----------
// kind: 'gen' fills a region · 'fx' transforms the selection
export const OPS = [
  { id: 'hatch', kind: 'gen', name: 'Hatch lines', desc: 'Parallel (or crossed) lines filling the region — the classic engraved-panel look.',
    params: { spacing: [1.2, 0.2, 20, 0.1, 'Spacing (mm)'], angle: [45, -180, 180, 5, 'Angle (°)'], crosshatch: [false, 'Crosshatch'], width: [0.25, 0.05, 3, 0.05, 'Line width (mm)'] } },
  { id: 'concentric', kind: 'gen', name: 'Concentric rings', desc: 'Contours stepping inward from the region edge (or outward from a point).',
    params: { spacing: [1.5, 0.2, 20, 0.1, 'Spacing (mm)'], from: [['edge', 'from the edge'], ['point', 'from a point']], width: [0.25, 0.05, 3, 0.05, 'Line width (mm)'] } },
  { id: 'spiral', kind: 'gen', name: 'Spiral', desc: 'One continuous spiral clipped to the region.',
    params: { spacing: [1.5, 0.2, 20, 0.1, 'Turn spacing (mm)'], width: [0.25, 0.05, 3, 0.05, 'Line width (mm)'] } },
  { id: 'flow', kind: 'gen', name: 'Flow field', desc: 'Streamlines following smooth noise — organic, plotter-ish.',
    params: { spacing: [1.6, 0.3, 20, 0.1, 'Seed spacing (mm)'], scale: [14, 2, 80, 1, 'Noise scale (mm)'], len: [40, 2, 300, 1, 'Max length (mm)'], seed: [1, 1, 9999, 1, 'Seed'], width: [0.25, 0.05, 3, 0.05, 'Line width (mm)'] } },
  { id: 'contour', kind: 'gen', name: 'Noise contours', desc: 'Topographic isolines of a noise field.',
    params: { levels: [7, 2, 40, 1, 'Levels'], scale: [16, 2, 80, 1, 'Noise scale (mm)'], seed: [1, 1, 9999, 1, 'Seed'], width: [0.25, 0.05, 3, 0.05, 'Line width (mm)'] } },
  { id: 'maze', kind: 'gen', name: 'Maze', desc: 'A perfect maze on a grid, clipped to the region.',
    params: { cell: [3, 0.8, 30, 0.2, 'Cell (mm)'], seed: [1, 1, 9999, 1, 'Seed'], width: [0.3, 0.05, 3, 0.05, 'Line width (mm)'] } },
  { id: 'truchet', kind: 'gen', name: 'Truchet tiles', desc: 'Random quarter-arcs (or diagonals) that knit into a pattern.',
    params: { cell: [4, 1, 30, 0.5, 'Tile (mm)'], style: [['arcs', 'arcs'], ['lines', 'diagonals']], seed: [1, 1, 9999, 1, 'Seed'], width: [0.3, 0.05, 3, 0.05, 'Line width (mm)'] } },
  { id: 'voronoi', kind: 'gen', name: 'Voronoi cells', desc: 'Filled cells with a gap — cracked-earth / stained-glass.',
    params: { count: [60, 3, 800, 1, 'Cells'], gap: [0.5, 0.05, 5, 0.05, 'Gap (mm)'], relax: [1, 0, 6, 1, 'Relax'], seed: [1, 1, 9999, 1, 'Seed'] } },
  { id: 'dots', kind: 'gen', name: 'Dot grid', desc: 'A grid of discs — square or hex packed.',
    params: { spacing: [2.5, 0.4, 30, 0.1, 'Spacing (mm)'], d: [1, 0.1, 20, 0.05, 'Dot Ø (mm)'], grid: [['hex', 'hex'], ['square', 'square']], jitter: [0, 0, 5, 0.05, 'Jitter (mm)'], seed: [1, 1, 9999, 1, 'Seed'] } },
  { id: 'scatter', kind: 'gen', name: 'Scatter', desc: 'Randomly sized shapes with a minimum gap.',
    params: { count: [200, 5, 3000, 5, 'Tries'], minD: [0.6, 0.1, 20, 0.05, 'Min Ø (mm)'], maxD: [2.2, 0.1, 30, 0.05, 'Max Ø (mm)'], minGap: [0.4, 0, 10, 0.05, 'Min gap (mm)'], shape: [['circle', 'circles'], ['square', 'squares'], ['triangle', 'triangles']], seed: [1, 1, 9999, 1, 'Seed'] } },
  { id: 'halftone', kind: 'gen', name: 'Halftone from an image', desc: 'Dot size follows an image — pick the image item first (or it uses the only one on the board).',
    params: { spacing: [1.4, 0.3, 10, 0.1, 'Cell (mm)'], minD: [0.15, 0, 5, 0.05, 'Min dot (mm)'], maxD: [1.3, 0.1, 10, 0.05, 'Max dot (mm)'], angle: [15, -90, 90, 5, 'Screen angle (°)'] } },
  { id: 'scale', kind: 'gen', name: 'Control scale (tick ring)', desc: 'Tick marks around a knob — centred on the selected part (or the board centre). The classic pedal/synth legend.',
    params: { radius: [9, 1, 60, 0.5, 'Radius (mm)'], ticks: [11, 2, 96, 1, 'Ticks'], span: [270, 10, 360, 5, 'Sweep (°)'], start: [225, 0, 360, 5, 'Start angle (° CCW from +X)'], len: [1.6, 0.2, 20, 0.1, 'Tick length (mm)'], major: [5, 0, 24, 1, 'Long tick every (0 = none)'], majorLen: [2.6, 0.2, 20, 0.1, 'Long tick length (mm)'], width: [0.25, 0.05, 3, 0.05, 'Line width (mm)'], labels: [0, 0, 3, 1, 'Labels: 0 none · 1 numbers · 2 MIN/MAX · 3 dots'], labelSize: [1.6, 0.5, 10, 0.1, 'Label size (mm)'], ring: [false, 'Draw the ring line too'] } },
  { id: 'frame', kind: 'gen', name: 'Border frame', desc: 'A frame inset from the board edge — single, double or ticked.',
    params: { inset: [3, 0.2, 40, 0.5, 'Inset from the edge (mm)'], gap: [0, 0, 10, 0.2, 'Second line gap (0 = single)'], radius: [2, 0, 30, 0.5, 'Corner radius (mm)'], width: [0.3, 0.05, 3, 0.05, 'Line width (mm)'] } },
  { id: 'corners', kind: 'gen', name: 'Corner / registration marks', desc: 'Crop-style marks at the board corners (and optional centre cross).',
    params: { inset: [4, 0.5, 40, 0.5, 'Inset (mm)'], len: [5, 0.5, 30, 0.5, 'Arm length (mm)'], width: [0.3, 0.05, 3, 0.05, 'Line width (mm)'], centre: [true, 'Centre cross'] } },
  // ---- effects on the selection ----
  { id: 'offset', kind: 'fx', name: 'Grow / shrink', desc: 'Offset the selected artwork outward (+) or inward (−).',
    params: { delta: [0.3, -20, 20, 0.05, 'Amount (mm)'] } },
  { id: 'round', kind: 'fx', name: 'Round corners', desc: 'Round every corner of the selected artwork.',
    params: { r: [0.6, 0.05, 20, 0.05, 'Radius (mm)'] } },
  { id: 'outline', kind: 'fx', name: 'Silhouette / outline', desc: 'Merge the selection into one silhouette; optionally keep only its outline stroke.',
    params: { grow: [0, -10, 10, 0.05, 'Grow (mm)'], stroke: [0, 0, 5, 0.05, 'Outline stroke (0 = filled)'] } },
  { id: 'echo', kind: 'fx', name: 'Shadow / echo', desc: 'Offset copies of the selection — great as copper under silk.',
    params: { dx: [0.6, -20, 20, 0.1, 'Offset X (mm)'], dy: [-0.6, -20, 20, 0.1, 'Offset Y (mm)'], count: [1, 1, 20, 1, 'Copies'], grow: [0, -5, 5, 0.05, 'Grow each (mm)'] } },
  { id: 'roughen', kind: 'fx', name: 'Roughen / jitter', desc: 'Displace the outline with noise — hand-drawn or corroded.',
    params: { amount: [0.4, 0.02, 10, 0.02, 'Amount (mm)'], detail: [2, 0.3, 30, 0.1, 'Detail (mm)'], seed: [1, 1, 9999, 1, 'Seed'] } },
  { id: 'fxhatch', kind: 'fx', name: 'Hatch the selection', desc: 'Fill the selected shapes with hatch lines.',
    params: { spacing: [1, 0.2, 20, 0.1, 'Spacing (mm)'], angle: [45, -180, 180, 5, 'Angle (°)'], crosshatch: [false, 'Crosshatch'], width: [0.25, 0.05, 3, 0.05, 'Line width (mm)'] } },
  { id: 'outlines', kind: 'fx', name: 'Text / image → outlines', desc: 'Convert the selected text or image into editable polygons.',
    params: { grow: [0, -2, 5, 0.05, 'Grow (mm)'] } },
];

// ---------- computation ----------
export function computeOp(app, op, P, target) {
  const st = app.store, doc = st.doc, board = st.board;
  const res = target.quality === 'fine' ? 0.03 : target.quality === 'fast' ? 0.12 : 0.06;
  const opts = { res };
  const bitmapFor = app.bitmapFor();
  const resolved = resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor });
  const sel = st.selectedItems();
  const outLayer = target.layer;
  const items = [];
  const warn = [];
  const idFn = () => uid('g');

  const selShapes = () => {
    if (!sel.length) return [];
    const tmp = { ...board, items: sel };
    const R = resolveBoard(tmp, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor, includeLinks: false });
    let prims = [];
    for (const l of LAYERS) if (R.layers[l]) prims = prims.concat(R.layers[l].filter(p => !p.isPad || target.includePads));
    return C.shapesFromPrims(prims, opts);
  };
  const regionShapes = () => {
    const keep = { edgeMargin: P.edgeMargin ?? target.edgeMargin, holeMargin: target.holeMargin, padMargin: target.padMargin, partMargin: target.partMargin, ...opts };
    let region;
    if (target.region === 'selection' && sel.length) region = C.intersectShapes(selShapes(), C.boardArea(resolved, { ...opts, edgeMargin: target.edgeMargin }), opts);
    else region = C.usableArea(resolved, keep);
    if (target.region === 'outside' && sel.length) region = C.subtractShapes(region, C.offsetShapes(selShapes(), target.partMargin || 0, opts), opts);
    if (target.avoidArt) {
      const layers = target.avoidArtAll ? LAYERS.filter(l => !l.endsWith('.Fab')) : [target.layer];
      let prims = [];
      for (const l of layers) if (resolved.layers[l]) prims = prims.concat(resolved.layers[l].filter(p => !p.isPad));
      if (prims.length) region = C.subtractShapes(region, C.offsetShapes(C.shapesFromPrims(prims, opts), target.artMargin ?? 0.6, opts), opts);
    }
    if (target.otherBoard && doc.stack && doc.stack.enabled && doc.boards.length > 1) {
      const other = resolveBoard(doc.boards[st.boardIndex ? 0 : 1], doc, { textAsStrokes: false, imagesAsPolys: false });
      const ko = C.keepoutShapes(other, { ...keep, edgeMargin: 0 });
      region = C.subtractShapes(region, ko, opts);
    }
    return region;
  };
  const asLines = (lines, w) => { const r = C.linesToItems(lines, { layer: outLayer, width: w, idFn }); items.push(...r.items); if (r.warnings) warn.push(...r.warnings); };
  const asShapes = (shapes) => { const r = C.shapesToItems(shapes, { layer: outLayer, filled: !target.strokeOnly, width: target.strokeWidth, idFn }); items.push(...r.items); if (r.warnings) warn.push(...r.warnings); };

  // ops that draw straight to geometry (no region maths needed)
  if (op.id === 'scale' || op.id === 'frame' || op.id === 'corners') {
    const [BW, BH] = boardSize(board);
    const lines = [];
    if (op.id === 'scale') {
      const part = sel.find(i => i.type === 'part');
      const cx = part ? part.x : (target.cx ?? BW / 2), cy = part ? part.y : (target.cy ?? BH / 2);
      const n = Math.max(2, Math.round(P.ticks));
      const full = Math.abs(P.span - 360) < 1e-6;
      for (let i = 0; i < n; i++) {
        const t = full ? i / n : i / (n - 1);
        const a = (P.start - P.span * t) * Math.PI / 180;
        const isMajor = P.major > 0 && i % P.major === 0;
        const L = isMajor ? P.majorLen : P.len;
        const r0 = P.radius, r1 = P.radius + L;
        lines.push([[cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)], [cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)]]);
        if (P.labels && (isMajor || P.major === 0)) {
          const rl = r1 + P.labelSize * 0.9;
          const txt = P.labels === 1 ? String(P.major > 0 ? i / P.major : i) : P.labels === 2 ? (i === 0 ? 'MIN' : i === n - 1 ? 'MAX' : '') : '·';
          if (txt) items.push(makeItem('text', { layer: outLayer, x: cx + rl * Math.cos(a), y: cy + rl * Math.sin(a) - P.labelSize / 2, text: txt, size: P.labelSize, thickness: Math.max(0.15, P.width), align: 'center', font: target.font || 'sans' }));
        }
      }
      if (P.ring) { const pts = []; const steps = 96; const full2 = Math.abs(P.span - 360) < 1e-6; for (let i = 0; i <= steps; i++) { const a = (P.start - P.span * i / steps) * Math.PI / 180; pts.push([cx + P.radius * Math.cos(a), cy + P.radius * Math.sin(a)]); } lines.push(pts); }
    } else if (op.id === 'frame') {
      const mk = (ins) => { const x0 = ins, y0 = ins, x1 = BW - ins, y1 = BH - ins, r = Math.min(P.radius, (x1 - x0) / 2, (y1 - y0) / 2); const pts = []; const arc = (ax, ay, a0, a1) => { for (let i = 0; i <= 8; i++) { const a = (a0 + (a1 - a0) * i / 8) * Math.PI / 180; pts.push([ax + r * Math.cos(a), ay + r * Math.sin(a)]); } };
        if (r > 0.01) { arc(x1 - r, y0 + r, -90, 0); arc(x1 - r, y1 - r, 0, 90); arc(x0 + r, y1 - r, 90, 180); arc(x0 + r, y0 + r, 180, 270); } else { pts.push([x0, y0], [x1, y0], [x1, y1], [x0, y1]); }
        pts.push(pts[0]); return pts; };
      lines.push(mk(P.inset));
      if (P.gap > 0) lines.push(mk(P.inset + P.gap));
    } else {
      const i = P.inset, L = P.len;
      for (const [x, y, sx, sy] of [[i, i, 1, 1], [BW - i, i, -1, 1], [BW - i, BH - i, -1, -1], [i, BH - i, 1, -1]]) { lines.push([[x, y], [x + sx * L, y]]); lines.push([[x, y], [x, y + sy * L]]); }
      if (P.centre) { lines.push([[BW / 2 - L / 2, BH / 2], [BW / 2 + L / 2, BH / 2]]); lines.push([[BW / 2, BH / 2 - L / 2], [BW / 2, BH / 2 + L / 2]]); }
    }
    for (const pts of lines) items.push(makeItem('path', { layer: outLayer, points: pts, width: P.width }));
    return { items, warn };
  }
  if (op.kind === 'gen') {
    const region = regionShapes();
    if (!region.length) { warn.push('The region came out empty — reduce the margins or pick a different region.'); return { items, warn }; }
    switch (op.id) {
      case 'hatch': asLines(C.hatchFill(region, { ...P, ...opts }), P.width); break;
      case 'concentric': asLines(C.concentric(region, { ...P, ...opts, x: target.cx, y: target.cy }), P.width); break;
      case 'spiral': asLines(C.spiral(region, { ...P, ...opts, cx: target.cx, cy: target.cy }), P.width); break;
      case 'flow': asLines(C.flowLines(region, { ...P, ...opts }), P.width); break;
      case 'contour': asLines(C.contourNoise(region, { ...P, ...opts }), P.width); break;
      case 'maze': asLines(C.mazeFill(region, { ...P, ...opts }), P.width); break;
      case 'truchet': asLines(C.truchet(region, { ...P, ...opts }), P.width); break;
      case 'voronoi': asShapes(C.voronoi(region, { ...P, ...opts })); break;
      case 'dots': asShapes(C.dotFill(region, { ...P, ...opts })); break;
      case 'scatter': asShapes(C.scatter(region, { ...P, ...opts })); break;
      case 'halftone': {
        const imgItem = sel.find(i => i.type === 'image') || board.items.find(i => i.type === 'image');
        if (!imgItem) { warn.push('No image on the board — place one first (Image tool), then run the halftone on it.'); break; }
        const bm = bitmapFor(imgItem);
        if (!bm) { warn.push('The image is still loading — try again in a moment.'); break; }
        const gray = { w: bm.w, h: bm.h, data: bm.data, x: imgItem.x, y: imgItem.y, wmm: imgItem.w, hmm: imgItem.h };
        asShapes(C.halftone(region, gray, { ...P, ...opts }));
        break;
      }
    }
  } else {
    const shapes = selShapes();
    if (!shapes.length) { warn.push('Select some artwork first (shapes, text or an image).'); return { items, warn }; }
    switch (op.id) {
      case 'offset': asShapes(C.offsetShapes(shapes, P.delta, opts)); break;
      case 'round': asShapes(C.roundCorners(shapes, P.r, opts)); break;
      case 'outline': { const u = C.offsetShapes(C.unionShapes(shapes, opts), P.grow, opts); if (P.stroke > 0) { const r = C.shapesToItems(u, { layer: outLayer, filled: false, width: P.stroke, idFn }); items.push(...r.items); } else asShapes(u); break; }
      case 'echo': { for (let i = 1; i <= P.count; i++) { let s = C.offsetShapes(shapes, P.grow * i, opts); s = s.map(sh => ({ outer: sh.outer.map(([x, y]) => [x + P.dx * i, y + P.dy * i]), holes: (sh.holes || []).map(hh => hh.map(([x, y]) => [x + P.dx * i, y + P.dy * i])) })); asShapes(s); } break; }
      case 'roughen': { const rnd = C.rng(P.seed); const jitter = (sh) => ({ outer: rough(sh.outer, P, rnd), holes: (sh.holes || []).map(hh => rough(hh, P, rnd)) }); asShapes(C.unionShapes(shapes, opts).map(jitter)); break; }
      case 'fxhatch': asLines(C.hatchFill(shapes, { ...P, ...opts }), P.width); break;
      case 'outlines': asShapes(P.grow ? C.offsetShapes(shapes, P.grow, opts) : shapes); break;
    }
  }
  return { items, warn };
}
function rough(ring, P, rnd) {
  if (!ring || ring.length < 3) return ring;
  const out = []; const step = Math.max(0.05, P.detail);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n; const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      out.push([x + (rnd() - 0.5) * 2 * P.amount, y + (rnd() - 0.5) * 2 * P.amount]);
    }
  }
  return out;
}

export const PRESETS = [
  { name: 'Engraved panel', op: 'hatch', P: { spacing: 0.8, angle: 45, crosshatch: false, width: 0.2 }, T: { layer: 'F.Silk', artMargin: 1.2 } },
  { name: 'Topographic', op: 'contour', P: { levels: 9, scale: 22, seed: 4, width: 0.25 }, T: { layer: 'F.Silk' } },
  { name: 'Ferrofluid', op: 'flow', P: { spacing: 1.6, scale: 12, len: 70, seed: 3, width: 0.22 }, T: { layer: 'F.Silk' } },
  { name: 'Circuit maze', op: 'maze', P: { cell: 2.6, seed: 5, width: 0.35 }, T: { layer: 'F.Cu' } },
  { name: 'Cracked earth', op: 'voronoi', P: { count: 90, gap: 0.6, relax: 2, seed: 6 }, T: { layer: 'F.Silk' } },
  { name: 'Dot matrix', op: 'dots', P: { spacing: 2.2, d: 1.1, grid: 'hex', jitter: 0, seed: 1 }, T: { layer: 'F.Silk' } },
  { name: 'Static / noise', op: 'scatter', P: { count: 900, minD: 0.3, maxD: 1.4, minGap: 0.25, shape: 'square', seed: 9 }, T: { layer: 'F.Silk' } },
  { name: 'Exposed copper hatch', op: 'hatch', P: { spacing: 1.6, angle: -45, crosshatch: true, width: 0.6 }, T: { layer: 'F.Mask' } },
  { name: 'Rings from the centre', op: 'concentric', P: { spacing: 1.4, from: 'point', width: 0.25 }, T: { layer: 'F.Silk' } },
  { name: 'Truchet weave', op: 'truchet', P: { cell: 3.5, style: 'arcs', seed: 2, width: 0.3 }, T: { layer: 'F.Silk' } },
];

// ---------- UI ----------
export function openDesignStudio(app, startId) {
  const st = app.store, ed = app.editor;
  const [W, H] = boardSize(st.board);
  let op = OPS.find(o => o.id === startId) || OPS[0];
  const P = {};
  const target = { region: 'board', layer: ed.activeLayer && ed.activeLayer !== 'Edge.Cuts' ? ed.activeLayer : 'F.Silk', edgeMargin: 1, holeMargin: 0.6, padMargin: 0.5, partMargin: 0.5, otherBoard: false, avoidArt: true, avoidArtAll: false, artMargin: 0.8, quality: 'normal', strokeOnly: false, strokeWidth: 0.25, includePads: false, cx: W / 2, cy: H / 2, keepOriginal: true };
  const defaults = (o) => { const p = {}; for (const [k, spec] of Object.entries(o.params)) p[k] = Array.isArray(spec[0]) ? spec[0][0] : spec[0]; return p; };
  Object.assign(P, defaults(op));
  let lastItems = [], busy = false, dirty = true;

  const opList = h('div', { class: 'oplist' });
  const applyPreset = (pr) => { op = OPS.find(o => o.id === pr.op) || op; Object.assign(P, defaults(op), pr.P); Object.assign(target, pr.T || {}); renderOps(); renderParams(); schedule(); };
  const paramBox = h('div', { class: 'props' });
  const info = h('div', { class: 'hint' });
  const count = h('div', { class: 'hint' });

  const renderOps = () => {
    clear(opList);
    opList.append(h('div', { class: 'ophdr' }, 'Presets'));
    for (const pr of PRESETS) opList.append(h('div', { class: 'opitem preset', onclick: () => applyPreset(pr) }, pr.name));
    for (const kind of ['gen', 'fx']) {
      opList.append(h('div', { class: 'ophdr' }, kind === 'gen' ? 'Generate (fills the board)' : 'Effects (on the selection)'));
      for (const o of OPS.filter(x => x.kind === kind)) opList.append(h('div', { class: 'opitem' + (o.id === op.id ? ' on' : ''), onclick: () => { op = o; Object.assign(P, defaults(o)); renderOps(); renderParams(); schedule(); } }, o.name));
    }
  };
  const renderParams = () => {
    clear(paramBox);
    info.textContent = op.desc;
    for (const [k, spec] of Object.entries(op.params)) {
      if (Array.isArray(spec[0])) { paramBox.append(field(k, select(spec, P[k], v => { P[k] = v; schedule(); }))); continue; }
      if (typeof spec[0] === 'boolean') { paramBox.append(field(spec[1] || k, checkbox(P[k], v => { P[k] = v; schedule(); }))); continue; }
      const [def, min, max, step, label] = spec;
      paramBox.append(field(label || k, numInput(P[k], v => { P[k] = v; schedule(); }, { min, max, step })));
    }
    paramBox.append(h('h4', {}, 'Where'));
    if (op.kind === 'gen') {
      paramBox.append(field('Region', select([['board', 'whole board, minus keepouts'], ['selection', 'inside the selection'], ['outside', 'board, avoiding the selection']], target.region, v => { target.region = v; schedule(); })),
        field('Keep clear of', h('div', { class: 'pair' }, numInput(target.holeMargin, v => { target.holeMargin = v; schedule(); }, { step: 0.1, title: 'holes (mm)' }), numInput(target.padMargin, v => { target.padMargin = v; schedule(); }, { step: 0.1, title: 'pads (mm)' }), numInput(target.partMargin, v => { target.partMargin = v; schedule(); }, { step: 0.1, title: 'parts (mm)' }))),
        h('div', { class: 'hint' }, 'holes · pads · parts (mm)'),
        field('Board edge inset', numInput(target.edgeMargin, v => { target.edgeMargin = v; schedule(); }, { step: 0.1 })));
      paramBox.append(field('Existing artwork', h('div', { class: 'pair' }, checkbox(target.avoidArt, v => { target.avoidArt = v; schedule(); }, 'keep clear of it'), numInput(target.artMargin, v => { target.artMargin = v; schedule(); }, { step: 0.1, min: 0, title: 'gap around existing artwork (mm)' }))),
        field('', checkbox(target.avoidArtAll, v => { target.avoidArtAll = v; schedule(); }, 'every layer, not just this one')));
      if (st.doc.stack && st.doc.stack.enabled && st.doc.boards.length > 1) paramBox.append(field('Other board', checkbox(target.otherBoard, v => { target.otherBoard = v; schedule(); }, 'also avoid the other board’s parts')));
    }
    paramBox.append(field('Layer', select(LAYERS.map(l => [l, l]), target.layer, v => { target.layer = v; schedule(); })));
    if (['voronoi', 'dots', 'scatter', 'halftone', 'offset', 'round', 'outline', 'echo', 'roughen', 'outlines'].includes(op.id))
      paramBox.append(field('Draw as', h('div', { class: 'pair' }, select([[false, 'filled'], [true, 'outline']], target.strokeOnly, v => { target.strokeOnly = v === 'true'; schedule(); }), numInput(target.strokeWidth, v => { target.strokeWidth = v; schedule(); }, { step: 0.05, min: 0.05, title: 'outline width (mm)' }))));
    if (op.kind === 'fx') paramBox.append(field('Originals', checkbox(target.keepOriginal, v => { target.keepOriginal = v; }, 'keep the original items')));
    paramBox.append(field('Quality', select([['fast', 'fast (0.12 mm)'], ['normal', 'normal (0.06 mm)'], ['fine', 'fine (0.03 mm, slow)']], target.quality, v => { target.quality = v; schedule(); })));
  };
  let timer = null;
  const schedule = () => { dirty = true; clearTimeout(timer); timer = setTimeout(run, 250); };
  const run = () => {
    if (busy) { schedule(); return; }
    busy = true; count.textContent = 'computing…';
    setTimeout(() => {
      const t0 = performance.now();
      let r;
      try { r = computeOp(app, op, P, target); } catch (e) { console.error(e); r = { items: [], warn: ['failed: ' + e.message] }; }
      lastItems = r.items;
      ed.previewItems = lastItems; ed.requestRender();
      count.textContent = `${lastItems.length} items · ${(performance.now() - t0).toFixed(0)} ms${r.warn.length ? ' · ' + r.warn.join(' · ') : ''}`;
      busy = false; dirty = false;
    }, 10);
  };
  renderOps(); renderParams(); schedule();
  const body = h('div', { class: 'studio' }, h('details', { class: 'opsdrawer', open: true }, h('summary', {}, 'Effect / generator'), opList), h('div', { class: 'studiomain' }, info, paramBox, count));
  const m = modal({
    title: 'Design studio', width: 'min(430px, 92vw)', body, dock: 'left', cls: 'studiodlg',
    onClose: () => { ed.previewItems = null; ed.requestRender(); },
    buttons: [
      { label: 'Close' },
      { label: 'Re-roll seed', left: true, onClick: () => { if ('seed' in P) { P[('seed')] = Math.floor(Math.random() * 9999) + 1; renderParams(); schedule(); } else toast('This one has no random seed'); return false; } },
      { label: 'Apply', primary: true, onClick: () => {
        if (!lastItems.length) { toast('Nothing to apply yet', 'err'); return false; }
        const copy = JSON.parse(JSON.stringify(lastItems));
        const remove = op.kind === 'fx' && !target.keepOriginal ? new Set(st.selection) : null;
        st.mutate(d => { const b = d.boards[st.boardIndex]; if (remove) b.items = b.items.filter(i => !remove.has(i.id)); b.items.push(...copy); }, op.name);
        st.select(copy.map(i => i.id));
        toast(`${copy.length} items added on ${target.layer}`);
        ed.previewItems = null; ed.requestRender();
        return false; // keep the studio open for another pass
      } },
    ],
  });
  return m;
}
