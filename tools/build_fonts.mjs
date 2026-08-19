// Generates js/lib/fonts.js — the LAMINA multi-font stroke-font pack — from the classic Hershey
// .jhf font files cached in lib-src/hershey/ (see lib-src/hershey/README.md for the licence notice).
// Run: node tools/build_fonts.mjs
//
// Conversion uses EXACTLY the same conventions as js/lib/hershey.js:
//   * .jhf coordinates are ASCII chars offset from 'R' (82), y grows DOWN
//   * y is flipped to Y-UP with the baseline at y=0:            y_out = 9 - y_raw
//   * x is shifted so each glyph's left bearing is 0:           x_out = x_raw - left
//   * adv = right - left  (both read from the record's 2 position chars)
//   * strokes = arrays of polylines; " R" in the data is a pen-up (stroke break)
// Verified: font 'sans' (futural.jhf) reproduces js/lib/hershey.js glyph-for-glyph.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'lib-src', 'hershey');
const OUT = path.join(root, 'js', 'lib', 'fonts.js');

const BASELINE = 9;      // y_raw of the baseline in the Hershey 'R'-relative frame
const FIRST = 32;        // first .jhf record maps to ASCII 32 (space)
const LAST = 126;        // last printable ASCII we keep ('~'); record 96 (DEL) is dropped

const SYM_NOTE = 'Symbol font: the ASCII mapping is arbitrary — glyphs are assigned to printable ASCII 32..126 in file order. Type ordinary characters and watch what comes out.';

// file, id, name, cat, symbolic?, note, sample
const TABLE = [
  { file: 'futural', id: 'sans', name: 'Sans (Simplex)', cat: 'Sans', sample: 'Aa Bb 123',
    note: 'Single-stroke sans. LAMINA default — thinnest, fastest to plot, safest on silkscreen.' },
  { file: 'futuram', id: 'sans-bold', name: 'Sans Medium', cat: 'Sans', sample: 'Aa Bb 123',
    note: 'Duplex sans: each stem is two strokes, so it reads bolder at the same line width.' },
  { file: 'rowmans', id: 'roman', name: 'Roman Simplex', cat: 'Serif', sample: 'Aa Bb 123',
    note: 'Single-stroke serif. Classic plotter/engraving face.' },
  { file: 'rowmand', id: 'roman-duplex', name: 'Roman Duplex', cat: 'Serif', sample: 'Aa Bb 123',
    note: 'Two-stroke serif stems — a medium weight.' },
  { file: 'rowmant', id: 'roman-triplex', name: 'Roman Triplex', cat: 'Serif', sample: 'Aa Bb 123',
    note: 'Three-stroke serif stems — the boldest Roman. Many strokes: slow to plot, keep sizes large.' },
  { file: 'timesr', id: 'times', name: 'Times Roman', cat: 'Serif', sample: 'Aa Bb 123',
    note: 'Outline-style serif (letters are drawn as closed contours, not skeletons).' },
  { file: 'timesrb', id: 'times-bold', name: 'Times Bold', cat: 'Serif', sample: 'Aa Bb 123',
    note: 'Outline-style bold serif. Contours are close together — do not use below ~2 mm cap height.' },
  { file: 'timesi', id: 'times-italic', name: 'Times Italic', cat: 'Serif', sample: 'Aa Bb 123',
    note: 'Outline-style italic serif.' },
  { file: 'timesib', id: 'times-bold-italic', name: 'Times Bold Italic', cat: 'Serif', sample: 'Aa Bb 123',
    note: 'Outline-style bold italic serif. Stands in for the never-digitised "Italic Complex".' },
  { file: 'scripts', id: 'script', name: 'Script', cat: 'Script', sample: 'Aa Bb 123',
    note: 'Joined single-stroke handwriting.' },
  { file: 'scriptc', id: 'script-bold', name: 'Script Complex', cat: 'Script', sample: 'Aa Bb 123',
    note: 'Heavier joined handwriting with entry/exit flourishes.' },
  { file: 'cursive', id: 'cursive', name: 'Cursive', cat: 'Script', sample: 'Aa Bb 123',
    note: 'Slanted single-stroke cursive — the nearest thing the Hershey set has to an italic script.' },
  { file: 'gothgbt', id: 'gothic-eng', name: 'Gothic English (blackletter)', cat: 'Display', sample: 'Aa Bb 123',
    note: 'Triplex blackletter. Very stroke-heavy; use large and expect long plot times.' },
  { file: 'gothgrt', id: 'gothic-ger', name: 'Gothic German', cat: 'Display', sample: 'Aa Bb 123',
    note: 'Triplex German blackletter.' },
  { file: 'gothitt', id: 'gothic-ita', name: 'Gothic Italian', cat: 'Display', sample: 'Aa Bb 123',
    note: 'Triplex Italian blackletter — rounder and wider than the English/German cuts.' },
  { file: 'greeks', id: 'greek', name: 'Greek', cat: 'Symbols', sample: 'ABGDEZ abgdez',
    note: 'Greek alphabet on the Latin keyboard: A\u2192alpha, B\u2192beta, G\u2192gamma, D\u2192delta \u2026 Digits and punctuation are ordinary; Y/Z/y/z have no Greek counterpart and are drawn from the Sans font.' },
  { file: 'cyrillic', id: 'cyrillic', name: 'Cyrillic', cat: 'Symbols', sample: 'ABVGDE abvgde',
    note: 'Cyrillic alphabet transliterated onto the Latin keyboard (A\u2192\u0410, B\u2192\u0411, V\u2192\u0412, G\u2192\u0413 \u2026). Digits and punctuation are ordinary.' },
  { file: 'meteorology', id: 'weather', name: 'Weather symbols', cat: 'Symbols', symbolic: true, sample: 'ABCDEF', note: SYM_NOTE },
  { file: 'music', id: 'music', name: 'Music symbols', cat: 'Symbols', symbolic: true, sample: 'ABCDEF', note: SYM_NOTE },
  { file: 'astrology', id: 'astro', name: 'Astrology symbols', cat: 'Symbols', symbolic: true, sample: 'ABCDEF', note: SYM_NOTE },
  { file: 'symbolic', id: 'symbols', name: 'Assorted symbols', cat: 'Symbols', symbolic: true, sample: 'ABCDEF', note: SYM_NOTE },
];

