// node test/kicad.test.mjs
// KiCad export/import round trip + kicad-cli validation (Flatpak shim ~/.local/bin/kicad-cli).
// Output dir: $LAMINA_TEST_OUT or <repo>/.tmp/kicad-test (inside $HOME so the Flatpak sandbox can read it — it cannot see
// /tmp; for a directory outside $HOME the runner falls back to `flatpak run --filesystem=<dir> --command=kicad-cli org.kicad.KiCad`).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { twoBoardDoc, oneBoardDoc, fakeBitmapFor } from './fixtures.mjs';
import { exportKicad, boardToKicad, KICAD_ORIGIN, KICAD_TEXT_SIZE_FACTOR, kq } from '../js/export/kicad.js';
import { importKicad, importKicadFootprint, parseSexpr } from '../js/import/kicad.js';
import { resolveBoard, outlineSize, bboxOfPoints, unionBBox } from '../js/geom.js';
import { newDocument, makeItem } from '../js/model.js';
import { safeName } from '../js/export/common.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`); n++; };

const REPO = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT = process.env.LAMINA_TEST_OUT || path.join(REPO, '.tmp', 'kicad-test');
fs.mkdirSync(OUT, { recursive: true });
const DEMO = '/var/lib/flatpak/app/org.kicad.KiCad/current/active/files/share/kicad/demos/pic_programmer/pic_programmer.kicad_pcb';

// ---------- kicad-cli runner ----------
const KICAD_CLI = path.join(os.homedir(), '.local', 'bin', 'kicad-cli');
const cleanEnv = () => { const e = { ...process.env }; delete e.APPDIR; delete e.APPIMAGE; return e; }; // AppImage vars leak into the Flatpak and break kiface loading
let cliMode = null; // 'shim' | 'flatpak' | 'none'
function kicadCli(args, cwd) {
  const opts = { cwd, env: cleanEnv(), timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] };
  const tryRun = (cmd, a) => { try { const out = execFileSync(cmd, a, opts).toString(); return { code: 0, out }; } catch (e) { return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') + (e.message || ''), err: e }; } };
  if (cliMode === null || cliMode === 'shim') {
    const r = tryRun(KICAD_CLI, args);
    if (r.code === 0) { cliMode = 'shim'; return r; }
    if (r.err && r.err.code === 'ENOENT') { cliMode = 'none'; return r; }
    if (!/does not exist or is not accessible/.test(r.out)) { cliMode = cliMode || 'shim'; return r; }
    // sandbox cannot see cwd → flatpak with the directory shared
  }
  const r2 = tryRun('flatpak', ['run', `--filesystem=${cwd}`, '--command=kicad-cli', 'org.kicad.KiCad', ...args]);
  if (r2.code === 0) cliMode = 'flatpak';
  else if (r2.err && r2.err.code === 'ENOENT') cliMode = 'none';
  return r2;
}
// render one or more layers of a .kicad_pcb to svg (returns svg text or throws on refusal)
function renderSvg(pcbFile, layers, tag) {
  const svg = `${path.basename(pcbFile, '.kicad_pcb')}-${tag}.svg`;
  if (fs.existsSync(path.join(OUT, svg))) fs.unlinkSync(path.join(OUT, svg));
  const r = kicadCli(['pcb', 'export', 'svg', '--mode-single', '--exclude-drawing-sheet', '--page-size-mode', '1', '--black-and-white', '--drill-shape-opt', '0', '--output', svg, '--layers', layers, path.basename(pcbFile)], OUT);
  if (cliMode === 'none') return null;
  assert.equal(r.code, 0, `kicad-cli refused ${path.basename(pcbFile)} (${layers}):\n${r.out}`);
  const text = fs.readFileSync(path.join(OUT, svg), 'utf8');
  assert.ok(text.length > 200 && /<svg/.test(text), `${svg} is not empty`);
  n++;
  return text;
}
// bbox of all drawn geometry in a kicad-cli svg (mm; strokes expanded by half width; <text> helpers ignored)
export function svgGeometry(text) {
  let bb = null; let count = 0;
  const grow = (x, y, e = 0) => { bb = bb ? [Math.min(bb[0], x - e), Math.min(bb[1], y - e), Math.max(bb[2], x + e), Math.max(bb[3], y + e)] : [x - e, y - e, x + e, y + e]; };
  const stack = [{ half: 0 }];
  const re = /<g\b([^>]*)>|<\/g>|<path\b([^>]*)\/>|<circle\b([^>]*)\/>/g;
  let m;
  const styleOf = attrs => { const sw = /stroke-width:\s*([\d.]+)/.exec(attrs); const none = /fill:\s*none/.test(attrs); return { half: none && sw ? +sw[1] / 2 : (sw && !/fill:\s*#/.test(attrs) ? 0 : 0), sw: sw ? +sw[1] : null, none }; };
  for (;;) {
    m = re.exec(text); if (!m) break;
    if (m[0].startsWith('<g')) { const st = styleOf(m[1]); const parent = stack[stack.length - 1]; stack.push({ half: st.sw != null ? (st.none ? st.sw / 2 : 0) : parent.half }); continue; }
    if (m[0] === '</g>') { if (stack.length > 1) stack.pop(); continue; }
    if (m[0].startsWith('<path')) {
      const attrs = m[2]; const d = /\sd="([^"]*)"/.exec(attrs); if (!d) continue;
      let half = stack[stack.length - 1].half;
      const own = /style="([^"]*)"/.exec(attrs); if (own) { const st = styleOf(own[1]); half = st.none && st.sw != null ? st.sw / 2 : 0; }
      count++;
      for (const c of d[1].matchAll(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/g)) grow(+c[1], +c[2], half);
      continue;
    }
    if (m[0].startsWith('<circle')) { const a = m[3]; const cx = +/cx="([^"]*)"/.exec(a)[1], cy = +/cy="([^"]*)"/.exec(a)[1], r = +/r="([^"]*)"/.exec(a)[1]; count++; grow(cx, cy, r + stack[stack.length - 1].half); }
  }
  return { bbox: bb, count };
}
const toK = (H) => ([x, y]) => [x + KICAD_ORIGIN.x, (H - y) + KICAD_ORIGIN.y];

