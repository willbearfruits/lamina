// LAMINA → hobby-CNC (GRBL) G-code. Plain ES module, no DOM.
// One file per job per board under gcode/:
//   <stem>-drill.nc            peck-drill every hole, grouped by tool diameter (M0 tool-change pause);
//                              slots are cut as a linear pass with the drill of the slot width
//   <stem>-outline.nc          contour the profile (offset OUTWARD by tool radius, multi-pass, holding tabs)
//                              + internal cutouts (offset INWARD, no tabs) — cutouts first
//   <stem>-engrave-F_Silk.nc   centre-line engraving of every stroke prim on the silk layers
//   <stem>-engrave-B_Silk.nc   (bottom mirrored x' = W − x, so flip the board over and engrave from the back)
//   README-cnc.txt             frame/conventions + why copper isolation is NOT generated here (do it in FlatCAM)
// Frame: mm, absolute, origin = board bottom-left corner, X right, Y up, Z0 = board TOP surface,
// cutting Z is negative. GRBL dialect: G21 G90 G17 G94, S..M3 at start, M5 M2 at end, lines only (no arcs).
import { resolveBoard, arcPoints, circlePoints, ensureCCW } from '../geom.js';
import { fmt, safeName } from './common.js';
import { slotEnds, isSlot, toolTable } from './excellon.js';

export const GCODE_VERSION = '0.1';
export const GCODE_DEFAULTS = {
  feedXY: 200,      // mm/min
  feedZ: 60,        // mm/min plunge
  safeZ: 5,         // mm above board top for rapids
  passDepth: 0.5,   // mm per contour / slot pass
  drillPeck: 1.0,   // mm per peck
  peckRetract: 0.5, // mm above surface between pecks
  spindle: 10000,   // rpm
  toolD: 1.0,       // mm — outline / cutout end mill
  engraveDepth: 0.1,// mm — silk engraving depth (V-bit)
  engraveToolD: 0.1,// mm — informational (V-bit tip)
  overcut: 0.2,     // mm cut past the bottom face for drills / outline (must stay < 0.5)
  tabs: 4,          // holding tabs on the outline (0 = none)
  tabWidth: 3,      // mm along the toolpath centreline
  tabHeight: 0.5,   // mm of material left under a tab
};
const N = v => fmt(v, 3);

// ---------- polygon helpers ----------
function dedupe(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push([p[0], p[1]]); }
  if (out.length > 1) { const a = out[0], b = out[out.length - 1]; if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop(); }
  return out;
}
// Vertex-normal (miter) offset of a closed CCW polygon by r (r>0 = outward, r<0 = inward).
// Exact for convex outlines and gentle concave ones (rounded rects, circles, cutouts wider than the tool);
// concave features tighter than |r| may self-intersect — LIMITATION, documented in the file header.
export function offsetPolygon(ptsIn, r) {
  const pts = dedupe(ensureCCW(ptsIn));
  const n = pts.length; if (n < 3) return pts;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-12;
    normals.push([dy / len, -dx / len]); // outward for CCW
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const n1 = normals[(i - 1 + n) % n], n2 = normals[i];
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const denom = 1 + dot;
    let mx, my;
    if (denom < 0.05) { mx = n1[0]; my = n1[1]; } // near-reversal: fall back to the incoming normal (no huge miter spike)
    else { mx = (n1[0] + n2[0]) / denom; my = (n1[1] + n2[1]) / denom; }
    out.push([pts[i][0] + r * mx, pts[i][1] + r * my]);
  }
  return out;
}
export function perimeter(pts) { let L = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; }