// ---------------------------------------------------------------- .jhf parsing

/** Split a .jhf file into one raw record per glyph, re-joining the 72-column hard wraps. */
function records(txt) {
  const lines = txt.split(/\r?\n/).filter(l => l.length);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i++];
    const n = parseInt(line.slice(5, 8), 10);
    if (!Number.isFinite(n)) continue;
    const need = 10 + 2 * (n - 1);
    while (line.length < need && i < lines.length) line += lines[i++];
    out.push({ n, line });
  }
  return out;
}

function parseGlyph(rec) {
  const { n, line } = rec;
  const left = line.charCodeAt(8) - 82;
  const right = line.charCodeAt(9) - 82;
  const data = line.slice(10, 10 + 2 * (n - 1));
  const strokes = [];
  let cur = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    const a = data[i], b = data[i + 1];
    if (a === ' ' && b === 'R') { if (cur.length) strokes.push(cur); cur = []; continue; }
    cur.push([Math.round(a.charCodeAt(0) - 82 - left), Math.round(BASELINE - (b.charCodeAt(0) - 82))]);
  }
  if (cur.length) strokes.push(cur);
  return { adv: right - left, strokes: strokes.filter(s => s.length) };
}

function loadFont(file) {
  const txt = fs.readFileSync(path.join(SRC, file + '.jhf'), 'utf8');
  const recs = records(txt);
  const glyphs = {};
  for (let i = 0; i < recs.length; i++) {
    const code = FIRST + i;
    if (code > LAST) break;
    glyphs[String.fromCharCode(code)] = parseGlyph(recs[i]);
  }
  return { glyphs, count: recs.length };
}

// ---------------------------------------------------------------- metrics

function topOf(glyphs, ch) {
  const g = glyphs[ch];
  if (!g || !g.strokes.length) return null;
  let m = -Infinity;
  for (const s of g.strokes) for (const p of s) if (p[1] > m) m = p[1];
  return m === -Infinity ? null : m;
}

