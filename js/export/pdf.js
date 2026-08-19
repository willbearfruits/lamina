// LAMINA PDF exporter — hand-written PDF 1.4, no libraries. One PDF per board:
//   page 1: top view colour render, page 2: bottom view (mirrored, as seen from below),
//   then one page per non-empty layer in black + outline. Everything is printed 1:1 (true scale) on
//   opts.paper ('A4' default | 'Letter' | 'A3'), landscape when the board is wider than tall, centred,
//   with a header (Helvetica) and a 10 mm scale bar. opts.mirrorBottom mirrors the B.* layer pages too.
// PDF user space = points, Y up (same handedness as LAMINA); we set a CTM of (72/25.4) so drawing happens in mm.
import { resolveBoard, arcPoints, ovalPoints } from '../geom.js';
import { fmt, safeName } from './common.js';
import { realisticPlan, nonEmptyLayers, HOLE_DEFAULT } from './svg.js';

export const PAPERS = { A4: [595.276, 841.89], Letter: [612, 792], A3: [841.89, 1190.55], Legal: [612, 1008] };
const PT = 72 / 25.4;
const N = n => fmt(n, 4);
const K = 0.5522847498; // circle Bézier constant

// ---------- string / colour helpers ----------
const WINANSI = { 0x2014: 0x97, 0x2013: 0x96, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2026: 0x85, 0x20AC: 0x80, 0x2122: 0x99 };
export function pdfString(s) { // → (escaped) literal string, ASCII only, WinAnsi for Latin-1 + common punctuation, '?' otherwise
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (WINANSI[c]) out += '\\' + WINANSI[c].toString(8).padStart(3, '0'); // 0x80-0x9F WinAnsi slots (dashes, quotes, bullet, …)
    else if (c === 0x28 || c === 0x29 || c === 0x5C) out += '\\' + ch;
    else if (c >= 0x20 && c < 0x7F) out += ch;
    else if (c >= 0xA0 && c <= 0xFF) out += '\\' + c.toString(8).padStart(3, '0');
    else if (c === 0x0A || c === 0x0D || c === 0x09) out += ' ';
    else out += '?';
  }
  return '(' + out + ')';
}
// Text strings outside content streams (Info dict) are PDFDocEncoding, not WinAnsi → use UTF-16BE (BOM) hex when non-ASCII.
export function pdfTextString(s) {
  const str = String(s);
  if (/^[\x20-\x7E]*$/.test(str)) return pdfString(str);
  let hex = 'FEFF';
  for (const ch of str) { let c = ch.codePointAt(0); if (c > 0xFFFF) { c -= 0x10000; hex += (0xD800 + (c >> 10)).toString(16).padStart(4, '0') + (0xDC00 + (c & 0x3FF)).toString(16).padStart(4, '0'); } else hex += c.toString(16).padStart(4, '0'); }
  return '<' + hex.toUpperCase() + '>';
}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
const rgbOp = (hex, op) => hexToRgb(hex).map(v => N(v)).join(' ') + ' ' + op;

