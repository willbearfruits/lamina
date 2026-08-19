// node test/gcode.test.mjs
import assert from 'node:assert/strict';
import { twoBoardDoc, oneBoardDoc, fakeBitmapFor } from './fixtures.mjs';
import { exportGcode, offsetPolygon, perimeter, primStrokes, GCODE_DEFAULTS } from '../js/export/gcode.js';
import { exportFabBundle, jlcOrderSummary } from '../js/export/fab.js';
import { resolveBoard, outlineSize, polygonArea, pointInPolygon } from '../js/geom.js';
import { newDocument, makeItem } from '../js/model.js';
import { safeName } from '../js/export/common.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// tiny GRBL parser: tracks modal X/Y/Z, validates words, collects stats
export function parseGcode(text) {
  const st = { minZ: 0, maxZ: -Infinity, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, g0: 0, g1: 0, m0: 0, m3: 0, m5: 0, comments: [], words: new Set(), first: null, last: null, cutMoves: [] };
  let x = 0, y = 0, z = 0;
  const lines = text.split('\n').filter(l => l.trim().length);
  st.first = lines[0]; st.last = lines[lines.length - 1];
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('(')) { assert.ok(l.endsWith(')') && !/[()]/.test(l.slice(1, -1)), 'comment closed, no nested parens: ' + l); st.comments.push(l); continue; }
    const words = l.split(/\s+/);
    for (const w of words) {
      const m = /^([GMXYZFST])(-?\d+(?:\.\d+)?)$/.exec(w);
      assert.ok(m, 'valid word "' + w + '" in: ' + l);
      const [, letter, val] = m; const v = +val;
      if (letter === 'G') { st.words.add('G' + v); if (v === 0) st.g0++; else if (v === 1) st.g1++; else assert.ok([17, 21, 90, 94].includes(v), 'allowed G code G' + v); }
      if (letter === 'M') { st.words.add('M' + v); if (v === 0) st.m0++; if (v === 3) st.m3++; if (v === 5) st.m5++; assert.ok([0, 2, 3, 5, 30].includes(v), 'allowed M code M' + v); }
      if (letter === 'X') x = v; if (letter === 'Y') y = v; if (letter === 'Z') z = v;
      if (letter === 'F') assert.ok(v > 0, 'positive feed');
      if (/\.\d{4,}/.test(val)) assert.fail('more than 3 decimals: ' + w);
    }
    if (/^G[01]\b/.test(l)) {
      st.minZ = Math.min(st.minZ, z); st.maxZ = Math.max(st.maxZ, z);
      if (/X/.test(l) || /Y/.test(l)) { st.minX = Math.min(st.minX, x); st.maxX = Math.max(st.maxX, x); st.minY = Math.min(st.minY, y); st.maxY = Math.max(st.maxY, y); }
      if (/^G1\b/.test(l) && z < 0 && (/X/.test(l) || /Y/.test(l))) st.cutMoves.push([x, y, z]);
      if (/^G0\b/.test(l) && (/X/.test(l) || /Y/.test(l))) assert.ok(z > 0, 'rapid XY only above the surface: ' + l);
    }
  }
  return st;
}
const T = 1.6;

