// node test/dxf.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { twoBoardDoc, oneBoardDoc, fakeBitmapFor } from './fixtures.mjs';
import { exportDxf, boardToDxf, DXF_LAYERS, OUTLINE_LAYER, DRILL_PTH, DRILL_NPTH } from '../js/export/dxf.js';
import { resolveBoard, GRAPHIC_LAYERS } from '../js/geom.js';
import { safeName } from '../js/export/common.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ---------- tiny DXF reader: group-code pairs → sections, layer table, entities ----------
export function parseDxf(text) {
  ok(text.endsWith('\r\n'), 'file ends with CRLF');
  const lines = text.split('\r\n');
  if (lines[lines.length - 1] === '') lines.pop();
  eq(lines.length % 2, 0, 'even number of lines (balanced code/value pairs)');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = lines[i], val = lines[i + 1];
    assert.ok(/^\s*\d+$/.test(code), `group code line ${i + 1} is a non-negative integer: "${code}"`);
    assert.ok(code.length >= 3 && code === String(+code).padStart(3, ' '), `group code right-justified in 3 columns: "${code}"`);
    pairs.push([+code, val]);
  }
  n++;
  // sections
  const sections = {}; let sec = null, secName = null;
  const tables = {}; let tab = null; // TABLE name → records
  const entities = []; let ent = null; let inEntities = false;
  const handles = new Set(); let dupHandle = null;
  let acadver = null, insunits = null, handseed = null, lastHeaderVar = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') { secName = pairs[i + 1][1]; assert.equal(pairs[i + 1][0], 2, 'SECTION followed by 2/name'); sec = []; sections[secName] = sec; inEntities = secName === 'ENTITIES'; continue; }
    if (c === 0 && v === 'ENDSEC') { sec = null; secName = null; inEntities = false; ent = null; continue; }
    if (c === 0 && v === 'EOF') { assert.equal(i, pairs.length - 1, 'EOF is the last pair'); continue; }
    if (secName === 'HEADER') { if (c === 9) lastHeaderVar = v; else if (lastHeaderVar === '$ACADVER' && c === 1) acadver = v; else if (lastHeaderVar === '$INSUNITS' && c === 70) insunits = +v; else if (lastHeaderVar === '$HANDSEED' && c === 5) handseed = v; }
    if (secName === 'TABLES') {
      if (c === 0 && v === 'TABLE') { const nm = pairs[i + 1][1]; tab = []; tables[nm] = tab; continue; }
      if (c === 0 && v === 'ENDTAB') { tab = null; continue; }
      if (c === 0 && tab) { tab.push({ type: v, attrs: [] }); continue; }
      if (tab && tab.length) tab[tab.length - 1].attrs.push([c, v]);
    }
    if (inEntities) {
      if (c === 0) { ent = { type: v, layer: null, handle: null, g: [] }; entities.push(ent); continue; }
      if (!ent) continue;
      if (c === 8) ent.layer = v; if (c === 5) { ent.handle = v; if (handles.has(v)) dupHandle = v; handles.add(v); }
      ent.g.push([c, v]);
    }
  }
  return { pairs, sections, tables, entities, acadver, insunits, handseed, dupHandle, handles };
}
const gval = (ent, code) => { const p = ent.g.find(g => g[0] === code); return p ? p[1] : undefined; };
const gvals = (ent, code) => ent.g.filter(g => g[0] === code).map(g => g[1]);
const layerRecords = p => (p.tables.LAYER || []).filter(r => r.type === 'LAYER').map(r => ({ name: r.attrs.find(a => a[0] === 2)?.[1], color: +r.attrs.find(a => a[0] === 62)?.[1] }));