function measure(glyphs, symbolic) {
  let maxY = -Infinity, minY = Infinity;
  for (const k of Object.keys(glyphs)) for (const s of glyphs[k].strokes) for (const p of s) {
    if (p[1] > maxY) maxY = p[1];
    if (p[1] < minY) minY = p[1];
  }
  if (maxY === -Infinity) { maxY = 0; minY = 0; }

  let capHeight = null;
  if (!symbolic) {
    capHeight = topOf(glyphs, 'H') ?? topOf(glyphs, 'A');
    if (capHeight == null) {                       // tallest uppercase that has ink
      for (let c = 65; c <= 90; c++) {
        const t = topOf(glyphs, String.fromCharCode(c));
        if (t != null && (capHeight == null || t > capHeight)) capHeight = t;
      }
    }
  }
  if (capHeight == null || capHeight <= 0) capHeight = maxY;

  const xHeight = topOf(glyphs, 'x') ?? topOf(glyphs, 'o') ?? 0;
  return {
    capHeight,
    xHeight: symbolic ? 0 : Math.max(0, xHeight),
    ascender: maxY,
    descender: minY,
    lineHeight: maxY - minY,
  };
}

// ---------------------------------------------------------------- emit

const q = s => JSON.stringify(s);
const pts = s => '[' + s.map(p => `[${p[0]},${p[1]}]`).join(',') + ']';
const glyphSrc = g => `{adv:${g.adv},strokes:[${g.strokes.map(pts).join(',')}]}`;

const built = [];
for (const f of TABLE) {
  const src = path.join(SRC, f.file + '.jhf');
  if (!fs.existsSync(src)) { console.warn(`SKIP ${f.id}: lib-src/hershey/${f.file}.jhf missing`); continue; }
  const { glyphs, count } = loadFont(f.file);
  const m = measure(glyphs, !!f.symbolic);
  const inked = Object.keys(glyphs).filter(k => glyphs[k].strokes.length).length;
  built.push({ ...f, glyphs, metrics: m, inked, records: count });
}

const head = `// GENERATED by tools/build_fonts.mjs — DO NOT HAND-EDIT. Regenerate after touching the generator.
// Source data: the classic Hershey .jhf fonts cached in lib-src/hershey/ (see lib-src/hershey/README.md).
//   The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the
//   U. S. National Bureau of Standards.  The format of the font data in this distribution was
//   originally created by James Hurt, Cognition Inc., 900 Technology Park Drive, Billerica MA 01821.
//
// Conventions (identical to js/lib/hershey.js): coordinates in font units, Y UP, baseline y=0,
// each glyph's left bearing shifted to x=0, adv = advance width, strokes = arrays of polylines.
// 'size' everywhere in LAMINA means CAP HEIGHT in mm, so the layout scale is size / font.capHeight.
`;

let body = 'export const FONTS = {\n';
for (const f of built) {
  const m = f.metrics;
  body += `  ${q(f.id)}: { id: ${q(f.id)}, name: ${q(f.name)}, cat: ${q(f.cat)}, ` +
    `capHeight: ${m.capHeight}, xHeight: ${m.xHeight}, ascender: ${m.ascender}, descender: ${m.descender}, ` +
    `lineHeight: ${m.lineHeight}, note: ${q(f.note)}, glyphs: {\n`;
  for (const ch of Object.keys(f.glyphs)) body += `${q(ch)}:${glyphSrc(f.glyphs[ch])},\n`;
  body += '  } },\n';
}
body += '};\n\n';

body += 'export const FONT_LIST = [\n';
for (const f of built) {
  body += `  { id: ${q(f.id)}, name: ${q(f.name)}, cat: ${q(f.cat)}, note: ${q(f.note)}, sample: ${q(f.sample)} },\n`;
}
body += '];\n\n';