// ---------- two-board doc ----------
const doc2 = twoBoardDoc();
const files2 = exportGcode(doc2, { bitmapFor: fakeBitmapFor });
ok(files2.some(f => f.name === 'gcode/README-cnc.txt'), 'README-cnc.txt present');
ok(files2.find(f => f.name === 'gcode/README-cnc.txt').data.includes('FlatCAM'), 'README points isolation routing to FlatCAM');
ok(!files2.some(f => /isolation/.test(f.name)), 'no isolation gcode shipped');
for (const b of doc2.boards) {
  const stem = safeName(b.name);
  const res = resolveBoard(b, doc2, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
  const [W, H] = outlineSize(b.outline);
  const want = [`gcode/${stem}-drill.nc`, `gcode/${stem}-outline.nc`, `gcode/${stem}-engrave-F_Silk.nc`, `gcode/${stem}-engrave-B_Silk.nc`];
  for (const w of want) ok(files2.some(f => f.name === w), `${w} present`);
  for (const f of files2.filter(f => f.name.startsWith(`gcode/${stem}-`))) {
    const t = f.data;
    const p = parseGcode(t);
    ok(t.split('\n').find(l => !l.startsWith('(')) === 'G21', `${f.name} first command is G21`);
    ok(p.words.has('G21') && p.words.has('G90') && p.words.has('G17'), `${f.name} G21 G90 G17`);
    ok(p.m3 >= 1 && /S\d+ M3/.test(t), `${f.name} contains S..M3`);
    ok(/M5\nM2\s*$/.test(t) || /M5\nM30\s*$/.test(t), `${f.name} ends with M5 + M2/M30`);
    ok(p.minZ >= -(T + 0.5), `${f.name} never below -(thickness+0.5) (minZ ${p.minZ})`);
    ok(p.minZ < 0, `${f.name} actually cuts`);
    ok(/Origin = board bottom-left corner/.test(t) && /Z0 = board TOP surface/.test(t) && /Units mm/.test(t), `${f.name} header states units/origin/Z0`);
    ok(/Tool/.test(t) && /Feeds:/.test(t) && /Safe Z/.test(t), `${f.name} header states tool + feeds + safe Z`);
    ok(!/G0?[23]\b/.test(t.replace(/\(.*\)/g, '')), `${f.name} no arc moves`);
    ok(p.minX >= -1 && p.maxX <= W + 1 && p.minY >= -1 && p.maxY <= H + 1, `${f.name} XY within board ±1 (${p.minX.toFixed(2)},${p.minY.toFixed(2)},${p.maxX.toFixed(2)},${p.maxY.toFixed(2)})`);
    if (f.name.endsWith('-drill.nc')) {
      const drills = res.drills;
      const hits = (t.match(/^\(drill /gm) || []).length, slots = (t.match(/^\(slot /gm) || []).length;
      eq(hits + slots, drills.length, `${f.name} drill hit count == resolved drills (${drills.length})`);
      eq(slots, drills.filter(d => d.slotLen > d.d).length, `${f.name} slot count`);
      const tools = new Set(drills.map(d => Math.round(d.d * 100) / 100));
      eq(p.m0, tools.size, `${f.name} one M0 tool-change pause per tool (${tools.size})`);
      ok(/TOOL CHANGE: [\d.]+ mm drill/.test(t), 'tool change comment names the drill');
      ok(near(p.minZ, -(T + GCODE_DEFAULTS.overcut), 1e-6), `drill depth = -(thickness+overcut) (${p.minZ})`);
      // pecking: at least one retract to peckRetract between plunges
      ok(t.includes(`G0 Z${GCODE_DEFAULTS.peckRetract}`), 'peck retract present');
      // every drill position appears as a rapid
      for (const d of drills.filter(d => !(d.slotLen > d.d))) ok(t.includes(`G0 X${(+d.x.toFixed(3)).toString()} Y${(+d.y.toFixed(3)).toString()}`), `rapid to drill ${d.x},${d.y}`);
    }
    if (f.name.endsWith('-outline.nc')) {
      ok(near(p.minZ, -(T + GCODE_DEFAULTS.overcut), 1e-6), `outline depth = -(thickness+overcut) (${p.minZ})`);
      // offset outward by tool radius: extents = board ± 0.5
      ok(near(p.minX, -0.5, 1e-3) && near(p.maxX, W + 0.5, 1e-3) && near(p.minY, -0.5, 1e-3) && near(p.maxY, H + 0.5, 1e-3), `outline offset outward by tool radius (${p.minX},${p.minY},${p.maxX},${p.maxY})`);
      const passesN = Math.ceil((T + GCODE_DEFAULTS.overcut) / GCODE_DEFAULTS.passDepth);
      ok(t.includes(`(profile)`), 'profile section');
      // tabs: on the deepest passes Z is lifted to -(T - tabHeight)
      const tabZ = -(T - GCODE_DEFAULTS.tabHeight);
      const lifts = (t.match(new RegExp(`^G1 Z${tabZ.toFixed(1)}`, 'gm')) || []).length;
      ok(lifts >= GCODE_DEFAULTS.tabs, `tab lifts to Z${tabZ} on deep passes (${lifts})`);
      ok(/Tabs: 4 x 3 mm wide, 0.5 mm high/.test(t), 'header documents tabs');
      ok(/concave/.test(t), 'header documents offset limitation');
      if (res.cutouts.length) {
        ok(t.includes('(cutout 1)'), 'cutout section present');
        ok(t.indexOf('(cutout 1)') < t.indexOf('(profile)'), 'cutouts before profile');
        // MAIN cutout rect 8x6 at (50,30): inward offset by 0.5 → x 46.5..53.5, y 27.5..32.5
        const seg = t.slice(t.indexOf('(cutout 1)'), t.indexOf('(profile)'));
        const xs = Array.from(seg.matchAll(/X(-?[\d.]+)/g)).map(m => +m[1]), ys = Array.from(seg.matchAll(/Y(-?[\d.]+)/g)).map(m => +m[1]);
        ok(near(Math.min(...xs), 46.5, 1e-3) && near(Math.max(...xs), 53.5, 1e-3) && near(Math.min(...ys), 27.5, 1e-3) && near(Math.max(...ys), 32.5, 1e-3), `cutout offset inward (${Math.min(...xs)}..${Math.max(...xs)} x ${Math.min(...ys)}..${Math.max(...ys)})`);
        ok(!/^G1 Z-1\.1 /m.test(seg), 'cutouts have no tab lifts');
      }
      ok(passesN >= 4 && (t.match(/^G1 Z-0\.5 /gm) || []).length >= 1 && (t.match(/^G1 Z-1 /gm) || []).length >= 1, 'multi-pass depths present');
    }
    if (/-engrave-/.test(f.name)) {
      ok(near(p.minZ, -GCODE_DEFAULTS.engraveDepth, 1e-6), `engrave depth ${p.minZ}`);
      const layer = /F_Silk/.test(f.name) ? 'F.Silk' : 'B.Silk';
      const prims = res.layers[layer];
      const strokesExpected = prims.reduce((a, pr) => a + primStrokes(pr, null).filter(s => s.pts.length >= 2).length, 0);
      const plunges = (t.match(new RegExp(`^G1 Z-${GCODE_DEFAULTS.engraveDepth} F`, 'gm')) || []).length;
      eq(plunges, strokesExpected, `${f.name} one plunge per stroke (${strokesExpected})`);
      if (layer === 'B.Silk') {
        ok(/MIRRORED/.test(t) && t.includes(`x' = ${W} - x`), 'bottom engrave header documents mirroring');
        // bottom text was at x≈50 (centre) → mirrored still ≈ centre; the R2 (60,30 bottom) outline → mirrored to x≈40
        const xs = p.cutMoves.map(c => c[0]);
        ok(xs.some(x => x > 35 && x < 45), 'bottom-side part silk mirrored to W - x');
      }
      if (prims.some(pr => pr.t === 'poly')) ok(/outline only/.test(t), 'filled polys flagged as outline-only');
    }
  }
}
// ---------- one-board doc ----------
{
  const doc1 = oneBoardDoc();
  const files1 = exportGcode(doc1);
  const stem = safeName(doc1.boards[0].name);
  ok(files1.some(f => f.name === `gcode/${stem}-outline.nc`), 'one-board outline');
  ok(files1.some(f => f.name === `gcode/${stem}-drill.nc`), 'one-board drill (mount holes)');
  ok(files1.some(f => f.name === `gcode/${stem}-engrave-F_Silk.nc`), 'one-board F.Silk engrave');
  const res = resolveBoard(doc1.boards[0], doc1, { textAsStrokes: true, imagesAsPolys: true });
  if (!res.layers['B.Silk'].length) ok(!files1.some(f => f.name.endsWith('-engrave-B_Silk.nc')), 'no B.Silk file when the layer is empty');
  for (const f of files1.filter(f => f.name.endsWith('.nc'))) { const p = parseGcode(f.data); ok(p.minZ >= -(T + 0.5) && p.first === f.data.split('\n')[0] && /M2$/.test(f.data.trim()), `${f.name} valid`); }
  const d = parseGcode(files1.find(f => f.name.endsWith('-drill.nc')).data);
  eq((files1.find(f => f.name.endsWith('-drill.nc')).data.match(/^\(drill /gm) || []).length, res.drills.length, 'one-board drill hits == resolved drills');
  ok(d.m0 >= 1, 'one-board drill has a tool change');
}
// ---------- opts override + thickness ----------
{
  const d = newDocument({ name: 'thick', w: 30, h: 20, thickness: 0.8 });
  d.boards[0].items.push(makeItem('hole', { x: 5, y: 5, d: 3 }));
  d.boards[0].items.push(makeItem('polygon', { layer: 'Edge.Cuts', points: [[10, 5], [20, 5], [20, 15], [10, 15]], filled: true }));
  const fl = exportGcode(d, { toolD: 2, passDepth: 0.3, safeZ: 8, spindle: 12000, tabs: 0, engraveDepth: 0.05 });
  const o = parseGcode(fl.find(f => f.name.endsWith('-outline.nc')).data);
  ok(near(o.minZ, -(0.8 + 0.2)), `thickness 0.8 → outline Z ${o.minZ}`);
  ok(near(o.minX, -1) && near(o.maxX, 31) && near(o.minY, -1) && near(o.maxY, 21), 'toolD 2 → outline offset by 1');
  ok(o.maxZ === 8, 'safeZ 8');
  ok(fl.find(f => f.name.endsWith('-outline.nc')).data.includes('S12000 M3'), 'spindle 12000');
  ok(!/G1 Z-0\.3 F[\d.]+\n(?:G1 X.*\n)+G1 Z-0\.6/.test('') && (fl.find(f => f.name.endsWith('-outline.nc')).data.match(/^G1 Z-0\.3 /gm) || []).length >= 1, 'passDepth 0.3 used');
  const dr = parseGcode(fl.find(f => f.name.endsWith('-drill.nc')).data);
  ok(near(dr.minZ, -1.0), 'drill depth follows thickness');
}
// ---------- offsetPolygon unit checks ----------
{
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const out = offsetPolygon(sq, 1);
  ok(near(polygonArea(out), 144), 'square offset +1 → 12x12');
  ok(out.every(([x, y]) => (near(x, -1) || near(x, 11)) && (near(y, -1) || near(y, 11))), 'square offset corners at ±1');
  const inn = offsetPolygon(sq, -1);
  ok(near(polygonArea(inn), 64), 'square offset -1 → 8x8');
  const cw = sq.slice().reverse();
  ok(near(polygonArea(offsetPolygon(cw, 1)), 144), 'CW input handled (ensureCCW)');
  // circle offset stays a circle of r+1
  const circ = []; for (let i = 0; i < 64; i++) circ.push([Math.cos(i / 64 * 2 * Math.PI) * 5, Math.sin(i / 64 * 2 * Math.PI) * 5]);
  const oc = offsetPolygon(circ, 1);
  ok(oc.every(([x, y]) => near(Math.hypot(x, y), 5 + 1 / Math.cos(Math.PI / 64), 1e-6)), 'circle offset: vertices at R + r/cos(pi/n) (miter of a 64-gon)');
  ok(pointInPolygon(0, 0, oc) && !pointInPolygon(6.2, 0, oc), 'circle offset sane');
  ok(near(perimeter(sq), 40), 'perimeter');
  // duplicate closing point tolerated
  ok(near(polygonArea(offsetPolygon([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], 1)), 144), 'closing duplicate point tolerated');
}
// ---------- fab bundle glue ----------
{
  const bundle = exportFabBundle(doc2, { bitmapFor: fakeBitmapFor, gcode: true });
  const names = bundle.map(f => f.name);
  ok(names.includes('README-fab.txt'), 'bundle README-fab.txt');
  ok(names.includes('gerber/MAIN/MAIN.GTL') && names.includes('gerber/MAIN/MAIN.GKO') && names.includes('gerber/MAIN/MAIN-PTH.DRL') && names.includes('gerber/MAIN/MAIN-NPTH.DRL'), 'bundle has gerbers + drills');
  ok(names.includes('gcode/MAIN-drill.nc') && names.includes('gcode/README-cnc.txt'), 'bundle has gcode when opts.gcode');
  ok(new Set(names).size === names.length, 'no duplicate names in bundle');
  const readme = bundle.find(f => f.name === 'README-fab.txt').data;
  ok(/\.GKO/.test(readme) && /PTH/.test(readme) && /NPTH/.test(readme) && /2 layers/.test(readme) && /1\.6 mm/.test(readme) && /Black/.test(readme) && /HASL/.test(readme), 'README lists outline/drills/JLC options');
  ok(readme.includes('MAIN.GTL') && readme.includes('PANEL.GKO'), 'README lists per-board files');
  const noG = exportFabBundle(doc2, { bitmapFor: fakeBitmapFor });
  ok(!noG.some(f => f.name.startsWith('gcode/')), 'no gcode without opts.gcode');
  const s = jlcOrderSummary(doc2);
  ok(/100 x 60 mm/.test(s) && /Layers:\s+2/.test(s) && /Thickness:\s+1\.6 mm/.test(s) && /Black/.test(s) && /Red/.test(s) && /Copper weight:\s+1 oz/.test(s) && /Quantity:\s+5/.test(s), 'jlcOrderSummary lists size/layers/thickness/colour/finish/copper/qty');
  ok(s.split('Board "').length === 3, 'summary covers both boards');
}
console.log(`gcode: ${n} checks`);
console.log('ALL PASS');
