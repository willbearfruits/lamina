// node test/pdf.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { twoBoardDoc, oneBoardDoc, fakeBitmapFor } from './fixtures.mjs';
import { exportPdf, buildPdf, pdfString, pdfTextString, PAPERS } from '../js/export/pdf.js';
import { nonEmptyLayers } from '../js/export/svg.js';
import { resolveBoard } from '../js/geom.js';
import { safeName } from '../js/export/common.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const PT = 72 / 25.4;

// ---------- tiny PDF structure parser: objects, xref, trailer, pages ----------
export function parsePdf(text) {
  const buf = Buffer.from(text, 'latin1');
  eq(buf.length, text.length, 'PDF is pure single-byte (ASCII) so string offsets == byte offsets');
  ok(/^%PDF-1\.\d\n/.test(text), 'starts with %PDF-1.x');
  ok(text.endsWith('%%EOF\n'), 'ends with %%EOF');
  for (let i = 0; i < buf.length; i++) assert.ok(buf[i] < 0x7F && (buf[i] >= 0x20 || buf[i] === 0x0A), `byte ${i} is printable ASCII / LF (got 0x${buf[i].toString(16)})`);
  n++;
  // objects with their byte offsets
  const objs = new Map(); const re = /(\d+) (\d+) obj\n/g; let m;
  while ((m = re.exec(text))) {
    if (m.index > 0 && text[m.index - 1] !== '\n') continue;
    const num = +m[1]; assert.ok(!objs.has(num), `object ${num} defined once`);
    const end = text.indexOf('\nendobj\n', m.index); assert.ok(end > 0, `object ${num} has endobj`);
    objs.set(num, { offset: m.index, gen: +m[2], body: text.slice(m.index + m[0].length, end) });
  }
  // xref
  const xi = text.lastIndexOf('\nxref\n'); ok(xi > 0, 'xref keyword present');
  const xrefOffset = xi + 1;
  const sx = /startxref\n(\d+)\n%%EOF\n$/.exec(text); ok(sx, 'startxref before %%EOF');
  eq(+sx[1], xrefOffset, 'startxref points at the xref table');
  const hdr = /^xref\n(\d+) (\d+)\n/.exec(text.slice(xrefOffset)); ok(hdr, 'xref subsection header');
  eq(+hdr[1], 0, 'xref subsection starts at object 0');
  const count = +hdr[2];
  eq(count, objs.size + 1, 'xref count == objects + free entry 0');
  const entriesStart = xrefOffset + hdr[0].length;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = text.slice(entriesStart + i * 20, entriesStart + (i + 1) * 20);
    assert.ok(/^\d{10} \d{5} [nf] \n$/.test(e), `xref entry ${i} is exactly 20 bytes "nnnnnnnnnn ggggg n \\n": ${JSON.stringify(e)}`);
    entries.push({ offset: +e.slice(0, 10), gen: +e.slice(11, 16), type: e[17] });
  }
  n++;
  ok(entries[0].type === 'f' && entries[0].gen === 65535, 'entry 0 is the free head (65535 f)');
  for (let i = 1; i < count; i++) {
    const o = objs.get(i);
    assert.ok(o, `object ${i} exists`);
    assert.equal(entries[i].type, 'n', `xref entry ${i} in use`);
    assert.equal(entries[i].offset, o.offset, `xref offset of object ${i} == actual byte offset (${entries[i].offset} vs ${o.offset})`);
    assert.equal(entries[i].gen, 0, `object ${i} generation 0`);
    assert.equal(text.slice(o.offset, o.offset + `${i} 0 obj`.length), `${i} 0 obj`, `bytes at offset really start "${i} 0 obj"`);
  }
  n++;
  ok(text.slice(entriesStart + count * 20).startsWith('trailer\n<<'), 'trailer follows the xref entries');
  const trailer = /trailer\n<<(.*)>>\nstartxref/s.exec(text)[1];
  const size = +/\/Size (\d+)/.exec(trailer)[1], root = +/\/Root (\d+) 0 R/.exec(trailer)[1], info = /\/Info (\d+) 0 R/.exec(trailer);
  eq(size, count, '/Size == xref count');
  const cat = objs.get(root); ok(cat && /\/Type \/Catalog/.test(cat.body), '/Root → Catalog');
  const pagesNum = +/\/Pages (\d+) 0 R/.exec(cat.body)[1];
  const pagesObj = objs.get(pagesNum); ok(pagesObj && /\/Type \/Pages/.test(pagesObj.body), 'Catalog /Pages → Pages');
  const kids = [...pagesObj.body.matchAll(/(\d+) 0 R/g)].map(k => +k[1]).filter(k => k !== pagesNum);
  const declaredCount = +/\/Count (\d+)/.exec(pagesObj.body)[1];
  eq(kids.length, declaredCount, 'Pages /Count == number of /Kids');
  const pages = [];
  for (const k of kids) {
    const pg = objs.get(k); assert.ok(pg && /\/Type \/Page\b/.test(pg.body) && !/\/Type \/Pages/.test(pg.body), `kid ${k} is a Page`);
    assert.equal(+/\/Parent (\d+) 0 R/.exec(pg.body)[1], pagesNum, `page ${k} /Parent`);
    const mb = /\/MediaBox \[([\d. ]+)\]/.exec(pg.body)[1].split(' ').map(Number);
    const cnum = +/\/Contents (\d+) 0 R/.exec(pg.body)[1];
    const cobj = objs.get(cnum); assert.ok(cobj, `page ${k} content object ${cnum}`);
    const sm = /^<< \/Length (\d+) >>\nstream\n([\s\S]*)endstream$/.exec(cobj.body); assert.ok(sm, `content ${cnum} is a stream with /Length`);
    assert.equal(+sm[1], sm[2].length, `content ${cnum} /Length == stream bytes (${sm[1]} vs ${sm[2].length})`);
    const fontRef = +/\/Font << \/F1 (\d+) 0 R >>/.exec(pg.body)[1];
    assert.ok(/\/Type \/Font/.test(objs.get(fontRef).body) && /\/Helvetica/.test(objs.get(fontRef).body), 'page font is Helvetica');
    pages.push({ num: k, mediaBox: mb, content: sm[2] });
  }
  n++;
  const allPageObjs = [...objs.values()].filter(o => /\/Type \/Page\b/.test(o.body) && !/\/Type \/Pages/.test(o.body));
  eq(allPageObjs.length, pages.length, 'every /Type /Page object is reachable from /Kids');
  const infoObj = info ? objs.get(+info[1]) : null;
  return { objs, pages, count: declaredCount, trailer, infoObj, catalog: cat };
}
// operator-level sanity of a content stream: q/Q balanced, BT/ET balanced, only known operators, numbers finite
function checkContent(cs, label) {
  const toks = cs.split(/\s+/).filter(Boolean);
  let q = 0, bt = 0, minQ = 0; const OPS = new Set(['q', 'Q', 'cm', 'w', 'J', 'j', 'rg', 'RG', 'gs', 'm', 'l', 'c', 'h', 'f', 'f*', 'S', 'B', 'BT', 'ET', 'Tf', 'Tm', 'Tj', 're', 'n', 'W']);
  let inStr = 0;
  for (const t of toks) {
    if (inStr) { if (/\)$/.test(t) && !/\\\)$/.test(t)) inStr = 0; continue; }
    if (t[0] === '(') { if (!(/\)$/.test(t) && !/\\\)$/.test(t)) || t === '(') inStr = 1; continue; }
    if (t[0] === '/') continue; // name
    if (/^-?\d*\.?\d+$/.test(t)) { assert.ok(Number.isFinite(+t), `${label}: numeric token`); continue; }
    assert.ok(OPS.has(t), `${label}: known operator "${t}"`);
    if (t === 'q') q++; else if (t === 'Q') { q--; minQ = Math.min(minQ, q); } else if (t === 'BT') bt++; else if (t === 'ET') bt--;
  }
  assert.equal(q, 0, `${label}: q/Q balanced`); assert.equal(minQ, 0, `${label}: never more Q than q`); assert.equal(bt, 0, `${label}: BT/ET balanced`);
  assert.ok(!/NaN|Infinity|undefined/.test(cs), `${label}: no NaN/Infinity/undefined`);
}

