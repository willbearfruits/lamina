// LAMINA DXF exporter — AutoCAD 2000 (AC1015) ASCII DXF, mm, Y up, origin bottom-left (same frame as LAMINA).
// One <stem>.dxf per board under dxf/, plus dxf/README-dxf.txt.
// Geometry: LWPOLYLINE (outline, cutouts, slots, polylines, filled-poly boundaries), LINE, ARC, CIRCLE.
// Text is exported twice: exact Hershey strokes as LWPOLYLINEs on the graphic layer (what DipTrace/FlatCAM see),
// and editable native TEXT entities on a parallel "<Layer>_TEXT" layer (KiCad / Inkscape / CAD users).
// Layer names follow the DipTrace-friendly convention: TopSilk, BottomSilk, TopCopper, ..., BoardOutline, Drill_PTH, Drill_NPTH.
import { resolveBoard, arcPoints, ovalPoints, GRAPHIC_LAYERS, primBBox, unionBBox } from '../geom.js';
import { fmt, safeName } from './common.js';

export const DXF_LAYERS = {
  'F.Silk': 'TopSilk', 'B.Silk': 'BottomSilk', 'F.Cu': 'TopCopper', 'B.Cu': 'BottomCopper', 'F.Mask': 'TopMask', 'B.Mask': 'BottomMask',
  'F.Paste': 'TopPaste', 'B.Paste': 'BottomPaste', 'F.Fab': 'TopFab', 'B.Fab': 'BottomFab',
};
export const OUTLINE_LAYER = 'BoardOutline', DRILL_PTH = 'Drill_PTH', DRILL_NPTH = 'Drill_NPTH';
// AutoCAD Color Index per layer (cosmetic; importers map by layer NAME)
export const DXF_ACI = {
  BoardOutline: 2, Drill_PTH: 7, Drill_NPTH: 8,
  TopCopper: 1, BottomCopper: 5, TopMask: 6, BottomMask: 4, TopSilk: 7, BottomSilk: 30,
  TopPaste: 8, BottomPaste: 9, TopFab: 3, BottomFab: 130,
};

const N = n => fmt(n, 4);
const H = n => n.toString(16).toUpperCase();

// ---------- low-level writer ----------
class Dxf {
  constructor() { this.lines = []; this.handle = 0x100; }
  g(code, val) { this.lines.push(String(code).padStart(3, ' '), String(val)); return this; }
  next() { return H(this.handle++); }
  text() { return this.lines.join('\r\n') + '\r\n'; }
}
function entityHead(d, type, layer, extra) {
  d.g(0, type).g(5, d.next()).g(330, '1F').g(100, 'AcDbEntity').g(8, layer);
  if (extra) extra();
}
function lwpolyline(d, layer, pts, closed, width = 0) {
  if (!pts || pts.length < 2) return;
  entityHead(d, 'LWPOLYLINE', layer);
  d.g(100, 'AcDbPolyline').g(90, pts.length).g(70, closed ? 1 : 0);
  if (width > 0) d.g(43, N(width));
  for (const [x, y] of pts) d.g(10, N(x)).g(20, N(y));
}
function line(d, layer, x1, y1, x2, y2) {
  entityHead(d, 'LINE', layer);
  d.g(100, 'AcDbLine').g(10, N(x1)).g(20, N(y1)).g(30, 0).g(11, N(x2)).g(21, N(y2)).g(31, 0);
}
function circle(d, layer, cx, cy, r) {
  entityHead(d, 'CIRCLE', layer);
  d.g(100, 'AcDbCircle').g(10, N(cx)).g(20, N(cy)).g(30, 0).g(40, N(r));
}
function arc(d, layer, cx, cy, r, a0, a1) {
  entityHead(d, 'ARC', layer);
  d.g(100, 'AcDbCircle').g(10, N(cx)).g(20, N(cy)).g(30, 0).g(40, N(r)).g(100, 'AcDbArc').g(50, N(a0)).g(51, N(a1));
}
function textEnt(d, layer, x, y, height, str, rot, mirror, align, valign) {
  const halign = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  const va = valign === 'middle' ? 2 : 0;
  entityHead(d, 'TEXT', layer);
  d.g(100, 'AcDbText').g(10, N(x)).g(20, N(y)).g(30, 0).g(40, N(height)).g(1, str);
  if (rot) d.g(50, N(rot));
  if (mirror) d.g(71, 2);
  d.g(72, halign);
  if (halign || va) d.g(11, N(x)).g(21, N(y)).g(31, 0);
  d.g(100, 'AcDbText');
  if (va) d.g(73, va);
}

