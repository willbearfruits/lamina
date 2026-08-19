// node test/fonts.test.mjs
// Covers the generated multi-font stroke pack js/lib/fonts.js (built by tools/build_fonts.mjs).
import { FONTS, FONT_LIST, FONT_CATS, DEFAULT_FONT, getFont, fontStrokes, textStrokes, strokesBBox } from '../js/lib/fonts.js';
import { HERSHEY, textStrokes as hersheyText } from '../js/lib/hershey.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`); n++; };

// ---------------------------------------------------------------- pack shape
const ids = Object.keys(FONTS);
ok(ids.length >= 15, `pack has ${ids.length} fonts (>= 15)`);
ok(FONTS[DEFAULT_FONT], `DEFAULT_FONT '${DEFAULT_FONT}' exists`);
ok(DEFAULT_FONT === 'sans', 'DEFAULT_FONT is sans');

// the families the pack promises
for (const id of ['sans', 'sans-bold', 'roman', 'roman-duplex', 'roman-triplex', 'times', 'times-bold',
  'times-italic', 'script', 'script-bold', 'gothic-eng', 'gothic-ger', 'gothic-ita',
  'greek', 'cyrillic', 'weather', 'music', 'astro', 'symbols']) {
  ok(FONTS[id], `font present: ${id}`);
}

const SYMBOLIC = new Set(['weather', 'music', 'astro', 'symbols']);

for (const id of ids) {
  const f = FONTS[id];
  ok(f.id === id, `${id}: id field matches key`);
  ok(typeof f.name === 'string' && f.name.length > 0, `${id}: has a name`);
  ok(typeof f.cat === 'string' && f.cat.length > 0, `${id}: has a category`);
  ok(typeof f.note === 'string' && f.note.length > 0, `${id}: has a note`);
  ok(FONT_CATS.includes(f.cat), `${id}: category '${f.cat}' is a known category`);

  // ---- glyph coverage
  const keys = Object.keys(f.glyphs);
  ok(keys.length >= 60, `${id}: ${keys.length} glyph slots (>= 60)`);
  const inked = keys.filter(k => f.glyphs[k].strokes.length);
  if (!SYMBOLIC.has(id)) ok(inked.length >= 60, `${id}: ${inked.length} inked glyphs (>= 60 for a text font)`);
  ok(f.glyphs[' '] && f.glyphs[' '].strokes.length === 0 && f.glyphs[' '].adv > 0, `${id}: space advances without ink`);
  for (let c = 32; c <= 126; c++) ok(f.glyphs[String.fromCharCode(c)], `${id}: printable ASCII ${c} present`);

  // ---- glyph data is well formed, integral, no empty strokes
  let bad = 0, nonInt = 0, empty = 0;
  for (const k of keys) {
    const g = f.glyphs[k];
    if (!Number.isFinite(g.adv) || !Array.isArray(g.strokes)) { bad++; continue; }
    for (const s of g.strokes) {
      if (!s.length) { empty++; continue; }
      for (const p of s) {
        if (!Array.isArray(p) || p.length !== 2) { bad++; continue; }
        if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) nonInt++;
      }
    }
  }
  ok(bad === 0, `${id}: every glyph is {adv, strokes:[[[x,y]...]]}`);
  ok(empty === 0, `${id}: no empty strokes`);
  ok(nonInt === 0, `${id}: all coordinates are integers`);

  // ---- metrics
  ok(f.capHeight > 0, `${id}: capHeight ${f.capHeight} > 0`);
  ok(f.ascender >= f.capHeight, `${id}: ascender >= capHeight`);
  ok(f.descender <= 0, `${id}: descender <= 0`);
  near(f.lineHeight, f.ascender - f.descender, 0, `${id}: lineHeight == ascender - descender`);
  ok(f.xHeight >= 0 && f.xHeight <= f.capHeight, `${id}: 0 <= xHeight <= capHeight`);
  if (!SYMBOLIC.has(id)) ok(f.xHeight > 0, `${id}: text font has an x-height`);

  // 'H' spans the baseline to the cap height, everywhere it is inked
  const H = f.glyphs['H'];
  if (H && H.strokes.length && !SYMBOLIC.has(id)) {
    const bb = strokesBBox(H.strokes);
    eq(bb.maxY, f.capHeight, `${id}: 'H' top is exactly capHeight`);
    // 'H' sits on the baseline; only the blackletters hang a flourish below it
    ok(bb.minY <= 0 && bb.minY >= -0.25 * f.capHeight, `${id}: 'H' bottom ${bb.minY} sits on/just under the baseline`);
    if (f.cat !== 'Display') eq(bb.minY, 0, `${id}: 'H' bottom is exactly the baseline`);
    ok(bb.minX >= 0, `${id}: 'H' left bearing is 0 or more`);
    ok(bb.maxX <= f.glyphs['H'].adv, `${id}: 'H' ink fits inside its advance`);
  }

  // left bearing is normalised to the record's declared left position, so ink starts at x=0 for
  // upright faces; italics/scripts may overhang slightly to the left. Bound the overhang.
  let minInkX = 0;
  for (const k of keys) for (const s of f.glyphs[k].strokes) for (const p of s) if (p[0] < minInkX) minInkX = p[0];
  ok(minInkX >= -0.5 * f.capHeight, `${id}: left overhang ${minInkX} is within half a cap height`);
  if (['sans', 'sans-bold', 'roman', 'roman-duplex', 'roman-triplex', 'times', 'times-bold', 'greek', 'cyrillic'].includes(id)) {
    ok(minInkX === 0, `${id}: upright face has no left overhang (left bearing shifted to 0)`);
  }
}

