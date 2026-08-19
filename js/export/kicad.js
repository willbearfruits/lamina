// LAMINA → KiCad PCB exporter (S-expression `.kicad_pcb`, format version 20241229 = KiCad 9; loads in KiCad 9/10,
// KiCad 8 asks to "load anyway"). See docs/EXPORTERS.md.
//   exportKicad(doc, opts) → [{ name: 'kicad/<stem>.kicad_pcb', data }, ..., { name: 'kicad/README-kicad.txt', data }]
//   boardToKicad(board, doc, opts) → string        (one board)
//
// Frame mapping (verified against kicad-cli 10.0.5 renders, see test/kicad.test.mjs):
//   * KiCad is mm, Y DOWN. LAMINA (x, y) → KiCad (x + OX, (H − y) + OY) with OX = OY = 20 (board at 20,20 on the sheet).
//   * Because the Y flip is undone by KiCad's Y-down screen, the picture is identical and every angle maps 1:1
//     (LAMINA CCW in Y-up == KiCad "(at x y r)" CCW on screen). Footprint rotation, pad rotation, text rotation: same number.
//   * Footprint-local coordinates are in the FOOTPRINT frame (unrotated), Y down: library pad (px, py) → (px, −py) for a
//     top-side part; for a bottom-side part LAMINA mirrors X before rotating, which after the Y flip becomes (−px, −py).
//     Pad "(at lx ly r)" r is the ABSOLUTE rotation (footprint rot + pad rot). KiCad does NOT flip pad layers by itself for a
//     footprint on B.Cu (verified) — bottom parts get their layers written flipped explicitly (B.Cu B.Paste B.Mask, B.SilkS…).
//   * Text: KiCad's stroke font capital height == (font size)  → LAMINA size (cap height) maps to KiCad size 1:1
//     (measured: gr_text size 10 → 'H' 10.000 mm tall; size 1 → 1.000 mm). KiCad has no baseline justification; measured
//     baseline offsets from the anchor (units of size, positive = below the anchor along the text's own "down"):
//     bottom −0.13, center +0.455 (single line), top +1.04, interline 1.62·size. LAMINA anchors at the first line's baseline,
//     so the KiCad anchor is shifted by that amount (KICAD_TEXT_BASELINE), and the importer applies the inverse.
//     LAMINA align left/center/right → (justify left|right); mirrored (bottom-side) text → (justify … mirror); KiCad mirrors
//     the justified layout about the anchor exactly like LAMINA's textPrimsToPolylines.
//
// What comes from where: graphics (lines/arcs/circles/polys/text/images) come from resolveBoard() prims; parts, standalone
// pads/holes/slots, vias, traces and regions are semantic KiCad objects (footprints/vias/segments/zones), so they are
// written from the items (raw + stackLinkItems) and their resolved prims are skipped (matched by prim.src).
import { resolveBoard, stackLinkItems, outlinePoints, outlineSize, rectPoints, ovalPoints, circlePoints, flipLayer, layerSide, D2R } from '../geom.js';
import { getFootprint } from '../library.js';
import { fmt, safeName } from './common.js';

export const KICAD_VERSION = 20241229;
export const KICAD_ORIGIN = { x: 20, y: 20 };
// LAMINA cap-height size → KiCad font size (measured 1.0; see header)
export const KICAD_TEXT_SIZE_FACTOR = 1.0;
// first-line baseline offset from the KiCad anchor, in units of size, along the text's local "down" (Y-down frame)
export const KICAD_TEXT_BASELINE = { bottom: -0.13, center: 0.455, top: 1.04, interline: 1.62 };
// LAMINA side: where the FIRST line's baseline sits relative to the text anchor, along the text's "up" (Y-up frame), in mm.
// valign 'baseline' (text items) → 0. valign 'middle' (footprint texts, reference designators): this mirrors what
// geom.textPrimsToPolylines actually renders today (oy = size/2 − (n−1)·0.8·size, i.e. shifted UP by size/2 for one line —
// note the sign: a true "middle" would be −size/2 + …; geom.js has that sign flipped). We follow geom.js so the KiCad export
// agrees with LAMINA's Gerber/SVG/PDF output; if geom.js is fixed, flip the sign here too (export and import share this helper).
export function laminaBaselineUp(valign, size, nLines = 1) {
  if (valign !== 'middle') return 0;
  return size / 2 - (nLines - 1) * 1.6 * size / 2;
}
export function kicadFirstBaselineOffset(vjust, size, nLines = 1) {
  const s = size, n = Math.max(1, nLines), il = KICAD_TEXT_BASELINE.interline;
  if (vjust === 'top') return KICAD_TEXT_BASELINE.top * s;
  if (vjust === 'bottom') return KICAD_TEXT_BASELINE.bottom * s - (n - 1) * il * s;
  return KICAD_TEXT_BASELINE.center * s - (n - 1) * il * s / 2;
}

