// LAMINA design rule checks — manufacturer presets + stack sanity. Returns a list of findings.
import { resolveBoard, pointInPolygon, distPointSeg, bboxOfPoints, primBBox, resolvePart, partTransform, outlineSize, textBBox } from './geom.js';
import { getFootprint } from './library.js';

// Values from JLCPCB's 2-layer capabilities page (mm). Conservative where JLC quotes ranges.
export const DRC_PRESETS = {
  'jlcpcb-2layer': {
    name: 'JLCPCB 2-layer (1 oz)', maxW: 600, maxH: 670, minTrace: 0.127, minSpace: 0.127, minDrill: 0.3, maxDrill: 6.3, minViaDrill: 0.3, minViaDia: 0.5,
    minAnnular: 0.2, minHoleToEdge: 1.0, minCopperToEdge: 0.3, minHoleToHole: 0.5, minNpthSlot: 1.0, minPthSlot: 0.5, minNpth: 0.5,
    minSilkWidth: 0.15, minSilkText: 1.0, minSilkTextWidth: 0.15, minMaskWeb: 0.1, minBoardDim: 5, cheapTier: [100, 100],
    note: 'JLC 2-layer: trace/space 0.10 (we use 0.127), via 0.3/0.5, PTH ring ≥0.2 (0.25 rec.), NPTH ≥0.5, plated slot ≥0.5, NPTH slot ≥1.0, copper→routed edge ≥0.2 (0.3 used), silk 0.15 line / 1.0 text; boards ≤100×100 are the cheap tier.',
  },
  'generic-hobby': { name: 'Generic (relaxed)', maxW: 500, maxH: 500, minTrace: 0.2, minSpace: 0.2, minDrill: 0.4, maxDrill: 6.5, minViaDrill: 0.4, minViaDia: 0.8, minAnnular: 0.2, minHoleToEdge: 1.0, minCopperToEdge: 0.5, minHoleToHole: 0.5, minNpthSlot: 1.0, minPthSlot: 1.0, minSilkWidth: 0.15, minSilkText: 1.0, minSilkTextWidth: 0.15, minMaskWeb: 0.1, minBoardDim: 5 },
  'cnc-isolation': { name: 'CNC isolation routing (V-bit)', maxW: 300, maxH: 300, minTrace: 0.4, minSpace: 0.4, minDrill: 0.6, maxDrill: 6.5, minViaDrill: 0.6, minViaDia: 1.6, minAnnular: 0.5, minHoleToEdge: 1.5, minCopperToEdge: 1.0, minHoleToHole: 1.0, minNpthSlot: 1.5, minPthSlot: 1.5, minSilkWidth: 0.3, minSilkText: 2, minSilkTextWidth: 0.3, minMaskWeb: 0, minBoardDim: 5 },
};

// polygon/polygon minimum distance (0 if overlapping)
export function polyDistance(a, b) {
  const ba = bboxOfPoints(a), bb = bboxOfPoints(b);
  const bd = Math.max(0, Math.max(bb[0] - ba[2], ba[0] - bb[2])) ; const bd2 = Math.max(0, Math.max(bb[1] - ba[3], ba[1] - bb[3]));
  const lower = Math.hypot(bd, bd2);
  if (pointInPolygon(a[0][0], a[0][1], b) || pointInPolygon(b[0][0], b[0][1], a)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) { const p = a[i]; for (let j = 0; j < b.length; j++) { const q = b[j], r = b[(j + 1) % b.length]; const d = distPointSeg(p[0], p[1], q[0], q[1], r[0], r[1]); if (d < best) best = d; } }
  for (let i = 0; i < b.length; i++) { const p = b[i]; for (let j = 0; j < a.length; j++) { const q = a[j], r = a[(j + 1) % a.length]; const d = distPointSeg(p[0], p[1], q[0], q[1], r[0], r[1]); if (d < best) best = d; } }
  // segment intersection check (touching without vertex containment)
  if (best > 0 && segsIntersect(a, b)) return 0;
  return Math.max(best, lower);
}
function segsIntersect(a, b) {
  for (let i = 0; i < a.length; i++) { const p1 = a[i], p2 = a[(i + 1) % a.length]; for (let j = 0; j < b.length; j++) { const q1 = b[j], q2 = b[(j + 1) % b.length]; if (segInt(p1, p2, q1, q2)) return true; } }
  return false;
}
function segInt(p1, p2, q1, q2) { const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); return o(p1, p2, q1) !== o(p1, p2, q2) && o(q1, q2, p1) !== o(q1, q2, p2); }
function polyToOutlineDist(poly, outline) { let best = Infinity; for (const p of poly) for (let j = 0; j < outline.length; j++) { const q = outline[j], r = outline[(j + 1) % outline.length]; best = Math.min(best, distPointSeg(p[0], p[1], q[0], q[1], r[0], r[1])); } return best; }
function polyInside(poly, outline) { return poly.every(p => pointInPolygon(p[0], p[1], outline)); }
// stroke → polygon approximation (rect around each segment)
function strokePolys(pts, w, closed) { const out = []; const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9; const nx = -dy / L * w / 2, ny = dx / L * w / 2; out.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]); } return out; }
function primPolys(p) {
  switch (p.t) {
    case 'poly': return [p.pts];
    case 'circle': { const n = 24, r = p.r + (p.w || 0) / 2; const pts = []; for (let i = 0; i < n; i++) pts.push([p.cx + r * Math.cos(i / n * 2 * Math.PI), p.cy + r * Math.sin(i / n * 2 * Math.PI)]); return [pts]; }
    case 'line': return strokePolys([[p.x1, p.y1], [p.x2, p.y2]], p.w, false);
    case 'polyline': return strokePolys(p.pts, p.w, p.closed);
    case 'arc': { const b = primBBox(p); return [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]]; }
    case 'text': { const b = textBBox(p); return [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]]; }
    case 'image': { const b = primBBox(p); return [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]]; }
  }
  return [];
}

