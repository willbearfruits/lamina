// LAMINA SVG exporter — true-scale (mm) vector renders. See docs/EXPORTERS.md.
// Files per board: <stem>-top.svg, <stem>-bottom.svg (mirrored, as seen from below), <stem>-layers.svg
// (Inkscape layers), <stem>-outline.svg (outline + cutouts + drills only), and with opts.perLayer
// one black-on-transparent <stem>-<Layer>.svg per non-empty layer.
// Coordinates: LAMINA mm / Y up → SVG Y down via a top-level flip group. Text and images are already
// flattened by resolveBoard (textAsStrokes / imagesAsPolys), so no native <text> is emitted.
import { resolveBoard, arcPoints, ovalPoints, GRAPHIC_LAYERS } from '../geom.js';
import { BOARD_COLORS, SILK_COLORS } from '../model.js';
import { fmt, safeName } from './common.js';

export const COPPER = '#c68a3a';
export const HOLE_DEFAULT = '#ffffff';
export const EDGE_STROKE = '#1a1a1a';
// colours for the "all layers" view (semi-transparent, distinct)
export const LAYER_COLORS = {
  'F.Cu': '#c83434', 'B.Cu': '#4d7fc4', 'F.Mask': '#c040c0', 'B.Mask': '#20a0a0', 'F.Silk': '#b0900a', 'B.Silk': '#c05070',
  'F.Paste': '#7a7a7a', 'B.Paste': '#4a8a8a', 'F.Fab': '#8a8a8a', 'B.Fab': '#585d84', 'Edge.Cuts': '#202020', 'Drills': '#202020',
};

// Shared with the PDF exporter: the paint order for a realistic single-side render.
// Returns ops: {kind:'board'|'layer'|'drills'|'cutouts'|'edge', ...}
export function realisticPlan(res, side, holeColor = HOLE_DEFAULT) {
  const board = res.board;
  const bc = (BOARD_COLORS[board.color] || BOARD_COLORS.green).mask;
  const silk = SILK_COLORS[board.silkColor] || SILK_COLORS.white;
  const P = side === 'bottom' ? 'B.' : 'F.';
  return [
    { kind: 'board', fill: bc },
    { kind: 'layer', layer: P + 'Cu', color: COPPER, opacity: 0.45 },   // copper under translucent mask
    { kind: 'layer', layer: P + 'Mask', color: COPPER, opacity: 1 },    // mask openings → exposed copper
    { kind: 'layer', layer: P + 'Silk', color: silk, opacity: 1 },
    { kind: 'drills', fill: holeColor },
    { kind: 'cutouts', fill: holeColor },
    { kind: 'edge', stroke: EDGE_STROKE, w: 0.1 },
  ];
}
export function nonEmptyLayers(res) { return GRAPHIC_LAYERS.filter(l => (res.layers[l] || []).length > 0); }
export function drillOutlines(res) { // → array of point rings (circles + slot stadiums)
  return res.drills.map(d => d.slotLen > 0 ? ovalPoints(d.x, d.y, d.slotLen, d.d, d.rot || 0) : null);
}

// ---------- SVG primitives ----------
const X = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const N = n => fmt(n, 4);
const ptsAttr = pts => pts.map(p => N(p[0]) + ',' + N(p[1])).join(' ');
const pathD = rings => rings.map(r => r.length ? 'M' + r.map(p => N(p[0]) + ',' + N(p[1])).join('L') + 'Z' : '').join('');
const sw = w => N(Math.max(w || 0, 0.01));