// ---------- two-board doc ----------
const doc2 = twoBoardDoc();
const files2 = exportDxf(doc2, { bitmapFor: fakeBitmapFor });
ok(files2.some(f => f.name === 'dxf/README-dxf.txt' && /DipTrace/.test(f.data)), 'README-dxf.txt present');
eq(files2.filter(f => f.name.endsWith('.dxf')).length, doc2.boards.length, 'one .dxf per board');
const dxfWritten = [];
for (const b of doc2.boards) {
  const stem = safeName(b.name);
  const f = files2.find(f => f.name === `dxf/${stem}.dxf`);
  ok(f && typeof f.data === 'string', `${stem}: dxf/${stem}.dxf present`);
  const t = f.data;
  const res = resolveBoard(b, doc2, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
  const p = parseDxf(t);
  for (const s of ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']) ok(p.sections[s], `${stem}: SECTION ${s} present`);
  ok(/\r\n  0\r\nEOF\r\n$/.test(t), `${stem}: ends with 0/EOF`);
  eq(p.acadver, 'AC1015', `${stem}: $ACADVER = AC1015`);
  eq(p.insunits, 4, `${stem}: $INSUNITS = 4 (mm)`);
  ok(p.handseed && parseInt(p.handseed, 16) > Math.max(...[...p.handles].map(h => parseInt(h, 16))), `${stem}: $HANDSEED above every entity handle`);
  ok(!p.dupHandle, `${stem}: entity handles unique (dup: ${p.dupHandle})`);
  // layer table
  const layers = layerRecords(p);
  const names = layers.map(l => l.name);
  ok(names.includes('0'), `${stem}: layer 0 present`);
  for (const L of [OUTLINE_LAYER, DRILL_PTH, DRILL_NPTH]) ok(names.includes(L), `${stem}: layer table has ${L}`);
  eq(OUTLINE_LAYER, 'BoardOutline', 'outline layer is BoardOutline');
  const nonEmpty = GRAPHIC_LAYERS.filter(l => (res.layers[l] || []).length);
  for (const l of nonEmpty) ok(names.includes(DXF_LAYERS[l]), `${stem}: layer table has ${DXF_LAYERS[l]} (for ${l})`);
  ok(names.includes('TopSilk'), `${stem}: TopSilk in layer table`);
  ok(new Set(names).size === names.length, `${stem}: layer names unique`);
  const declared = +(p.tables.LAYER.find(r => r.type === 'TABLE') || { attrs: [] }).attrs.find(a => a[0] === 70)?.[1];
  ok(!Number.isFinite(declared) || declared >= layers.length, `${stem}: LAYER table max-count >= records`);
  // every entity sits on a declared layer, and has a handle + owner + AcDbEntity marker
  for (const e of p.entities) {
    assert.ok(names.includes(e.layer), `${stem}: entity ${e.type} on declared layer (${e.layer})`);
    assert.ok(e.handle, `${stem}: entity has a handle`);
    assert.equal(gval(e, 330), '1F', `${stem}: entity owner is model space`);
    assert.equal(gvals(e, 100)[0], 'AcDbEntity', `${stem}: first subclass marker AcDbEntity`);
  }
  n++;
  const types = new Set(p.entities.map(e => e.type));
  ok([...types].every(tp => ['LWPOLYLINE', 'LINE', 'ARC', 'CIRCLE', 'TEXT'].includes(tp)), `${stem}: only LWPOLYLINE/LINE/ARC/CIRCLE/TEXT entities (${[...types]})`);
  // outline: closed polyline(s) on BoardOutline; the board edge is one closed LWPOLYLINE with the resolved outline vertex count
  const outl = p.entities.filter(e => e.layer === OUTLINE_LAYER);
  ok(outl.length >= 1 && outl.every(e => e.type === 'LWPOLYLINE' && gval(e, 70) === '1'), `${stem}: BoardOutline has ≥1 closed LWPOLYLINE only`);
  eq(outl.length, 1 + res.cutouts.length, `${stem}: outline + ${res.cutouts.length} cutouts`);
  const edge = outl[0];
  eq(+gval(edge, 90), res.outline.length, `${stem}: outline vertex count == resolved outline (${res.outline.length})`);
  eq(gvals(edge, 10).length, res.outline.length, `${stem}: outline has one 10/20 pair per vertex`);
  const xs = gvals(edge, 10).map(Number), ys = gvals(edge, 20).map(Number);
  ok(near(Math.min(...xs), 0, 1e-3) && near(Math.min(...ys), 0, 1e-3) && near(Math.max(...xs), res.size[0], 1e-3) && near(Math.max(...ys), res.size[1], 1e-3), `${stem}: outline spans 0..W × 0..H (Y up, origin bottom-left)`);
  // drills: CIRCLE per round drill, closed LWPOLYLINE per slot, split by plating
  const drills = res.drills, round = drills.filter(d => !(d.slotLen > 0)), slots = drills.filter(d => d.slotLen > 0);
  const circPTH = p.entities.filter(e => e.type === 'CIRCLE' && e.layer === DRILL_PTH), circNPTH = p.entities.filter(e => e.type === 'CIRCLE' && e.layer === DRILL_NPTH);
  eq(circPTH.length + circNPTH.length, round.length, `${stem}: CIRCLE count on drill layers == non-slot drills (${round.length})`);
  eq(circPTH.length, round.filter(d => d.plated).length, `${stem}: Drill_PTH circles == plated round drills`);
  eq(circNPTH.length, round.filter(d => !d.plated).length, `${stem}: Drill_NPTH circles == non-plated round drills`);
  const slotEnts = p.entities.filter(e => e.type === 'LWPOLYLINE' && (e.layer === DRILL_PTH || e.layer === DRILL_NPTH));
  eq(slotEnts.length, slots.length, `${stem}: one closed polyline per slot (${slots.length})`);
  ok(slotEnts.every(e => gval(e, 70) === '1'), `${stem}: slot polylines closed`);
  for (const c of [...circPTH, ...circNPTH]) {
    const cx = +gval(c, 10), cy = +gval(c, 20), r = +gval(c, 40);
    assert.ok(round.some(d => near(d.x, cx, 1e-3) && near(d.y, cy, 1e-3) && near(d.d / 2, r, 1e-3)), `${stem}: drill circle ${cx},${cy} r${r} matches a resolved drill`);
  }
  n++;
  // graphic layers: entity count per layer >= prim count for prims that map 1:1 (line/arc/circle/polyline/poly)
  for (const l of nonEmpty) {
    const ents = p.entities.filter(e => e.layer === DXF_LAYERS[l]);
    const prims = res.layers[l];
    const expected = prims.reduce((s, pr) => s + (pr.t === 'poly' ? 1 + (pr.holes || []).length : 1), 0);
    assert.equal(ents.length, expected, `${stem}: ${DXF_LAYERS[l]} entity count == prims (${expected})`);
    for (const e of ents) if (e.type === 'LWPOLYLINE') assert.equal(+gval(e, 90), gvals(e, 10).length, `${stem}: LWPOLYLINE 90 == vertex count`);
  }
  n++;
  // text layers: <Layer>_TEXT with TEXT entities, one per non-blank text line of the unflattened resolve
  const resT = resolveBoard(b, doc2, { textAsStrokes: false, imagesAsPolys: false });
  for (const l of GRAPHIC_LAYERS) {
    const texts = (resT.layers[l] || []).filter(pr => pr.t === 'text' && String(pr.text ?? '').trim());
    const lines = texts.reduce((s, pr) => s + String(pr.text).split('\n').filter(x => x.trim()).length, 0);
    const ents = p.entities.filter(e => e.layer === DXF_LAYERS[l] + '_TEXT');
    assert.equal(ents.length, lines, `${stem}: ${DXF_LAYERS[l]}_TEXT has ${lines} TEXT entities`);
    if (lines) assert.ok(names.includes(DXF_LAYERS[l] + '_TEXT'), `${stem}: ${DXF_LAYERS[l]}_TEXT declared`);
    for (const e of ents) { assert.equal(e.type, 'TEXT'); assert.ok(gval(e, 1) != null && +gval(e, 40) > 0, 'TEXT has string + height'); }
  }
  n++;
  // colours: ACI on every layer record is a valid index
  ok(layers.every(l => Number.isInteger(l.color) && l.color >= 0 && l.color <= 256), `${stem}: layer colours are valid ACI`);
  // for ezdxf below
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-dxf-'));
  const fp = path.join(dir, `${stem}.dxf`); fs.writeFileSync(fp, t); dxfWritten.push({ fp, dir, stem, round: round.length, slots: slots.length, layers: names });
}
// MAIN specifics: fixture text 'LAMINA MAIN v1' as native TEXT (centered) and mirrored bottom text
{
  const p = parseDxf(files2.find(f => f.name === 'dxf/MAIN.dxf').data);
  const t = p.entities.find(e => e.type === 'TEXT' && gval(e, 1) === 'LAMINA MAIN v1');
  ok(t && t.layer === 'TopSilk_TEXT' && gval(t, 72) === '1' && near(+gval(t, 11), 50, 1e-6) && near(+gval(t, 21), 52, 1e-6) && near(+gval(t, 40), 2), 'MAIN: "LAMINA MAIN v1" TEXT centred at 50,52 height 2 on TopSilk_TEXT');
  const bt = p.entities.find(e => e.type === 'TEXT' && gval(e, 1) === 'bottom text');
  ok(bt && bt.layer === 'BottomSilk_TEXT' && gval(bt, 71) === '2', 'MAIN: bottom text is a mirrored (71=2) TEXT on BottomSilk_TEXT');
  // fixture arc 0..270 → ARC entity, and the 6 mm NPTH hole → CIRCLE r3 on Drill_NPTH
  ok(p.entities.some(e => e.type === 'ARC' && e.layer === 'TopSilk' && near(+gval(e, 10), 70) && near(+gval(e, 20), 30) && near(+gval(e, 40), 4) && near(+gval(e, 50), 0) && near(+gval(e, 51), 270)), 'MAIN: silk arc → ARC 0..270 r4 at 70,30');
  ok(p.entities.some(e => e.type === 'CIRCLE' && e.layer === DRILL_NPTH && near(+gval(e, 10), 90) && near(+gval(e, 20), 50) && near(+gval(e, 40), 3)), 'MAIN: 6 mm NPTH hole → CIRCLE r3 at 90,50');
  // fixture NPTH slot 15,15 len 8 w 2.2 rot 30 → closed LWPOLYLINE on Drill_NPTH whose bbox centre is 15,15
  const sl = p.entities.find(e => e.type === 'LWPOLYLINE' && e.layer === DRILL_NPTH);
  const xs = gvals(sl, 10).map(Number), ys = gvals(sl, 20).map(Number);
  ok(near((Math.min(...xs) + Math.max(...xs)) / 2, 15, 1e-3) && near((Math.min(...ys) + Math.max(...ys)) / 2, 15, 1e-3), 'MAIN: slot stadium centred at 15,15');
  ok(near(Math.max(...xs) - Math.min(...xs), (8 - 2.2) * Math.cos(30 * Math.PI / 180) + 2.2, 0.05), 'MAIN: slot X extent == (len-w)·cos30 + w');
  // cutout rect 8×6 at 50,30 → second BoardOutline polyline
  const cut = p.entities.filter(e => e.layer === OUTLINE_LAYER)[1];
  const cx = gvals(cut, 10).map(Number), cy = gvals(cut, 20).map(Number);
  ok(near(Math.min(...cx), 46) && near(Math.max(...cx), 54) && near(Math.min(...cy), 27) && near(Math.max(...cy), 33), 'MAIN: internal cutout 46..54 × 27..33 on BoardOutline');
  // trace on F.Cu → LWPOLYLINE with constant width 0.4 (43)
  ok(p.entities.some(e => e.type === 'LWPOLYLINE' && e.layer === 'TopCopper' && gval(e, 43) === '0.4' && gval(e, 70) === '0' && +gval(e, 90) === 3), 'MAIN: F.Cu trace → open LWPOLYLINE, 3 vertices, const width 0.4');
  // image on PANEL silk (fake bitmap) → filled polys on TopSilk
  const pp = parseDxf(files2.find(f => f.name === 'dxf/PANEL.dxf').data);
  ok(pp.entities.filter(e => e.layer === 'TopSilk' && e.type === 'LWPOLYLINE').length >= 2, 'PANEL: image + text strokes present on TopSilk');
}
// ---------- one-board doc + opts.boards ----------
{
  const doc1 = oneBoardDoc();
  const files1 = exportDxf(doc1);
  eq(files1.filter(f => f.name.endsWith('.dxf')).length, 1, 'one-board doc → 1 dxf');
  const p = parseDxf(files1[0].data);
  const res = resolveBoard(doc1.boards[0], doc1);
  eq(p.entities.filter(e => e.type === 'CIRCLE' && (e.layer === DRILL_PTH || e.layer === DRILL_NPTH)).length, res.drills.filter(d => !(d.slotLen > 0)).length, 'one-board drill circles == drills');
  const sub = exportDxf(doc2, { boards: [1] });
  eq(sub.filter(f => f.name.endsWith('.dxf')).length, 1, 'opts.boards=[1] → only PANEL');
  ok(sub[0].name === 'dxf/PANEL.dxf', 'opts.boards picks the right board');
  ok(boardToDxf(doc1.boards[0], doc1).startsWith('  0\r\nSECTION\r\n  2\r\nHEADER\r\n'), 'boardToDxf starts with HEADER section');
}

// ---------- optional: ezdxf load + audit ----------
{
  const py = 'python3';
  const has = () => { try { execFileSync(py, ['-c', 'import ezdxf'], { stdio: 'ignore' }); return true; } catch { return false; } };
  let ezdxf = has();
  if (!ezdxf) {
    for (const args of [[py, ['-m', 'pip', 'install', '--user', '--quiet', 'ezdxf']], ['pip', ['install', '--user', '--quiet', 'ezdxf']]]) {
      try { execFileSync(args[0], args[1], { stdio: 'ignore', timeout: 120000 }); } catch { /* try next */ }
      if (has()) { ezdxf = true; break; }
    }
  }
  if (ezdxf) {
    const script = `
import sys, json, ezdxf
from collections import Counter
out = []
for f in sys.argv[1:]:
    doc = ezdxf.readfile(f)
    a = doc.audit()
    msp = doc.modelspace()
    cnt = Counter((e.dxftype(), e.dxf.layer) for e in msp)
    out.append({ 'file': f, 'errors': [str(e) for e in a.errors], 'fixes': [str(e) for e in a.fixes], 'version': doc.dxfversion,
                 'units': doc.units, 'layers': [l.dxf.name for l in doc.layers],
                 'circles_drill': sum(v for (t, l), v in cnt.items() if t == 'CIRCLE' and l in ('Drill_PTH', 'Drill_NPTH')),
                 'outline_closed': sum(1 for e in msp.query('LWPOLYLINE[layer=="BoardOutline"]') if e.closed),
                 'entities': sum(cnt.values()) })
print(json.dumps(out))
`;
    let rep = null;
    try { rep = JSON.parse(execFileSync(py, ['-c', script, ...dxfWritten.map(w => w.fp)], { encoding: 'utf8', timeout: 120000 })); }
    catch (e) { assert.fail('ezdxf failed to load the DXF files: ' + String(e.stderr || e.message).slice(0, 800)); }
    for (const r of rep) {
      const w = dxfWritten.find(w => w.fp === r.file);
      eq(r.errors.length, 0, `ezdxf audit ${w.stem}: no errors (${r.errors.slice(0, 3).join(' | ')})`);
      if (r.fixes.length) console.log(`ezdxf audit ${w.stem}: ${r.fixes.length} auto-fix(es):`, r.fixes.slice(0, 5));
      eq(r.version, 'AC1015', `ezdxf ${w.stem}: version AC1015`);
      eq(r.units, 4, `ezdxf ${w.stem}: units = mm`);
      eq(r.circles_drill, w.round, `ezdxf ${w.stem}: drill CIRCLE count == ${w.round}`);
      ok(r.outline_closed >= 1, `ezdxf ${w.stem}: closed BoardOutline polyline`);
      for (const L of w.layers) assert.ok(r.layers.includes(L), `ezdxf ${w.stem}: layer ${L} read back`);
      n++;
    }
    console.log(`ezdxf: loaded + audited ${rep.length} files (${rep.map(r => r.entities).join('+')} entities), 0 errors`);
  } else console.log('ezdxf not available (import failed and pip install --user ezdxf did not succeed) — ezdxf audit skipped');
  for (const w of dxfWritten) fs.rmSync(w.dir, { recursive: true, force: true });
}

console.log(`dxf: ${n} checks`);
console.log('ALL PASS');
