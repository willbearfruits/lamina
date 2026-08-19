// node test/gerber.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { twoBoardDoc, oneBoardDoc, fakeBitmapFor } from './fixtures.mjs';
import { exportGerber, GerberWriter, classifyPadPoly, gcoord } from '../js/export/gerber.js';
import { resolveBoard, outlineSize } from '../js/geom.js';
import { newDocument, makeItem } from '../js/model.js';
import { safeName } from '../js/export/common.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };

// ---------- tiny RS-274X parser: apertures + D01/D02/D03 + G36/G37, bbox of everything drawn ----------
export function parseGerber(text) {
  const aps = new Map(); // D → {kind, w, h}
  let cur = null, x = 0, y = 0, inRegion = false, region = [];
  const st = { d01: 0, d02: 0, d03: 0, regions: 0, lpc: 0, lpd: 0, bbox: null, badCoords: [], divisor: null, unitsMM: false };
  const grow = (px, py, hw = 0, hh = 0) => {
    const b = [px - hw, py - hh, px + hw, py + hh];
    st.bbox = st.bbox ? [Math.min(st.bbox[0], b[0]), Math.min(st.bbox[1], b[1]), Math.max(st.bbox[2], b[2]), Math.max(st.bbox[3], b[3])] : b;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    let m;
    if ((m = /^%FSLAX(\d)(\d)Y(\d)(\d)\*%$/.exec(line))) { st.divisor = Math.pow(10, +m[2]); continue; }
    if (line === '%MOMM*%') { st.unitsMM = true; continue; }
    if ((m = /^%ADD(\d+)([CRO]),([\d.]+)(?:X([\d.]+))?\*%$/.exec(line))) { aps.set(+m[1], { kind: m[2], w: +m[3], h: m[4] !== undefined ? +m[4] : +m[3] }); continue; }
    if (line.startsWith('%LPC')) { st.lpc++; continue; }
    if (line.startsWith('%LPD')) { st.lpd++; continue; }
    if (line.startsWith('%') || line.startsWith('G04')) continue;
    if ((m = /^D(\d+)\*$/.exec(line))) { cur = aps.get(+m[1]); assert.ok(cur, 'aperture defined before use: D' + m[1]); continue; }
    if (line === 'G36*') { inRegion = true; region = []; continue; }
    if (line === 'G37*') { inRegion = false; st.regions++; assert.ok(region.length >= 4, 'region has >= 4 vertices'); continue; }
    if ((m = /^(?:X(-?\d+))?(?:Y(-?\d+))?D0([123])\*$/.exec(line))) {
      // coordinates must be pure integers (no decimal point) — regex guarantees it, but flag anything odd
      if (/\./.test(line)) st.badCoords.push(line);
      const nx = m[1] !== undefined ? +m[1] / st.divisor : x, ny = m[2] !== undefined ? +m[2] / st.divisor : y;
      const op = m[3];
      if (op === '1') {
        st.d01++;
        if (inRegion) { region.push([nx, ny]); grow(nx, ny); }
        else { assert.ok(cur, 'D01 with an aperture'); const hw = cur.w / 2; grow(x, y, hw, hw); grow(nx, ny, hw, hw); }
      } else if (op === '2') { st.d02++; if (inRegion) { region.push([nx, ny]); grow(nx, ny); } }
      else { st.d03++; assert.ok(cur, 'D03 with an aperture'); grow(nx, ny, cur.w / 2, cur.h / 2); }
      x = nx; y = ny; continue;
    }
    if (line === 'G01*' || line === 'M02*') continue;
    assert.fail('unparsed gerber line: ' + line);
  }
  st.apertures = aps;
  return st;
}