// ---------------------------------------------------------------- FONT_LIST
ok(FONT_LIST.length === ids.length, `FONT_LIST covers all ${ids.length} fonts`);
for (const e of FONT_LIST) {
  ok(FONTS[e.id], `FONT_LIST entry '${e.id}' resolves`);
  ok(e.name === FONTS[e.id].name && e.cat === FONTS[e.id].cat && e.note === FONTS[e.id].note, `${e.id}: FONT_LIST metadata matches FONTS`);
  ok(typeof e.sample === 'string' && e.sample.length > 0, `${e.id}: has a sample string`);
  ok(!('glyphs' in e), `${e.id}: FONT_LIST is metadata only (no glyph payload)`);
  ok(fontStrokes(e.id, e.sample, 3).strokes.length > 0, `${e.id}: sample string renders ink`);
}
for (const id of SYMBOLIC) ok(/arbitrary/i.test(FONTS[id].note), `${id}: note warns the ASCII mapping is arbitrary`);

// ---------------------------------------------------------------- getFont
ok(getFont('sans') === FONTS.sans, 'getFont returns the font');
ok(getFont('no-such-font') === FONTS[DEFAULT_FONT], 'getFont falls back for unknown id');
ok(getFont(undefined) === FONTS[DEFAULT_FONT], 'getFont falls back for undefined');
ok(getFont(null) === FONTS[DEFAULT_FONT], 'getFont falls back for null');

// ---------------------------------------------------------------- layout
for (const id of ids) {
  const r = fontStrokes(id, 'Hi', 2);
  ok(r.width > 0, `${id}: fontStrokes width > 0`);
  ok(r.strokes.length > 0, `${id}: fontStrokes produces strokes`);
  ok(r.lines === 1, `${id}: single line`);
  const r2 = fontStrokes(id, 'Hi', 4);
  near(r2.width, r.width * 2, 1e-9, `${id}: width scales linearly with size`);
  const bb1 = strokesBBox(r.strokes), bb2 = strokesBBox(r2.strokes);
  near(bb2.maxY, bb1.maxY * 2, 1e-9, `${id}: ink scales linearly with size`);
}

// cap height really is the size, for the text fonts
for (const id of ids) {
  if (SYMBOLIC.has(id)) continue;
  if (!FONTS[id].glyphs['H'].strokes.length) continue;
  const bb = strokesBBox(fontStrokes(id, 'H', 3).strokes);
  near(bb.maxY, 3, 1e-9, `${id}: 'H' top == size (size means cap height)`);
  ok(bb.minY <= 1e-9 && bb.minY > -0.75, `${id}: 'H' sits on the baseline y=0`);
}

// letterSpacing
{
  const a = fontStrokes('roman', 'Hi', 2);
  const b = fontStrokes('roman', 'Hi', 2, { letterSpacing: 1 });
  near(b.width - a.width, 1, 1e-9, 'letterSpacing adds 1 per gap (1 gap in "Hi")');
  const c = fontStrokes('roman', 'Hii', 2, { letterSpacing: 1 });
  const d = fontStrokes('roman', 'Hii', 2);
  near(c.width - d.width, 2, 1e-9, 'letterSpacing adds 2 for 2 gaps');
  ok(fontStrokes('roman', 'a b', 2).width > fontStrokes('roman', 'ab', 2).width, 'space advances');
}