// One prim → SVG element string. Colours are inherited from the enclosing <g> (fill + stroke set there).
export function svgPrim(p) {
  switch (p.t) {
    case 'line': return `<line x1="${N(p.x1)}" y1="${N(p.y1)}" x2="${N(p.x2)}" y2="${N(p.y2)}" fill="none" stroke-width="${sw(p.w)}"/>`;
    case 'polyline': {
      if (!p.pts || p.pts.length < 1) return '';
      if (p.pts.length === 1) { const [x, y] = p.pts[0]; return `<circle cx="${N(x)}" cy="${N(y)}" r="${N(Math.max(p.w || 0, 0.01) / 2)}" stroke="none"/>`; }
      return `<${p.closed ? 'polygon' : 'polyline'} points="${ptsAttr(p.pts)}" fill="none" stroke-width="${sw(p.w)}"/>`;
    }
    case 'arc': return `<polyline points="${ptsAttr(arcPoints(p.cx, p.cy, p.r, p.a0, p.a1))}" fill="none" stroke-width="${sw(p.w)}"/>`;
    case 'circle': return p.w > 0
      ? `<circle cx="${N(p.cx)}" cy="${N(p.cy)}" r="${N(p.r)}" fill="none" stroke-width="${sw(p.w)}"/>`
      : `<circle cx="${N(p.cx)}" cy="${N(p.cy)}" r="${N(p.r)}" stroke="none"/>`;
    case 'poly': {
      if (!p.pts || p.pts.length < 3) return '';
      const rings = [p.pts, ...(p.holes || [])];
      return `<path d="${pathD(rings)}" fill-rule="evenodd" stroke="none"/>`;
    }
    default: return ''; // text/image only appear when not flattened — not emitted here
  }
}
function layerGroup(id, prims, color, opacity, extra = '') {
  const body = prims.map(svgPrim).filter(Boolean).join('\n    ');
  const op = opacity != null && opacity < 1 ? ` opacity="${N(opacity)}"` : '';
  return `  <g id="${X(id)}" inkscape:label="${X(id)}" inkscape:groupmode="layer" fill="${color}" stroke="${color}"${op} stroke-linecap="round" stroke-linejoin="round"${extra}>\n    ${body}\n  </g>`;
}
function drillShapes(res, fill, stroke, w) {
  const out = [];
  const st = stroke ? ` fill="${fill}" stroke="${stroke}" stroke-width="${N(w)}"` : ` fill="${fill}" stroke="none"`;
  for (const d of res.drills) {
    if (d.slotLen > 0) out.push(`<polygon points="${ptsAttr(ovalPoints(d.x, d.y, d.slotLen, d.d, d.rot || 0))}"${st}/>`);
    else out.push(`<circle cx="${N(d.x)}" cy="${N(d.y)}" r="${N(d.d / 2)}"${st}/>`);
  }
  return out;
}
function cutoutShapes(res, fill, stroke, w) {
  const st = stroke ? ` fill="${fill}" stroke="${stroke}" stroke-width="${N(w)}"` : ` fill="${fill}" stroke="none"`;
  return res.cutouts.map(c => `<polygon points="${ptsAttr(c)}"${st}/>`);
}