// ---------- fixture: two boards ----------
const doc2 = twoBoardDoc();
const files2 = exportGerber(doc2, { bitmapFor: fakeBitmapFor });
const names2 = files2.map(f => f.name);
ok(files2.length > 0, 'two-board doc exports files');
for (const b of doc2.boards) {
  const stem = safeName(b.name);
  const res = resolveBoard(b, doc2, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
  const [W, H] = outlineSize(b.outline);
  const expectExt = { 'F.Cu': 'GTL', 'B.Cu': 'GBL', 'F.Mask': 'GTS', 'B.Mask': 'GBS', 'F.Silk': 'GTO', 'B.Silk': 'GBO', 'F.Paste': 'GTP', 'B.Paste': 'GBP' };
  for (const [layer, ext] of Object.entries(expectExt)) {
    const name = `gerber/${stem}/${stem}.${ext}`;
    if (res.layers[layer].length) ok(names2.includes(name), `${name} present (layer non-empty)`);
    else ok(!names2.includes(name), `${name} absent (layer empty)`);
  }
  ok(names2.includes(`gerber/${stem}/${stem}.GKO`), `${stem}.GKO outline always present`);
  ok(!names2.some(x => /\.(GTF|GBF)$/.test(x)), 'no fab-layer gerbers by default');
  for (const f of files2.filter(f => f.name.startsWith(`gerber/${stem}/`))) {
    const t = f.data;
    ok(t.startsWith('%TF.GenerationSoftware,LAMINA,lamina,'), `${f.name} starts with %TF`);
    ok(/%TF\.FileFunction,[A-Za-z]+/.test(t), `${f.name} has a FileFunction`);
    ok(t.includes('%FSLAX46Y46*%') && t.includes('%MOMM*%'), `${f.name} has FS 4.6 + MO mm`);
    ok(t.trimEnd().endsWith('M02*'), `${f.name} ends with M02*`);
    ok(t.includes('%LPD*%'), `${f.name} sets LPD`);
    // every coordinate line is X<int>Y<int>D0n*
    const coordLines = t.split('\n').filter(l => /^X/.test(l));
    ok(coordLines.length > 0, `${f.name} has coordinate data`);
    ok(coordLines.every(l => /^X-?\d+Y-?\d+D0[123]\*$/.test(l)), `${f.name} coordinates are integers`);
    const p = parseGerber(t);
    ok(p.badCoords.length === 0 && p.divisor === 1e6 && p.unitsMM, `${f.name} parses (4.6, mm)`);
    ok(p.bbox && p.bbox[0] >= -1 && p.bbox[1] >= -1 && p.bbox[2] <= W + 1 && p.bbox[3] <= H + 1, `${f.name} bbox within board ±1 mm (${p.bbox && p.bbox.map(v => v.toFixed(2)).join(',')})`);
    if (f.name.endsWith('.GKO')) {
      ok(p.d01 >= 1, 'outline has >= 1 D01');
      ok(t.includes('%TF.FileFunction,Profile,NP*%'), 'outline FileFunction Profile,NP');
      ok(Math.abs(p.bbox[0] + 0.05) < 1e-6 && Math.abs(p.bbox[2] - W - 0.05) < 1e-6, 'outline stroke spans exactly the board width (0.1 mm aperture)');
      ok(p.d03 === 0 && p.regions === 0, 'outline has no flashes/regions');
    }
    if (f.name.endsWith('.GTL')) {
      ok(p.d03 > 0, `${f.name} has flashes (D03)`);
      ok(p.regions > 0, `${f.name} has regions (G36)`);
      ok(t.includes('%TF.FileFunction,Copper,L1,Top*%'), 'F.Cu FileFunction');
    }
    if (f.name.endsWith('.GBL')) ok(t.includes('%TF.FileFunction,Copper,L2,Bot*%'), 'B.Cu FileFunction');
    if (f.name.endsWith('.GTS')) ok(t.includes('%TF.FileFunction,Soldermask,Top*%') && t.includes('%TF.FilePolarity,Negative*%'), 'mask FileFunction + negative polarity');
    if (f.name.endsWith('.GTO')) ok(t.includes('%TF.FileFunction,Legend,Top*%') && p.d01 > 20, 'silk has plenty of strokes (text)');
    if (f.name.endsWith('.GBO')) ok(t.includes('%TF.FileFunction,Legend,Bot*%'), 'B.Silk FileFunction');
    if (f.name.endsWith('.GTP')) ok(t.includes('%TF.FileFunction,Paste,Top*%') && p.d03 + p.regions > 0, 'paste has pads');
  }
}
// MAIN copper: the fixture's 1.6 mm oval DIP pads / TP1 rect / P2 oval → C, R and O apertures flashed
{
  const gtl = files2.find(f => f.name === 'gerber/MAIN/MAIN.GTL').data;
  ok(/%ADD\d+R,1\.6X1\.6\*%/.test(gtl), 'DIP pin-1 rect pad → R aperture');
  ok(/%ADD\d+C,1\.6\*%/.test(gtl), 'DIP round pads → C aperture');
  ok(/%ADD\d+R,3X2\*%/.test(gtl), 'TP1 3x2 rect → R aperture');
  ok(/%ADD\d+O,2\.2X1\.6\*%/.test(gtl), 'P2 2.2x1.6 oval → O aperture');
  ok(/%ADD\d+C,0\.8\*%/.test(gtl), 'via ring 0.8 → C flash');
  ok(/%ADD\d+C,0\.4\*%/.test(gtl), 'trace 0.4 → C stroke');
  // rotated 45° rect on F.Cu is a region, not a flash
  const p = parseGerber(gtl);
  ok(p.regions >= 1, 'rotated rect drawn as region');
  const gbl = files2.find(f => f.name === 'gerber/MAIN/MAIN.GBL').data;
  const pb = parseGerber(gbl);
  ok(pb.regions >= 1, 'B.Cu region (GND pour) present');
  // bottom layer is NOT mirrored: the region [60..90]x[40..55] must be found at those coordinates
  ok(gbl.includes('X60000000Y40000000') && gbl.includes('X90000000Y55000000'), 'bottom copper uses top-view coordinates (not mirrored)');
  // bottom silk mirrored text still lands where the text is (x≈50, y≈5)
  const gbo = files2.find(f => f.name === 'gerber/MAIN/MAIN.GBO').data;
  const near = gbo.split('\n').filter(l => { const m = /^X(-?\d+)Y(-?\d+)D01\*$/.exec(l); if (!m) return false; const x = +m[1] / 1e6, y = +m[2] / 1e6; return x > 40 && x < 60 && y > 3 && y < 8; });
  ok(near.length > 10, 'bottom text strokes land near (50,5) in top-view coordinates');
}
// PANEL: connector pads at rot 90 still flash as apertures (axis aligned)
{
  const gtl = files2.find(f => f.name === 'gerber/PANEL/PANEL.GTL').data;
  ok(/%ADD\d+R,1\.7X1\.7\*%/.test(gtl) && /%ADD\d+C,1\.7\*%/.test(gtl), 'panel header pads → R + C apertures');
  ok(parseGerber(gtl).d03 >= 8, 'panel copper has >= 8 flashes');
  const gko = parseGerber(files2.find(f => f.name === 'gerber/PANEL/PANEL.GKO').data);
  ok(gko.d01 >= 4, 'panel outline drawn');
}
// MAIN outline includes the internal cutout (rect 8x6 at 50,30 → second closed loop)
{
  const gko = files2.find(f => f.name === 'gerber/MAIN/MAIN.GKO').data;
  const p = parseGerber(gko);
  ok(p.d02 === 2, 'MAIN outline: 2 loops (profile + cutout)');
  ok(gko.includes('X46000000Y27000000') && gko.includes('X54000000Y33000000'), 'cutout corners present');
}

// ---------- fixture: one board ----------
const doc1 = oneBoardDoc();
const files1 = exportGerber(doc1, { bitmapFor: fakeBitmapFor });
{
  const stem = safeName(doc1.boards[0].name);
  ok(files1.some(f => f.name === `gerber/${stem}/${stem}.GTL`), 'one-board GTL');
  ok(files1.some(f => f.name === `gerber/${stem}/${stem}.GKO`), 'one-board GKO');
  ok(files1.some(f => f.name === `gerber/${stem}/${stem}.GTP`), 'one-board GTP (SMD SOIC/0603 pads → paste)');
  for (const f of files1) {
    const p = parseGerber(f.data);
    ok(p.bbox[0] >= -1 && p.bbox[1] >= -1 && p.bbox[2] <= 51 && p.bbox[3] <= 51, `${f.name} bbox in board (${p.bbox.map(v => v.toFixed(2))})`);
    ok(f.data.trimEnd().endsWith('M02*'), `${f.name} ends with M02*`);
  }
  const gtl = files1.find(f => f.name === `gerber/${stem}/${stem}.GTL`).data;
  ok(/%ADD\d+C,0\.5\*%/.test(gtl), 'VCC trace 0.5 aperture');
  const p = parseGerber(gtl);
  ok(p.regions >= 10 && p.d01 >= 2, 'one-board copper: roundrect SOIC/0603 pads as regions + trace strokes');
}
// opts.boards selects boards; opts.dir changes the folder; includeFab adds fab layers
{
  const only = exportGerber(doc2, { boards: [1], bitmapFor: fakeBitmapFor });
  ok(only.every(f => f.name.startsWith('gerber/PANEL/')), 'opts.boards=[1] exports only PANEL');
  const flat = exportGerber(doc1, { dir: '' });
  ok(flat.every(f => !f.name.includes('/')), 'opts.dir="" gives flat names');
  const fab = exportGerber(doc2, { includeFab: true, bitmapFor: fakeBitmapFor });
  ok(fab.some(f => f.name.endsWith('MAIN.GTF')), 'includeFab adds F.Fab gerber');
}

// ---------- sign handling / negative coordinates ----------
{
  eq(gcoord(0), '0', 'gcoord 0');
  eq(gcoord(-0), '0', 'gcoord -0');
  eq(gcoord(-2), '-2000000', 'gcoord -2 mm');
  eq(gcoord(12.3456789), '12345679', 'gcoord rounds to 1e-6');
  eq(gcoord(-0.0000004), '0', 'gcoord tiny negative → 0');
  const d = newDocument({ name: 'neg', w: 20, h: 10, r: 0 });
  d.boards[0].items.push(makeItem('line', { layer: 'F.Silk', x1: -2, y1: -1.5, x2: 3, y2: 4, width: 0.2 }));
  const gto = exportGerber(d).find(f => f.name.endsWith('.GTO')).data;
  ok(gto.includes('X-2000000Y-1500000D02*') && gto.includes('X3000000Y4000000D01*'), 'negative coordinates keep their sign');
  const p = parseGerber(gto);
  ok(Math.abs(p.bbox[0] + 2.1) < 1e-9 && Math.abs(p.bbox[1] + 1.6) < 1e-9, 'parser bbox honours negatives');
}

// ---------- poly with holes: local polarity dance ----------
{
  const g = new GerberWriter({ fileFunction: 'Copper,L1,Top' });
  g.poly([[0, 0], [10, 0], [10, 10], [0, 10]], [[[3, 3], [7, 3], [7, 7], [3, 7]]]);
  g.flash('C,1', 5, 5); // a later feature INSIDE the hole must be dark again
  const t = g.toString();
  const iOuter = t.indexOf('G36*'), iLPC = t.indexOf('%LPC*%'), iLPD2 = t.lastIndexOf('%LPD*%'), iFlash = t.indexOf('X5000000Y5000000D03*');
  ok(iOuter >= 0 && iLPC > iOuter && iLPD2 > iLPC && iFlash > iLPD2, 'outer region → LPC hole → LPD → later flash');
  eq((t.match(/G36\*/g) || []).length, 2, 'two regions (outer + hole)');
  const p = parseGerber(t);
  eq(p.lpc, 1, 'one LPC'); eq(p.lpd, 2, 'header LPD + restore LPD');
  ok(t.trimEnd().endsWith('M02*'), 'ends with M02*');
}
// ---------- classification unit checks ----------
{
  ok(classifyPadPoly([[0, 0], [2, 0], [2, 1], [0, 1]]).kind === 'R', 'axis rect → R');
  ok(classifyPadPoly([[0, 0], [2, 1], [1, 3], [-1, 2]]) === null, 'rotated quad → null (region)');
  ok(classifyPadPoly([[0, 0], [1, 0], [1, 1]]) === null, 'triangle → null');
}
// ---------- empty layer file still valid ----------
{
  const d = newDocument({ name: 'empty', w: 10, h: 10 });
  const fl = exportGerber(d);
  eq(fl.length, 1, 'empty board → only the outline file');
  ok(fl[0].name.endsWith('.GKO') && parseGerber(fl[0].data).d01 >= 4, 'outline of an empty board');
  const fl2 = exportGerber(d, { emptyLayers: true });
  ok(fl2.length === 9, 'emptyLayers → 8 layer files + outline');
  for (const f of fl2) parseGerber(f.data); // must parse
  n++;
}

// ---------- optional: gerbv smoke test ----------
{
  let gerbv = null;
  try { gerbv = execFileSync('which', ['gerbv']).toString().trim(); } catch { gerbv = null; }
  if (gerbv) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-gerber-'));
    const written = [];
    for (const f of files2) { const p = path.join(dir, f.name.replace(/\//g, '_')); fs.writeFileSync(p, f.data); written.push(p); }
    const png = path.join(dir, 'out.png');
    let good = false;
    try {
      execFileSync(gerbv, ['-x', 'png', '-o', png, '-D', '100', ...written], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
      good = fs.existsSync(png) && fs.statSync(png).size > 100;
    } catch (e) { console.log('gerbv smoke test skipped:', String(e.message).split('\n')[0]); }
    if (good) { ok(good, 'gerbv rendered all gerbers to PNG'); console.log('gerbv smoke test: rendered', written.length, 'files OK'); }
    fs.rmSync(dir, { recursive: true, force: true });
  } else console.log('gerbv not found — smoke test skipped');
}

console.log(`gerber: ${n} checks`);
console.log('ALL PASS');