// ---------- two-board doc ----------
const doc2 = twoBoardDoc();
const files2 = exportPdf(doc2, { bitmapFor: fakeBitmapFor });
eq(files2.length, doc2.boards.length, 'one PDF per board');
const written = [];
for (const b of doc2.boards) {
  const stem = safeName(b.name);
  const f = files2.find(f => f.name === `${stem}.pdf`);
  ok(f && typeof f.data === 'string', `${stem}.pdf present (string)`);
  const res = resolveBoard(b, doc2, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
  const [W, H] = res.size;
  const layers = nonEmptyLayers(res);
  const p = parsePdf(f.data);
  const claimed = 2 + layers.length; // top + bottom + one page per non-empty layer (module contract)
  eq(p.count, claimed, `${stem}: page count == 2 + ${layers.length} non-empty layers = ${claimed}`);
  ok(p.count >= 2, `${stem}: ≥ 2 pages`);
  eq(p.pages.length, claimed, `${stem}: parsed pages == claimed`);
  // paper: A4, landscape iff W > H, all pages same size
  const [pw, ph] = W > H ? [PAPERS.A4[1], PAPERS.A4[0]] : PAPERS.A4;
  ok(p.pages.every(pg => pg.mediaBox[0] === 0 && pg.mediaBox[1] === 0 && near(pg.mediaBox[2], pw, 1e-3) && near(pg.mediaBox[3], ph, 1e-3)), `${stem}: every MediaBox = A4 ${W > H ? 'landscape' : 'portrait'}`);
  // content streams: sane operators, mm CTM present, board drawn 1:1 (72/25.4 scale) and centred
  p.pages.forEach((pg, i) => {
    checkContent(pg.content, `${stem} page ${i + 1}`);
    const cm = new RegExp(`(-?${PT.toFixed(4)}) 0 0 ${PT.toFixed(4)} (-?[\\d.]+) (-?[\\d.]+) cm`).exec(pg.content);
    assert.ok(cm, `${stem} page ${i + 1}: mm CTM (${PT.toFixed(4)} pt/mm) present`);
    const mirrored = cm[1].startsWith('-');
    const ox = +cm[2], oy = +cm[3];
    const expectedOx = (pw - W * PT) / 2, expectedOy = (ph - H * PT) / 2 - 8;
    assert.ok(near(oy, expectedOy, 1e-3), `${stem} page ${i + 1}: board vertically centred (−8 pt for header)`);
    assert.ok(near(mirrored ? ox - W * PT : ox, expectedOx, 1e-3), `${stem} page ${i + 1}: board horizontally centred${mirrored ? ' (mirrored: origin at right edge)' : ''}`);
    assert.equal(mirrored, i === 1, `${stem} page ${i + 1}: ${i === 1 ? 'bottom page mirrored' : 'not mirrored'} (opts.mirrorBottom unset)`);
    assert.ok(/\/F1 11 Tf/.test(pg.content) && /Tj/.test(pg.content), `${stem} page ${i + 1}: header text`);
    assert.ok(pg.content.includes('(10 mm  \\(1:1\\)) Tj'), `${stem} page ${i + 1}: scale bar label (parens escaped)`);
    assert.ok(/1 J 1 j/.test(pg.content), `${stem} page ${i + 1}: round caps/joins`);
    // outline ring appears (first vertex of resolved outline as "x y m")
    const [x0, y0] = res.outline[0];
    assert.ok(pg.content.includes(`${+x0.toFixed(4)} ${+y0.toFixed(4)} m`), `${stem} page ${i + 1}: outline drawn in mm`);
  });
  n++;
  // page titles: TOP, BOTTOM, then each layer name
  const unpdf = s => s.replace(/\\([0-7]{3})/g, (m, o) => String.fromCharCode(parseInt(o, 8) === 0x97 ? 0x2014 : parseInt(o, 8))).replace(/\\([()\\])/g, '$1');
  const titles = p.pages.map(pg => unpdf(/\/F1 11 Tf[^(]*\(([^)]*(?:\\\)[^)]*)*)\) Tj/.exec(pg.content)[1]));
  ok(/TOP$/.test(titles[0]) && /BOTTOM \(as seen from below\)$/.test(titles[1]), `${stem}: page 1 TOP, page 2 BOTTOM`);
  layers.forEach((l, i) => assert.ok(titles[i + 2].endsWith(l), `${stem}: page ${i + 3} titled ${l} (got "${titles[i + 2]}")`));
  n++;
  ok(titles.every(t => t.includes(stem) && !t.includes('?')), `${stem}: titles carry board name and no "?" replacement chars (WinAnsi dashes)`);
  ok(/\\227/.test(p.pages[0].content), `${stem}: em dash written as WinAnsi \\227 in content text`);
  // layer pages: black fill/stroke, drills as white-filled black-stroked, alpha state only on realistic pages
  p.pages.slice(2).forEach((pg, i) => { assert.ok(/0 0 0 rg/.test(pg.content) && /0 0 0 RG/.test(pg.content), `${stem} layer page ${layers[i]}: black`); assert.ok(/1 1 1 rg/.test(pg.content), `${stem} layer page ${layers[i]}: white drill fill`); assert.ok(!/\/GS45 gs/.test(pg.content), `${stem} layer page ${layers[i]}: no transparency`); });
  ok(/\/GS45 gs/.test(p.pages[0].content), `${stem}: top page uses the /GS45 alpha state (copper under mask)`);
  n++;
  // Info dict
  ok(p.infoObj && /\/Producer \(LAMINA\)/.test(p.infoObj.body) && /\/CreationDate \(D:\d{14}\)/.test(p.infoObj.body), `${stem}: Info dict with Producer + CreationDate`);
  ok(/\/Title <FEFF[0-9A-F]+>/.test(p.infoObj.body), `${stem}: Info /Title is UTF-16BE (contains an em dash)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-pdf-'));
  const fp = path.join(dir, `${stem}.pdf`); fs.writeFileSync(fp, f.data, 'latin1'); written.push({ fp, dir, stem, pages: claimed, W, H });
}
// ---------- options: paper / landscape / boards / mirrorBottom ----------
{
  const f = exportPdf(doc2, { bitmapFor: fakeBitmapFor, boards: [1], paper: 'Letter', mirrorBottom: true });
  eq(f.length, 1, 'opts.boards=[1] → one file'); eq(f[0].name, 'PANEL.pdf', 'named after the board');
  const p = parsePdf(f[0].data);
  ok(p.pages.every(pg => near(pg.mediaBox[2], 792) && near(pg.mediaBox[3], 612)), 'Letter landscape (board 100×60)');
  const res = resolveBoard(doc2.boards[1], doc2, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: fakeBitmapFor });
  const layers = nonEmptyLayers(res);
  layers.forEach((l, i) => { const mir = /-2\.8346 0 0 2\.8346/.test(p.pages[i + 2].content); assert.equal(mir, l.startsWith('B.'), `mirrorBottom: ${l} page ${mir ? '' : 'not '}mirrored`); });
  n++;
  const g = exportPdf(doc2, { bitmapFor: fakeBitmapFor, boards: [0], landscape: false });
  ok(parsePdf(g[0].data).pages.every(pg => near(pg.mediaBox[2], 595.276)), 'landscape:false forces portrait');
  const big = exportPdf(doc2, { bitmapFor: fakeBitmapFor, boards: [0], paper: 'A3' });
  ok(parsePdf(big[0].data).pages.every(pg => near(pg.mediaBox[2], 1190.55) && near(pg.mediaBox[3], 841.89)), 'A3 landscape');
}
// ---------- one-board doc ----------
{
  const doc1 = oneBoardDoc();
  const f1 = exportPdf(doc1);
  eq(f1.length, 1, 'one-board → one PDF');
  const res = resolveBoard(doc1.boards[0], doc1, { textAsStrokes: true, imagesAsPolys: true });
  const p = parsePdf(f1[0].data);
  eq(p.count, 2 + nonEmptyLayers(res).length, 'one-board page count');
  ok(p.pages.every(pg => near(pg.mediaBox[2], 595.276) && near(pg.mediaBox[3], 841.89)), '50×50 board → A4 portrait');
}
// ---------- unit checks: pdfString / pdfTextString / buildPdf ----------
{
  eq(pdfString('a(b)c\\'), '(a\\(b\\)c\\\\)', 'pdfString escapes ( ) \\');
  eq(pdfString('café ×'), '(caf\\351 \\327)', 'pdfString Latin-1 → octal');
  eq(pdfString('a — b … “q” •'), '(a \\227 b \\205 \\223q\\224 \\225)', 'pdfString WinAnsi 0x80–0x9F punctuation (dash, ellipsis, quotes, bullet)');
  eq(pdfString('x\ny\tz'), '(x y z)', 'pdfString newlines/tabs → space');
  eq(pdfString('日本'), '(??)', 'pdfString non-Latin → ?');
  eq(pdfTextString('plain'), '(plain)', 'pdfTextString ASCII stays literal');
  eq(pdfTextString('a—b'), '<FEFF006120140062>', 'pdfTextString UTF-16BE hex with BOM');
  eq(pdfTextString('😀'), '<FEFFD83DDE00>', 'pdfTextString surrogate pairs');
  const mini = buildPdf([{ w: 100, h: 200, content: '0 0 m 10 10 l S\n' }], { title: 'T' });
  const p = parsePdf(mini);
  eq(p.count, 1, 'buildPdf: single page');
  ok(near(p.pages[0].mediaBox[2], 100) && near(p.pages[0].mediaBox[3], 200), 'buildPdf: MediaBox from page size');
  eq(p.pages[0].content, '0 0 m 10 10 l S\n', 'buildPdf: content verbatim');
  assert.throws(() => buildPdf([{ w: 1, h: 1, content: 'é' }]), /non-ASCII/, 'buildPdf rejects non-ASCII content');
  n++;
}

// ---------- optional: external validators (qpdf --check / pdfinfo / mutool / gs) ----------
{
  const which = c => { try { return execFileSync('which', [c], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
  const tools = { qpdf: which('qpdf'), pdfinfo: which('pdfinfo'), mutool: which('mutool'), gs: which('gs') };
  const used = [];
  for (const w of written) {
    if (tools.qpdf) { try { execFileSync(tools.qpdf, ['--check', w.fp], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); } catch (e) { assert.fail(`qpdf --check ${w.stem}.pdf failed: ` + String(e.stdout || e.stderr || e.message).slice(0, 600)); } n++; if (!used.includes('qpdf')) used.push('qpdf'); }
    if (tools.pdfinfo) {
      let out; try { out = execFileSync(tools.pdfinfo, [w.fp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); } catch (e) { assert.fail(`pdfinfo ${w.stem}.pdf failed: ` + String(e.stderr || e.message).slice(0, 600)); }
      const pages = +/Pages:\s+(\d+)/.exec(out)[1];
      eq(pages, w.pages, `pdfinfo ${w.stem}.pdf: Pages == ${w.pages}`);
      ok(/PDF version:\s+1\.4/.test(out), `pdfinfo ${w.stem}.pdf: version 1.4`);
      const title = /Title:\s+(.*)/.exec(out)?.[1] || '';
      ok(title.includes('—') && title.includes(w.stem), `pdfinfo ${w.stem}.pdf: Title decodes with the em dash ("${title}")`);
      if (!used.includes('pdfinfo')) used.push('pdfinfo');
    }
    if (tools.mutool) { try { execFileSync(tools.mutool, ['info', w.fp], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); } catch (e) { assert.fail(`mutool info ${w.stem}.pdf failed: ` + String(e.stderr || e.message).slice(0, 600)); } n++; if (!used.includes('mutool')) used.push('mutool'); }
    if (tools.gs) {
      let out = '';
      try { out = execFileSync(tools.gs, ['-dNOPAUSE', '-dBATCH', '-dQUIET', '-dPDFSTOPONERROR', '-sDEVICE=nullpage', w.fp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }); } catch (e) { assert.fail(`gs ${w.stem}.pdf failed: ` + String(e.stdout || e.stderr || e.message).slice(0, 600)); }
      ok(!/error|Error/.test(out), `gs ${w.stem}.pdf: interpreted all pages without errors`);
      if (!used.includes('gs')) used.push('gs');
    }
    fs.rmSync(w.dir, { recursive: true, force: true });
  }
  if (used.length) console.log(`external validators used: ${used.join(', ')} on ${written.length} PDFs`);
  else console.log('no PDF validator found (qpdf/pdfinfo/mutool/gs) — external check skipped');
}

console.log(`pdf: ${n} checks`);
console.log('ALL PASS');