// ---------- writer ----------
class G {
  constructor(o) { this.o = o; this.L = []; this.minZ = 0; this.z = null; }
  c(s) { this.L.push(`(${String(s).replace(/[()]/g, '_')})`); }
  raw(s) { this.L.push(s); }
  header(doc, board, res, job, toolLine, extra = []) {
    const o = this.o;
    this.c(`LAMINA ${GCODE_VERSION} G-code - ${doc.name || 'untitled'} / ${board.name} - ${job}`);
    this.c(`Board ${N(res.size[0])} x ${N(res.size[1])} mm, thickness ${N(board.thickness ?? 1.6)} mm`);
    this.c('Units mm, absolute (G90). Origin = board bottom-left corner, X right, Y up.');
    this.c('Z0 = board TOP surface; cutting Z is negative. Home/touch off the tool on the board top before running.');
    this.c(toolLine);
    this.c(`Feeds: XY ${N(o.feedXY)} mm/min, plunge ${N(o.feedZ)} mm/min. Safe Z ${N(o.safeZ)} mm. Spindle ${N(o.spindle)} rpm.`);
    for (const e of extra) this.c(e);
    this.c('Dialect: GRBL 1.1 (G21 G90 G17 G94, lines only, M0 = pause for tool change).');
    this.raw('G21'); this.raw('G90'); this.raw('G17'); this.raw('G94');
    this.raw(`S${N(o.spindle)} M3`);
    this.safe();
  }
  footer() { this.safe(); this.raw('M5'); this.raw('M2'); }
  safe() { if (this.z !== this.o.safeZ) { this.raw(`G0 Z${N(this.o.safeZ)}`); this.z = this.o.safeZ; } }
  rapidXY(x, y) { this.raw(`G0 X${N(x)} Y${N(y)}`); }
  rapidZ(z) { this.raw(`G0 Z${N(z)}`); this.z = z; if (z < this.minZ) this.minZ = z; }
  plunge(z) { this.raw(`G1 Z${N(z)} F${N(this.o.feedZ)}`); this.z = z; if (z < this.minZ) this.minZ = z; }
  cutXY(x, y) { this.raw(`G1 X${N(x)} Y${N(y)} F${N(this.o.feedXY)}`); }
  toolChange(desc) { this.safe(); this.raw('M5'); this.c(`TOOL CHANGE: ${desc} - press cycle start / resume when ready`); this.c(`MSG, load ${desc}`); this.raw('M0'); this.raw(`S${N(this.o.spindle)} M3`); }
  text() { return this.L.join('\n') + '\n'; }
}
// depth schedule: [-pass, -2pass, ..., zTarget]
function passes(zTarget, step) {
  const out = []; let z = 0;
  while (z - step > zTarget + 1e-9) { z -= step; out.push(z); }
  out.push(zTarget);
  return out;
}

// ---------- drill job ----------
export function drillGcode(doc, board, res, o) {
  const drills = res.drills.filter(d => d.d > 0);
  if (!drills.length) return null;
  const T = board.thickness ?? 1.6;
  const zTarget = -(T + o.overcut);
  const g = new G(o);
  const tools = toolTable(drills);
  g.header(doc, board, res, 'drill', `Tools: ${tools.map(t => N(t.d) + ' mm').join(', ')} (one M0 pause per tool; drill through to Z${N(zTarget)}).`,
    [`Peck ${N(o.drillPeck)} mm, retract to Z${N(o.peckRetract)} between pecks. Slots are cut linearly with the drill of the slot width in ${N(o.passDepth)} mm passes.`,
     `Holes: ${drills.length} (${drills.filter(isSlot).length} slots). Plated/non-plated makes no difference here.`]);
  tools.forEach((t, i) => {
    g.toolChange(`${N(t.d)} mm drill (T${i + 1}, ${t.hits.length} holes)`);
    for (const dr of t.hits) {
      if (isSlot(dr)) {
        const [[ax, ay], [bx, by]] = slotEnds(dr);
        g.c(`slot x${N(dr.x)} y${N(dr.y)} w${N(dr.d)} len${N(dr.slotLen)} rot${N(dr.rot || 0)}`);
        g.safe(); g.rapidXY(ax, ay);
        let atA = true;
        for (const z of passes(zTarget, o.passDepth)) {
          g.plunge(z);
          if (atA) g.cutXY(bx, by); else g.cutXY(ax, ay);
          atA = !atA;
        }
        g.safe();
      } else {
        g.c(`drill x${N(dr.x)} y${N(dr.y)} d${N(dr.d)}${dr.plated === false ? ' npth' : ''}`);
        g.safe(); g.rapidXY(dr.x, dr.y);
        const pk = passes(zTarget, o.drillPeck);
        pk.forEach((z, k) => { g.plunge(z); if (k < pk.length - 1) g.rapidZ(o.peckRetract); });
        g.safe();
      }
    }
  });
  g.footer();
  return { text: g.text(), minZ: g.minZ, count: drills.length };
}