// align
{
  const l = strokesBBox(fontStrokes('times', 'Hi', 2).strokes);
  const c = strokesBBox(fontStrokes('times', 'Hi', 2, { align: 'center' }).strokes);
  const r = strokesBBox(fontStrokes('times', 'Hi', 2, { align: 'right' }).strokes);
  ok(l.minX >= -1e-9, 'left align starts at x >= 0');
  ok(c.minX < 0 && c.maxX > 0, 'center align straddles x=0');
  ok(r.maxX <= 1e-9, 'right align ends at x <= 0');
  near((c.maxX - c.minX), (l.maxX - l.minX), 1e-9, 'align does not change ink width');
}

// mirror
{
  const p = fontStrokes('sans-bold', 'Hi', 2);
  const m = fontStrokes('sans-bold', 'Hi', 2, { mirror: true });
  ok(strokesBBox(m.strokes).maxX <= 1e-9, 'mirror flips to negative x');
  near(m.width, p.width, 1e-9, 'mirror keeps the reported width');
  const bp = strokesBBox(p.strokes), bm = strokesBBox(m.strokes);
  near(bm.minX, -bp.maxX, 1e-9, 'mirror is a reflection about x=0');
}

// multiline
{
  const one = fontStrokes('script', 'A', 2);
  const two = fontStrokes('script', 'A\nB', 2);
  ok(two.lines === 2, 'multiline reports 2 lines');
  near(two.height - one.height, 2 * 1.6, 1e-9, 'default lineHeight is 1.6 * size');
  ok(strokesBBox(two.strokes).minY < -1, 'second line goes downward (negative y)');
  const tight = fontStrokes('script', 'A\nB', 2, { lineHeight: 1 });
  near(tight.height, 2 + 2, 1e-9, 'lineHeight option controls the line advance');
  const three = fontStrokes('script', 'A\nBB\nC', 2);
  ok(three.lines === 3 && three.width >= fontStrokes('script', 'BB', 2).width - 1e-9, 'width is the widest line');
  ok(fontStrokes('sans', '', 2).strokes.length === 0, 'empty string renders nothing');
  ok(fontStrokes('sans', null, 2).lines === 1, 'null text is treated as empty');
}

// unknown font id falls back to sans
{
  const bad = fontStrokes('definitely-not-a-font', 'Hxg 123', 3);
  const good = fontStrokes('sans', 'Hxg 123', 3);
  eq(bad, good, 'unknown font id falls back to the sans font');
}

// unknown glyph: falls back through the ASCII map, then to sans, then to the box
{
  // 'é' is in the fallback map -> 'e'
  const acc = fontStrokes('sans', 'é', 2);
  const e = fontStrokes('sans', 'e', 2);
  eq(acc, e, 'accented Latin falls back to the unaccented letter');
  for (const [from, to] of [['—', '-'], ['’', "'"], ['×', 'x'], ['°', 'o'], ['µ', 'u'], ['Ω', 'O'], ['Ω', 'O'], ['ü', 'u'], ['ä', 'a'], ['ñ', 'n'], ['ß', 's'], ['ł', 'l']]) {
    eq(fontStrokes('sans', from, 2), fontStrokes('sans', to, 2), `fallback ${JSON.stringify(from)} -> ${to}`);
  }
  // the greek font has no glyph at 'Z'; it must borrow sans' 'Z' rather than draw a box
  ok(FONTS.greek.glyphs['Z'].strokes.length === 0, 'greek "Z" is blank in the source font');
  eq(fontStrokes('greek', 'Z', 2).strokes, fontStrokes('sans', 'Z', 2).strokes, 'blank glyph borrows the sans glyph');
  // a character no font has at all -> box placeholder (1 closed rectangle)
  const boxr = fontStrokes('sans', '中', 2);
  ok(boxr.strokes.length === 1 && boxr.strokes[0].length === 5, 'truly unknown char draws a 1-stroke box');
  const bbox = strokesBBox(boxr.strokes);
  near(bbox.minY, 0, 1e-9, 'box sits on the baseline');
  near(bbox.maxY, 2, 1e-9, 'box is size tall');
  ok(boxr.width > 0, 'box advances');
  // tab renders as a space (no ink) in every font
  for (const id of ids) ok(fontStrokes(id, '\t', 2).strokes.length === 0, `${id}: tab renders as a space`);
}