// ---------- content stream builder (mm space) ----------
class Content {
  constructor() { this.ops = []; }
  push(...s) { this.ops.push(...s); return this; }
  fill(hex) { return this.push(rgbOp(hex, 'rg')); }
  stroke(hex) { return this.push(rgbOp(hex, 'RG')); }
  ring(pts, close = true) { // subpath
    if (!pts || !pts.length) return this;
    this.push(`${N(pts[0][0])} ${N(pts[0][1])} m`);
    for (let i = 1; i < pts.length; i++) this.push(`${N(pts[i][0])} ${N(pts[i][1])} l`);
    if (close) this.push('h');
    return this;
  }
  circlePath(cx, cy, r) {
    const k = K * r;
    return this.push(`${N(cx + r)} ${N(cy)} m`,
      `${N(cx + r)} ${N(cy + k)} ${N(cx + k)} ${N(cy + r)} ${N(cx)} ${N(cy + r)} c`,
      `${N(cx - k)} ${N(cy + r)} ${N(cx - r)} ${N(cy + k)} ${N(cx - r)} ${N(cy)} c`,
      `${N(cx - r)} ${N(cy - k)} ${N(cx - k)} ${N(cy - r)} ${N(cx)} ${N(cy - r)} c`,
      `${N(cx + k)} ${N(cy - r)} ${N(cx + r)} ${N(cy - k)} ${N(cx + r)} ${N(cy)} c`, 'h');
  }
  prim(p) { // assumes fill + stroke colours already set; round caps/joins set once per page
    const w = Math.max(p.w || 0, 0.02);
    switch (p.t) {
      case 'line': return this.push(`${N(w)} w`).push(`${N(p.x1)} ${N(p.y1)} m ${N(p.x2)} ${N(p.y2)} l S`);
      case 'polyline':
        if (!p.pts || !p.pts.length) return this;
        if (p.pts.length === 1) return this.circlePath(p.pts[0][0], p.pts[0][1], w / 2).push('f');
        return this.push(`${N(w)} w`).ring(p.pts, !!p.closed).push('S');
      case 'arc': return this.push(`${N(w)} w`).ring(arcPoints(p.cx, p.cy, p.r, p.a0, p.a1), false).push('S');
      case 'circle': return p.w > 0 ? this.push(`${N(w)} w`).circlePath(p.cx, p.cy, p.r).push('S') : this.circlePath(p.cx, p.cy, p.r).push('f');
      case 'poly': {
        if (!p.pts || p.pts.length < 3) return this;
        this.ring(p.pts); for (const h of p.holes || []) this.ring(h);
        return this.push('f*');
      }
      default: return this;
    }
  }
  drills(res, fillHex, strokeHex, w) {
    if (fillHex) this.fill(fillHex); if (strokeHex) this.stroke(strokeHex).push(`${N(w)} w`);
    const op = fillHex && strokeHex ? 'B' : fillHex ? 'f' : 'S';
    for (const d of res.drills) {
      if (d.slotLen > 0) this.ring(ovalPoints(d.x, d.y, d.slotLen, d.d, d.rot || 0)); else this.circlePath(d.x, d.y, d.d / 2);
      this.push(op);
    }
    return this;
  }
  text() { return this.ops.join('\n') + '\n'; }
}

// ---------- pages ----------
function pageSetup(res, opts) {
  const [W, H] = res.size;
  const paper = PAPERS[opts.paper] || PAPERS.A4;
  const landscape = opts.landscape ?? (W > H);
  const [pw, ph] = landscape ? [paper[1], paper[0]] : paper;
  const ox = (pw - W * PT) / 2, oy = (ph - H * PT) / 2 - 8; // slightly low to leave header room
  return { W, H, pw, ph, ox, oy, fits: W * PT <= pw - 20 && H * PT <= ph - 60 };
}
function headerAndScale(c, ps, title, sub) {
  const { ph, fits } = ps;
  c.push('q', '0 0 0 rg', 'BT', '/F1 11 Tf', `1 0 0 1 28 ${N(ph - 32)} Tm`, `${pdfString(title)} Tj`, 'ET');
  c.push('BT', '/F1 8 Tf', `1 0 0 1 28 ${N(ph - 44)} Tm`, `${pdfString(sub + (fits ? '' : '   !! board larger than the paper — content clipped, choose a bigger paper'))} Tj`, 'ET');
  // 10 mm scale bar at bottom-left
  const bx = 28, by = 30, L = 10 * PT;
  c.push('0 0 0 RG', '0.6 w', `${N(bx)} ${N(by)} m ${N(bx + L)} ${N(by)} l S`, `${N(bx)} ${N(by - 4)} m ${N(bx)} ${N(by + 4)} l S`, `${N(bx + L)} ${N(by - 4)} m ${N(bx + L)} ${N(by + 4)} l S`);
  c.push('BT', '/F1 7 Tf', `1 0 0 1 ${N(bx + L + 5)} ${N(by - 2)} Tm`, `${pdfString('10 mm  (1:1)')} Tj`, 'ET', 'Q');
}
function beginMm(c, ps, mirror) {
  const { ox, oy, W } = ps;
  c.push('q', mirror ? `${N(-PT)} 0 0 ${N(PT)} ${N(ox + W * PT)} ${N(oy)} cm` : `${N(PT)} 0 0 ${N(PT)} ${N(ox)} ${N(oy)} cm`, '1 J 1 j');
}
function renderPage(res, side, ps, docName) {
  const c = new Content();
  const [W, H] = res.size;
  headerAndScale(c, ps, `${docName} — ${res.board.name} — ${side === 'bottom' ? 'BOTTOM (as seen from below)' : 'TOP'}`,
    `${N(W)} × ${N(H)} mm  ·  1:1 — print at 100%, no scaling  ·  ${res.board.color} mask, ${res.board.silkColor} silk  ·  LAMINA ${new Date().toISOString().slice(0, 10)}`);
  beginMm(c, ps, side === 'bottom');
  for (const op of realisticPlan(res, side, HOLE_DEFAULT)) {
    switch (op.kind) {
      case 'board': c.fill(op.fill); c.ring(res.outline).push('f'); break;
      case 'layer': {
        const prims = res.layers[op.layer] || []; if (!prims.length) break;
        c.push('q'); if (op.opacity < 1) c.push('/GS45 gs');
        c.fill(op.color).stroke(op.color);
        for (const p of prims) c.prim(p);
        c.push('Q'); break;
      }
      case 'drills': c.drills(res, op.fill, null, 0); break;
      case 'cutouts': c.fill(op.fill); for (const r of res.cutouts) c.ring(r).push('f'); break;
      case 'edge': c.stroke(op.stroke).push(`${N(op.w)} w`); c.ring(res.outline).push('S'); for (const r of res.cutouts) c.ring(r).push('S'); break;
    }
  }
  c.push('Q');
  return c.text();
}
function layerPage(res, layer, ps, docName, opts) {
  const c = new Content();
  const [W, H] = res.size;
  const mirror = !!opts.mirrorBottom && layer.startsWith('B.');
  headerAndScale(c, ps, `${docName} — ${res.board.name} — ${layer}${mirror ? ' (mirrored)' : ''}`,
    `${N(W)} × ${N(H)} mm  ·  1:1 — print at 100%, no scaling  ·  ${layer.endsWith('Mask') ? 'mask OPENINGS shown black' : 'black = ' + layer}  ·  LAMINA ${new Date().toISOString().slice(0, 10)}`);
  beginMm(c, ps, mirror);
  c.stroke('#000000').push('0.1 w'); c.ring(res.outline).push('S'); for (const r of res.cutouts) c.ring(r).push('S');
  c.fill('#000000').stroke('#000000');
  for (const p of res.layers[layer] || []) c.prim(p);
  c.drills(res, '#ffffff', '#000000', 0.05);
  c.push('Q');
  return c.text();
}