export const LAYER_TO_KICAD = { 'F.Cu': 'F.Cu', 'B.Cu': 'B.Cu', 'F.Mask': 'F.Mask', 'B.Mask': 'B.Mask', 'F.Silk': 'F.SilkS', 'B.Silk': 'B.SilkS', 'F.Paste': 'F.Paste', 'B.Paste': 'B.Paste', 'F.Fab': 'F.Fab', 'B.Fab': 'B.Fab', 'Edge.Cuts': 'Edge.Cuts' };
export const KICAD_TO_LAYER = Object.fromEntries(Object.entries(LAYER_TO_KICAD).map(([a, b]) => [b, a]));
const KICAD_LAYERS_LIST = `	(layers
		(0 "F.Cu" signal)
		(2 "B.Cu" signal)
		(9 "F.Adhes" user "F.Adhesive")
		(11 "B.Adhes" user "B.Adhesive")
		(13 "F.Paste" user)
		(15 "B.Paste" user)
		(5 "F.SilkS" user "F.Silkscreen")
		(7 "B.SilkS" user "B.Silkscreen")
		(1 "F.Mask" user)
		(3 "B.Mask" user)
		(17 "Dwgs.User" user "User.Drawings")
		(19 "Cmts.User" user "User.Comments")
		(21 "Eco1.User" user "User.Eco1")
		(23 "Eco2.User" user "User.Eco2")
		(25 "Edge.Cuts" user)
		(27 "Margin" user)
		(31 "F.CrtYd" user "F.Courtyard")
		(29 "B.CrtYd" user "B.Courtyard")
		(35 "F.Fab" user)
		(33 "B.Fab" user)
	)`;
const PCBPLOTPARAMS = `		(pcbplotparams
			(layerselection 0x00000000_00000000_00000030_80000001)
			(plot_on_all_layers_selection 0x00000000_00000000_00000000_00000000)
			(disableapertmacros no)
			(usegerberextensions yes)
			(usegerberattributes yes)
			(usegerberadvancedattributes yes)
			(creategerberjobfile yes)
			(dashed_line_dash_ratio 12)
			(dashed_line_gap_ratio 3)
			(svgprecision 6)
			(plotframeref no)
			(mode 1)
			(useauxorigin no)
			(hpglpennumber 1)
			(hpglpenspeed 20)
			(hpglpendiameter 15)
			(pdf_front_fp_property_popups yes)
			(pdf_back_fp_property_popups yes)
			(pdf_metadata yes)
			(pdf_single_document no)
			(dxfpolygonmode yes)
			(dxfimperialunits yes)
			(dxfusepcbnewfont yes)
			(psnegative no)
			(psa4output no)
			(plot_black_and_white yes)
			(sketchpadsonfab no)
			(plotpadnumbers no)
			(hidednponfab no)
			(sketchdnponfab yes)
			(crossoutdnponfab yes)
			(subtractmaskfromsilk no)
			(outputformat 1)
			(mirror no)
			(drillshape 1)
			(scaleselection 1)
			(outputdirectory "")
		)`;
const COLOR_NAMES = { green: 'Green', red: 'Red', blue: 'Blue', black: 'Black', white: 'White', yellow: 'Yellow', purple: 'Purple' };
const FINISH_NAMES = { HASL: 'HAL SnPb', LeadFreeHASL: 'HAL lead-free', ENIG: 'ENIG' };