export function runDRC(doc, opts = {}) {
  const rules = DRC_PRESETS[doc.drcPreset] || DRC_PRESETS['jlcpcb-2layer'];
  const findings = [];
  const add = (level, code, msg, bi, x, y, ids = []) => findings.push({ level, code, msg, board: bi, x, y, ids });
  doc.boards.forEach((board, bi) => {
    const R = resolveBoard(board, doc, { textAsStrokes: false, imagesAsPolys: false });
    const [W, H] = R.size;
    if (W > rules.maxW || H > rules.maxH) add('error', 'size', `Board ${board.name} is ${W}×${H} mm — exceeds ${rules.maxW}×${rules.maxH}`, bi, W / 2, H / 2);
    else if (rules.cheapTier && (W > rules.cheapTier[0] || H > rules.cheapTier[1])) add('info', 'size', `Board ${board.name} (${W}×${H}) is larger than the ${rules.cheapTier[0]}×${rules.cheapTier[1]} cheap tier`, bi, W / 2, H / 2);
    if (W < rules.minBoardDim || H < rules.minBoardDim) add('warn', 'size', `Board ${board.name} is very small (${W}×${H})`, bi, W / 2, H / 2);
    // drills
    for (const d of R.drills) {
      const isSlot = d.slotLen > 0;
      if (d.d < rules.minDrill && !isSlot) add('error', 'drill', `Drill Ø${d.d} < min ${rules.minDrill}`, bi, d.x, d.y, [d.src]);
      else if (!d.plated && !isSlot && rules.minNpth && d.d < rules.minNpth) add('warn', 'drill', `Non-plated hole Ø${d.d} < ${rules.minNpth} (fab minimum for NPTH)`, bi, d.x, d.y, [d.src]);
      if (isSlot && d.d < (d.plated ? rules.minPthSlot : rules.minNpthSlot)) add('error', 'slot', `Slot width ${d.d} < min ${d.plated ? rules.minPthSlot : rules.minNpthSlot}`, bi, d.x, d.y, [d.src]);
      if (d.d > rules.maxDrill) add('info', 'drill', `Drill Ø${d.d} > ${rules.maxDrill} — the fab routes it (fine at JLC; check the min slot/route width)`, bi, d.x, d.y, [d.src]);
      const edge = polyToOutlineDist([[d.x, d.y]], R.outline) - d.d / 2;
      if (!pointInPolygon(d.x, d.y, R.outline)) add('error', 'edge', `Hole outside board outline`, bi, d.x, d.y, [d.src]);
      else if (edge < rules.minHoleToEdge) add(edge < 0.3 ? 'error' : 'warn', 'edge', `Hole ${edge.toFixed(2)} mm from board edge (< ${rules.minHoleToEdge})`, bi, d.x, d.y, [d.src]);
      for (const c of R.cutouts) { const e2 = polyToOutlineDist([[d.x, d.y]], c) - d.d / 2; if (pointInPolygon(d.x, d.y, c)) add('error', 'edge', 'Hole inside a cutout', bi, d.x, d.y, [d.src]); else if (e2 < rules.minHoleToEdge) add('warn', 'edge', `Hole ${e2.toFixed(2)} mm from cutout edge`, bi, d.x, d.y, [d.src]); }
    }
    for (let i = 0; i < R.drills.length; i++) for (let j = i + 1; j < R.drills.length; j++) {
      const a = R.drills[i], b = R.drills[j]; const dd = Math.hypot(a.x - b.x, a.y - b.y) - (a.d + b.d) / 2 - (a.slotLen + b.slotLen) / 2;
      if (dd < 0) add('error', 'hole', `Holes overlap`, bi, (a.x + b.x) / 2, (a.y + b.y) / 2, [a.src, b.src]);
      else if (dd < rules.minHoleToHole && a.src !== b.src) add('warn', 'hole', `Holes ${dd.toFixed(2)} mm apart (< ${rules.minHoleToHole})`, bi, (a.x + b.x) / 2, (a.y + b.y) / 2, [a.src, b.src]);
    }
    // pads: annular ring
    for (const p of R.pads) {
      if (p.drill > 0) { const ring = (Math.min(p.w, p.h) - Math.max(p.drill, p.slotLen ? p.drill : 0)) / 2; if (ring < rules.minAnnular) add(ring < 0.05 ? 'error' : 'warn', 'annular', `Annular ring ${ring.toFixed(2)} mm < ${rules.minAnnular} (pad ${p.partRef || ''}${p.name ? ' ' + p.name : ''})`, bi, p.x, p.y, [p.src || p.partRef]); }
    }
    // copper: width, edge, clearance
    for (const layer of ['F.Cu', 'B.Cu']) {
      const prims = R.layers[layer] || [];
      for (const p of prims) {
        if ((p.t === 'polyline' || p.t === 'line') && p.w < rules.minTrace) add('error', 'trace', `Trace width ${p.w} < ${rules.minTrace}`, bi, p.t === 'line' ? p.x1 : p.pts[0][0], p.t === 'line' ? p.y1 : p.pts[0][1], [p.src]);
        if (p.isVia && p.r * 2 < rules.minViaDia) add('error', 'via', `Via Ø${(p.r * 2).toFixed(2)} < ${rules.minViaDia}`, bi, p.cx, p.cy, [p.src]);
        for (const poly of primPolys(p)) {
          if (!polyInside(poly, R.outline)) { add('error', 'edge', `Copper outside board outline (${layer})`, bi, poly[0][0], poly[0][1], [p.src]); break; }
          const e = polyToOutlineDist(poly, R.outline); if (e < rules.minCopperToEdge) { add('warn', 'edge', `Copper ${e.toFixed(2)} mm from board edge (< ${rules.minCopperToEdge}, ${layer})`, bi, poly[0][0], poly[0][1], [p.src]); break; }
        }
      }
      // clearance between different-net (or different-source unnamed) copper features
      const feats = [];
      for (const p of prims) for (const poly of primPolys(p)) feats.push({ poly, net: p.net || '', src: p.src, bb: bboxOfPoints(poly), padName: p.padName });
      const cl = rules.minSpace;
      for (let i = 0; i < feats.length; i++) for (let j = i + 1; j < feats.length; j++) {
        const a = feats[i], b = feats[j];
        if (a.bb[0] > b.bb[2] + cl || b.bb[0] > a.bb[2] + cl || a.bb[1] > b.bb[3] + cl || b.bb[1] > a.bb[3] + cl) continue;
        const sameNet = a.net && b.net && a.net === b.net;
        if (sameNet) continue;
        const bothNamed = a.net && b.net;
        const sameSrc = a.src === b.src;
        if (!bothNamed && sameSrc) continue; // same part / same trace: pads of one footprint are allowed to be close
        const d = polyDistance(a.poly, b.poly);
        if (bothNamed && d < cl) add(d <= 0 ? 'error' : 'warn', 'clearance', `Copper clearance ${d.toFixed(3)} mm between nets "${a.net}" and "${b.net}" (${layer})`, bi, a.poly[0][0], a.poly[0][1], [a.src, b.src]);
        else if (!bothNamed && d <= 0) add('warn', 'clearance', `Copper features overlap (${layer}) — intended? (unnamed nets)`, bi, a.poly[0][0], a.poly[0][1], [a.src, b.src]);
      }
    }
    // silk
    for (const layer of ['F.Silk', 'B.Silk']) {
      const prims = R.layers[layer] || [];
      const maskLayer = layer.replace('Silk', 'Mask');
      const maskFeats = (R.layers[maskLayer] || []).filter(p => p.isPad && p.t === 'poly').map(p => ({ poly: p.pts, bb: bboxOfPoints(p.pts), src: p.src }));
      for (const p of prims) {
        if ((p.t === 'line' || p.t === 'polyline' || p.t === 'arc' || (p.t === 'circle' && p.w > 0)) && p.w < rules.minSilkWidth) add(p.w >= 0.12 ? 'info' : 'warn', 'silk', `Silk line ${p.w} mm < ${rules.minSilkWidth} may not print`, bi, p.t === 'line' ? p.x1 : p.t === 'circle' || p.t === 'arc' ? p.cx : p.pts[0][0], p.t === 'line' ? p.y1 : p.t === 'circle' || p.t === 'arc' ? p.cy : p.pts[0][1], [p.src]);
        if (p.t === 'text' && /triplex|gothic|duplex|bold/.test(p.font || '') && p.size < 2) add('info', 'silk', `Silk text "${String(p.text).slice(0, 12)}" uses a heavy font at ${p.size} mm — its strokes merge below ~2 mm`, bi, p.x, p.y, [p.src]);
        if (p.t === 'text' && (p.size < rules.minSilkText || p.thickness < rules.minSilkTextWidth)) add('warn', 'silk', `Silk text "${String(p.text).slice(0, 12)}" ${p.size} mm / ${p.thickness} mm stroke is below ${rules.minSilkText}/${rules.minSilkTextWidth}`, bi, p.x, p.y, [p.src]);
        if (p.t === 'image' && Math.min(p.w, p.h) < 2) add('warn', 'silk', 'Image is very small; fine detail will not print', bi, p.x, p.y, [p.src]);
        if (p.isRef) continue;
        for (const poly of primPolys(p)) {
          const bb = bboxOfPoints(poly);
          if (!polyInside(poly, R.outline)) { const isPart = R.parts.some(pp => pp.id === p.src); add(isPart ? 'info' : 'warn', 'edge', `Silk${isPart ? ' of ' + R.parts.find(pp => pp.id === p.src).ref : ''} outside the board outline (${layer})${isPart ? ' — fine for edge connectors/jacks' : ''}`, bi, poly[0][0], poly[0][1], [p.src]); break; }
          let hit = null;
          for (const m of maskFeats) { if (m.src && m.src === p.src) continue; if (bb[0] > m.bb[2] || m.bb[0] > bb[2] || bb[1] > m.bb[3] || m.bb[1] > bb[3]) continue; if (polyDistance(poly, m.poly) <= 0) { hit = m; break; } }
          if (hit) { const other = R.parts.find(pp => pp.id === hit.src); add('warn', 'silk', `Silk${p.src && R.parts.find(pp => pp.id === p.src) ? ' of ' + R.parts.find(pp => pp.id === p.src).ref : ''} overlaps a pad${other ? ' of ' + other.ref : ''} (${layer}) — the fab clips silk on pads`, bi, poly[0][0], poly[0][1], [p.src, hit.src]); break; }
        }
      }
    }
    // parts outside board
    for (const part of R.parts) {
      if (!part.bbox) continue;
      const [x0, y0, x1, y1] = part.bbox;
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const outBy = Math.max(...corners.map(c => pointInPolygon(c[0], c[1], R.outline) ? 0 : polyToOutlineDist([c], R.outline)));
      if (outBy > 1.0) add('warn', 'edge', `${part.ref} (${part.name}) extends ${outBy.toFixed(1)} mm past the board edge`, bi, part.x, part.y, [part.id]);
    }
    // parts overlapping (courtyards, same side)
    for (let i = 0; i < R.parts.length; i++) for (let j = i + 1; j < R.parts.length; j++) {
      const a = R.parts[i], b = R.parts[j]; if (!a.bbox || !b.bbox || a.side !== b.side) continue;
      if (a.bbox[0] < b.bbox[2] && b.bbox[0] < a.bbox[2] && a.bbox[1] < b.bbox[3] && b.bbox[1] < a.bbox[3]) add('warn', 'overlap', `${a.ref} and ${b.ref} overlap (${a.side} side)`, bi, (a.x + b.x) / 2, (a.y + b.y) / 2, [a.id, b.id]);
    }
    if (part_verify(R)) for (const p of R.parts) if (p.fp?.verify) add('info', 'verify', `${p.ref}: footprint "${p.name}" is marked verify — check pads vs datasheet before ordering`, bi, p.x, p.y, [p.id]);
  });
  // stack checks
  const st = doc.stack;
  if (st?.enabled && doc.boards.length > 1) {
    const lower = resolveBoard(doc.boards[0], doc), upper = resolveBoard(doc.boards[1], doc);
    const gap = st.gap;
    for (const link of st.links || []) {
      const fp = getFootprint(link.lib, link);
      if (link.kind === 'connector' && fp?.pair) {
        if (gap < fp.pair.minGap - 1e-6) add('error', 'stack', `Gap ${gap} mm is below the connector's minimum ${fp.pair.minGap} mm (${fp.name}) — boards would collide/pins bottom out`, 0, link.x, link.y, [link.id]);
        else if (gap > fp.pair.maxGap + 1e-6) add('error', 'stack', `Gap ${gap} mm exceeds the connector's maximum ${fp.pair.maxGap} mm (${fp.name}) — pins won't engage`, 0, link.x, link.y, [link.id]);
      }
      if (link.kind === 'standoff') {
        const L = link.opts?.length ?? gap;
        if (Math.abs(L - gap) > 0.05) add('error', 'stack', `Standoff length ${L} ≠ gap ${gap}`, 0, link.x, link.y, [link.id]);
        const std = fp?.meta?.lengths || [];
        if (std.length && !std.includes(Math.round(gap * 100) / 100)) add('info', 'stack', `Standoff ${gap} mm is not a stock length (${std.join('/')}) — nearest ${nearest(std, gap)} mm; adjust the gap or shim with washers`, 0, link.x, link.y, [link.id]);
      }
    }
    // clearance between facing components
    const lowTop = lower.parts.filter(p => p.side === 'top' && !p.fromLink);
    const upBot = upper.parts.filter(p => p.side === 'bottom' && !p.fromLink);
    for (const a of lowTop) {
      if (a.height > gap && !a.through) add('warn', 'stack', `${a.ref} (${a.name}) is ${a.height} mm tall but the gap is ${gap} mm — mark it "through" (needs a hole in the upper board) or raise the gap`, 0, a.x, a.y, [a.id]);
      for (const b of upBot) {
        if (!a.bbox || !b.bbox) continue;
        if (a.bbox[0] < b.bbox[2] && b.bbox[0] < a.bbox[2] && a.bbox[1] < b.bbox[3] && b.bbox[1] < a.bbox[3]) {
          const need = a.height + b.height;
          if (need > gap) add('error', 'stack', `${a.ref} (lower, ${a.height} mm) and ${b.ref} (upper bottom side, ${b.height} mm) collide: need ${need.toFixed(1)} mm, gap is ${gap} mm`, 0, a.x, a.y, [a.id, b.id]);
        }
      }
    }
    for (const b of upBot) if (b.height > gap) add('error', 'stack', `${b.ref} on the upper board's bottom side is ${b.height} mm tall > gap ${gap}`, 1, b.x, b.y, [b.id]);
    // through parts: bushing reach
    for (const a of lowTop) {
      if (!a.through) continue;
      const fp = a.fp; if (!fp?.through) continue;
      const pd = fp.panelDist; if (pd != null) {
        const upperT = doc.boards[1].thickness;
        // the panel can never sit lower than the part's shoulder
        if (gap < pd - 0.05) add('error', 'stack', `${a.ref} (${a.name}): its body is ${pd} mm tall up to the shoulder but the gap is ${gap} mm — the panel would sit on the part. Raise the gap to ≥ ${pd} mm or use a shorter part.`, 0, a.x, a.y, [a.id]);
        // and the thread has to come through the panel far enough for a nut
        if (fp.bushingLen != null) {
          const threadAbove = pd + fp.bushingLen - gap - upperT;
          if (threadAbove < 0) add('error', 'stack', `${a.ref}: the ${fp.bushingLen} mm bushing does not reach through the ${upperT} mm panel at gap ${gap} mm (short by ${(-threadAbove).toFixed(1)} mm) — reduce the gap to ${(pd + fp.bushingLen - upperT).toFixed(1)} mm or less`, 0, a.x, a.y, [a.id]);
          else if (threadAbove < 1.2) add('warn', 'stack', `${a.ref}: only ${threadAbove.toFixed(1)} mm of thread above the panel — the nut may not catch (gap ≤ ${(pd + fp.bushingLen - upperT - 1.5).toFixed(1)} mm gives 1.5 mm)`, 0, a.x, a.y, [a.id]);
        }
      }
    }
    if (!(st.links || []).some(l => l.kind === 'standoff' || l.kind === 'screw')) add('warn', 'stack', 'Two boards but no standoffs/screws in the stack', 0, 5, 5);
  }
  return findings;
}
function part_verify() { return true; }
function nearest(arr, v) { return arr.reduce((b, a) => Math.abs(a - v) < Math.abs(b - v) ? a : b, arr[0]); }
export function drcSummary(findings) { const e = findings.filter(f => f.level === 'error').length, w = findings.filter(f => f.level === 'warn').length; return { errors: e, warnings: w, infos: findings.length - e - w }; }