// ---------- sections ----------
function header(d, ext, handseed) {
  d.g(0, 'SECTION').g(2, 'HEADER');
  d.g(9, '$ACADVER').g(1, 'AC1015');
  d.g(9, '$HANDSEED').g(5, handseed);
  d.g(9, '$INSUNITS').g(70, 4);
  d.g(9, '$MEASUREMENT').g(70, 1);
  d.g(9, '$EXTMIN').g(10, N(ext[0])).g(20, N(ext[1])).g(30, 0);
  d.g(9, '$EXTMAX').g(10, N(ext[2])).g(20, N(ext[3])).g(30, 0);
  d.g(0, 'ENDSEC');
}
function tables(d, layerNames, ext) {
  d.g(0, 'SECTION').g(2, 'TABLES');
  // VPORT
  const cx = (ext[0] + ext[2]) / 2, cy = (ext[1] + ext[3]) / 2, vh = Math.max(ext[3] - ext[1], 1) * 1.2, ar = Math.max(ext[2] - ext[0], 1) / Math.max(ext[3] - ext[1], 1);
  d.g(0, 'TABLE').g(2, 'VPORT').g(5, '8').g(330, '0').g(100, 'AcDbSymbolTable').g(70, 1);
  d.g(0, 'VPORT').g(5, '2E').g(330, '8').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbViewportTableRecord').g(2, '*Active').g(70, 0)
    .g(10, 0).g(20, 0).g(11, 1).g(21, 1).g(12, N(cx)).g(22, N(cy)).g(13, 0).g(23, 0).g(14, 10).g(24, 10).g(15, 10).g(25, 10)
    .g(16, 0).g(26, 0).g(36, 1).g(17, 0).g(27, 0).g(37, 0).g(40, N(vh)).g(41, N(ar)).g(42, 50).g(43, 0).g(44, 0).g(50, 0).g(51, 0)
    .g(71, 0).g(72, 100).g(73, 1).g(74, 3).g(75, 0).g(76, 0).g(77, 0).g(78, 0);
  d.g(0, 'ENDTAB');
  // LTYPE
  d.g(0, 'TABLE').g(2, 'LTYPE').g(5, '5').g(330, '0').g(100, 'AcDbSymbolTable').g(70, 3);
  for (const [h, name, desc] of [['14', 'ByBlock', ''], ['15', 'ByLayer', ''], ['16', 'Continuous', 'Solid line']])
    d.g(0, 'LTYPE').g(5, h).g(330, '5').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbLinetypeTableRecord').g(2, name).g(70, 0).g(3, desc).g(72, 65).g(73, 0).g(40, 0);
  d.g(0, 'ENDTAB');
  // LAYER
  d.g(0, 'TABLE').g(2, 'LAYER').g(5, '2').g(330, '0').g(100, 'AcDbSymbolTable').g(70, layerNames.length + 1);
  d.g(0, 'LAYER').g(5, '10').g(330, '2').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbLayerTableRecord').g(2, '0').g(70, 0).g(62, 7).g(6, 'Continuous').g(370, -3);
  for (const name of layerNames) {
    const base = name.replace(/_TEXT$/, '');
    d.g(0, 'LAYER').g(5, d.next()).g(330, '2').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbLayerTableRecord').g(2, name).g(70, 0).g(62, DXF_ACI[base] || 7).g(6, 'Continuous').g(370, -3);
  }
  d.g(0, 'ENDTAB');
  // STYLE
  d.g(0, 'TABLE').g(2, 'STYLE').g(5, '3').g(330, '0').g(100, 'AcDbSymbolTable').g(70, 1);
  d.g(0, 'STYLE').g(5, '11').g(330, '3').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbTextStyleTableRecord').g(2, 'Standard').g(70, 0).g(40, 0).g(41, 1).g(50, 0).g(71, 0).g(42, 2.5).g(3, 'txt').g(4, '');
  d.g(0, 'ENDTAB');
  // VIEW, UCS (empty)
  d.g(0, 'TABLE').g(2, 'VIEW').g(5, '6').g(330, '0').g(100, 'AcDbSymbolTable').g(70, 0).g(0, 'ENDTAB');
  d.g(0, 'TABLE').g(2, 'UCS').g(5, '7').g(330, '0').g(100, 'AcDbSymbolTable').g(70, 0).g(0, 'ENDTAB');
  // APPID
  d.g(0, 'TABLE').g(2, 'APPID').g(5, '9').g(330, '0').g(100, 'AcDbSymbolTable').g(70, 1);
  d.g(0, 'APPID').g(5, '12').g(330, '9').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbRegAppTableRecord').g(2, 'ACAD').g(70, 0);
  d.g(0, 'ENDTAB');
  // DIMSTYLE
  d.g(0, 'TABLE').g(2, 'DIMSTYLE').g(5, 'A').g(330, '0').g(100, 'AcDbSymbolTable').g(70, 0).g(100, 'AcDbDimStyleTable').g(71, 0).g(0, 'ENDTAB');
  // BLOCK_RECORD
  d.g(0, 'TABLE').g(2, 'BLOCK_RECORD').g(5, '1').g(330, '0').g(100, 'AcDbSymbolTable').g(70, 2);
  d.g(0, 'BLOCK_RECORD').g(5, '1F').g(330, '1').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbBlockTableRecord').g(2, '*Model_Space');
  d.g(0, 'BLOCK_RECORD').g(5, '1B').g(330, '1').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbBlockTableRecord').g(2, '*Paper_Space');
  d.g(0, 'ENDTAB');
  d.g(0, 'ENDSEC');
}
function blocks(d) {
  d.g(0, 'SECTION').g(2, 'BLOCKS');
  d.g(0, 'BLOCK').g(5, '20').g(330, '1F').g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockBegin').g(2, '*Model_Space').g(70, 0).g(10, 0).g(20, 0).g(30, 0).g(3, '*Model_Space').g(1, '');
  d.g(0, 'ENDBLK').g(5, '21').g(330, '1F').g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockEnd');
  d.g(0, 'BLOCK').g(5, '1C').g(330, '1B').g(100, 'AcDbEntity').g(67, 1).g(8, '0').g(100, 'AcDbBlockBegin').g(2, '*Paper_Space').g(70, 0).g(10, 0).g(20, 0).g(30, 0).g(3, '*Paper_Space').g(1, '');
  d.g(0, 'ENDBLK').g(5, '1D').g(330, '1B').g(100, 'AcDbEntity').g(67, 1).g(8, '0').g(100, 'AcDbBlockEnd');
  d.g(0, 'ENDSEC');
}
function objects(d) {
  d.g(0, 'SECTION').g(2, 'OBJECTS');
  d.g(0, 'DICTIONARY').g(5, 'C').g(330, '0').g(100, 'AcDbDictionary').g(281, 1).g(3, 'ACAD_GROUP').g(350, 'D');
  d.g(0, 'DICTIONARY').g(5, 'D').g(330, 'C').g(100, 'AcDbDictionary').g(281, 1);
  d.g(0, 'ENDSEC');
}