// ---------- writer helpers ----------
const N = n => fmt(n, 4);
export function kq(s) { return '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '') + '"'; }
function xy(pts) { return '(pts ' + pts.map(([x, y]) => `(xy ${N(x)} ${N(y)})`).join(' ') + ')'; }
function stroke(w, type = 'default') { return `(stroke (width ${N(w)}) (type ${type}))`; }
function uuidGen(seed) { let c = 0; const s = (seed & 0xffff).toString(16).padStart(4, '0'); return () => `0000${s}-0000-4000-8000-${(++c).toString(16).padStart(12, '0')}`; }
function normAngle(a) { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; }
function isAxisRect(pts) { // 4 points forming an axis-aligned rectangle → [x0,y0,x1,y1] or null
  if (!pts || pts.length !== 4) return null;
  const e = 1e-6;
  const [a, b, c, d] = pts;
  const ok1 = Math.abs(a[1] - b[1]) < e && Math.abs(b[0] - c[0]) < e && Math.abs(c[1] - d[1]) < e && Math.abs(d[0] - a[0]) < e;
  const ok2 = Math.abs(a[0] - b[0]) < e && Math.abs(b[1] - c[1]) < e && Math.abs(c[0] - d[0]) < e && Math.abs(d[1] - a[1]) < e;
  if (!ok1 && !ok2) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function arcPts(cx, cy, r, a0, a1) { // start / mid / end of a CCW arc from a0 to a1 (any frame)
  let sweep = a1 - a0; while (sweep < 0) sweep += 360; if (sweep === 0) sweep = 360;
  if (sweep >= 360 - 1e-9) sweep = 359.99; // KiCad arcs cannot be full circles
  const P = a => [cx + r * Math.cos(a * D2R), cy + r * Math.sin(a * D2R)];
  return [P(a0), P(a0 + sweep / 2), P(a0 + sweep)];
}
// text "down" unit vector for a text rotated by rot (deg CCW on screen) in a Y-down frame
function downVec(rot) { const a = rot * D2R; return [Math.sin(a), Math.cos(a)]; }

// ---------- main ----------
export function exportKicad(doc, opts = {}) {
  const idxs = opts.boards || doc.boards.map((_, i) => i);
  const files = [];
  const stems = [];
  for (const i of idxs) {
    const board = doc.boards[i]; if (!board) continue;
    const stem = safeName(board.name);
    stems.push(stem);
    files.push({ name: `kicad/${stem}.kicad_pcb`, data: boardToKicad(board, doc, { ...opts, boardIndex: i }) });
  }
  files.push({ name: 'kicad/README-kicad.txt', data: readme(doc, stems) });
  return files;
}

function readme(doc, stems) {
  return [
    `LAMINA → KiCad export (${doc.name || 'untitled'})`,
    '',
    ...stems.map(s => `  ${s}.kicad_pcb  — open with KiCad 9/10 (File → Open, or "kicad-cli pcb export ..."). KiCad 8 offers to load it anyway.`),
    '',
    'Frame: 1 LAMINA mm = 1 KiCad mm; the board\'s bottom-left corner sits at (20, 20) on the A4 sheet (KiCad Y grows downward).',
    'Parts: one footprint per LAMINA part, named "LAMINA:<lib id>", pads/silk/fab/courtyard inline (no external library needed).',
    '       Standalone pads / holes / slots become tiny footprints "LAMINA:pad", "LAMINA:hole", "LAMINA:slot".',
    'Copper: traces → tracks, vias → vias, regions → zones (already filled with their own polygon; run "Fill all zones"',
    '        in KiCad if you change clearances). Nets are named exactly as in LAMINA (no schematic).',
    'Text: LAMINA text size = cap height = KiCad font size; bottom-side text is written mirrored.',
    'Images: bitmap items are vectorised into filled polygons on their layer.',
    'Round trip: LAMINA can import these files back (Import → KiCad PCB) keeping parts, nets, outline and cutouts.',
  ].join('\n') + '\n';
}

export function boardToKicad(board, doc, opts = {}) {
  const [W, H] = outlineSize(board.outline);
  const OX = opts.origin?.x ?? KICAD_ORIGIN.x, OY = opts.origin?.y ?? KICAD_ORIGIN.y;
  const X = x => x + OX, Y = y => (H - y) + OY;
  const P = ([x, y]) => [X(x), Y(y)];
  const uuid = uuidGen(opts.boardIndex || 0);
  const res = resolveBoard(board, doc, { textAsStrokes: false, imagesAsPolys: true, bitmapFor: opts.bitmapFor });
  const items = board.items.concat(stackLinkItems(doc, board));
  const out = [];
  const w = s => out.push(s);

  // ---- nets ----
  const netNames = new Set();
  for (const p of res.pads) if (p.net) netNames.add(String(p.net));
  for (const it of items) if ((it.type === 'via' || it.type === 'trace' || it.type === 'region' || it.type === 'pad') && it.net) netNames.add(String(it.net));
  const nets = Array.from(netNames).sort();
  const netNo = new Map(nets.map((n, i) => [n, i + 1]));
  const netRef = name => name && netNo.has(String(name)) ? `(net ${netNo.get(String(name))} ${kq(name)})` : '';

  // ---- header ----
  const cuT = (board.copperOz || 1) * 0.035;
  const T = board.thickness || 1.6;
  const color = COLOR_NAMES[board.color] || 'Green';
  const silk = board.silkColor === 'black' ? 'Black' : 'White';
  w('(kicad_pcb');
  w(`	(version ${KICAD_VERSION})`);
  w('	(generator "lamina")');
  w('	(generator_version "0.1")');
  w(`	(general (thickness ${N(T)}) (legacy_teardrops no))`);
  w('	(paper "A4")');
  w(`	(title_block (title ${kq(board.name || 'BOARD')}) (comment 1 ${kq('LAMINA ' + (doc.name || '') + ' — board origin at (' + N(OX) + ', ' + N(OY) + '), Y down')}))`);
  w(KICAD_LAYERS_LIST);
  w('	(setup');
  w('		(stackup');
  w(`			(layer "F.SilkS" (type "Top Silk Screen") (color ${kq(silk)}))`);
  w('			(layer "F.Paste" (type "Top Solder Paste"))');
  w(`			(layer "F.Mask" (type "Top Solder Mask") (color ${kq(color)}) (thickness 0.01))`);
  w(`			(layer "F.Cu" (type "copper") (thickness ${N(cuT)}))`);
  w(`			(layer "dielectric 1" (type "core") (thickness ${N(Math.max(0.1, T - 2 * cuT))}) (material "FR4") (epsilon_r 4.5) (loss_tangent 0.02))`);
  w(`			(layer "B.Cu" (type "copper") (thickness ${N(cuT)}))`);
  w(`			(layer "B.Mask" (type "Bottom Solder Mask") (color ${kq(color)}) (thickness 0.01))`);
  w('			(layer "B.Paste" (type "Bottom Solder Paste"))');
  w(`			(layer "B.SilkS" (type "Bottom Silk Screen") (color ${kq(silk)}))`);
  w(`			(copper_finish ${kq(FINISH_NAMES[board.finish] || 'None')})`);
  w('			(dielectric_constraints no)');
  w('		)');
  w('		(pad_to_mask_clearance 0)');
  w('		(allow_soldermask_bridges_in_footprints no)');
  w('		(tenting front back)');
  w(PCBPLOTPARAMS);
  w('	)');
  w('	(net 0 "")');
  nets.forEach((n, i) => w(`	(net ${i + 1} ${kq(n)})`));

  // ---- board outline + cutouts (Edge.Cuts) ----
  const edge = (body) => w(`	(${body} (layer "Edge.Cuts") (uuid ${kq(uuid())}))`);
  const o = board.outline;
  if (o.type === 'circle') { const r = o.d / 2; edge(`gr_circle (center ${N(X(r))} ${N(Y(r))}) (end ${N(X(o.d))} ${N(Y(r))}) ${stroke(0.1)} (fill no)`); }
  else if (o.type === 'rect' && !(o.r > 0)) edge(`gr_rect (start ${N(X(0))} ${N(Y(H))}) (end ${N(X(W))} ${N(Y(0))}) ${stroke(0.1)} (fill no)`);
  else if (o.type === 'rect') {
    const r = Math.min(o.r, W / 2, H / 2);
    // 4 straight edges + 4 quarter arcs (true arcs for the fab)
    const L = (a, b) => edge(`gr_line (start ${N(X(a[0]))} ${N(Y(a[1]))}) (end ${N(X(b[0]))} ${N(Y(b[1]))}) ${stroke(0.1)}`);
    const A = (cx, cy, a0, a1) => { const [s, m, e] = arcPts(cx, cy, r, a0, a1).map(P); edge(`gr_arc (start ${N(s[0])} ${N(s[1])}) (mid ${N(m[0])} ${N(m[1])}) (end ${N(e[0])} ${N(e[1])}) ${stroke(0.1)}`); };
    L([r, 0], [W - r, 0]); A(W - r, r, -90, 0); L([W, r], [W, H - r]); A(W - r, H - r, 0, 90); L([W - r, H], [r, H]); A(r, H - r, 90, 180); L([0, H - r], [0, r]); A(r, r, 180, 270);
  } else edge(`gr_poly ${xy(res.outline.map(P))} ${stroke(0.1)} (fill no)`);
  for (const it of items) {
    if (it.layer !== 'Edge.Cuts') continue;
    if (it.type === 'circle') edge(`gr_circle (center ${N(X(it.cx))} ${N(Y(it.cy))}) (end ${N(X(it.cx + it.r))} ${N(Y(it.cy))}) ${stroke(0.1)} (fill no)`);
    else if (it.type === 'rect' && !(it.rx > 0) && (it.rot || 0) % 90 === 0) { const b = isAxisRect(rectPoints(it.x, it.y, it.w, it.h, it.rot || 0)); edge(`gr_rect (start ${N(X(b[0]))} ${N(Y(b[3]))}) (end ${N(X(b[2]))} ${N(Y(b[1]))}) ${stroke(0.1)} (fill no)`); }
    else if (it.type === 'rect') edge(`gr_poly ${xy(rectPoints(it.x, it.y, it.w, it.h, it.rot || 0, it.rx || 0).map(P))} ${stroke(0.1)} (fill no)`);
    else if (it.type === 'polygon' && it.points.length >= 3) edge(`gr_poly ${xy(it.points.map(P))} ${stroke(0.1)} (fill no)`);
  }

  // ---- graphics from resolved prims (skip what is written natively below) ----
  const nativeIds = new Set(items.filter(it => ['part', 'pad', 'hole', 'slot', 'via', 'trace', 'region'].includes(it.type)).map(it => it.id));
  for (const [layer, prims] of Object.entries(res.layers)) {
    const kl = LAYER_TO_KICAD[layer]; if (!kl) continue;
    for (const p of prims) {
      if (p.src !== undefined && nativeIds.has(p.src)) continue;
      if (p.isPad || p.isVia) continue;
      for (const s of primToGr(p, kl, P, 'gr', uuid)) w('	' + s);
    }
  }

  // ---- copper: traces, vias, regions ----
  for (const it of items) {
    if (it.type === 'trace') {
      const pts = it.points || [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = P(pts[i]), b = P(pts[i + 1]);
        w(`	(segment (start ${N(a[0])} ${N(a[1])}) (end ${N(b[0])} ${N(b[1])}) (width ${N(it.width)}) (layer ${kq(LAYER_TO_KICAD[it.layer] || 'F.Cu')}) (net ${netNo.get(String(it.net || '')) || 0}) (uuid ${kq(uuid())}))`);
      }
    } else if (it.type === 'via') {
      const c = P([it.x, it.y]);
      w(`	(via (at ${N(c[0])} ${N(c[1])}) (size ${N(it.d)}) (drill ${N(it.drill)}) (layers "F.Cu" "B.Cu")${it.tented === false ? ' (tenting none)' : ''} (net ${netNo.get(String(it.net || '')) || 0}) (uuid ${kq(uuid())}))`);
    } else if (it.type === 'region') {
      if (!it.points || it.points.length < 3) continue;
      const kl = LAYER_TO_KICAD[it.layer] || 'F.Cu';
      const pts = xy(it.points.map(P));
      w(`	(zone (net ${netNo.get(String(it.net || '')) || 0}) (net_name ${kq(it.net || '')}) (layer ${kq(kl)}) (uuid ${kq(uuid())}) (hatch edge 0.5) (connect_pads (clearance 0.5)) (min_thickness 0.25) (filled_areas_thickness no) (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5)) (polygon ${pts}) (filled_polygon (layer ${kq(kl)}) ${pts}))`);
    }
  }

  // ---- footprints: parts + standalone pads / holes / slots ----
  for (const it of items) {
    if (it.type === 'part') { const s = partFootprint(it, doc, P, netRef, uuid); if (s) w(s); }
    else if (it.type === 'pad') {
      const c = P([it.x, it.y]);
      const pad = { ...it, rot: it.rot || 0, layer: it.layer || 'both', drill: it.drill || 0, slotLen: it.slot || 0, name: it.name || '' };
      const th = pad.drill > 0 || pad.layer === 'both';
      w(`	(footprint "LAMINA:pad" (layer "F.Cu") (uuid ${kq(uuid())}) (at ${N(c[0])} ${N(c[1])})\n` +
        `		(property "Reference" ${kq(it.name || 'PAD')} (at 0 0) (layer "F.SilkS") (hide yes) (uuid ${kq(uuid())}) (effects (font (size 1 1) (thickness 0.15))))\n` +
        `		(property "Value" ${kq(it.net || '')} (at 0 0) (layer "F.Fab") (hide yes) (uuid ${kq(uuid())}) (effects (font (size 1 1) (thickness 0.15))))\n` +
        `		(attr ${th ? 'through_hole' : 'smd'} exclude_from_pos_files exclude_from_bom)\n` +
        `		${padSexpr(pad, 0, 0, pad.rot, false, netRef, uuid)}\n	)`);
    } else if (it.type === 'hole') {
      const c = P([it.x, it.y]);
      w(`	(footprint "LAMINA:hole" (layer "F.Cu") (uuid ${kq(uuid())}) (at ${N(c[0])} ${N(c[1])})\n` +
        `		(property "Reference" "H" (at 0 0) (layer "F.SilkS") (hide yes) (uuid ${kq(uuid())}) (effects (font (size 1 1) (thickness 0.15))))\n` +
        `		(property "Value" "" (at 0 0) (layer "F.Fab") (hide yes) (uuid ${kq(uuid())}) (effects (font (size 1 1) (thickness 0.15))))\n` +
        `		(attr exclude_from_pos_files exclude_from_bom)\n` +
        `		(pad "" np_thru_hole circle (at 0 0) (size ${N(it.d)} ${N(it.d)}) (drill ${N(it.d)}) (layers "*.Cu" "*.Mask") (uuid ${kq(uuid())}))\n	)`);
    } else if (it.type === 'slot') {
      const c = P([it.x, it.y]);
      w(`	(footprint "LAMINA:slot" (layer "F.Cu") (uuid ${kq(uuid())}) (at ${N(c[0])} ${N(c[1])})\n` +
        `		(property "Reference" "H" (at 0 0) (layer "F.SilkS") (hide yes) (uuid ${kq(uuid())}) (effects (font (size 1 1) (thickness 0.15))))\n` +
        `		(property "Value" "" (at 0 0) (layer "F.Fab") (hide yes) (uuid ${kq(uuid())}) (effects (font (size 1 1) (thickness 0.15))))\n` +
        `		(attr exclude_from_pos_files exclude_from_bom)\n` +
        `		(pad "" np_thru_hole oval (at 0 0 ${N(normAngle(it.rot || 0))}) (size ${N(it.len)} ${N(it.w)}) (drill oval ${N(it.len)} ${N(it.w)}) (layers "*.Cu" "*.Mask") (uuid ${kq(uuid())}))\n	)`);
    }
  }
  w(')');
  return out.join('\n') + '\n';
}

// One resolved prim → KiCad graphic S-expressions (array of strings, no leading indent). P maps points into the target frame
// (board: LAMINA→KiCad; footprint: library-local→footprint-local). prefix 'gr' or 'fp'. `extra` = trailing tokens (e.g. justify mirror).
export function primToGr(p, kl, P, prefix, uuid, textOpts = {}) {
  const L = `(layer ${kq(kl)})`;
  const U = () => `(uuid ${kq(uuid())})`;
  const out = [];
  switch (p.t) {
    case 'line': { const a = P([p.x1, p.y1]), b = P([p.x2, p.y2]); out.push(`(${prefix}_line (start ${N(a[0])} ${N(a[1])}) (end ${N(b[0])} ${N(b[1])}) ${stroke(p.w || 0.1)} ${L} ${U()})`); break; }
    case 'arc': { const [s, m, e] = arcPts(p.cx, p.cy, p.r, p.a0, p.a1).map(P); out.push(`(${prefix}_arc (start ${N(s[0])} ${N(s[1])}) (mid ${N(m[0])} ${N(m[1])}) (end ${N(e[0])} ${N(e[1])}) ${stroke(p.w || 0.1)} ${L} ${U()})`); break; }
    case 'circle': { const c = P([p.cx, p.cy]), e = P([p.cx + p.r, p.cy]); const filled = !(p.w > 0); out.push(`(${prefix}_circle (center ${N(c[0])} ${N(c[1])}) (end ${N(e[0])} ${N(e[1])}) ${stroke(filled ? 0 : p.w)} (fill ${filled ? 'yes' : 'no'}) ${L} ${U()})`); break; }
    case 'poly': {
      if (!p.pts || p.pts.length < 3) break;
      const pts = p.pts.map(P);
      const b = isAxisRect(pts);
      if (b) out.push(`(${prefix}_rect (start ${N(b[0])} ${N(b[1])}) (end ${N(b[2])} ${N(b[3])}) ${stroke(0)} (fill yes) ${L} ${U()})`);
      else out.push(`(${prefix}_poly ${xy(pts)} ${stroke(0)} (fill yes) ${L} ${U()})`);
      break;
    }
    case 'polyline': {
      const pts = (p.pts || []).map(P);
      if (pts.length === 1) { const [x, y] = pts[0]; out.push(`(${prefix}_circle (center ${N(x)} ${N(y)}) (end ${N(x + (p.w || 0.1) / 2)} ${N(y)}) ${stroke(0)} (fill yes) ${L} ${U()})`); break; }
      if (pts.length < 2) break;
      if (p.closed && pts.length >= 3) { const b = isAxisRect(pts); out.push(b ? `(${prefix}_rect (start ${N(b[0])} ${N(b[1])}) (end ${N(b[2])} ${N(b[3])}) ${stroke(p.w || 0.1)} (fill no) ${L} ${U()})` : `(${prefix}_poly ${xy(pts)} ${stroke(p.w || 0.1)} (fill no) ${L} ${U()})`); break; }
      for (let i = 0; i + 1 < pts.length; i++) out.push(`(${prefix}_line (start ${N(pts[i][0])} ${N(pts[i][1])}) (end ${N(pts[i + 1][0])} ${N(pts[i + 1][1])}) ${stroke(p.w || 0.1)} ${L} ${U()})`);
      break;
    }
    case 'text': {
      const s = textSexpr(p, kl, P, prefix === 'fp' ? 'fp_text user' : 'gr_text', uuid, textOpts);
      if (s) out.push(s);
      break;
    }
    case 'image': break; // never here (imagesAsPolys)
  }
  return out;
}

// text prim {x,y,text,size,thickness,rot,mirror,align,valign} → gr_text / fp_text / property.
// p.rot = ABSOLUTE rotation on the KiCad screen (what gets written). P maps the source-frame anchor (Y up) into the target
// frame (Y down). p.srcRot (default p.rot) = the text's rotation inside the source frame (differs from p.rot for footprint
// texts: library-local vs absolute). textOpts.frameRot = rotation the target frame is later subjected to (footprint rot),
// so the KiCad justification shift is applied along downVec(p.rot − frameRot) in the target frame.
export function textSexpr(p, kl, P, head, uuid, textOpts = {}) {
  const txt = String(p.text ?? '');
  if (!txt.trim()) return '';
  const lines = txt.split('\n');
  const size = (p.size || 1) * KICAD_TEXT_SIZE_FACTOR;
  const thick = p.thickness || Math.max(0.05, size * 0.15);
  const rot = p.rot || 0;
  const srcRot = p.srcRot ?? rot;
  const relRot = rot - (textOpts.frameRot || 0);
  const vj = p.valign === 'middle' ? 'center' : (lines.length > 1 ? 'top' : 'bottom');
  // LAMINA first-line baseline (source frame, Y up): 'baseline' = the anchor itself; 'middle' = anchor + up·laminaBaselineUp
  let bx = p.x, by = p.y;
  const upShift = laminaBaselineUp(p.valign, p.size || 1, lines.length);
  if (upShift) {
    const a = srcRot * D2R; // "up" of a text rotated by srcRot in a Y-up frame = (−sin, cos)
    bx += -Math.sin(a) * upShift; by += Math.cos(a) * upShift;
  }
  const B = P([bx, by]); // baseline point in the target frame (Y down)
  const off = kicadFirstBaselineOffset(vj, size, lines.length);
  const dn = downVec(relRot);
  const ax = B[0] - dn[0] * off, ay = B[1] - dn[1] * off;
  const hj = p.align === 'right' ? 'right' : p.align === 'center' ? '' : 'left';
  const just = [hj, vj === 'center' ? '' : vj, p.mirror ? 'mirror' : ''].filter(Boolean).join(' ');
  const effects = `(effects (font (size ${N(size)} ${N(size)}) (thickness ${N(thick)}))${just ? ` (justify ${just})` : ''})`;
  return `(${head} ${kq(txt)} (at ${N(ax)} ${N(ay)} ${N(normAngle(rot))}) (layer ${kq(kl)})${textOpts.hide ? ' (hide yes)' : ''} (uuid ${kq(uuid())}) ${effects})`;
}

// pad (library/local frame, LAMINA schema, Y up) → (pad ...) in footprint-local KiCad frame; T maps local pts.
function padSexpr(pad, lx, ly, rotAbs, bottom, netRef, uuid) {
  const drill = pad.drill || 0, slot = pad.slotLen || 0;
  const plated = pad.plated !== false;
  const type = drill > 0 ? (plated ? 'thru_hole' : 'np_thru_hole') : 'smd';
  let shape = { circle: 'circle', rect: 'rect', oval: 'oval', roundrect: 'roundrect' }[pad.shape] || 'rect';
  if (type === 'np_thru_hole' && shape === 'rect') shape = 'rect';
  let layer = pad.layer || (drill > 0 ? 'both' : 'F');
  if (bottom && layer !== 'both') layer = layer === 'F' ? 'B' : 'F';
  let layers;
  if (type !== 'smd' || layer === 'both') layers = ['*.Cu', ...(pad.mask === false ? [] : ['*.Mask'])];
  else layers = [`${layer}.Cu`, ...(pad.paste === false || drill > 0 ? [] : [`${layer}.Paste`]), ...(pad.mask === false ? [] : [`${layer}.Mask`])];
  const w = pad.w ?? pad.d ?? 1, h = pad.h ?? w;
  const parts = [`(pad ${kq(type === 'np_thru_hole' ? '' : (pad.name ?? ''))} ${type} ${shape}`, `(at ${N(lx)} ${N(ly)}${rotAbs ? ' ' + N(normAngle(rotAbs)) : ''})`, `(size ${N(w)} ${N(h)})`];
  if (drill > 0) parts.push(slot > 0 ? `(drill oval ${N(slot)} ${N(drill)})` : `(drill ${N(drill)})`);
  parts.push(`(layers ${layers.map(kq).join(' ')})`);
  if (shape === 'roundrect') parts.push(`(roundrect_rratio ${N(pad.rr ?? 0.25)})`);
  if (pad.maskMargin != null) parts.push(`(solder_mask_margin ${N(pad.maskMargin)})`);
  const nr = netRef(pad.net); if (nr) parts.push(nr);
  parts.push(`(uuid ${kq(uuid())})`, ')');
  return parts.join(' ');
}

// LAMINA part item → (footprint ...) string (or '' when the footprint is unknown)
export function partFootprint(part, doc, P, netRef, uuid) {
  const fp = part.fp || getFootprint(part.lib, part);
  if (!fp) return '';
  const bottom = part.side === 'bottom';
  const rot = part.rot || 0;
  // library-local (Y up) → footprint-local file frame (Y down): top (px, −py); bottom (−px, −py)
  const TL = ([px, py]) => bottom ? [-px, -py] : [px, -py];
  const LYR = l => LAYER_TO_KICAD[bottom ? flipLayer(l) : l] || null;
  const c = P([part.x, part.y]);
  const hasTh = (fp.pads || []).some(p => (p.drill || 0) > 0);
  const lines = [];
  const w = s => lines.push('		' + s);
  const libId = part.lib || fp.id || fp.name || 'part';
  lines.push(`	(footprint ${kq('LAMINA:' + libId)} (layer ${bottom ? '"B.Cu"' : '"F.Cu"'}) (uuid ${kq(uuid())}) (at ${N(c[0])} ${N(c[1])}${rot ? ' ' + N(normAngle(rot)) : ''})`);
  if (fp.name || fp.desc) w(`(descr ${kq((fp.name || '') + (fp.desc ? ' — ' + fp.desc : ''))})`);
  if (fp.tags && fp.tags.length) w(`(tags ${kq(fp.tags.join(' '))})`);
  // reference designator (position from refPos, rotation absolute 0, as LAMINA renders it)
  const rp = fp.refPos || { x: 0, y: (fp.courtyard ? (fp.courtyard.h || 0) / 2 + 1 : 2) };
  const hideRef = fp.refText === false || part.hideRef;
  const refPrim = { t: 'text', x: rp.x, y: rp.y, text: part.ref || '', size: 1, thickness: 0.15, rot: 0, srcRot: bottom ? rot : -rot, mirror: bottom, align: 'center', valign: 'middle' };
  // property texts carry the ABSOLUTE angle: LAMINA draws refs unrotated → angle 0; relative rot for the anchor shift = −rot
  const refS = textSexpr(refPrim, LYR('F.Silk'), TL, `property "Reference"`, uuid, { frameRot: rot, hide: hideRef || !part.ref });
  w(refS || `(property "Reference" ${kq(part.ref || '')} (at 0 0) (layer ${kq(LYR('F.Silk'))}) (hide yes) (uuid ${kq(uuid())}) (effects (font (size 1 1) (thickness 0.15))))`);
  w(`(property "Value" ${kq(part.value || '')} (at 0 0) (layer ${kq(LYR('F.Fab'))}) (hide yes) (uuid ${kq(uuid())}) (effects (font (size 1 1) (thickness 0.15))${bottom ? ' (justify mirror)' : ''}))`);
  const attrs = [hasTh ? 'through_hole' : ((fp.pads || []).length ? 'smd' : ''), (fp.pads || []).length ? '' : 'exclude_from_pos_files exclude_from_bom'].filter(Boolean).join(' ');
  if (attrs) w(`(attr ${attrs})`);
  // graphics (library schema, docs/LIBRARY.md)
  for (const g of fp.graphics || []) {
    const kl = LYR(g.layer || 'F.Silk'); if (!kl) continue;
    let prim = null;
    switch (g.t) {
      case 'line': prim = { t: 'line', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, w: g.w ?? 0.15 }; break;
      case 'circle': prim = { t: 'circle', cx: g.cx, cy: g.cy, r: g.r, w: g.w ?? 0.15 }; break;
      case 'arc': prim = { t: 'arc', cx: g.cx, cy: g.cy, r: g.r, a0: g.a0, a1: g.a1, w: g.w ?? 0.15 }; break;
      case 'rect': { const pts = rectPoints(g.cx || 0, g.cy || 0, g.w, g.h, g.rot || 0, g.rx || 0); prim = g.filled ? { t: 'poly', pts } : { t: 'polyline', pts, w: g.lw ?? 0.15, closed: true }; break; }
      case 'poly': prim = g.filled !== false ? { t: 'poly', pts: g.pts } : { t: 'polyline', pts: g.pts, w: g.lw ?? 0.15, closed: true }; break;
      case 'polyline': prim = { t: 'polyline', pts: g.pts, w: g.w ?? 0.15, closed: !!g.closed }; break;
      case 'text': {
        const txt = g.text === '${REF}' ? '${REFERENCE}' : g.text;
        prim = { t: 'text', x: g.x, y: g.y, text: txt, size: g.size ?? 1, thickness: g.thickness ?? 0.15, rot: (bottom ? -(g.rot || 0) : (g.rot || 0)) + rot, srcRot: g.rot || 0, mirror: bottom, align: g.align || 'center', valign: 'middle' };
        break;
      }
    }
    if (!prim) continue;
    for (const s of primToGr(prim, kl, TL, 'fp', uuid, { frameRot: rot })) w(s);
  }
  // courtyard (F.CrtYd / B.CrtYd) — helps KiCad DRC and lets the importer recover the LAMINA courtyard
  const cy = fp.courtyard;
  if (cy) {
    const cpts = (cy.pts ? cy.pts : rectPoints(cy.x || 0, cy.y || 0, cy.w, cy.h)).map(TL);
    const b = isAxisRect(cpts);
    const cl = bottom ? 'B.CrtYd' : 'F.CrtYd';
    w(b ? `(fp_rect (start ${N(b[0])} ${N(b[1])}) (end ${N(b[2])} ${N(b[3])}) ${stroke(0.05)} (fill no) (layer ${kq(cl)}) (uuid ${kq(uuid())}))` : `(fp_poly ${xy(cpts)} ${stroke(0.05)} (fill no) (layer ${kq(cl)}) (uuid ${kq(uuid())}))`);
  }
  // pads + NPTH holes
  for (const p of fp.pads || []) {
    const [lx, ly] = TL([p.x, p.y]);
    const rotAbs = (bottom ? -(p.rot || 0) : (p.rot || 0)) + rot;
    w(padSexpr({ ...p, name: String(p.name ?? p.n ?? '') }, lx, ly, rotAbs, bottom, netRef, uuid));
  }
  for (const h of fp.holes || []) {
    const [lx, ly] = TL([h.x, h.y]);
    const rotAbs = (bottom ? -(h.rot || 0) : (h.rot || 0)) + rot;
    if (h.slotLen > 0) w(`(pad "" np_thru_hole oval (at ${N(lx)} ${N(ly)}${rotAbs ? ' ' + N(normAngle(rotAbs)) : ''}) (size ${N(h.slotLen)} ${N(h.d)}) (drill oval ${N(h.slotLen)} ${N(h.d)}) (layers "*.Cu" "*.Mask") (uuid ${kq(uuid())}))`);
    else w(`(pad "" np_thru_hole circle (at ${N(lx)} ${N(ly)}) (size ${N(h.d)} ${N(h.d)}) (drill ${N(h.d)}) (layers "*.Cu" "*.Mask") (uuid ${kq(uuid())}))`);
  }
  lines.push('	)');
  return lines.join('\n');
}
