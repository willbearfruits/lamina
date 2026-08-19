// BOM (JLC columns), pick-and-place (JLC CPL), hardware/standoff list, per-board part list.
import { resolveBoard } from '../geom.js';
import { getFootprint } from '../library.js';
import { safeName, fmt } from './common.js';

function csvCell(s) { s = String(s ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
export function csv(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

export function bomRows(doc, bi) {
  const board = doc.boards[bi]; const R = resolveBoard(board, doc);
  const groups = new Map();
  for (const p of R.parts) {
    if (p.fp && p.fp.cat === 'Mechanical' && !p.fp.pads?.length && !p.fromLink) { /* mounting holes: list separately */ }
    const key = [p.value || '', p.name || p.lib, p.fp?.meta?.lcsc || ''].join('|');
    if (!groups.has(key)) groups.set(key, { comment: p.value || '', footprint: p.name || p.lib, lcsc: p.fp?.meta?.lcsc || '', refs: [], mpn: p.fp?.meta?.mpn || '', verify: !!p.fp?.verify });
    groups.get(key).refs.push(p.ref);
  }
  return Array.from(groups.values()).map(g => ({ ...g, refs: g.refs.sort(natural) }));
}
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
export function exportBOM(doc, opts = {}) {
  const files = [];
  for (const bi of (opts.boards || doc.boards.map((_, i) => i))) {
    const b = doc.boards[bi]; const stem = safeName(b.name);
    const rows = [['Comment', 'Designator', 'Footprint', 'JLCPCB Part #', 'MPN', 'Qty', 'Notes']];
    for (const g of bomRows(doc, bi)) rows.push([g.comment, g.refs.join(','), g.footprint, g.lcsc, g.mpn, g.refs.length, g.verify ? 'verify footprint vs datasheet' : '']);
    files.push({ name: `bom/${stem}-BOM.csv`, data: csv(rows) });
    // CPL — JLC: Designator, Mid X, Mid Y, Layer, Rotation (mm, top-view coords; origin = board bottom-left)
    const R = resolveBoard(b, doc);
    const cpl = [['Designator', 'Mid X', 'Mid Y', 'Layer', 'Rotation']];
    for (const p of R.parts) { if (!p.fp?.pads?.length) continue; cpl.push([p.ref, fmt(p.x, 3) + 'mm', fmt(p.y, 3) + 'mm', p.side === 'bottom' ? 'B' : 'T', fmt(((p.rot % 360) + 360) % 360, 1)]); }
    files.push({ name: `bom/${stem}-CPL.csv`, data: csv(cpl) });
  }
  files.push({ name: 'bom/hardware.txt', data: hardwareList(doc) });
  files.push({ name: 'bom/README-bom.txt', data: 'BOM = JLCPCB assembly BOM columns (Comment, Designator, Footprint, JLCPCB Part #). Fill the JLCPCB Part # column with LCSC codes (C12345) for parts you want assembled.\nCPL = JLCPCB pick-and-place (Mid X/Y in mm from the board\'s bottom-left corner, Layer T/B, Rotation deg CCW). If your Gerber origin differs, JLC re-aligns visually anyway.\nhardware.txt = standoffs / screws / connectors for the two-board stack.\n' });
  return files;
}
export function hardwareList(doc) {
  const st = doc.stack; const lines = [`LAMINA hardware list — ${doc.name}`, ''];
  if (!st.enabled) { lines.push('Single board — no stack hardware.'); }
  else {
    lines.push(`Board-to-board gap (facing surfaces): ${st.gap} mm`);
    const standoffs = (st.links || []).filter(l => l.kind === 'standoff' || l.kind === 'screw');
    const byLib = new Map(); for (const l of standoffs) byLib.set(l.lib, (byLib.get(l.lib) || 0) + 1);
    for (const [lib, n] of byLib) { const fp = getFootprint(lib) || {}; const thread = fp.meta?.thread || lib; const std = fp.meta?.lengths || []; const ok = std.includes(st.gap); lines.push(`${n} × ${thread} standoff, length ${st.gap} mm${ok ? '' : ' (NOT a stock length — nearest ' + nearest(std, st.gap) + ' mm; use washers/shims or change the gap)'}, hex ${fp.hexAF || '?'} AF`); lines.push(`${n * 2} × ${thread} screws (${n} per board; ~ 6 mm long for 1.6 mm boards)`); }
    const conns = (st.links || []).filter(l => l.kind === 'connector');
    for (const l of conns) { const fp = getFootprint(l.lib) || {}; const pr = fp.pair || {}; lines.push(`1 × ${fp.name || l.lib}: lower board gets ${l.opts?.flip ? pr.upper : pr.lower}, upper board gets ${l.opts?.flip ? pr.lower : pr.upper} (nominal gap ${pr.nominalGap} mm, ok ${pr.minGap}–${pr.maxGap} mm)`); }
    const lower = doc.boards[0]; const thr = lower.items.filter(i => i.type === 'part' && i.through);
    if (thr.length) { lines.push('', 'Parts passing through the upper board (holes auto-added):'); for (const p of thr) { const fp = getFootprint(p.lib) || {}; lines.push(`  ${p.ref} ${fp.name || p.lib}: hole Ø${fp.through?.d ?? '?'} mm${fp.panelDist != null ? `, ideal gap ${fp.panelDist} mm` : ''}${fp.bushingLen != null ? `, bushing ${fp.bushingLen} mm` : ''}`); } }
  }
  lines.push('', 'Mounting holes / feet: see each board\'s BOM.');
  return lines.join('\n') + '\n';
}
function nearest(arr, v) { return arr.length ? arr.reduce((b, a) => Math.abs(a - v) < Math.abs(b - v) ? a : b, arr[0]) : v; }