const runtime = `export const DEFAULT_FONT = 'sans';

/** Category order for UI pickers (categories not listed sort last, alphabetically). */
export const FONT_CATS = ['Sans', 'Serif', 'Script', 'Display', 'Symbols'];

/** Look up a font by id; unknown ids fall back to DEFAULT_FONT. */
export function getFont(id) {
  return FONTS[id] || FONTS[DEFAULT_FONT];
}

// Characters LAMINA can draw with a different glyph than the one asked for. Kept identical to the
// map in js/lib/hershey.js (so 'sans' output is unchanged) and extended for accented Latin,
// currency and the typographic punctuation people paste in from word processors.
const FALLBACK = {
  '\\u2014': '-', '\\u2013': '-', '\\u2212': '-', '\\u2010': '-', '\\u2011': '-', '\\u2015': '-',
  '\\u2018': "'", '\\u2019': "'", '\\u201a': ',', '\\u201b': "'", '\\u00b4': "'", '\\u02bc': "'",
  '\\u201c': '"', '\\u201d': '"', '\\u201e': '"', '\\u2033': '"', '\\u2032': "'",
  '\\u00d7': 'x', '\\u00f7': '/', '\\u00b0': 'o', '\\u2022': '*', '\\u00b7': '.', '\\u00a0': ' ',
  '\\u2026': '.', '\\u00b5': 'u', '\\u03a9': 'O', '\\u2126': 'O', '\\u00b1': '+', '\\u2260': '=',
  '\\u2264': '<', '\\u2265': '>', '\\u2190': '<', '\\u2192': '>', '\\u2191': '^', '\\u2193': 'v',
  '\\u20ac': 'E', '\\u00a3': 'L', '\\u00a5': 'Y', '\\u00a2': 'c', '\\u00a7': 'S', '\\u00b6': 'P',
  '\\u00a9': 'C', '\\u00ae': 'R', '\\u2122': 'T', '\\u2044': '/', '\\u2502': '|', '\\u2500': '-',
  // accented Latin -> unaccented (LAMINA silkscreen is a stroke font; better a plain letter than a box)
  '\\u00c0': 'A', '\\u00c1': 'A', '\\u00c2': 'A', '\\u00c3': 'A', '\\u00c4': 'A', '\\u00c5': 'A', '\\u00c6': 'A',
  '\\u00e0': 'a', '\\u00e1': 'a', '\\u00e2': 'a', '\\u00e3': 'a', '\\u00e4': 'a', '\\u00e5': 'a', '\\u00e6': 'a',
  '\\u00c7': 'C', '\\u00e7': 'c',
  '\\u00c8': 'E', '\\u00c9': 'E', '\\u00ca': 'E', '\\u00cb': 'E',
  '\\u00e8': 'e', '\\u00e9': 'e', '\\u00ea': 'e', '\\u00eb': 'e',
  '\\u00cc': 'I', '\\u00cd': 'I', '\\u00ce': 'I', '\\u00cf': 'I',
  '\\u00ec': 'i', '\\u00ed': 'i', '\\u00ee': 'i', '\\u00ef': 'i',
  '\\u00d1': 'N', '\\u00f1': 'n',
  '\\u00d2': 'O', '\\u00d3': 'O', '\\u00d4': 'O', '\\u00d5': 'O', '\\u00d6': 'O', '\\u00d8': 'O', '\\u0152': 'O',
  '\\u00f2': 'o', '\\u00f3': 'o', '\\u00f4': 'o', '\\u00f5': 'o', '\\u00f6': 'o', '\\u00f8': 'o', '\\u0153': 'o',
  '\\u00d9': 'U', '\\u00da': 'U', '\\u00db': 'U', '\\u00dc': 'U',
  '\\u00f9': 'u', '\\u00fa': 'u', '\\u00fb': 'u', '\\u00fc': 'u',
  '\\u00dd': 'Y', '\\u0178': 'Y', '\\u00fd': 'y', '\\u00ff': 'y',
  '\\u00df': 's', '\\u0160': 'S', '\\u0161': 's', '\\u017d': 'Z', '\\u017e': 'z',
  '\\u010c': 'C', '\\u010d': 'c', '\\u0106': 'C', '\\u0107': 'c', '\\u0141': 'L', '\\u0142': 'l',
  '\\u011e': 'G', '\\u011f': 'g', '\\u0130': 'I', '\\u0131': 'i', '\\u015e': 'S', '\\u015f': 's',
};

// Last-resort "missing glyph" box, in the target font's units (identical to hershey.js when k == 1).
function boxGlyph(font) {
  const k = font.capHeight / 21;
  const h = font.capHeight;
  return { adv: 16 * k, strokes: [[[2 * k, 0], [14 * k, 0], [14 * k, h], [2 * k, h], [2 * k, 0]]] };
}

// A glyph counts as usable if it has ink; the one legitimately blank glyph is the space itself.
// (Greek has no Y/Z/y/z, for instance — those slots are blank and should borrow the Sans letter
// rather than punch an invisible hole in the label.)
const hit = (g, key) => (g && (g.strokes.length > 0 || key === ' ')) ? g : null;

function pickGlyph(font, sans, ch, box) {
  const fb = FALLBACK[ch];
  return hit(font.glyphs[ch], ch)
    || (fb ? hit(font.glyphs[fb], fb) : null)
    || hit(sans.glyphs[ch], ch)
    || (fb ? hit(sans.glyphs[fb], fb) : null)
    || (ch === '\\t' ? (font.glyphs[' '] || sans.glyphs[' ']) : null)
    || box;
}

/**
 * Lay out a string as polylines, in any of the packed fonts.
 * Same contract as hershey.textStrokes — for fontId 'sans' the output is identical.
 * @param {string} fontId  key into FONTS; unknown ids fall back to DEFAULT_FONT
 * @param {string} text
 * @param {number} size    cap height in output units (mm)
 * @param {object} opts
 *   letterSpacing {number} extra advance added between characters (output units), default 0
 *   align {'left'|'center'|'right'} horizontal anchor for x=0, default 'left'
 *   mirror {boolean} mirror horizontally (bottom-side silkscreen), default false
 *   lineHeight {number} multiplier for '\\n' line advance relative to size, default 1.6
 * @returns {{strokes:number[][][], width:number, height:number, lines:number}}
 *   Coordinates: x grows right, y grows UP; first line's baseline is y=0, further lines go negative.
 */
export function fontStrokes(fontId, text, size, opts = {}) {
  const font = getFont(fontId);
  const sans = FONTS[DEFAULT_FONT];
  const letterSpacing = opts.letterSpacing || 0;
  const align = opts.align || 'left';
  const mirror = !!opts.mirror;
  const lineHeight = (opts.lineHeight ?? 1.6) * size;
  const scale = size / font.capHeight;
  const box = boxGlyph(font);

  const lines = String(text ?? '').split('\\n');
  const out = [];
  let width = 0;
  const lineStrokes = [];
  for (const line of lines) {
    let x = 0;
    const ls = [];
    const chars = Array.from(line);
    chars.forEach((ch, i) => {
      const g = pickGlyph(font, sans, ch, box);
      for (const s of g.strokes) {
        ls.push(s.map(([px, py]) => [x + px * scale, py * scale]));
      }
      x += g.adv * scale;
      if (i < chars.length - 1) x += letterSpacing;
    });
    lineStrokes.push({ strokes: ls, width: x });
    if (x > width) width = x;
  }
  lineStrokes.forEach((L, li) => {
    const dx = align === 'center' ? -L.width / 2 : align === 'right' ? -L.width : 0;
    const dy = -li * lineHeight;
    for (const s of L.strokes) {
      out.push(s.map(([px, py]) => [mirror ? -(px + dx) : px + dx, py + dy]));
    }
  });
  const height = size + (lines.length - 1) * lineHeight;
  return { strokes: out, width, height, lines: lines.length };
}

/** Drop-in replacement for hershey.textStrokes; pick the family with opts.font. */
export function textStrokes(text, size, opts = {}) {
  return fontStrokes(opts.font || DEFAULT_FONT, text, size, opts);
}

/** Bounding box of a stroke set: {minX,minY,maxX,maxY} or null if empty. */
export function strokesBBox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const [x, y] of s) {
    if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
`;

fs.writeFileSync(OUT, head + '\n' + body + runtime);
const bytes = fs.statSync(OUT).size;

console.log('fonts built:');
for (const f of built) {
  const m = f.metrics;
  console.log(`  ${f.id.padEnd(18)} ${String(Object.keys(f.glyphs).length).padStart(3)} glyphs (${String(f.inked).padStart(3)} inked)  ` +
    `cap ${String(m.capHeight).padStart(3)}  x ${String(m.xHeight).padStart(3)}  asc ${String(m.ascender).padStart(3)}  ` +
    `desc ${String(m.descender).padStart(4)}  lh ${String(m.lineHeight).padStart(3)}  <- ${f.file}.jhf`);
}
console.log(`\n${built.length} fonts -> ${path.relative(root, OUT)}  ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