// ---------- entities from resolved geometry ----------
function emitPrim(d, layer, p) {
  switch (p.t) {
    case 'line': line(d, layer, p.x1, p.y1, p.x2, p.y2); break;
    case 'polyline':
      if (p.pts && p.pts.length === 1) circle(d, layer, p.pts[0][0], p.pts[0][1], Math.max(p.w || 0.01, 0.01) / 2);
      else lwpolyline(d, layer, p.pts, !!p.closed, p.w || 0);
      break;
    case 'arc': {
      let sweep = p.a1 - p.a0; while (sweep < 0) sweep += 360;
      if (sweep >= 360 || Math.abs(sweep) < 1e-9) circle(d, layer, p.cx, p.cy, p.r); // full turn
      else arc(d, layer, p.cx, p.cy, p.r, ((p.a0 % 360) + 360) % 360, ((p.a1 % 360) + 360) % 360);
      break;
    }
    case 'circle': circle(d, layer, p.cx, p.cy, p.r); break;           // filled disc or ring: boundary circle only
    case 'poly':
      lwpolyline(d, layer, p.pts, true, 0);
      for (const h of p.holes || []) lwpolyline(d, layer, h, true, 0);
      break;
    default: break; // text / image handled elsewhere
  }
}
function emitText(d, layer, p) {
  const lines = String(p.text ?? '').split('\n');
  const lineH = p.size * 1.6;
  lines.forEach((str, li) => {
    if (!str.trim()) return;
    // same per-line offset rule as geom.textPrimsToPolylines
    const oy = -li * lineH - (p.valign === 'middle' ? -p.size / 2 + (lines.length - 1) * lineH / 2 : 0);
    const a = (p.rot || 0) * Math.PI / 180;
    const x = p.x - oy * Math.sin(a), y = p.y + oy * Math.cos(a);
    // DXF valign 'middle' (73=2) centres on the alignment point; our 'middle' offsets baseline by -size/2, so pass baseline (73=0) with the shifted point.
    textEnt(d, layer, x, y, p.size, str.replace(/[\r\n]/g, ' '), p.rot || 0, !!p.mirror, p.align || 'left', 'baseline');
  });
}