// ---------------------------------------------------------------- hershey.js parity
{
  const sans = FONTS.sans;
  eq(Object.keys(sans.glyphs), Object.keys(HERSHEY.glyphs), 'sans has exactly hershey.js glyph set');
  let worst = 0, shapeMismatch = 0;
  for (const k of Object.keys(HERSHEY.glyphs)) {
    const a = HERSHEY.glyphs[k], b = sans.glyphs[k];
    if (a.adv !== b.adv || a.strokes.length !== b.strokes.length) { shapeMismatch++; continue; }
    for (let i = 0; i < a.strokes.length; i++) {
      if (a.strokes[i].length !== b.strokes[i].length) { shapeMismatch++; break; }
      for (let j = 0; j < a.strokes[i].length; j++) {
        worst = Math.max(worst, Math.abs(a.strokes[i][j][0] - b.strokes[i][j][0]), Math.abs(a.strokes[i][j][1] - b.strokes[i][j][1]));
      }
    }
  }
  ok(shapeMismatch === 0, 'sans matches hershey.js glyph-for-glyph (same adv, same stroke structure)');
  ok(worst <= 1, `sans coordinates match hershey.js within 1 unit (worst = ${worst})`);
  eq([sans.capHeight, sans.xHeight, sans.ascender, sans.descender, sans.lineHeight],
    [HERSHEY.capHeight, HERSHEY.xHeight, HERSHEY.ascender, HERSHEY.descender, HERSHEY.lineHeight],
    'sans metrics match hershey.js');

  // the required layout parity check
  const S = 'Hxg 123 %&@';
  const a = hersheyText(S, 3);
  const b = fontStrokes('sans', S, 3);
  ok(a.strokes.length === b.strokes.length, `same stroke count for ${JSON.stringify(S)} @3`);
  let lw = 0;
  for (let i = 0; i < a.strokes.length; i++) {
    assert.ok(a.strokes[i].length === b.strokes[i].length, `stroke ${i} same point count`);
    for (let j = 0; j < a.strokes[i].length; j++) {
      lw = Math.max(lw, Math.abs(a.strokes[i][j][0] - b.strokes[i][j][0]), Math.abs(a.strokes[i][j][1] - b.strokes[i][j][1]));
    }
  }
  n++;
  ok(lw <= 1 / 21 * 1, `layout matches hershey.js within 1 font unit (worst = ${lw.toFixed(6)} mm)`);
  near(a.width, b.width, 1e-9, 'same advance width');
  near(a.height, b.height, 1e-9, 'same height');

  // and through the compatibility wrapper, with every option combination
  for (const opts of [{}, { letterSpacing: 0.4 }, { align: 'center' }, { align: 'right' }, { mirror: true }, { lineHeight: 2.2 }, { letterSpacing: 0.3, align: 'center', mirror: true }]) {
    eq(textStrokes('Hxg 123 %&@\nSecond line', 3, opts), hersheyText('Hxg 123 %&@\nSecond line', 3, opts),
      `textStrokes() == hershey.textStrokes() for ${JSON.stringify(opts)}`);
  }
  eq(textStrokes('Hi', 2, { font: 'roman' }), fontStrokes('roman', 'Hi', 2), 'textStrokes honours opts.font');
  eq(textStrokes('Hi', 2, { font: 'nope' }), fontStrokes('sans', 'Hi', 2), 'textStrokes falls back for a bad opts.font');
}

// ---------------------------------------------------------------- strokesBBox
ok(strokesBBox([]) === null, 'strokesBBox([]) is null');
eq(strokesBBox([[[1, 2], [3, 4]]]), { minX: 1, minY: 2, maxX: 3, maxY: 4 }, 'strokesBBox works');

// ---------------------------------------------------------------- size report
const bytes = fs.statSync(path.join(root, 'js', 'lib', 'fonts.js')).size;
ok(bytes < 1_200_000, `js/lib/fonts.js is ${(bytes / 1024).toFixed(1)} KB (< 1.2 MB budget)`);

console.log(`${ids.length} fonts, ${ids.reduce((a, id) => a + Object.keys(FONTS[id].glyphs).length, 0)} glyphs`);
console.log(`js/lib/fonts.js = ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
console.log(`${n} assertions`);
console.log('ALL PASS');