// ---------- PDF file assembly ----------
export function buildPdf(pages, meta = {}) { // pages: [{w,h,content}] → ASCII string
  const objs = []; // index+1 = object number
  const add = body => { objs.push(body); return objs.length; };
  const catalog = add(null), pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const gs = add('<< /Type /ExtGState /ca 0.45 /CA 0.45 >>');
  const kids = [];
  for (const pg of pages) {
    const stream = pg.content;
    const cobj = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    const pobj = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${N(pg.w)} ${N(pg.h)}] /Resources << /Font << /F1 ${font} 0 R >> /ExtGState << /GS45 ${gs} 0 R >> /ProcSet [/PDF /Text] >> /Contents ${cobj} 0 R >>`);
    kids.push(`${pobj} 0 R`);
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const info = add(`<< /Producer (LAMINA) /Creator (LAMINA PCB) /Title ${pdfTextString(meta.title || 'LAMINA')} /CreationDate (D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}) >>`);
  let out = '%PDF-1.4\n%LAMINA\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  for (let i = 0; i < out.length; i++) if (out.charCodeAt(i) > 0x7E) throw new Error('PDF builder: non-ASCII byte at ' + i);
  return out;
}

export function exportPdf(doc, opts = {}) {
  const files = [];
  const idxs = opts.boards || doc.boards.map((_, i) => i);
  for (const i of idxs) {
    const board = doc.boards[i]; if (!board) continue;
    const res = resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: true, bitmapFor: opts.bitmapFor });
    const ps = pageSetup(res, opts);
    const pages = [];
    pages.push({ w: ps.pw, h: ps.ph, content: renderPage(res, 'top', ps, doc.name) });
    pages.push({ w: ps.pw, h: ps.ph, content: renderPage(res, 'bottom', ps, doc.name) });
    for (const l of nonEmptyLayers(res)) pages.push({ w: ps.pw, h: ps.ph, content: layerPage(res, l, ps, doc.name, opts) });
    files.push({ name: `${safeName(board.name)}.pdf`, data: buildPdf(pages, { title: `${doc.name} — ${board.name}` }) });
  }
  return files;
}
