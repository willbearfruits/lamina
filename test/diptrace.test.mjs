// node test/diptrace.test.mjs — DipTrace ASCII PCB importer against a real export (trimmed): test/fixtures/diptrace-mini.asc
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importDiptraceAsc } from '../js/import/diptrace.js';
import { resolveBoard } from '../js/geom.js';
import { newDocument } from '../js/model.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
const near = (a, b, m, tol = 1e-3) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); n++; };
const dir = path.dirname(fileURLToPath(import.meta.url));
const text = fs.readFileSync(path.join(dir, 'fixtures', 'diptrace-mini.asc'), 'utf8');

const { board, warnings, nets } = importDiptraceAsc(text, { name: 'mini.asc' });
ok(board && Array.isArray(board.items), 'board returned');
ok(warnings.length >= 1 && /÷3/.test(warnings[0]), 'summary warning mentions the ÷3 unit conversion');
// outline: the MIDIUSB board is 146.4 × 77.4 file units = 48.8 × 25.8 mm with 4 corner arcs → polygon
eq(board.outline.type, 'polygon', 'outline imported as polygon');
{
  const xs = board.outline.points.map(p => p[0]), ys = board.outline.points.map(p => p[1]);
  near(Math.min(...xs), 0, 'outline bbox min x = 0'); near(Math.min(...ys), 0, 'outline bbox min y = 0');
  near(Math.max(...xs), 48.8, 'outline width 48.8 mm', 0.01); near(Math.max(...ys), 25.8, 'outline height 25.8 mm', 0.01);
  ok(board.outline.points.length > 20, 'corner arcs were sampled');
}
const parts = board.items.filter(i => i.type === 'part');
eq(parts.length, 5, '5 components');
const byRef = Object.fromEntries(parts.map(p => [p.ref, p]));
// SIL5 header J3: 5 pins on 2.54 mm, Ø1.016 holes, net names attached
{
  const j = byRef.J3; ok(j, 'J3 present'); eq(j.fp.pads.length, 5, 'J3 5 pads'); eq(j.value, 'MIDI', 'J3 value');
  const xs = j.fp.pads.map(p => p.x).sort((a, b) => a - b); near(xs[1] - xs[0], 2.54, 'J3 pitch 2.54 (7.62 units ÷ 3)');
  ok(j.fp.pads.every(p => p.layer === 'both' && p.drill > 0.9 && p.drill < 1.02 && !p.slotLen), 'J3 through-hole Ø0.91–1.02, no bogus slots');
  ok(j.fp.pads.some(p => p.net === 'GND') && j.fp.pads.some(p => p.net === 'IN+'), 'J3 pads carry net names');
  eq(j.side, 'top', 'J3 on top');
}
// 0805 resistor R10: SMD rect pads 2.286 apart
{
  const r = byRef.R10; ok(r, 'R10 present'); eq(r.fp.pads.length, 2, 'R10 2 pads'); ok(r.fp.pads.every(p => p.layer === 'F' && p.drill === 0 && p.shape === 'rect'), 'R10 SMD rect pads');
  near(Math.abs(r.fp.pads[0].x - r.fp.pads[1].x), 2.286, 'R10 pad spacing 2.286'); near(r.fp.pads[0].w, 1.524, 'R10 pad w'); near(r.fp.pads[0].h, 1.422, 'R10 pad h');
  eq(r.fp.graphics.length, 1, 'R10 body rectangle imported'); eq(r.fp.graphics[0].t, 'polyline', 'R10 outline is a closed polyline');
  const g = r.fp.graphics[0]; const gx = g.pts.map(p => p[0]), gy = g.pts.map(p => p[1]); near(Math.max(...gx) - Math.min(...gx), 4.452, 'R10 outline width = pattern Width/3', 0.01); near(Math.max(...gy) - Math.min(...gy), 1.908, 'R10 outline height', 0.01);
}
// QFP-48 IC1: 48 pads on 0.5 mm pitch, left-side pads are "Inverted" → 1.6 × 0.3
{
  const u = byRef.IC1; ok(u, 'IC1 present'); eq(u.fp.pads.length, 48, 'IC1 48 pads');
  const p1 = u.fp.pads.find(p => p.name === '1'), p2 = u.fp.pads.find(p => p.name === '2'), p13 = u.fp.pads.find(p => p.name === '13');
  near(p1.x, -4.2, 'IC1 pin 1 x'); near(p1.y, 2.75, 'IC1 pin 1 y (Y flipped: 8.25 units down → +2.75 mm up)'); near(Math.abs(p1.y - p2.y), 0.5, 'IC1 pitch 0.5');
  near(p1.w, 1.6, 'IC1 left pad is 1.6 wide (Inverted swaps w/h)'); near(p1.h, 0.3, 'IC1 left pad 0.3 tall'); near(p13.w, 0.3, 'IC1 bottom pad 0.3 wide'); near(p13.h, 1.6, 'IC1 bottom pad 1.6 tall');
  ok(u.fp.pads.every(p => p.layer === 'F'), 'IC1 SMD');
}
// LED: TH pads 2.54 apart, K first
{
  const d = byRef.LD1; ok(d, 'LD1 present'); eq(d.fp.pads.length, 2, 'LD1 2 pads'); near(Math.abs(d.fp.pads[0].y - d.fp.pads[1].y), 2.54, 'LED pitch 2.54'); ok(d.fp.pads.every(p => p.drill > 0.8 && p.drill < 0.82), 'LED Ø0.813 holes');
  ok(d.fp.graphics.some(g => g.t === 'polyline' && !g.closed) && d.fp.graphics.some(g => g.t === 'line'), 'LED silk arc + flat line imported');
}
// bottom-side capacitor C2: side bottom, pads un-mirrored so the resolver mirrors them back
{
  const c = byRef.C2; ok(c, 'C2 present'); eq(c.side, 'bottom', 'C2 on the bottom'); near(c.fp.pads.find(p => p.name === 'A').x, -1.143, 'C2 pad A un-mirrored to −x');
  const doc = newDocument({ name: 't' }); doc.boards = [board];
  const R = resolveBoard(board, doc);
  const rc = R.pads.filter(p => p.partRef === 'C2'); eq(rc.length, 2, 'C2 resolves 2 pads');
  const a = rc.find(p => p.name === 'A'); near(a.x, c.x + 1.143, 'resolved C2 pad A lands at +x (as in the DipTrace file)'); ok(rc.every(p => p.layer === 'B'), 'C2 pads on B.Cu after resolve');
  ok(R.pads.filter(p => p.partRef === 'IC1').length === 48, 'resolver sees all 48 QFP pads');
}
// traces + texts
{
  const traces = board.items.filter(i => i.type === 'trace'); ok(traces.length >= 1, 'traces imported');
  const t = traces.find(x => x.net === 'CONNECT_LED'); ok(t, 'CONNECT_LED trace'); eq(t.layer, 'F.Cu', 'trace on top copper'); near(t.width, 0.305, 'trace width 0.914 units = 0.305 mm', 0.002); eq(t.points.length, 9, 'trace keeps its 9 vertices');
  const texts = board.items.filter(i => i.type === 'text'); eq(texts.length, 2, '2 board texts'); ok(texts.some(x => x.text === 'GND') && texts.every(x => x.layer === 'F.Silk'), 'texts on top silk with content');
  ok(nets.includes('GND') && nets.includes('CONNECT_LED'), 'net list returned');
}
// errors
assert.throws(() => importDiptraceAsc('(kicad_pcb (version 1))'), /Not a DipTrace/, 'rejects non-DipTrace'); n++;
assert.throws(() => importDiptraceAsc('(Source "DipTrace-Schematic")\n(Schematic)'), /SCHEMATIC/, 'rejects schematic ASCII'); n++;

console.log(`ALL PASS ${n}/${n}`);
