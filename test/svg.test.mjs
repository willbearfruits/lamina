// node test/svg.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { twoBoardDoc, oneBoardDoc, fakeBitmapFor } from './fixtures.mjs';
import { exportSvg, svgPrim, nonEmptyLayers, realisticPlan, LAYER_COLORS } from '../js/export/svg.js';
import { resolveBoard, GRAPHIC_LAYERS } from '../js/geom.js';
import { safeName } from '../js/export/common.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---------- tiny XML tokenizer: balanced tag stack (ignores <?xml ?>, <!-- -->, self-closing), collects elements ----------
export function tokenizeSvg(text) {
  const els = []; // {name, attrs, depth, parent}
  const stack = [];
  let i = 0; const len = text.length;
  ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"'), 'starts with an XML declaration (UTF-8)');
  while (i < len) {
    const lt = text.indexOf('<', i); if (lt < 0) break;
    const between = text.slice(i, lt);
    assert.ok(!/[<>]/.test(between), 'no stray < > in text content');
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt); assert.ok(e > 0, 'PI closed'); i = e + 2; continue; }
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt); assert.ok(e > 0, 'comment closed'); i = e + 3; continue; }
    assert.ok(!text.startsWith('<!', lt), 'no DOCTYPE/CDATA expected in exporter output');
    // end of tag honouring quotes
    let j = lt + 1, q = null;
    for (; j < len; j++) { const ch = text[j]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; }
    assert.ok(j < len, 'tag closed with >');
    const raw = text.slice(lt + 1, j); i = j + 1;
    if (raw[0] === '/') { const name = raw.slice(1).trim(); assert.ok(stack.length, `closing </${name}> with empty stack`); const open = stack.pop(); assert.equal(open.name, name, `</${name}> closes <${open.name}>`); continue; }
    const selfClose = /\/\s*$/.test(raw);
    const body = selfClose ? raw.replace(/\/\s*$/, '') : raw;
    const nm = /^([A-Za-z_][\w.:-]*)/.exec(body); assert.ok(nm, 'tag has a name: ' + body.slice(0, 40));
    const attrs = {}; const re = /([^\s=]+)\s*=\s*"([^"]*)"/g; let m;
    const attrText = body.slice(nm[1].length);
    while ((m = re.exec(attrText))) { assert.ok(!(m[1] in attrs), `duplicate attribute ${m[1]} on <${nm[1]}>`); attrs[m[1]] = m[2]; }
    assert.ok(!/[^\s"=]+\s*=\s*[^"\s]/.test(attrText.replace(re, '')), 'all attribute values double-quoted: ' + attrText.slice(0, 60));
    for (const v of Object.values(attrs)) assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(v) && !/</.test(v), 'attribute value escaped: ' + v.slice(0, 40));
    const el = { name: nm[1], attrs, depth: stack.length, parent: stack[stack.length - 1] || null, children: [] };
    if (el.parent) el.parent.children.push(el);
    els.push(el);
    if (!selfClose) stack.push(el);
  }
  assert.equal(stack.length, 0, 'all tags closed (stack empty at EOF): ' + stack.map(s => s.name).join('>'));
  n++;
  return els;
}
const groups = els => els.filter(e => e.name === 'g');
const attrMm = v => { const m = /^(-?[\d.]+)mm$/.exec(v); return m ? +m[1] : null; };
const isNum = s => /^-?\d+(\.\d+)?$/.test(s);
function checkNumbers(els) { // every coordinate/points/d attribute is well-formed numeric data
  for (const e of els) {
    for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'stroke-width', 'opacity']) {
      if (e.attrs[k] != null && !/mm$/.test(e.attrs[k])) assert.ok(isNum(e.attrs[k]), `<${e.name} ${k}="${e.attrs[k]}"> numeric`);
    }
    if (e.attrs.points != null) { const a = e.attrs.points.trim().split(/\s+/); assert.ok(a.length >= 2 && a.every(p => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(p)), `<${e.name}> points well-formed`); }
    if (e.attrs.d != null && e.name === 'path') assert.ok(/^(M-?\d+(\.\d+)?,-?\d+(\.\d+)?(L-?\d+(\.\d+)?,-?\d+(\.\d+)?)+Z)+$/.test(e.attrs.d), `<path d> is M..L..Z rings only: ${e.attrs.d.slice(0, 50)}`);
    if (e.name === 'circle') assert.ok(+e.attrs.r > 0, 'circle r > 0');
    if (e.attrs['stroke-width'] != null && e.attrs.fill !== undefined) assert.ok(+e.attrs['stroke-width'] >= 0.01 || e.attrs.stroke === 'none', 'stroke-width >= 0.01');
  }
  n++;
}
// count of shape elements inside a group (recursively)
const shapesIn = g => { let c = 0; const walk = e => { for (const ch of e.children) { if (['path', 'polygon', 'polyline', 'line', 'circle', 'rect'].includes(ch.name)) c++; walk(ch); } }; walk(g); return c; };
const expectedShapeCount = prims => prims.reduce((s, p) => s + (p.t === 'polyline' ? (p.pts && p.pts.length >= 1 ? 1 : 0) : p.t === 'poly' ? (p.pts && p.pts.length >= 3 ? 1 : 0) : ['line', 'arc', 'circle'].includes(p.t) ? 1 : 0), 0);