// ---------- outline job ----------
// Cut a closed toolpath in depth passes; tabs = [{s0,s1}] arc-length intervals along the path where Z is
// lifted to tabZ (only for passes deeper than tabZ).
function contour(g, path, zPasses, tabs, tabZ) {
  const n = path.length; if (n < 2) return;
  const segs = []; let s = 0;
  for (let i = 0; i < n; i++) { const a = path[i], b = path[(i + 1) % n]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push({ a, b, s0: s, len }); s += len; }
  const inTab = d => tabs.some(t => d > t.s0 + 1e-9 && d < t.s1 - 1e-9);
  const breaks = []; for (const t of tabs) { breaks.push(t.s0, t.s1); }
  breaks.sort((x, y) => x - y);
  g.safe(); g.rapidXY(path[0][0], path[0][1]);
  for (const z of zPasses) {
    const useTabs = tabs.length && z < tabZ - 1e-9;
    let curZ = useTabs && inTab(1e-6) ? tabZ : z;
    g.plunge(curZ);
    for (const sg of segs) {
      // pieces of this segment split at tab boundaries
      const cuts = useTabs ? breaks.filter(b => b > sg.s0 + 1e-9 && b < sg.s0 + sg.len - 1e-9) : [];
      let from = sg.s0;
      for (const b of cuts.concat([sg.s0 + sg.len])) {
        const t = sg.len ? (b - sg.s0) / sg.len : 1;
        const x = sg.a[0] + (sg.b[0] - sg.a[0]) * t, y = sg.a[1] + (sg.b[1] - sg.a[1]) * t;
        const wantZ = useTabs && inTab((from + b) / 2) ? tabZ : z;
        if (Math.abs(wantZ - curZ) > 1e-9) { g.plunge(wantZ); curZ = wantZ; }
        g.cutXY(x, y);
        from = b;
      }
    }
  }
  g.safe();
}
export function outlineGcode(doc, board, res, o) {
  const T = board.thickness ?? 1.6, r = o.toolD / 2;
  const zTarget = -(T + o.overcut);
  const zPasses = passes(zTarget, o.passDepth);
  const g = new G(o);
  const tabZ = -(T - o.tabHeight);
  g.header(doc, board, res, 'outline', `Tool: ${N(o.toolD)} mm end mill. Profile offset OUTWARD by ${N(r)} mm, cutouts offset INWARD; ${zPasses.length} passes of ${N(o.passDepth)} mm to Z${N(zTarget)}.`,
    [`Tabs: ${o.tabs} x ${N(o.tabWidth)} mm wide, ${N(o.tabHeight)} mm high (Z lifted to ${N(tabZ)} through the tab). Cut the tabs by hand afterwards.`,
     'Offset = vertex-normal (miter) offset: exact for convex/rounded outlines; concave notches tighter than the tool radius may self-intersect - check the toolpath in a previewer.',
     `Cutouts: ${res.cutouts.length} (cut first, no tabs). Fix the board to a spoil board; the tabs hold it during the profile cut.`]);
  // cutouts first, inward offset, no tabs
  res.cutouts.forEach((c, i) => {
    g.c(`cutout ${i + 1}`);
    contour(g, offsetPolygon(c, -r), zPasses, [], tabZ);
  });
  // profile
  g.c('profile');
  const path = offsetPolygon(res.outline, r);
  const L = perimeter(path);
  const tabs = [];
  if (o.tabs > 0 && o.tabWidth > 0 && L > o.tabs * o.tabWidth * 2) {
    for (let k = 0; k < o.tabs; k++) { const c = (k + 0.5) / o.tabs * L; tabs.push({ s0: Math.max(0, c - o.tabWidth / 2), s1: Math.min(L, c + o.tabWidth / 2) }); }
  }
  contour(g, path, zPasses, tabs, tabZ);
  g.footer();
  return { text: g.text(), minZ: g.minZ, tabs: tabs.length };
}

// ---------- engrave job ----------
// prim → list of centre-line polylines (mirror: x' = W − x for bottom layers)
export function primStrokes(p, mirrorW) {
  const M = pts => (mirrorW === null || mirrorW === undefined) ? pts : pts.map(([x, y]) => [mirrorW - x, y]);
  switch (p.t) {
    case 'line': return [{ pts: M([[p.x1, p.y1], [p.x2, p.y2]]) }];
    case 'polyline': { const pts = p.pts.slice(); if (p.closed && pts.length > 2) pts.push(pts[0]); return [{ pts: M(pts) }]; }
    case 'arc': return [{ pts: M(arcPoints(p.cx, p.cy, p.r, p.a0, p.a1)) }];
    case 'circle': { const pts = circlePoints(p.cx, p.cy, p.r); pts.push(pts[0]); return [{ pts: M(pts), note: p.w ? null : 'filled disc: outline only' }]; }
    case 'poly': {
      const out = [];
      const outer = p.pts.slice(); if (outer.length > 2) outer.push(outer[0]);
      out.push({ pts: M(outer), note: 'filled polygon: outline only, no hatch fill' });
      for (const h of p.holes || []) { const hp = h.slice(); if (hp.length > 2) hp.push(hp[0]); out.push({ pts: M(hp), note: 'polygon hole outline' }); }
      return out;
    }
    default: return [];
  }
}
export function engraveGcode(doc, board, res, layer, o) {
  const prims = res.layers[layer] || [];
  if (!prims.length) return null;
  const W = res.size[0];
  const bottom = layer.startsWith('B.');
  const g = new G(o);
  g.header(doc, board, res, `engrave ${layer}`, `Tool: V-bit / engraver (~${N(o.engraveToolD)} mm tip). Centre-line engraving at Z-${N(o.engraveDepth)}.`,
    bottom ? [`BOTTOM layer: X is MIRRORED (x' = ${N(W)} - x). Flip the board over about its vertical axis so its bottom faces up,`,
              'with the board\'s bottom-left corner (as seen from the top) now at the bottom-RIGHT; touch off at the new bottom-left corner.',
              'After flipping, Z0 = the face now on top (the board bottom). Filled shapes are engraved as outlines only (no hatch fill).']
           : ['Coordinates identical to the gerbers (top view). Filled shapes are engraved as outlines only (no hatch fill).']);
  let strokes = 0;
  for (const p of prims) {
    for (const st of primStrokes(p, bottom ? W : null)) {
      if (!st.pts || st.pts.length < 2) continue;
      if (st.note) g.c(st.note);
      g.safe(); g.rapidXY(st.pts[0][0], st.pts[0][1]);
      g.plunge(-o.engraveDepth);
      for (let i = 1; i < st.pts.length; i++) g.cutXY(st.pts[i][0], st.pts[i][1]);
      g.safe();
      strokes++;
    }
  }
  g.footer();
  return { text: g.text(), minZ: g.minZ, strokes };
}