export function boardToDxf(board, doc, opts = {}) {
  const res = resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: opts.bitmapFor });
  const resT = resolveBoard(board, doc, { textAsStrokes: false, imagesAsPolys: false });
  const [W, Hh] = res.size;
  let ext = [0, 0, W, Hh];
  for (const l of GRAPHIC_LAYERS) for (const p of res.layers[l] || []) { const b = primBBox(p); if (b) ext = unionBBox(ext, b); }
  // entities first (to learn the handle range), then assemble
  const ents = new Dxf(); ents.handle = 0x100;
  const layerNames = [OUTLINE_LAYER, DRILL_PTH, DRILL_NPTH];
  ents.g(0, 'SECTION').g(2, 'ENTITIES');
  lwpolyline(ents, OUTLINE_LAYER, res.outline, true);
  for (const c of res.cutouts) lwpolyline(ents, OUTLINE_LAYER, c, true);
  for (const dr of res.drills) {
    const layer = dr.plated ? DRILL_PTH : DRILL_NPTH;
    if (dr.slotLen > 0) lwpolyline(ents, layer, ovalPoints(dr.x, dr.y, dr.slotLen, dr.d, dr.rot || 0), true);
    else circle(ents, layer, dr.x, dr.y, dr.d / 2);
  }
  for (const l of GRAPHIC_LAYERS) {
    const prims = res.layers[l] || []; if (!prims.length) continue;
    const name = DXF_LAYERS[l]; layerNames.push(name);
    for (const p of prims) emitPrim(ents, name, p);
  }
  for (const l of GRAPHIC_LAYERS) {
    const texts = (resT.layers[l] || []).filter(p => p.t === 'text' && String(p.text ?? '').trim());
    if (!texts.length) continue;
    const name = DXF_LAYERS[l] + '_TEXT'; layerNames.push(name);
    for (const p of texts) emitText(ents, name, p);
  }
  ents.g(0, 'ENDSEC');
  const d = new Dxf(); d.handle = ents.handle;          // layer records take handles after the entities
  const layerTable = new Dxf(); layerTable.handle = ents.handle;
  tables(layerTable, layerNames, ext);
  header(d, ext, H(layerTable.handle + 16));
  d.g(0, 'SECTION').g(2, 'CLASSES').g(0, 'ENDSEC');
  d.lines.push(...layerTable.lines);
  blocks(d);
  d.lines.push(...ents.lines);
  objects(d);
  d.g(0, 'EOF');
  return d.text();
}

