// node test/excellon.test.mjs
import assert from 'node:assert/strict';
import { twoBoardDoc, oneBoardDoc, fakeBitmapFor } from './fixtures.mjs';
import { exportExcellon, slotEnds, isSlot, toolTable, excellonText } from '../js/export/excellon.js';
import { resolveBoard } from '../js/geom.js';
import { newDocument, makeItem } from '../js/model.js';
import { safeName } from '../js/export/common.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };

// tiny Excellon parser (KiCad decimal style)
export function parseExcellon(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const st = { tools: new Map(), hits: [], slots: [], header: true, ok: true, metric: false, fmat2: false };
  let cur = null;
  eq(lines[0], 'M48', 'starts with M48');
  for (const l of lines) {
    let m;
    if (l.startsWith(';')) continue;
    if (l === 'M48') continue;
    if (l === 'FMAT,2') { st.fmat2 = true; continue; }
    if (l === 'METRIC' || l === 'METRIC,TZ' || l === 'METRIC,LZ') { st.metric = true; continue; }
    if ((m = /^T(\d+)C(\d+\.\d+)$/.exec(l))) { assert.ok(st.header, 'tool defs in header'); st.tools.set(+m[1], +m[2]); continue; }
    if (l === '%') { st.header = false; continue; }
    if (l === 'G90' || l === 'G05') { assert.ok(!st.header, 'G90/G05 after %'); continue; }
    if ((m = /^T(\d+)$/.exec(l))) { cur = +m[1]; if (cur !== 0) assert.ok(st.tools.has(cur), 'tool selected exists T' + cur); continue; }
    if ((m = /^X(-?\d+\.\d{3})Y(-?\d+\.\d{3})G85X(-?\d+\.\d{3})Y(-?\d+\.\d{3})$/.exec(l))) { assert.ok(cur, 'slot with tool'); st.slots.push({ t: cur, ax: +m[1], ay: +m[2], bx: +m[3], by: +m[4], d: st.tools.get(cur) }); continue; }
    if ((m = /^X(-?\d+\.\d{3})Y(-?\d+\.\d{3})$/.exec(l))) { assert.ok(cur, 'hit with tool'); st.hits.push({ t: cur, x: +m[1], y: +m[2], d: st.tools.get(cur) }); continue; }
    if (l === 'M30') continue;
    assert.fail('unparsed excellon line: ' + l);
  }
  eq(lines[lines.length - 1], 'M30', 'ends with M30');
  eq(lines[lines.length - 2], 'T0', 'T0 before M30');
  return st;
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---------- two-board doc ----------
const doc2 = twoBoardDoc();
const files2 = exportExcellon(doc2, { bitmapFor: fakeBitmapFor });
for (const b of doc2.boards) {
  const stem = safeName(b.name);
  const res = resolveBoard(b, doc2, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
  const pth = res.drills.filter(d => d.plated !== false), npth = res.drills.filter(d => d.plated === false);
  const fP = files2.find(f => f.name === `gerber/${stem}/${stem}-PTH.DRL`);
  const fN = files2.find(f => f.name === `gerber/${stem}/${stem}-NPTH.DRL`);
  ok(fP && fN, `${stem}: both PTH and NPTH files`);
  for (const [f, drills, kind] of [[fP, pth, 'PTH'], [fN, npth, 'NPTH']]) {
    const t = f.data;
    ok(t.includes('; FORMAT={-:-/ absolute / metric / decimal}'), `${f.name} KiCad-style FORMAT comment`);
    ok(t.includes(`; #@! TF.FileFunction,${kind === 'PTH' ? 'Plated,1,2,PTH' : 'NonPlated,1,2,NPTH'}`), `${f.name} FileFunction`);
    ok(/\nFMAT,2\nMETRIC\n/.test(t), `${f.name} FMAT,2 + METRIC`);
    ok(/\n%\nG90\nG05\n/.test(t), `${f.name} % G90 G05`);
    const p = parseExcellon(t);
    ok(p.tools.size > 0, `${f.name} tool count > 0`);
    eq(p.hits.length + p.slots.length, drills.length, `${f.name} hit count == resolved ${kind} drills (${drills.length})`);
    // tool table: diameters rounded to 0.01, unique, ascending, all used
    const dias = Array.from(p.tools.values());
    ok(dias.every(d => near(d, Math.round(d * 100) / 100)), 'tool diameters at 0.01 mm resolution');
    ok(new Set(dias).size === dias.length, 'tools merged (unique diameters)');
    ok(dias.every((d, i) => i === 0 || d > dias[i - 1]), 'tools ascending');
    const used = new Set([...p.hits, ...p.slots].map(h => h.t));
    ok(used.size === p.tools.size, 'every tool is used');
    // every hit corresponds to a resolved drill of that diameter at that position
    for (const h of p.hits) ok(drills.some(d => !isSlot(d) && near(d.x, h.x, 1e-3) && near(d.y, h.y, 1e-3) && near(Math.round(d.d * 100) / 100, h.d)), `hit ${h.x},${h.y} d${h.d} matches a resolved drill`);
    ok(p.hits.every(h => h.x >= -1 && h.x <= res.size[0] + 1 && h.y >= -1 && h.y <= res.size[1] + 1), 'hits inside the board');
  }
}
// MAIN NPTH: the fixture slot (15,15 len 8 w 2.2 rot 30) → one G85 with the right endpoints
{
  const t = files2.find(f => f.name === 'gerber/MAIN/MAIN-NPTH.DRL').data;
  const p = parseExcellon(t);
  eq(p.slots.length, 1, 'MAIN NPTH has exactly one slot (G85)');
  const s = p.slots[0];
  const half = (8 - 2.2) / 2, c = Math.cos(30 * Math.PI / 180) * half, sn = Math.sin(30 * Math.PI / 180) * half;
  ok(near(s.ax, 15 - c, 1e-3) && near(s.ay, 15 - sn, 1e-3) && near(s.bx, 15 + c, 1e-3) && near(s.by, 15 + sn, 1e-3), `slot endpoints centre ± (len-d)/2 along rot (${s.ax},${s.ay} → ${s.bx},${s.by})`);
  eq(s.d, 2.2, 'slot tool = slot width');
  ok(t.includes('T1C2.200') || /T\dC2\.200/.test(t), 'tool line T#C2.200 (3 decimals)');
  ok(t.includes('; #@! TA.AperFunction,NonPlated,NPTH,Slot'), 'slot tool has Slot AperFunction');
  // 6 mm hole + 4 standoff 3.2 holes present
  ok(p.hits.some(h => h.d === 6 && near(h.x, 90, 1e-3) && near(h.y, 50, 1e-3)), 'NPTH 6 mm hole at 90,50');
  eq(p.hits.filter(h => h.d === 3.2).length, 4, '4 standoff holes 3.2 mm');
}
// MAIN PTH: via 0.4 + DIP 0.8 + header 1.0 + oval P2 1.0 → tools 0.4/0.8/1.0
{
  const t = files2.find(f => f.name === 'gerber/MAIN/MAIN-PTH.DRL').data;
  const p = parseExcellon(t);
  const dias = Array.from(p.tools.values());
  ok(dias.includes(0.4) && dias.includes(0.8) && dias.includes(1), `PTH tools include 0.4/0.8/1.0 (${dias})`);
  ok(p.hits.some(h => h.d === 0.4 && near(h.x, 45, 1e-3) && near(h.y, 40, 1e-3)), 'via drill at 45,40');
  ok(t.includes('; #@! TA.AperFunction,Plated,PTH,ViaDrill'), 'via tool has ViaDrill AperFunction');
  ok(/^X\d+\.\d{3}Y\d+\.\d{3}$/m.test(t), 'coordinates have exactly 3 decimals with a decimal point');
  eq(p.slots.length, 0, 'no plated slots in fixture');
}
// PANEL: standoffs (NPTH) + connector pads (PTH), no slots
{
  const p = parseExcellon(files2.find(f => f.name === 'gerber/PANEL/PANEL-NPTH.DRL').data);
  eq(p.hits.length, 4, 'PANEL NPTH: 4 standoff holes');
  const q = parseExcellon(files2.find(f => f.name === 'gerber/PANEL/PANEL-PTH.DRL').data);
  eq(q.hits.length, 8, 'PANEL PTH: 8 header pads');
}
// ---------- one-board doc: mount holes → NPTH; SMD-only parts → maybe no PTH ----------
{
  const doc1 = oneBoardDoc();
  const files1 = exportExcellon(doc1);
  const res = resolveBoard(doc1.boards[0], doc1, { textAsStrokes: true, imagesAsPolys: true });
  const pth = res.drills.filter(d => d.plated !== false), npth = res.drills.filter(d => d.plated === false);
  const stem = safeName(doc1.boards[0].name);
  const fN = files1.find(f => f.name === `gerber/${stem}/${stem}-NPTH.DRL`);
  const fP = files1.find(f => f.name === `gerber/${stem}/${stem}-PTH.DRL`);
  ok(!!fN === npth.length > 0, 'one-board NPTH file iff non-plated drills exist');
  ok(!!fP === pth.length > 0, 'one-board PTH file iff plated drills exist');
  if (fN) eq(parseExcellon(fN.data).hits.length, npth.length, 'one-board NPTH hit count');
  if (fP) eq(parseExcellon(fP.data).hits.length + parseExcellon(fP.data).slots.length, pth.length, 'one-board PTH hit count');
}
// ---------- unit checks ----------
{
  const [[ax, ay], [bx, by]] = slotEnds({ x: 10, y: 10, d: 2, slotLen: 6, rot: 0 });
  ok(near(ax, 8) && near(ay, 10) && near(bx, 12) && near(by, 10), 'slotEnds rot 0');
  const [[cx, cy], [dx, dy]] = slotEnds({ x: 10, y: 10, d: 2, slotLen: 6, rot: 90 });
  ok(near(cx, 10) && near(cy, 8) && near(dx, 10) && near(dy, 12), 'slotEnds rot 90');
  ok(!isSlot({ d: 2, slotLen: 0 }) && !isSlot({ d: 2, slotLen: 2 }) && isSlot({ d: 2, slotLen: 2.5 }), 'isSlot');
  const tt = toolTable([{ d: 0.804 }, { d: 0.796 }, { d: 1.0 }, { d: 0.5 }]);
  eq(tt.map(t => t.d).join(','), '0.5,0.8,1', 'toolTable merges 0.804/0.796 → 0.8 and sorts');
  eq(tt[1].hits.length, 2, 'merged tool holds both hits');
  // plated slot on a pad → PTH G85; negative coordinates keep sign; -0 → 0.000
  const d = newDocument({ name: 'sl', w: 20, h: 20 });
  d.boards[0].items.push(makeItem('pad', { x: 5, y: 5, shape: 'oval', w: 3, h: 1.6, drill: 1.0, slot: 2.5, layer: 'both', rot: 0 }));
  d.boards[0].items.push(makeItem('hole', { x: -0.0001, y: -3, d: 2 }));
  const fl = exportExcellon(d);
  const P = parseExcellon(fl.find(f => f.name.endsWith('-PTH.DRL')).data);
  eq(P.slots.length, 1, 'plated slot → G85 in PTH file');
  ok(near(P.slots[0].ax, 4.25, 1e-3) && near(P.slots[0].bx, 5.75, 1e-3), 'plated slot endpoints ± (2.5-1)/2');
  const Nt = fl.find(f => f.name.endsWith('-NPTH.DRL')).data;
  ok(Nt.includes('X0.000Y-3.000'), 'negative Y kept, -0 written as 0.000');
  ok(excellonText(d, d.boards[0], [], 'PTH', null) === null, 'no drills → null (no file)');
}
console.log(`excellon: ${n} checks`);
console.log('ALL PASS');