export function cncReadme(doc, o) {
  return [
    `LAMINA ${GCODE_VERSION} - CNC (GRBL) G-code bundle for "${doc.name || 'untitled'}"`,
    '',
    'FRAME: mm, absolute, origin = board bottom-left corner, X right, Y up, Z0 = board TOP surface, cutting Z negative.',
    'Every file starts with G21 G90 G17 G94 + S..M3 and ends with M5 M2. Only straight moves (G0/G1), no arcs.',
    '',
    'FILES PER BOARD',
    '  <board>-drill.nc            peck drilling grouped by tool; M0 pause before each tool (load the drill named in the comment, then resume).',
    '                              Slots are cut linearly with the drill of the slot width (multi-pass).',
    '  <board>-outline.nc          cutouts (inward offset) then profile (outward offset by tool radius), multi-pass, holding tabs on the profile.',
    '  <board>-engrave-F_Silk.nc   silkscreen engraving, top. Centre-line of every stroke, filled shapes as outlines only.',
    '  <board>-engrave-B_Silk.nc   silkscreen engraving, bottom - X mirrored (x\' = W - x); flip the board and touch off again.',
    '',
    `DEFAULTS: XY ${o.feedXY} mm/min, plunge ${o.feedZ} mm/min, safe Z ${o.safeZ} mm, pass ${o.passDepth} mm, peck ${o.drillPeck} mm,`,
    `          spindle ${o.spindle} rpm, outline tool ${o.toolD} mm, engrave depth ${o.engraveDepth} mm, overcut ${o.overcut} mm, tabs ${o.tabs} x ${o.tabWidth} mm / ${o.tabHeight} mm high.`,
    '',
    'COPPER ISOLATION ROUTING IS NOT GENERATED HERE (on purpose).',
    'Correct isolation needs the union of all offset copper features; a half-right toolpath would short pads.',
    'Recommended path: load this bundle\'s gerbers (gerber/<board>/<board>.GTL / .GBL) and drills (.DRL) into FlatCAM',
    '(or Candle/bCNC + pcb2gcode), generate isolation there with your real V-bit angle/depth, then use these drill/outline files as-is',
    '(same origin: board bottom-left, Y up).',
    '',
    'LIMITATIONS: outline offset is a miter (vertex-normal) offset - exact for convex/rounded outlines, may self-intersect on concave',
    'notches tighter than the tool radius; no ramping (straight plunges); no hatch fill for filled silk shapes.',
    '',
  ].join('\n');
}

// opts: { boards:[idx], bitmapFor, dir:'gcode', ...GCODE_DEFAULTS }
export function exportGcode(doc, opts = {}) {
  const o = { ...GCODE_DEFAULTS, ...opts };
  const idxs = opts.boards || doc.boards.map((_, i) => i);
  const dir = (opts.dir === undefined ? 'gcode' : opts.dir);
  const prefix = dir ? `${dir}/` : '';
  const out = [];
  for (const i of idxs) {
    const board = doc.boards[i]; if (!board) continue;
    const res = resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: opts.bitmapFor });
    const stem = safeName(board.name);
    const d = drillGcode(doc, board, res, o); if (d) out.push({ name: `${prefix}${stem}-drill.nc`, data: d.text });
    const ol = outlineGcode(doc, board, res, o); out.push({ name: `${prefix}${stem}-outline.nc`, data: ol.text });
    for (const layer of ['F.Silk', 'B.Silk']) {
      const e = engraveGcode(doc, board, res, layer, o);
      if (e) out.push({ name: `${prefix}${stem}-engrave-${layer.replace('.', '_')}.nc`, data: e.text });
    }
  }
  out.push({ name: `${prefix}README-cnc.txt`, data: cncReadme(doc, o) });
  return out;
}
