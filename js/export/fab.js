// LAMINA fabrication bundle: gerbers + Excellon drills + README-fab.txt (+ optional gcode/).
// Plain ES module, no DOM. Everything under gerber/<board>/ is what you zip and upload to JLCPCB
// (one zip per board).
import { resolveBoard, outlineSize } from '../geom.js';
import { fmt, safeName } from './common.js';
import { gerberFilesForBoard, GERBER_LAYERS, OUTLINE_LAYER, GERBER_VERSION } from './gerber.js';
import { excellonFilesForBoard } from './excellon.js';
import { exportGcode } from './gcode.js';

const COLOR_NAMES = { green: 'Green', red: 'Red', blue: 'Blue', black: 'Black', white: 'White', yellow: 'Yellow', purple: 'Purple' };
const FINISH_NAMES = { HASL: 'HASL (with lead)', LeadFreeHASL: 'LeadFree HASL', ENIG: 'ENIG' };

function boardOptions(board) {
  const [W, H] = outlineSize(board.outline);
  return {
    name: board.name, W, H,
    layers: 2,
    thickness: board.thickness ?? 1.6,
    color: COLOR_NAMES[board.color] || board.color || 'Green',
    silk: board.silkColor || 'white',
    finish: FINISH_NAMES[board.finish] || board.finish || 'HASL (with lead)',
    copperOz: board.copperOz ?? 1,
    quantity: 5,
  };
}

// Small text with the options JLCPCB will ask for (for the UI).
export function jlcOrderSummary(doc, opts = {}) {
  const idxs = opts.boards || doc.boards.map((_, i) => i);
  const L = [`JLCPCB order summary - ${doc.name || 'untitled'}`];
  for (const i of idxs) {
    const b = doc.boards[i]; if (!b) continue;
    const o = boardOptions(b);
    L.push('');
    L.push(`Board "${o.name}"  (upload gerber/${safeName(b.name)}/ zipped)`);
    L.push(`  Size:            ${fmt(o.W, 2)} x ${fmt(o.H, 2)} mm`);
    L.push(`  Layers:          ${o.layers}`);
    L.push(`  Thickness:       ${fmt(o.thickness, 2)} mm`);
    L.push(`  Solder mask:     ${o.color}   (silkscreen ${o.silk}${o.color.toLowerCase() === 'white' && o.silk === 'white' ? ' - NOTE: JLC forces black silk on white mask' : ''})`);
    L.push(`  Surface finish:  ${o.finish}`);
    L.push(`  Copper weight:   ${fmt(o.copperOz, 1)} oz`);
    L.push(`  Quantity:        ${o.quantity}`);
    L.push('  Material: FR-4, dielectric TG130-140 (default), via covering: tented (default), remove order number: your choice');
  }
  return L.join('\n') + '\n';
}

function fabReadme(doc, perBoard, opts) {
  const L = [];
  L.push(`LAMINA ${GERBER_VERSION} fabrication bundle - "${doc.name || 'untitled'}"`);
  L.push(`Generated ${new Date().toISOString()}`);
  L.push('');
  L.push('Coordinates: mm, Y up, origin = each board\'s bottom-left corner; bottom layers are drawn as seen from the top');
  L.push('(standard Gerber convention - the fab flips them). Gerber: RS-274X, 4.6 absolute. Drills: Excellon, decimal mm.');
  L.push('');
  for (const pb of perBoard) {
    const o = pb.opts;
    L.push(`=== Board "${o.name}"  ${fmt(o.W, 2)} x ${fmt(o.H, 2)} mm, ${fmt(o.thickness, 2)} mm, ${o.color} mask / ${o.silk} silk, ${o.finish}, ${fmt(o.copperOz, 1)} oz ===`);
    L.push(`Folder: gerber/${pb.stem}/   -> zip THIS folder's files (flat, no subfolder needed) and upload it as one JLCPCB order.`);
    L.push('Files:');
    for (const f of pb.files) L.push(`  ${f.name.split('/').pop().padEnd(22)} ${f.desc}`);
    L.push('JLCPCB order options: 2 layers, ' + `${fmt(o.thickness, 2)} mm, ${o.color}, ${o.finish}, ${fmt(o.copperOz, 1)} oz outer copper, qty ${o.quantity} (minimum).`);
    L.push('');
  }
  L.push('NOTES');
  L.push('  * The board outline (profile + internal cutouts) is in the .GKO file (Protel "keep-out" name that JLCPCB and FlatCAM');
  L.push('    auto-detect as the board outline). If a viewer asks, it is also acceptable to rename it .GM1.');
  L.push('  * Plated (PTH) and non-plated (NPTH) drills are SEPARATE files (<board>-PTH.DRL / <board>-NPTH.DRL); JLCPCB accepts');
  L.push('    both in the same zip and reads slots (G85) from them. Do not merge them.');
  L.push('  * Solder mask files (.GTS/.GBS) contain the OPENINGS (mask removed), the usual Gerber convention.');
  L.push('  * Silkscreen text/images are stroked vector geometry (Hershey font) - readable down to ~1 mm cap height at 0.15 mm stroke.');
  L.push('  * JLCPCB adds an order number on the silk unless you pick "Remove Order Number" (paid) or "Specify a location" and put');
  L.push('    the text JLCJLCJLCJLC on the silk yourself.');
  if (opts.gcode) L.push('  * gcode/ holds GRBL toolpaths for a hobby CNC (drill / outline / silk engraving). See gcode/README-cnc.txt.');
  L.push('  * Two-board stacks: order each board separately (they can differ in colour/thickness); standoff holes match at the same XY.');
  L.push('');
  L.push(jlcOrderSummary(doc, opts));
  return L.join('\n');
}

const LAYER_DESC = {
  'F.Cu': 'top copper', 'B.Cu': 'bottom copper', 'F.Mask': 'top solder mask (openings)', 'B.Mask': 'bottom solder mask (openings)',
  'F.Silk': 'top silkscreen', 'B.Silk': 'bottom silkscreen', 'F.Paste': 'top paste (stencil)', 'B.Paste': 'bottom paste (stencil)',
  'F.Fab': 'top fab drawing (not for the fab house)', 'B.Fab': 'bottom fab drawing (not for the fab house)',
  'Edge.Cuts': 'board outline + cutouts (profile)',
};

// opts: { boards, bitmapFor, gcode:false, includeFab:false, ...gcode opts }
export function exportFabBundle(doc, opts = {}) {
  const idxs = opts.boards || doc.boards.map((_, i) => i);
  const out = [];
  const perBoard = [];
  for (const i of idxs) {
    const board = doc.boards[i]; if (!board) continue;
    const res = resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: opts.bitmapFor });
    const files = [];
    for (const f of gerberFilesForBoard(doc, board, res, opts)) files.push({ name: f.name, data: f.data, desc: LAYER_DESC[f.layer] || f.layer });
    for (const f of excellonFilesForBoard(doc, board, res, opts)) files.push({ name: f.name, data: f.data, desc: f.kind === 'PTH' ? `plated drills (${f.count} hits: pads + vias)` : `non-plated drills (${f.count} hits: holes, slots)` });
    perBoard.push({ stem: safeName(board.name), opts: boardOptions(board), files });
    for (const f of files) out.push({ name: f.name, data: f.data });
  }
  out.push({ name: 'README-fab.txt', data: fabReadme(doc, perBoard, opts) });
  if (opts.gcode) for (const f of exportGcode(doc, { ...opts, dir: 'gcode' })) out.push(f);
  return out;
}