// ---------- structural checks ----------
function structural(text, stem) {
  ok(text.startsWith('(kicad_pcb'), `${stem}: starts with (kicad_pcb`);
  ok(/\(version 20241229\)/.test(text), `${stem}: version 20241229`);
  ok(/\(generator "lamina"\)/.test(text) && /\(generator_version "0.1"\)/.test(text), `${stem}: generator lamina 0.1`);
  ok(/\(general \(thickness [\d.]+\) \(legacy_teardrops no\)\)/.test(text), `${stem}: general/thickness`);
  ok(/\(paper "A4"\)/.test(text), `${stem}: paper A4`);
  ok(/\(layers\s+\(0 "F.Cu" signal\)/.test(text) && /\(35 "F.Fab" user\)/.test(text), `${stem}: standard layer list`);
  ok(/\(stackup[\s\S]*\(color "/.test(text) && /\(pad_to_mask_clearance 0\)/.test(text) && /\(pcbplotparams/.test(text), `${stem}: setup/stackup/pcbplotparams`);
  ok(/\(net 0 ""\)/.test(text), `${stem}: net 0`);
  ok(/\(layer "Edge.Cuts"\)/.test(text), `${stem}: Edge.Cuts outline present`);
  // balanced parens (outside strings)
  let depth = 0, inStr = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; } if (c === '"') inStr = true; else if (c === '(') depth++; else if (c === ')') { depth--; assert.ok(depth >= 0, 'paren underflow'); } }
  eq(depth, 0, `${stem}: balanced parentheses`);
  const parsed = parseSexpr(text); eq(String(parsed[0][0]), 'kicad_pcb', `${stem}: re-parses`);
}

// ---------- 1. fixtures: export, validate, round trip ----------
const docs = [['two', twoBoardDoc()], ['one', oneBoardDoc()]];
for (const [tag, doc] of docs) {
  const files = exportKicad(doc, { bitmapFor: fakeBitmapFor });
  eq(files.length, doc.boards.length + 1, `${tag}: one file per board + README`);
  ok(files.some(f => f.name === 'kicad/README-kicad.txt' && f.data.length > 100), `${tag}: README present`);
  for (const b of doc.boards) {
    const stem = safeName(b.name);
    const f = files.find(x => x.name === `kicad/${stem}.kicad_pcb`); ok(f, `${tag}: kicad/${stem}.kicad_pcb`);
    structural(f.data, stem);
    const pcbPath = path.join(OUT, `${tag}-${stem}.kicad_pcb`);
    fs.writeFileSync(pcbPath, f.data);
    const svg = renderSvg(pcbPath, 'F.Cu,B.Cu,Edge.Cuts', 'cu');
    if (svg) ok(svgGeometry(svg).count > 0, `${tag}-${stem}: kicad-cli rendered geometry`);
    // ---- round trip ----
    const { board: rb, warnings } = importKicad(f.data);
    ok(Array.isArray(warnings), `${tag}-${stem}: importer returns warnings[]`);
    const [W0, H0] = outlineSize(b.outline), [W1, H1] = outlineSize(rb.outline);
    near(W1, W0, 0.01, `${stem} outline width`); near(H1, H0, 0.01, `${stem} outline height`);
    eq(rb.outline.type, b.outline.type, `${stem} outline type survives`);
    if (b.outline.type === 'rect') near(rb.outline.r || 0, b.outline.r || 0, 0.01, `${stem} corner radius`);
    near(rb.thickness, b.thickness, 1e-9, `${stem} thickness`);
    eq(rb.color, b.color, `${stem} mask colour survives via stackup`);
    const res0 = resolveBoard(b, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
    const doc1 = { ...doc, boards: [rb], stack: { enabled: false, gap: 0, links: [] } };
    const res1 = resolveBoard(rb, doc1, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
    eq(res1.parts.length, res0.parts.length, `${stem} same number of parts (${res0.parts.length})`);
    eq(res1.drills.length, res0.drills.length, `${stem} same number of drills (${res0.drills.length})`);
    eq(res1.pads.length, res0.pads.length, `${stem} same number of pads (${res0.pads.length})`);
    eq(res1.cutouts.length, res0.cutouts.length, `${stem} same number of cutouts`);
    const netsOf = (r, brd) => { const s = new Set(); for (const p of r.pads) if (p.net) s.add(p.net); for (const it of brd.items) if (['via', 'trace', 'region'].includes(it.type) && it.net) s.add(it.net); return Array.from(s).sort().join(','); };
    eq(netsOf(res1, rb), netsOf(res0, b), `${stem} nets preserved`);
    const padKey = r => r.pads.map(p => [+p.x.toFixed(2), +p.y.toFixed(2), p.layer, p.net || '', p.drill > 0 ? 1 : 0]).sort((a, c) => a[0] - c[0] || a[1] - c[1] || (a[2] < c[2] ? -1 : 1));
    const A = padKey(res0), B = padKey(res1);
    for (let i = 0; i < A.length; i++) { near(B[i][0], A[i][0], 0.02, `${stem} pad ${i} x`); near(B[i][1], A[i][1], 0.02, `${stem} pad ${i} y`); eq(B[i][2], A[i][2], `${stem} pad ${i} layer`); eq(B[i][3], A[i][3], `${stem} pad ${i} net`); }
    const drKey = r => r.drills.map(d => [+d.x.toFixed(2), +d.y.toFixed(2), +d.d.toFixed(2), +(d.slotLen || 0).toFixed(2), d.plated ? 1 : 0]).sort((a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2]);
    const D0 = drKey(res0), D1 = drKey(res1);
    for (let i = 0; i < D0.length; i++) { near(D1[i][0], D0[i][0], 0.02, `${stem} drill ${i} x`); near(D1[i][1], D0[i][1], 0.02, `${stem} drill ${i} y`); near(D1[i][2], D0[i][2], 0.01, `${stem} drill ${i} d`); near(D1[i][3], D0[i][3], 0.02, `${stem} drill ${i} slot`); eq(D1[i][4], D0[i][4], `${stem} drill ${i} plated`); }
    for (const p0 of res0.parts) {
      const p1 = res1.parts.find(p => p.ref === p0.ref); ok(p1, `${stem} part ${p0.ref} present after import`);
      near(p1.x, p0.x, 0.01, `${stem} ${p0.ref} x`); near(p1.y, p0.y, 0.01, `${stem} ${p0.ref} y`); eq(p1.side, p0.side, `${stem} ${p0.ref} side`);
      near(((p1.rot - p0.rot) % 360 + 360) % 360, 0, 0.01, `${stem} ${p0.ref} rot`);
    }
    // texts survive with size + layer
    const t0 = b.items.filter(i => i.type === 'text'), t1 = rb.items.filter(i => i.type === 'text');
    eq(t1.length, t0.length, `${stem} text items count`);
    for (const t of t0) { const m = t1.find(x => x.text === t.text); ok(m, `${stem} text "${t.text}" survives`); eq(m.layer, t.layer, `${stem} text layer`); near(m.size, t.size, 1e-6, `${stem} text size`); near(m.x, t.x, 0.02, `${stem} text x`); near(m.y, t.y, 0.02, `${stem} text y`); eq(!!m.mirror, !!t.mirror, `${stem} text mirror flag`); }
    // re-export the imported board: must load again
    const again = boardToKicad(rb, doc1, {});
    const againPath = path.join(OUT, `${tag}-${stem}-rt.kicad_pcb`);
    fs.writeFileSync(againPath, again);
    structural(again, stem + '-rt');
    renderSvg(againPath, 'F.Cu,B.Cu,Edge.Cuts', 'cu');
  }
}

// ---------- 2. rotation / side / text-size verification against kicad-cli renders ----------
{
  const doc = newDocument({ name: 'verify', w: 60, h: 40, r: 0 });
  const b = doc.boards[0];
  const H = 40, K = toK(H);
  // rotated bottom-side SMD part (roundrect pads → filled polygons in the svg)
  b.items.push(makeItem('part', { lib: 'r_0805', ref: 'R1', value: '', x: 20, y: 20, rot: 30, side: 'bottom' }));
  // rotated top-side SMD part
  b.items.push(makeItem('part', { lib: 'sot23', ref: 'Q1', value: '', x: 45, y: 15, rot: 45, side: 'top' }));
  const text = makeItem('text', { layer: 'F.SilkS'.replace('SilkS', 'Silk'), x: 10, y: 32, text: 'H', size: 5, thickness: 0.4, align: 'left' });
  b.items.push(text);
  const pcb = boardToKicad(b, doc, {});
  const pcbPath = path.join(OUT, 'verify.kicad_pcb');
  fs.writeFileSync(pcbPath, pcb);
  structural(pcb, 'verify');
  const res = resolveBoard(b, doc, { textAsStrokes: true });
  const padBox = layer => { let bb = null; for (const p of res.pads) if (p.layer === layer) bb = unionBBox(bb, bboxOfPoints(p.poly.map(K))); return bb; };
  const cmpBox = (got, want, tol, msg) => { for (let i = 0; i < 4; i++) near(got[i], want[i], tol, `${msg}[${i}]`); };
  const bcu = renderSvg(pcbPath, 'B.Cu', 'bcu');
  if (bcu) {
    const g = svgGeometry(bcu);
    ok(g.count >= 2, 'bottom part pads rendered on B.Cu');
    // in the KiCad Y-down frame the bbox from LAMINA is [minx, miny(from max LAMINA y), ...] — normalise
    const w = padBox('B'); const want = [Math.min(w[0], w[2]), Math.min(w[1], w[3]), Math.max(w[0], w[2]), Math.max(w[1], w[3])];
    cmpBox(g.bbox, want, 0.03, 'B.Cu pads of a 30°-rotated bottom part match LAMINA (rotation 1:1, X mirror, layer flip)');
  }
  const fcu = renderSvg(pcbPath, 'F.Cu', 'fcu');
  if (fcu) {
    const g = svgGeometry(fcu);
    ok(g.count >= 3, 'top part pads rendered on F.Cu');
    const w = padBox('F'); const want = [Math.min(w[0], w[2]), Math.min(w[1], w[3]), Math.max(w[0], w[2]), Math.max(w[1], w[3])];
    cmpBox(g.bbox, want, 0.03, 'F.Cu pads of a 45°-rotated top part match LAMINA (and none of the bottom part leaked)');
  }
  const silk = renderSvg(pcbPath, 'F.SilkS', 'silk');
  if (silk) {
    // only R1's ref is on B.SilkS; F.SilkS has Q1's ref (size 1) and our 'H' (size 5). Isolate the big H by bbox height.
    const g = svgGeometry(silk);
    ok(g.count > 0, 'silk rendered');
    // capital H of size 5: stroke centreline height must be 5 × factor; find the tallest path
    let tallest = null;
    for (const m of silk.matchAll(/<path[^>]*\sd="([^"]*)"/g)) { const pts = Array.from(m[1].matchAll(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/g)).map(c => [+c[1], +c[2]]); if (pts.length < 2) continue; const bb = bboxOfPoints(pts); if (!tallest || bb[3] - bb[1] > tallest[3] - tallest[1]) tallest = bb; }
    near(tallest[3] - tallest[1], 5 * KICAD_TEXT_SIZE_FACTOR, 0.05, 'KiCad cap height of a size-5 LAMINA text = 5 mm (size factor 1.0)');
    const [, baseK] = K([text.x, text.y]);
    near(tallest[3], baseK, 0.05, 'text baseline lands on the LAMINA baseline (bottom-justify anchor shift)');
    ok(tallest[0] > K([text.x, 0])[0], 'left-aligned text starts right of its anchor');
  }
  // importer inverse: text anchor / size / rotation and the bottom part come back
  const { board: rb } = importKicad(pcb);
  const rt = rb.items.find(i => i.type === 'text' && i.text === 'H');
  near(rt.size, 5, 1e-6, 'text size round trip'); near(rt.x, 10, 0.02, 'text x round trip'); near(rt.y, 32, 0.02, 'text y round trip');
  const r1 = rb.items.find(i => i.type === 'part' && i.ref === 'R1');
  eq(r1.side, 'bottom', 'R1 comes back on the bottom'); near(r1.x, 20, 0.01, 'R1 x'); near(r1.y, 20, 0.01, 'R1 y'); near(r1.rot, 30, 0.01, 'R1 rot');
  const res1 = resolveBoard(rb, { ...doc, boards: [rb] }, {});
  const centres = r => r.pads.map(p => [+p.x.toFixed(3), +p.y.toFixed(3), p.layer]).sort((a, c) => a[0] - c[0] || a[1] - c[1]);
  const c0 = centres(res), c1 = centres(res1);
  eq(c1.length, c0.length, 'pad count after round trip');
  for (let i = 0; i < c0.length; i++) { near(c1[i][0], c0[i][0], 0.02, `pad ${i} x after round trip`); near(c1[i][1], c0[i][1], 0.02, `pad ${i} y after round trip`); eq(c1[i][2], c0[i][2], `pad ${i} layer after round trip`); }
  const rq = rb.items.find(i => i.type === 'part' && i.ref === 'Q1');
  near(rq.rot, 45, 0.01, 'Q1 rot round trip'); eq(rq.side, 'top', 'Q1 side');
}

// ---------- 3. importer details ----------
{
  const p = parseSexpr('(a "q\\"x\\\\y\\nz" 1.5 (b c) d)');
  eq(String(p[0][0]), 'a', 'sexpr head'); eq(String(p[0][1]), 'q"x\\y\nz', 'sexpr string escapes'); eq(String(p[0][2]), '1.5', 'sexpr number token'); eq(String(p[0][3][1]), 'c', 'sexpr nesting');
  const mod = `(footprint "Test:R_0603" (version 20241229) (generator "pcbnew") (layer "F.Cu")
    (property "Reference" "REF**" (at 0 -1.43 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "R_0603" (at 0 1.43 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
    (attr smd)
    (fp_line (start -0.237258 -0.5225) (end 0.237258 -0.5225) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
    (fp_rect (start -1.48 -0.73) (end 1.48 0.73) (stroke (width 0.05) (type solid)) (fill no) (layer "F.CrtYd"))
    (fp_arc (start 0.5 0) (mid 0 0.5) (end -0.5 0) (stroke (width 0.1) (type solid)) (layer "F.Fab"))
    (pad "1" smd roundrect (at -0.825 0) (size 0.8 0.95) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
    (pad "2" smd roundrect (at 0.825 0 90) (size 0.8 0.95) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25))
    (pad "" np_thru_hole circle (at 0 2) (size 1 1) (drill 1) (layers "*.Cu" "*.Mask"))
  )`;
  const fp = importKicadFootprint(mod);
  eq(fp.name, 'R_0603', 'kicad_mod name'); eq(fp.pads.length, 2, 'kicad_mod pads'); eq(fp.holes.length, 1, 'kicad_mod np hole');
  eq(fp.pads[0].layer, 'F', 'smd pad layer F'); eq(fp.pads[0].shape, 'roundrect', 'roundrect shape'); near(fp.pads[0].x, -0.825, 1e-9, 'pad x'); near(fp.pads[1].rot, 90, 1e-9, 'pad rot');
  near(fp.holes[0].y, -2, 1e-9, 'hole y flipped to Y-up'); near(fp.courtyard.w, 2.96, 1e-6, 'courtyard from F.CrtYd'); near(fp.refPos.y, 1.43, 1e-9, 'refPos');
  const arc = fp.graphics.find(g => g.t === 'arc'); ok(arc && Math.abs(arc.r - 0.5) < 1e-6, 'fp_arc reconstructed r=0.5');
  // arc from (0.5,0) via (0,0.5) to (-0.5,0) in Y-down = the lower half on screen; in Y-up: from 0° through 270° (−90°) to 180° → CCW is 180→360
  near(((arc.a0 % 360) + 360) % 360, 180, 1e-6, 'fp_arc a0'); near(((arc.a1 % 360) + 360) % 360, 0, 1e-6, 'fp_arc a1');
  eq(fp.graphics.some(g => g.t === 'line' && g.layer === 'F.Silk'), true, 'fp_line → F.Silk');
}

// ---------- 4. KiCad demo board import + re-export ----------
if (fs.existsSync(DEMO)) {
  const txt = fs.readFileSync(DEMO, 'utf8');
  const { board, warnings } = importKicad(txt);
  ok(board.outline && outlineSize(board.outline)[0] > 100, 'demo: outline found (' + JSON.stringify(board.outline).slice(0, 60) + ')');
  eq(board.outline.type, 'rect', 'demo: 5 collinear Edge.Cuts lines → rect outline');
  const parts = board.items.filter(i => i.type === 'part');
  ok(parts.length > 20, `demo: >20 parts (${parts.length})`);
  ok(board.items.some(i => i.type === 'trace') && board.items.some(i => i.type === 'via') && board.items.some(i => i.type === 'region'), 'demo: traces, vias, zone imported');
  ok(warnings.length < 10, `demo: few warnings (${warnings.length})`);
  const doc = { ...newDocument({ name: 'pic' }), boards: [board] };
  const res = resolveBoard(board, doc, {});
  ok(res.pads.length > 100 && res.drills.length > 100, `demo: resolves (${res.pads.length} pads, ${res.drills.length} drills)`);
  ok(res.pads.some(p => p.net === 'GND') && res.pads.some(p => p.net === 'VCC'), 'demo: pad nets from the net table / names');
  const back = boardToKicad(board, doc, {});
  const backPath = path.join(OUT, 'pic-back.kicad_pcb');
  fs.writeFileSync(backPath, back);
  structural(back, 'pic-back');
  const svgBack = renderSvg(backPath, 'F.Cu', 'fcu');
  if (svgBack) {
    // compare against the original demo rendered by the same kicad-cli: same F.Cu element count (pads + track segments +
    // copper text strokes), and the F.Mask (pad openings only — no text) bbox has the same size. (The F.Cu bbox itself differs
    // slightly because the demo uses non-square font sizes, which LAMINA text cannot represent.)
    const origPath = path.join(OUT, 'pic-orig.kicad_pcb'); fs.copyFileSync(DEMO, origPath);
    const svgOrig = renderSvg(origPath, 'F.Cu', 'fcu');
    const g0 = svgGeometry(svgOrig), g1 = svgGeometry(svgBack);
    ok(Math.abs(g1.count - g0.count) <= Math.max(3, g0.count * 0.01), `demo: F.Cu element count ${g1.count} ≈ original ${g0.count}`);
    const m0 = svgGeometry(renderSvg(origPath, 'F.Mask', 'fmask')), m1 = svgGeometry(renderSvg(backPath, 'F.Mask', 'fmask'));
    eq(m1.count, m0.count, `demo: F.Mask element count ${m1.count} = original ${m0.count}`);
    near(m1.bbox[2] - m1.bbox[0], m0.bbox[2] - m0.bbox[0], 0.05, 'demo: F.Mask bbox width equals original');
    near(m1.bbox[3] - m1.bbox[1], m0.bbox[3] - m0.bbox[1], 0.05, 'demo: F.Mask bbox height equals original');
    // and the board sits at (20,20): the outline bbox min of the original (73.66, 40.64) maps to KICAD_ORIGIN
    near(m1.bbox[0] - m0.bbox[0], KICAD_ORIGIN.x - 73.66, 0.05, 'demo: x offset = origin shift');
    near(m1.bbox[1] - m0.bbox[1], KICAD_ORIGIN.y - 40.64, 0.05, 'demo: y offset = origin shift');
  }
} else console.log('  (KiCad demo not found at', DEMO, '— skipping demo import test)');

if (cliMode === 'none') console.log('  NOTE: kicad-cli not runnable on this machine — files were validated structurally only');
else console.log(`  kicad-cli validation via ${cliMode} (${OUT})`);
console.log(`ALL PASS (${n} checks)`);
