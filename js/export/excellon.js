// LAMINA → Excellon drill files (KiCad decimal style, which JLCPCB & FlatCAM parse reliably).
// Two files per board when applicable, next to the gerbers:
//   gerber/<stem>/<stem>-PTH.DRL   plated: pad drills + vias (+ plated slots as G85 routes)
//   gerber/<stem>/<stem>-NPTH.DRL  non-plated: holes, NPTH slots (G85), unplated pad drills
// Units mm, absolute, decimal coordinates with 3 decimals (always a decimal point → no LZ/TZ ambiguity),
// Y up, origin = board bottom-left (same frame as the gerbers).
import { resolveBoard } from '../geom.js';
import { fmt, safeName } from './common.js';

export const EXCELLON_VERSION = '0.1';
const D2R = Math.PI / 180;

const num = v => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3); // fixed 3 decimals, no "-0.000"
export const drillCoord = num;
const toolDia = d => Math.round(d * 100) / 100; // 0.01 mm resolution, equal tools merge

// slot centre endpoints: centre ± (slotLen − d)/2 along rot (slotLen = overall stadium length, d = width)
export function slotEnds(dr) {
  const half = Math.max(0, ((dr.slotLen || 0) - dr.d) / 2);
  const a = (dr.rot || 0) * D2R, dx = Math.cos(a) * half, dy = Math.sin(a) * half;
  return [[dr.x - dx, dr.y - dy], [dr.x + dx, dr.y + dy]];
}
export function isSlot(dr) { return (dr.slotLen || 0) > dr.d + 1e-6; }

// group drills by rounded tool diameter, sorted ascending → [{d, hits:[drill...]}]
export function toolTable(drills) {
  const m = new Map();
  for (const dr of drills) {
    const d = toolDia(dr.d); if (!(d > 0)) continue;
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(dr);
  }
  return Array.from(m.entries()).sort((a, b) => a[0] - b[0]).map(([d, hits]) => ({ d, hits }));
}

function drillFunction(dr, plated) {
  if (!plated) return isSlot(dr) ? 'NonPlated,NPTH,Slot' : 'NonPlated,NPTH,ComponentDrill';
  if (dr.via) return 'Plated,PTH,ViaDrill';
  return isSlot(dr) ? 'Plated,PTH,Slot' : 'Plated,PTH,ComponentDrill';
}

// Write one Excellon file. kind = 'PTH' | 'NPTH'. Returns the text (or null when there are no drills).
export function excellonText(doc, board, drills, kind, res) {
  const plated = kind === 'PTH';
  const tools = toolTable(drills);
  if (!tools.length) return null;
  const L = [];
  L.push('M48');
  L.push(`; DRILL file {LAMINA ${EXCELLON_VERSION}} date ${new Date().toISOString()}`);
  L.push('; FORMAT={-:-/ absolute / metric / decimal}');
  L.push(`; ${doc.name || 'untitled'} / ${board.name} ${res ? `(${fmt(res.size[0], 3)} x ${fmt(res.size[1], 3)} mm)` : ''} - ${plated ? 'plated' : 'non-plated'} holes`);
  L.push('; Coordinates: mm, absolute, decimal (3 places), Y up, origin = board bottom-left corner');
  L.push(`; #@! TF.CreationDate,${new Date().toISOString()}`);
  L.push(`; #@! TF.GenerationSoftware,LAMINA,lamina,${EXCELLON_VERSION}`);
  L.push(`; #@! TF.FileFunction,${plated ? 'Plated,1,2,PTH' : 'NonPlated,1,2,NPTH'}`);
  L.push('FMAT,2');
  L.push('METRIC');
  tools.forEach((t, i) => {
    // one AperFunction per tool: use the function of the first hit (mixed use is rare, all plated anyway)
    L.push(`; #@! TA.AperFunction,${drillFunction(t.hits[0], plated)}`);
    L.push(`T${i + 1}C${num(t.d)}`);
  });
  L.push('%');
  L.push('G90');
  L.push('G05');
  tools.forEach((t, i) => {
    L.push(`T${i + 1}`);
    for (const dr of t.hits) {
      if (isSlot(dr)) {
        const [[ax, ay], [bx, by]] = slotEnds(dr);
        L.push(`X${num(ax)}Y${num(ay)}G85X${num(bx)}Y${num(by)}`);
      } else {
        L.push(`X${num(dr.x)}Y${num(dr.y)}`);
      }
    }
  });
  L.push('T0');
  L.push('M30');
  return L.join('\n') + '\n';
}

export function excellonFilesForBoard(doc, board, res, opts = {}) {
  const stem = safeName(board.name);
  const dir = (opts.dir === undefined ? 'gerber' : opts.dir);
  const prefix = dir ? `${dir}/${stem}/` : '';
  const files = [];
  const pth = res.drills.filter(d => d.plated !== false);
  const npth = res.drills.filter(d => d.plated === false);
  const a = excellonText(doc, board, pth, 'PTH', res);
  if (a) files.push({ name: `${prefix}${stem}-PTH.DRL`, data: a, kind: 'PTH', count: pth.length });
  const b = excellonText(doc, board, npth, 'NPTH', res);
  if (b) files.push({ name: `${prefix}${stem}-NPTH.DRL`, data: b, kind: 'NPTH', count: npth.length });
  return files;
}

// opts: { boards:[idx...], bitmapFor, dir:'gerber' }
export function exportExcellon(doc, opts = {}) {
  const idxs = opts.boards || doc.boards.map((_, i) => i);
  const out = [];
  for (const i of idxs) {
    const board = doc.boards[i]; if (!board) continue;
    const res = resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: opts.bitmapFor });
    for (const f of excellonFilesForBoard(doc, board, res, opts)) out.push({ name: f.name, data: f.data });
  }
  return out;
}