export const README = `LAMINA DXF export (AutoCAD 2000 / AC1015 ASCII, millimetres, Y up, origin = bottom-left of the board)
========================================================================================================

Files: one <board>.dxf per board. Everything is plain LWPOLYLINE / LINE / ARC / CIRCLE / TEXT — no splines,
no blocks, no hatches. Filled areas (pads, copper regions, filled polygons, images) are exported as their
closed BOUNDARY polylines (DXF has no reliable fill), so copper layers are best taken from the Gerber export.

Layers
  BoardOutline      board edge (one closed polyline) + internal cutouts (closed polylines)
  Drill_PTH         plated holes (CIRCLE, diameter = finished hole) and plated slots (closed stadium polylines)
  Drill_NPTH        non-plated holes / slots
  TopSilk BottomSilk TopCopper BottomCopper TopMask BottomMask TopPaste BottomPaste TopFab BottomFab
                    graphics; text is drawn as exact stroke polylines here
  <Layer>_TEXT      the same text as editable native TEXT entities (height = cap height in mm).
                    Ignore these layers if you only want geometry — they duplicate the stroke text.
Mask layers are OPENINGS (mask removed), like Gerber/KiCad.

DipTrace PCB Layout
  Preferred routes: File → Import → KiCAD board (.kicad_pcb from the LAMINA KiCad export) or
  File → Import → Gerber / N/C Drill (LAMINA gerber export) — those carry pads, nets and drills.
  DXF is mainly for the outline and graphics:
  File → Import → DXF → pick the file → Units: mm → for each DXF layer choose the DipTrace layer:
    BoardOutline → "Board Outline"    Drill_PTH / Drill_NPTH → "Holes"
    TopSilk → Top Silk    BottomSilk → Bottom Silk    TopCopper → Top    BottomCopper → Bottom
    TopMask → Top Mask    BottomMask → Bottom Mask     TopPaste → Top Paste   ...
    *_TEXT layers → leave unmapped (DipTrace does not import TEXT anyway).
  Tick "Fill closed areas" if you want polygons filled.

KiCad (pcbnew)
  File → Import → Graphics… → choose the .dxf, units mm, pick a target layer per import
  (import BoardOutline onto Edge.Cuts, TopSilk onto F.Silkscreen, etc.). KiCad reads TEXT entities.

Inkscape
  File → Open → .dxf (built-in DXF input; choose "manual scale" 1.0 and mm). Y is already up.

FlatCAM / CNC
  File → Open DXF → the outline can be used as a cutout job, Drill_* circles as excellon-like drills.
`;

export function exportDxf(doc, opts = {}) {
  const files = [];
  const idxs = opts.boards || doc.boards.map((_, i) => i);
  for (const i of idxs) {
    const board = doc.boards[i]; if (!board) continue;
    files.push({ name: `dxf/${safeName(board.name)}.dxf`, data: boardToDxf(board, doc, opts) });
  }
  files.push({ name: 'dxf/README-dxf.txt', data: README });
  return files;
}