// ---------- two-board doc ----------
const doc2 = twoBoardDoc();
const files2 = exportSvg(doc2, { bitmapFor: fakeBitmapFor });
eq(files2.length, doc2.boards.length * 4, '4 files per board (top/bottom/layers/outline)');
ok(files2.every(f => typeof f.data === 'string' && f.name.endsWith('.svg') && !f.name.includes('/')), 'all files are flat .svg strings');
const rendered = [];
for (const b of doc2.boards) {
  const stem = safeName(b.name);
  const res = resolveBoard(b, doc2, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
  const [W, H] = res.size;
  const nonEmpty = nonEmptyLayers(res);
  eq(nonEmpty.join(','), GRAPHIC_LAYERS.filter(l => res.layers[l].length).join(','), `${stem}: nonEmptyLayers helper`);
  for (const kind of ['top', 'bottom', 'layers', 'outline']) {
    const f = files2.find(f => f.name === `${stem}-${kind}.svg`);
    ok(f, `${stem}: ${stem}-${kind}.svg exists`);
    const els = tokenizeSvg(f.data);
    checkNumbers(els);
    const svg = els[0];
    eq(svg.name, 'svg', `${stem}-${kind}: root is <svg>`);
    eq(svg.attrs.xmlns, 'http://www.w3.org/2000/svg', `${stem}-${kind}: xmlns`);
    ok(svg.attrs.width.endsWith('mm') && svg.attrs.height.endsWith('mm'), `${stem}-${kind}: width/height in mm`);
    ok(near(attrMm(svg.attrs.width), W) && near(attrMm(svg.attrs.height), H), `${stem}-${kind}: width/height == board size ${W}×${H}`);
    const vb = svg.attrs.viewBox.split(/\s+/).map(Number);
    ok(vb.length === 4 && vb[0] === 0 && vb[1] === 0 && near(vb[2], W) && near(vb[3], H), `${stem}-${kind}: viewBox = 0 0 W H`);
    ok(els.some(e => e.name === 'title' && e.parent === svg) && els.some(e => e.name === 'desc' && e.parent === svg), `${stem}-${kind}: <title> + <desc>`);
    const lam = els.find(e => e.name === 'g' && e.attrs.id === 'lamina');
    ok(lam && lam.parent === svg, `${stem}-${kind}: top-level <g id="lamina">`);
    const flip = kind === 'bottom' ? `translate(${W},${H}) scale(-1,-1)` : `translate(0,${H}) scale(1,-1)`;
    eq(lam.attrs.transform, flip, `${stem}-${kind}: Y-flip transform (${kind === 'bottom' ? 'mirrored' : 'plain'})`);
    // no native text/image, everything is vector shapes
    ok(!els.some(e => e.name === 'text' || e.name === 'image'), `${stem}-${kind}: no <text>/<image>`);
    ok(els.every(e => ['svg', 'title', 'desc', 'g', 'path', 'polygon', 'polyline', 'line', 'circle', 'rect'].includes(e.name)), `${stem}-${kind}: only known elements`);
    // ids unique per document
    const ids = els.map(e => e.attrs.id).filter(Boolean);
    ok(new Set(ids).size === ids.length, `${stem}-${kind}: unique ids`);
    if (kind === 'top' || kind === 'bottom') {
      const P = kind === 'bottom' ? 'B.' : 'F.';
      const plan = realisticPlan(res, kind);
      eq(plan.map(o => o.kind).join(','), 'board,layer,layer,layer,drills,cutouts,edge', `${stem}-${kind}: paint order`);
      const gs = groups(els).filter(g => g.parent === lam).map(g => g.attrs.id);
      const want = ['board', P + 'Cu', P + 'Mask', P + 'Silk', 'drills', ...(res.cutouts.length ? ['cutouts'] : []), 'Edge.Cuts'];
      eq(gs.join(','), want.join(','), `${stem}-${kind}: groups in paint order`);
      for (const l of [P + 'Cu', P + 'Mask', P + 'Silk']) {
        const g = groups(els).find(g => g.attrs.id === l);
        assert.equal(shapesIn(g), expectedShapeCount(res.layers[l]), `${stem}-${kind}: ${l} shape count == prims`);
      }
      n++;
      const dr = groups(els).find(g => g.attrs.id === 'drills');
      eq(shapesIn(dr), res.drills.length, `${stem}-${kind}: one shape per drill (${res.drills.length})`);
      eq(dr.children.filter(c => c.name === 'circle').length, res.drills.filter(d => !(d.slotLen > 0)).length, `${stem}-${kind}: round drills are <circle>`);
      eq(dr.children.filter(c => c.name === 'polygon').length, res.drills.filter(d => d.slotLen > 0).length, `${stem}-${kind}: slots are <polygon>`);
      const board = groups(els).find(g => g.attrs.id === 'board');
      ok(board.children.length === 1 && board.children[0].name === 'path' && board.children[0].attrs.d.split('M').length === 2, `${stem}-${kind}: board is one filled path ring`);
      const edge = groups(els).find(g => g.attrs.id === 'Edge.Cuts');
      eq(edge.children[0].attrs.d.split('M').length - 1, 1 + res.cutouts.length, `${stem}-${kind}: edge path has outline + cutout rings`);
      // the outline ring spans exactly the board size
      const nums = board.children[0].attrs.d.match(/-?\d+(\.\d+)?/g).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
      ok(near(Math.min(...xs), 0, 1e-3) && near(Math.max(...xs), W, 1e-3) && near(Math.min(...ys), 0, 1e-3) && near(Math.max(...ys), H, 1e-3), `${stem}-${kind}: outline ring spans 0..W × 0..H`);
    }
    if (kind === 'layers') {
      const gs = groups(els).filter(g => g.parent === lam);
      const ids2 = gs.map(g => g.attrs.id);
      eq(ids2.join(','), ['Edge.Cuts', ...nonEmpty, 'Drills'].join(','), `${stem}-layers: one <g> per non-empty layer (+Edge.Cuts, Drills)`);
      for (const l of nonEmpty) {
        const g = gs.find(g => g.attrs.id === l);
        assert.equal(g.attrs['inkscape:groupmode'], 'layer', `${stem}-layers: ${l} is an Inkscape layer`);
        assert.equal(g.attrs['inkscape:label'], l, `${stem}-layers: ${l} label`);
        assert.equal(g.attrs.fill, LAYER_COLORS[l], `${stem}-layers: ${l} colour`);
        assert.equal(shapesIn(g), expectedShapeCount(res.layers[l]), `${stem}-layers: ${l} shape count == prims (${res.layers[l].length})`);
        assert.ok(shapesIn(g) > 0, `${stem}-layers: ${l} non-empty`);
      }
      n++;
      ok(!GRAPHIC_LAYERS.some(l => !nonEmpty.includes(l) && ids2.includes(l)), `${stem}-layers: empty layers get no group`);
      ok(svg.attrs['xmlns:inkscape'] === 'http://www.inkscape.org/namespaces/inkscape', `${stem}-layers: inkscape namespace declared`);
      eq(shapesIn(gs.find(g => g.attrs.id === 'Drills')), res.drills.length, `${stem}-layers: Drills group has one shape per drill`);
    }
    if (kind === 'outline') {
      const gs = groups(els).filter(g => g.parent === lam).map(g => g.attrs.id);
      eq(gs.join(','), 'Edge.Cuts,Drills', `${stem}-outline: only Edge.Cuts + Drills`);
      ok(els.filter(e => e.name !== 'svg' && e.name !== 'title' && e.name !== 'desc' && e.name !== 'g').every(e => e.attrs.fill === 'none' && e.attrs.stroke === '#000000' || e.parent.attrs.fill === 'none' && e.parent.attrs.stroke === '#000000'), `${stem}-outline: black hairlines, no fills`);
    }
    if (kind === 'top') rendered.push({ name: f.name, data: f.data });
  }
}
// ---------- specific geometry checks (MAIN) ----------
{
  const res = resolveBoard(doc2.boards[0], doc2, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
  const top = files2.find(f => f.name === 'MAIN-top.svg').data;
  const els = tokenizeSvg(top);
  // F.Cu trace [[30,40],[45,40],[45,33]] w0.4 → <polyline points="30,40 45,40 45,33" stroke-width="0.4"> in LAMINA coords (flip is on the group)
  ok(els.some(e => e.name === 'polyline' && e.attrs.points === '30,40 45,40 45,33' && e.attrs['stroke-width'] === '0.4' && e.attrs.fill === 'none'), 'MAIN-top: F.Cu trace polyline verbatim in mm, Y up');
  // via 0.8 → filled circle r0.4 at 45,40 in F.Cu; its 0.4 drill → white circle r0.2 in drills
  ok(els.some(e => e.name === 'circle' && e.attrs.cx === '45' && e.attrs.cy === '40' && e.attrs.r === '0.4' && e.attrs.stroke === 'none'), 'MAIN-top: via ring is a filled circle r0.4');
  ok(els.some(e => e.name === 'circle' && e.parent.attrs.id === 'drills' && e.attrs.cx === '45' && e.attrs.cy === '40' && e.attrs.r === '0.2' && e.attrs.fill === '#ffffff'), 'MAIN-top: via drill r0.2 white');
  // silk line 5,45→95,45 w0.3 and the arc → polyline
  ok(els.some(e => e.name === 'line' && e.attrs.x1 === '5' && e.attrs.y1 === '45' && e.attrs.x2 === '95' && e.attrs.y2 === '45' && e.attrs['stroke-width'] === '0.3'), 'MAIN-top: silk line verbatim');
  // 6 mm hole → circle r3 at 90,50 in drills; slot → polygon in drills
  ok(els.some(e => e.name === 'circle' && e.parent.attrs.id === 'drills' && e.attrs.cx === '90' && e.attrs.cy === '50' && e.attrs.r === '3'), 'MAIN-top: 6 mm hole');
  ok(els.some(e => e.name === 'polygon' && e.parent.attrs.id === 'drills'), 'MAIN-top: slot polygon');
  // cutout 46..54 × 27..33
  const cut = els.find(e => e.parent && e.parent.attrs.id === 'cutouts');
  ok(cut && cut.attrs.points.split(' ').every(p => { const [x, y] = p.split(',').map(Number); return x >= 46 - 1e-6 && x <= 54 + 1e-6 && y >= 27 - 1e-6 && y <= 33 + 1e-6; }), 'MAIN-top: cutout polygon within 46..54 × 27..33');
  // bottom-side text: B.Silk prims are polylines that are mirrored (as seen from top) — in the bottom file the group flips X so they read correctly; count matches
  const bot = tokenizeSvg(files2.find(f => f.name === 'MAIN-bottom.svg').data);
  eq(shapesIn(groups(bot).find(g => g.attrs.id === 'B.Silk')), expectedShapeCount(res.layers['B.Silk']), 'MAIN-bottom: B.Silk strokes present');
  ok(!bot.some(e => e.attrs.id === 'F.Silk' || e.attrs.id === 'F.Cu'), 'MAIN-bottom: no F.* layers');
  // opts.background paints a rect and colours holes with it
  const bg = exportSvg(doc2, { bitmapFor: fakeBitmapFor, boards: [0], background: '#ffffff' });
  eq(bg.length, 4, 'opts.boards=[0] → 4 files');
  const bels = tokenizeSvg(bg.find(f => f.name === 'MAIN-top.svg').data);
  ok(bels.some(e => e.name === 'rect' && e.parent.name === 'svg' && e.attrs.fill === '#ffffff' && attrMm(e.attrs.width) === null && near(+e.attrs.width, 100)), 'background rect emitted at root');
  // perLayer
  const pl = exportSvg(doc2, { bitmapFor: fakeBitmapFor, boards: [0], perLayer: true });
  const nonEmpty = nonEmptyLayers(res);
  eq(pl.length, 4 + nonEmpty.length, 'perLayer adds one file per non-empty layer');
  for (const l of nonEmpty) {
    const f = pl.find(f => f.name === `MAIN-${l.replace(/\./g, '_')}.svg`);
    assert.ok(f, `perLayer file for ${l}`);
    const e = tokenizeSvg(f.data);
    const g = groups(e).find(g => g.attrs.id === l);
    assert.ok(g && g.attrs.fill === '#000000' && shapesIn(g) === expectedShapeCount(res.layers[l]), `perLayer ${l}: black, all prims`);
  }
  n++;
}
// ---------- svgPrim unit checks ----------
{
  eq(svgPrim({ t: 'line', x1: 0, y1: 0, x2: 1, y2: 2, w: 0.2 }), '<line x1="0" y1="0" x2="1" y2="2" fill="none" stroke-width="0.2"/>', 'svgPrim line');
  eq(svgPrim({ t: 'polyline', pts: [[0, 0], [1, 1]], w: 0.1, closed: false }), '<polyline points="0,0 1,1" fill="none" stroke-width="0.1"/>', 'svgPrim open polyline');
  eq(svgPrim({ t: 'polyline', pts: [[0, 0], [1, 1], [0, 1]], w: 0.1, closed: true }), '<polygon points="0,0 1,1 0,1" fill="none" stroke-width="0.1"/>', 'svgPrim closed polyline → polygon');
  eq(svgPrim({ t: 'polyline', pts: [[2, 3]], w: 0.5 }), '<circle cx="2" cy="3" r="0.25" stroke="none"/>', 'svgPrim 1-point polyline → dot');
  eq(svgPrim({ t: 'circle', cx: 1, cy: 1, r: 2, w: 0 }), '<circle cx="1" cy="1" r="2" stroke="none"/>', 'svgPrim filled disc');
  eq(svgPrim({ t: 'circle', cx: 1, cy: 1, r: 2, w: 0.3 }), '<circle cx="1" cy="1" r="2" fill="none" stroke-width="0.3"/>', 'svgPrim ring');
  eq(svgPrim({ t: 'poly', pts: [[0, 0], [4, 0], [4, 4], [0, 4]], holes: [[[1, 1], [3, 1], [3, 3], [1, 3]]] }), '<path d="M0,0L4,0L4,4L0,4ZM1,1L3,1L3,3L1,3Z" fill-rule="evenodd" stroke="none"/>', 'svgPrim poly with hole → evenodd path');
  eq(svgPrim({ t: 'poly', pts: [[0, 0], [1, 1]] }), '', 'svgPrim degenerate poly → nothing');
  eq(svgPrim({ t: 'text', text: 'x' }), '', 'svgPrim text → nothing (must be flattened upstream)');
  ok(svgPrim({ t: 'arc', cx: 0, cy: 0, r: 1, a0: 0, a1: 90, w: 0.1 }).startsWith('<polyline points="1,0 '), 'svgPrim arc → polyline from a0');
  ok(svgPrim({ t: 'line', x1: 0, y1: 0, x2: 1, y2: 0, w: 0 }).includes('stroke-width="0.01"'), 'zero-width stroke clamped to 0.01');
  eq(svgPrim({ t: 'polyline', pts: [[1e-12, -0.00001], [1, 1]], w: 0.1 }), '<polyline points="0,0 1,1" fill="none" stroke-width="0.1"/>', 'no -0 / tiny values');
}
// ---------- one-board doc ----------
{
  const doc1 = oneBoardDoc();
  const f1 = exportSvg(doc1);
  eq(f1.length, 4, 'one-board → 4 files');
  const stem1 = safeName(doc1.boards[0].name);
  ok(f1.some(f => f.name === `${stem1}-top.svg`) && f1.some(f => f.name === `${stem1}-bottom.svg`), 'one-board top+bottom files named after the board');
  const els = tokenizeSvg(f1.find(f => f.name === `${stem1}-top.svg`).data);
  ok(near(attrMm(els[0].attrs.width), 50) && near(attrMm(els[0].attrs.height), 50), 'one-board 50×50 mm');
}

// ---------- optional: render one file with rsvg-convert / inkscape ----------
{
  const which = c => { try { return execFileSync('which', [c], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
  const rsvg = which('rsvg-convert'), ink = which('inkscape');
  if (rsvg || ink) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-svg-'));
    const src = path.join(dir, rendered[0].name); fs.writeFileSync(src, rendered[0].data);
    const png = path.join(dir, 'out.png');
    let good = false, tool = null;
    try {
      if (rsvg) { tool = 'rsvg-convert'; execFileSync(rsvg, ['-o', png, src], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 }); }
      else { tool = 'inkscape'; execFileSync(ink, ['--export-type=png', '--export-filename=' + png, src], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 }); }
      good = fs.existsSync(png) && fs.statSync(png).size > 100;
      if (good) { const hdr = fs.readFileSync(png).subarray(0, 8); good = hdr[0] === 0x89 && hdr[1] === 0x50 && hdr[2] === 0x4E && hdr[3] === 0x47; }
    } catch (e) { assert.fail(`${tool} failed to render ${rendered[0].name}: ` + String(e.stderr || e.message).slice(0, 400)); }
    ok(good, `${tool} rendered ${rendered[0].name} to PNG`);
    console.log(`${tool} smoke test: rendered ${rendered[0].name} OK`);
    fs.rmSync(dir, { recursive: true, force: true });
  } else console.log('neither rsvg-convert nor inkscape found — render smoke test skipped');
}

console.log(`svg: ${n} checks`);
console.log('ALL PASS');
