// node test/hershey.test.mjs
import { HERSHEY, textStrokes, strokesBBox } from '../js/lib/hershey.js';
import assert from 'node:assert/strict';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

ok(Object.keys(HERSHEY.glyphs).length === 95, '95 glyphs (ASCII 32..126)');
for (let c = 32; c <= 126; c++) ok(HERSHEY.glyphs[String.fromCharCode(c)], 'glyph present: ' + c);
ok(HERSHEY.capHeight === 21 && HERSHEY.unitsPerEm === 21, 'capHeight 21 units');
ok(HERSHEY.glyphs['A'].strokes.length > 0, '"A" has strokes');
ok(HERSHEY.glyphs['A'].strokes.length === 3, '"A" has 3 strokes');
ok(HERSHEY.glyphs[' '].adv > 0 && HERSHEY.glyphs[' '].strokes.length === 0, 'space advances, no ink');

// y-up, baseline 0, cap top = capHeight
const bbH = strokesBBox(HERSHEY.glyphs['H'].strokes);
ok(bbH.minY === 0 && bbH.maxY === HERSHEY.capHeight, 'H spans baseline..capHeight');
ok(bbH.minX >= 0, 'x starts at/after 0');

const r = textStrokes('Hi', 2);
ok(r.width > 0, 'textStrokes("Hi",2).width > 0');
ok(r.strokes.length > 0, 'textStrokes returns strokes');
const bb = strokesBBox(textStrokes('H', 2).strokes);
ok(Math.abs(bb.maxY - 2) < 1e-9, 'cap height scaled to size (H top == 2)');
ok(bb.minY >= -1e-9, 'baseline at 0');
ok(strokesBBox(r.strokes).maxY > 2, 'i-dot rises slightly above cap height (font design)');

const r2 = textStrokes('Hi', 2, { letterSpacing: 1 });
ok(Math.abs((r2.width - r.width) - 1) < 1e-9, 'letterSpacing adds 1 per gap');
const rs = textStrokes('a b', 2);
ok(rs.width > textStrokes('ab', 2).width, 'space advances');
const ru = textStrokes('é', 2);
ok(ru.width > 0 && ru.strokes.length === 1, 'unknown char draws a box and advances');
const rc = textStrokes('Hi', 2, { align: 'center' });
const bbc = strokesBBox(rc.strokes);
ok(bbc.minX < 0 && bbc.maxX > 0, 'center align straddles x=0');
const rm = textStrokes('Hi', 2, { mirror: true });
ok(strokesBBox(rm.strokes).maxX <= 1e-9, 'mirror flips to negative x');
const r3 = textStrokes('A\nB', 2);
ok(r3.lines === 2 && strokesBBox(r3.strokes).minY < -1, 'multiline goes downward');

console.log(`${n} assertions`);
console.log('ALL PASS');