function svgDoc({ W, H, title, desc, background, mirror, body }) {
  const bg = background && background !== 'none' ? `  <rect x="0" y="0" width="${N(W)}" height="${N(H)}" fill="${X(background)}" stroke="none"/>\n` : '';
  const T = mirror ? `translate(${N(W)},${N(H)}) scale(-1,-1)` : `translate(0,${N(H)}) scale(1,-1)`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${N(W)}mm" height="${N(H)}mm" viewBox="0 0 ${N(W)} ${N(H)}">
<title>${X(title)}</title>
<desc>${X(desc)}</desc>
${bg}<g id="lamina" transform="${T}">
${body}
</g>
</svg>
`;
}

// realistic render of one side (top view, or bottom-as-seen-from-below when side==='bottom')
function renderSide(res, side, opts, docName) {
  const [W, H] = res.size;
  const holeColor = opts.background && opts.background !== 'none' ? opts.background : HOLE_DEFAULT;
  const parts = [];
  for (const op of realisticPlan(res, side, holeColor)) {
    switch (op.kind) {
      case 'board': parts.push(`  <g id="board" fill="${op.fill}" stroke="none">\n    <path d="${pathD([res.outline])}"/>\n  </g>`); break;
      case 'layer': parts.push(layerGroup(op.layer, res.layers[op.layer] || [], op.color, op.opacity)); break;
      case 'drills': parts.push(`  <g id="drills">\n    ${drillShapes(res, op.fill, null).join('\n    ')}\n  </g>`); break;
      case 'cutouts': if (res.cutouts.length) parts.push(`  <g id="cutouts">\n    ${cutoutShapes(res, op.fill, null).join('\n    ')}\n  </g>`); break;
      case 'edge': parts.push(`  <g id="Edge.Cuts" fill="none" stroke="${op.stroke}" stroke-width="${N(op.w)}" stroke-linejoin="round">\n    <path d="${pathD([res.outline, ...res.cutouts])}"/>\n  </g>`); break;
    }
  }
  return svgDoc({ W, H, mirror: side === 'bottom', background: opts.background,
    title: `${docName} — ${res.board.name} (${side === 'bottom' ? 'bottom, as seen from below' : 'top'})`,
    desc: `LAMINA ${side} render, true scale (mm). Generated ${new Date().toISOString()}`, body: parts.join('\n') });
}
function renderLayers(res, opts, docName) {
  const [W, H] = res.size;
  const parts = [];
  parts.push(`  <g id="Edge.Cuts" inkscape:label="Edge.Cuts" inkscape:groupmode="layer" fill="none" stroke="${LAYER_COLORS['Edge.Cuts']}" stroke-width="0.1" stroke-linejoin="round">\n    <path d="${pathD([res.outline, ...res.cutouts])}"/>\n  </g>`);
  for (const l of GRAPHIC_LAYERS) {
    const prims = res.layers[l] || []; if (!prims.length) continue;
    parts.push(layerGroup(l, prims, LAYER_COLORS[l] || '#000', 0.6));
  }
  parts.push(`  <g id="Drills" inkscape:label="Drills" inkscape:groupmode="layer">\n    ${drillShapes(res, 'none', LAYER_COLORS.Drills, 0.1).join('\n    ')}\n  </g>`);
  return svgDoc({ W, H, background: opts.background, title: `${docName} — ${res.board.name} (all layers, top view)`,
    desc: `LAMINA all-layers view, one <g> per layer (Inkscape layers), true scale (mm). Generated ${new Date().toISOString()}`, body: parts.join('\n') });
}
function renderOutline(res, opts, docName) {
  const [W, H] = res.size;
  const w = opts.outlineStroke ?? 0.1;
  const body = [
    `  <g id="Edge.Cuts" inkscape:label="Edge.Cuts" inkscape:groupmode="layer" fill="none" stroke="#000000" stroke-width="${N(w)}" stroke-linejoin="round">\n    <path d="${pathD([res.outline, ...res.cutouts])}"/>\n  </g>`,
    `  <g id="Drills" inkscape:label="Drills" inkscape:groupmode="layer">\n    ${drillShapes(res, 'none', '#000000', w).join('\n    ')}\n  </g>`,
  ].join('\n');
  return svgDoc({ W, H, background: opts.background, title: `${docName} — ${res.board.name} (outline + holes)`,
    desc: `LAMINA outline, cutouts and drills, black hairline strokes, true scale (mm). Generated ${new Date().toISOString()}`, body });
}
function renderOneLayer(res, layer, opts, docName) {
  const [W, H] = res.size;
  const body = layerGroup(layer, res.layers[layer] || [], '#000000', 1);
  return svgDoc({ W, H, background: opts.background, title: `${docName} — ${res.board.name} — ${layer}`,
    desc: `LAMINA layer ${layer}, black on transparent, true scale (mm). Generated ${new Date().toISOString()}`, body });
}

// ---------- entry point ----------
export function exportSvg(doc, opts = {}) {
  const files = [];
  const idxs = opts.boards || doc.boards.map((_, i) => i);
  for (const i of idxs) {
    const board = doc.boards[i]; if (!board) continue;
    const res = resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: opts.bitmapFor });
    const stem = safeName(board.name);
    files.push({ name: `${stem}-top.svg`, data: renderSide(res, 'top', opts, doc.name) });
    files.push({ name: `${stem}-bottom.svg`, data: renderSide(res, 'bottom', opts, doc.name) });
    files.push({ name: `${stem}-layers.svg`, data: renderLayers(res, opts, doc.name) });
    files.push({ name: `${stem}-outline.svg`, data: renderOutline(res, opts, doc.name) });
    if (opts.perLayer) for (const l of nonEmptyLayers(res)) files.push({ name: `${stem}-${l.replace(/\./g, '_')}.svg`, data: renderOneLayer(res, l, opts, doc.name) });
  }
  return files;
}
