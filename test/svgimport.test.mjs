// node test/svgimport.test.mjs
import assert from 'node:assert/strict';
import { oneBoardDoc, twoBoardDoc, fakeBitmapFor } from './fixtures.mjs';
import { importSvg, parsePathData, parseTransform, arcToCubics, parseXml, decodeEntities, mul } from '../js/import/svg.js';
import { exportSvg } from '../js/export/svg.js';
import { itemBBox, unionBBox } from '../js/geom.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const nearArr = (a, b, e = 1e-6) => a.length === b.length && a.every((v, i) => near(v, b[i], e));
const bboxOf = items => { let bb = null; for (const it of items) bb = unionBBox(bb, itemBBox(it)); return bb; };
const PX = 25.4 / 96;

// ---------- hand-written SVG: <g transform="translate(10,5) scale(2)"> with rect / circle / path / polyline ----------
// Root: 100mm × 100mm, viewBox 0 0 100 100 → 1 mm per user unit. Group matrix M = [2 0 0 2 10 5] (similarity, scale 2).
// Hand-computed, in SVG (Y-down) mm before the flip:
//   rect  x1 y1 w5 h3 rx.5 fill red      → native rect, centre (1+2.5, 1+1.5) = (3.5, 2.5) → M → (17, 10); w 10 h 6 rx 1; filled.        bbox x 12..22, y 7..13
//   circle cx20 cy20 r4 stroke .5 no fill → native circle, centre (50, 45), r 8, stroke 0.5·2 = 1 mm; unfilled.       bbox (r + w/2 = 8.5) x 41.5..58.5, y 36.5..53.5
//   path  M0 0 l10 0 c 2 3 4 3 6 0 a 3 3 0 0 1 6 0 z  fill blue, no stroke → one filled polygon
//         local: (0,0)→(10,0), cubic to (16,0) with control y=3 (peak y = 9·¼ = 2.25 at t=.5), semicircle r3 centre (19,0) sweep=1 → passes (19,-3), to (22,0), close
//         local bbox x 0..22, y -3..2.25 → M → x 10..54, y -1..9.5
//   polyline 0,30 10,30 10,40 stroke green width 1 no fill → 2 line items, width 2 mm: (10,65)→(30,65)→(30,85).   bbox (± w/2 = 1) x 9..31, y 64..86
// Union bbox (SVG frame): x 9..58.5, y -1..86 → after Y flip and shift so min = (0,0): x' = x − 9, y' = 86 − y; size 49.5 × 87.
const HAND = `<?xml version="1.0" encoding="UTF-8"?>
<!-- comment before root -->
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
  <title>hand</title>
  <g transform="translate(10,5) scale(2)">
    <rect x="1" y="1" width="5" height="3" rx="0.5" fill="red"/>
    <circle cx="20" cy="20" r="4" fill="none" stroke="black" stroke-width="0.5"/>
    <path d="M0 0 l10 0 c 2 3 4 3 6 0 a 3 3 0 0 1 6 0 z" fill="blue" stroke="none"/>
    <polyline points="0,30 10,30 10,40" fill="none" stroke="green" stroke-width="1"/>
  </g>
</svg>`;
{
  const r = importSvg(HAND);
  eq(r.warnings.length, 0, `hand SVG: no warnings (${r.warnings})`);
  eq(r.items.length, 5, 'hand SVG: 5 items (rect, circle, polygon, 2 lines)');
  eq(r.items.map(i => i.type).join(','), 'rect,circle,polygon,line,line', 'hand SVG: item types in document order');
  ok(r.items.every(i => i.layer === 'F.Silk'), 'default layer F.Silk');
  ok(near(r.width, 49.5) && near(r.height, 87), `hand SVG: overall size 49.5 × 87 (got ${r.width} × ${r.height})`);
  const [rect, circ, poly, l1, l2] = r.items;
  // filled / unfilled per fill/stroke attributes
  ok(rect.filled === true && rect.width === 0, 'rect fill=red → filled, no stroke');
  ok(circ.filled === false && near(circ.width, 1), 'circle fill=none stroke → unfilled ring, width = 0.5 × scale 2 = 1 mm');
  ok(poly.filled === true && poly.width === 0, 'path fill=blue stroke=none → filled polygon');
  ok(near(l1.width, 2) && near(l2.width, 2), 'polyline stroke-width 1 × 2 = 2 mm lines');
  // positions after transform + flip + shift (x' = x − 9, y' = 86 − y)
  ok(near(rect.x, 8) && near(rect.y, 76) && near(rect.w, 10) && near(rect.h, 6) && near(rect.rx, 1) && near(rect.rot, 0), `rect centre (8,76) 10×6 rx1 (got ${rect.x},${rect.y} ${rect.w}×${rect.h} rx${rect.rx})`);
  ok(near(circ.cx, 41) && near(circ.cy, 41) && near(circ.r, 8), `circle centre (41,41) r8 (got ${circ.cx},${circ.cy} r${circ.r})`);
  ok(near(l1.x1, 1) && near(l1.y1, 21) && near(l1.x2, 21) && near(l1.y2, 21), `line 1 (1,21)→(21,21) (got ${l1.x1},${l1.y1}→${l1.x2},${l1.y2})`);
  ok(near(l2.x1, 21) && near(l2.y1, 21) && near(l2.x2, 21) && near(l2.y2, 1), `line 2 (21,21)→(21,1) (got ${l2.x1},${l2.y1}→${l2.x2},${l2.y2})`);
  const pb = itemBBox(poly);
  ok(nearArr(pb, [1, 76.5, 45, 87], 2e-3), `path polygon bbox [1,76.5,45,87] (got ${pb.map(v => +v.toFixed(4))})`);
  ok(poly.points.length > 12, `curves flattened (${poly.points.length} pts)`);
  // arc extreme (19,-3) local → (48,-1) → (39,87) is a vertex; cubic peak (13,2.25) → (36,9.5) → (27,76.5)
  ok(poly.points.some(p => near(p[0], 39, 1e-3) && near(p[1], 87, 1e-3)), 'arc apex (39,87) is a polygon vertex');
  ok(poly.points.some(p => near(p[0], 27, 1e-3) && near(p[1], 76.5, 1e-3)), 'cubic peak (27,76.5) is a polygon vertex');
  const first = poly.points[0], last = poly.points[poly.points.length - 1];
  ok(!(near(first[0], last[0]) && near(first[1], last[1])), 'closed path: duplicate closing vertex dropped');
  // Y flip: in SVG the polyline went "down" (y 30→40); in LAMINA it goes down in Y too (Y up frame → 21 → 1) — i.e. the drawing is not upside down
  ok(l2.y2 < l2.y1, 'Y flipped (SVG down = LAMINA lower Y)');
  // union bbox of the result starts at (0,0)
  const bb = bboxOf(r.items);
  ok(near(bb[0], 0) && near(bb[1], 0) && near(bb[2], 49.5) && near(bb[3], 87), `result bbox min at (0,0), max (49.5,87) (got ${bb.map(v => +v.toFixed(4))})`);
  // same document with unquoted attribute values (lenient parser) → identical geometry
  const lax = HAND.replace(/="([\w.]+)"/g, '=$1');
  ok(lax !== HAND, 'lax variant differs');
  const r2 = importSvg(lax);
  eq(JSON.stringify(r2.items.map(({ id, ...rest }) => rest)), JSON.stringify(r.items.map(({ id, ...rest }) => rest)), 'unquoted attributes parse identically');
  // opts: layer + targetWidth
  const r3 = importSvg(HAND, { layer: 'B.Cu', targetWidth: 99 });
  ok(r3.items.every(i => i.layer === 'B.Cu'), 'opts.layer applied');
  ok(near(r3.width, 99) && near(r3.height, 174), 'opts.targetWidth rescales uniformly (49.5×87 → 99×174)');
  ok(near(r3.items[1].width, 2) && near(r3.items[3].width, 4), 'targetWidth scales stroke widths too');
}

// ---------- units: width="50mm" viewBox="0 0 100 100" → 0.5 mm per user unit ----------
{
  const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" width="50mm" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100"/><circle cx="50" cy="50" r="10" fill="none" stroke="#000" stroke-width="2"/></svg>');
  eq(r.items.length, 2, 'units: 2 items');
  const [rect, circ] = r.items;
  ok(near(rect.w, 50) && near(rect.h, 50) && near(rect.x, 25) && near(rect.y, 25), `50mm/100 units → rect 50×50 mm centred (25,25) (got ${rect.w}×${rect.h} @ ${rect.x},${rect.y})`);
  ok(near(circ.r, 5) && near(circ.width, 1) && near(circ.cx, 25) && near(circ.cy, 25), '0.5 mm/unit: r10 → 5 mm, stroke 2 → 1 mm');
  ok(near(r.width, 50) && near(r.height, 50), 'units: overall 50 × 50 mm');
  eq(r.warnings.length, 0, 'units: no warnings');
  // width+height both given, same aspect
  const r2 = importSvg('<svg width="2in" height="1in" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>');
  ok(near(r2.items[0].w, 50.8) && near(r2.items[0].h, 25.4), 'inches: 2in/200 → 0.254 mm/unit');
  // px viewport (no unit) with viewBox
  const r3 = importSvg('<svg width="96" height="96" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  ok(near(r3.items[0].w, 25.4), 'unitless width = px → 96px = 25.4 mm');
  // no viewBox: user unit = px (spec), with warning
  const r4 = importSvg('<svg width="10mm" height="10mm"><rect width="96" height="96"/></svg>');
  ok(near(r4.items[0].w, 25.4) && r4.warnings.some(w => /no viewBox/.test(w)), 'no viewBox → 1 unit = 1 px + warning');
  // aspect mismatch → uniform min scale + warning
  const r5 = importSvg('<svg width="100mm" height="20mm" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>');
  ok(near(r5.items[0].w, 20) && r5.warnings.some(w => /aspect/.test(w)), 'aspect mismatch → min scale (0.2) + warning');
  // viewBox with offset origin
  const r6 = importSvg('<svg width="10mm" viewBox="5 5 10 10"><rect x="5" y="5" width="10" height="10"/><circle cx="15" cy="15" r="1"/></svg>');
  // SVG bbox x 5..16 (circle reaches 16), y 5..16 → x' = x − 5, y' = 16 − y: rect centre (10,10) → (5,6); circle (15,15) → (10,1)
  ok(near(r6.items[0].x, 5) && near(r6.items[0].y, 6) && near(r6.items[1].cx, 10) && near(r6.items[1].cy, 1) && near(r6.width, 11) && near(r6.height, 11), 'viewBox min-x/min-y honoured (relative positions kept, 11×11)');
}

// ---------- round trip: exportSvg(oneBoardDoc()) top file → importSvg ----------
{
  const doc1 = oneBoardDoc();
  const top = exportSvg(doc1).find(f => f.name.endsWith('-top.svg'));
  ok(top, 'exporter produced a -top.svg');
  let r; assert.doesNotThrow(() => { r = importSvg(top.data); }, 'importSvg does not throw on our own export'); n++;
  ok(r.items.length > 0, `round trip: ${r.items.length} items`);
  ok(near(r.width, 50, 0.2) && near(r.height, 50, 0.2), `round trip: board-sized result ≈ 50×50 (got ${r.width}×${r.height}; edge stroke adds 0.1)`);
  ok(r.warnings.length === 0 || r.warnings.every(w => /compound/.test(w)), `round trip: only the compound-path warning at most (${r.warnings})`);
  ok(r.items.some(i => i.type === 'circle' && i.filled), 'round trip: drills came back as filled circles');
  ok(r.items.some(i => i.type === 'polygon' && i.filled), 'round trip: pads/board came back as filled polygons');
  const types = new Set(r.items.map(i => i.type));
  ok([...types].every(t => ['line', 'circle', 'rect', 'polygon'].includes(t)), `round trip: only native graphic item types (${[...types]})`);
  // all four files of both fixture boards import without throwing
  const doc2 = twoBoardDoc();
  for (const f of exportSvg(doc2, { bitmapFor: fakeBitmapFor })) { const rr = importSvg(f.data); assert.ok(rr.items.length > 0, `${f.name} imports > 0 items`); }
  n++;
  // the mount holes of oneBoardDoc (2.7 mm NPTH at inset 3.5) come back at the right relative spacing: 50 − 2·3.5 = 43 mm apart
  const holes = r.items.filter(i => i.type === 'circle' && i.filled && near(i.r, 1.35, 1e-3));
  eq(holes.length, 4, 'round trip: 4 mount-hole circles r1.35');
  const xs = holes.map(h => h.cx), ys = holes.map(h => h.cy);
  ok(near(Math.max(...xs) - Math.min(...xs), 43, 1e-3) && near(Math.max(...ys) - Math.min(...ys), 43, 1e-3), 'round trip: hole spacing 43 mm both axes');
}

// ---------- parser unit checks ----------
{
  // path data
  const subs = parsePathData('M1 2 L3 4 H5 V6 Z m1 1 l1 0 v1 h-1 z');
  eq(subs.length, 2, 'two subpaths');
  ok(subs[0].closed && subs[1].closed, 'both closed');
  ok(nearArr(subs[0].start, [1, 2]) && subs[0].segs.length === 3 && nearArr(subs[0].segs[2].slice(1), [5, 6]), 'abs M/L/H/V');
  ok(nearArr(subs[1].start, [2, 3]) && nearArr(subs[1].segs[2].slice(1), [2, 4]), 'rel m after z starts from subpath start (1,2)+(1,1)');
  const impl = parsePathData('M0 0 10 0 10 10');
  eq(impl[0].segs.length, 2, 'implicit L after M');
  const q = parsePathData('M0 0 Q 5 10 10 0 T 20 0');
  ok(q[0].segs.length === 2 && q[0].segs.every(s => s[0] === 'C'), 'Q/T → cubics');
  ok(nearArr(q[0].segs[0].slice(1, 3), [10 / 3, 20 / 3]), 'Q → C control point 1 = P0 + 2/3 (Q − P0)');
  ok(nearArr(q[0].segs[1].slice(1, 3), [40 / 3, -20 / 3]), 'T reflects the previous quadratic control point → (15,-10) → C cp1 = (10,0) + 2/3·(5,-10)');
  const s = parsePathData('M0 0 C 1 1 2 1 3 0 S 5 -1 6 0');
  ok(nearArr(s[0].segs[1].slice(1, 3), [4, -1]), 'S reflects previous cubic cp2 (2,1) about (3,0) → (4,-1)');
  const sci = parsePathData('M1e1 -.5L2.5e-1.5 3 4');
  ok(nearArr(sci[0].start, [10, -0.5]) && nearArr(sci[0].segs[0].slice(1), [0.25, 0.5]) && nearArr(sci[0].segs[1].slice(1), [3, 4]) && sci[0].segs.length === 2, 'exponents / packed decimals (2.5e-1.5 = 0.25, 0.5) / missing separators');
  const flags = parsePathData('M0 0 a1 1 0 011 1'); // packed arc flags
  ok(flags[0].segs.length >= 1 && flags[0].segs.every(x => x[0] === 'C'), 'packed arc flags "011 1" parse');
  assert.throws(() => parsePathData('M0 0 L1 1 Z 5 5'), /after Z/, 'numbers after Z → error (not a hang)');
  assert.throws(() => parsePathData('M0 0 L1'), /bad path number/, 'truncated data → error');
  n += 2;
  // arcs: full geometry sanity — semicircle sweep 1 vs 0, large arc
  const A = (sweep, large) => arcToCubics(0, 0, 5, 5, 0, large, sweep, 10, 0);
  const endOf = segs => segs[segs.length - 1].slice(5);
  ok(nearArr(endOf(A(1, 0)), [10, 0]) && nearArr(endOf(A(0, 0)), [10, 0]), 'arc ends exactly at the endpoint');
  ok(A(1, 0).length === 2 && A(0, 0).length === 2, 'semicircle → 2 cubic pieces');
  ok(A(1, 0)[0][6] < 0 && A(0, 0)[0][6] > 0, 'sweep=1 goes through negative Y (up on screen), sweep=0 through positive Y');
  ok(nearArr(A(1, 0)[0].slice(5), [5, -5], 1e-9), 'quarter point of the semicircle at (5,-5)');
  const big = arcToCubics(0, 0, 10, 10, 0, 1, 1, 10, 10);   // 270° arc
  ok(big.length === 3 && nearArr(endOf(big), [10, 10]), 'large-arc flag → 3 quarter pieces');
  const small = arcToCubics(0, 0, 10, 10, 0, 0, 1, 10, 10);
  eq(small.length, 1, 'small arc (90°) → 1 piece');
  ok(arcToCubics(0, 0, 1, 1, 0, 0, 0, 0, 0).length === 0, 'zero-length arc → nothing');
  eq(arcToCubics(0, 0, 0, 3, 0, 0, 0, 4, 0)[0][0], 'L', 'zero radius → straight line');
  const rad = arcToCubics(0, 0, 1, 1, 0, 0, 1, 10, 0); // radii too small → scaled up to a semicircle r5
  ok(nearArr(rad[0].slice(5), [5, -5], 1e-6), 'radii scaled up when too small (spec F.6.6)');
  const ell = arcToCubics(0, 0, 4, 2, 90, 0, 1, 0, 8); // rotated ellipse; the far side of the semi-ellipse is at x = -2... rotate 90 → x = 2? check symmetry via mid-point distance
  ok(nearArr(endOf(ell), [0, 8], 1e-9), 'rotated elliptical arc reaches its endpoint');
  // transforms
  ok(nearArr(parseTransform('translate(10,5) scale(2)'), [2, 0, 0, 2, 10, 5]), 'translate·scale');
  ok(nearArr(parseTransform('scale(2) translate(10,5)'), [2, 0, 0, 2, 20, 10]), 'order matters (right-multiplied)');
  ok(nearArr(parseTransform('rotate(90)'), [0, 1, -1, 0, 0, 0], 1e-12), 'rotate 90');
  ok(nearArr(parseTransform('rotate(90 10 10)'), [0, 1, -1, 0, 20, 0], 1e-12), 'rotate about a point');
  ok(nearArr(parseTransform('matrix(1 2 3 4 5 6)'), [1, 2, 3, 4, 5, 6]), 'matrix');
  ok(nearArr(parseTransform('translate(3)'), [1, 0, 0, 1, 3, 0]) && nearArr(parseTransform('scale(2, 3)'), [2, 0, 0, 3, 0, 0]), 'translate(tx) / scale(sx,sy)');
  ok(near(parseTransform('skewX(45)')[2], 1) && near(parseTransform('skewY(45)')[1], 1), 'skew');
  ok(nearArr(mul([1, 0, 0, 1, 1, 2], [2, 0, 0, 2, 0, 0]), [2, 0, 0, 2, 1, 2]), 'mul');
  // xml
  const t = parseXml('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg a="1" b=\'2\'><g><rect/><!-- c --><![CDATA[<x>]]></g><path d="M0 0"/></svg>');
  const svg = t.children[0];
  eq(svg.name, 'svg', 'parseXml root'); eq(svg.attrs.a + svg.attrs.b, '12', 'quoted attrs (both quote styles)');
  eq(svg.children.map(c => c.name).join(','), 'g,path', 'children; comment/CDATA are not elements');
  eq(svg.children[0].children[0].name, 'rect', 'nested self-closing');
  eq(svg.children[0].text, '<x>', 'CDATA text kept');
  eq(decodeEntities('&lt;a&gt; &amp; &#65;&#x42; &quot;'), '<a> & AB "', 'entities');
  ok(parseXml('<svg><g></svg>').children[0].children[0].name === 'g', 'unclosed tag tolerated');
}

// ---------- style handling: CSS, style attribute, inheritance, opacity, display/visibility, unsupported elements ----------
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
    <defs><rect id="d" width="10" height="10"/></defs>
    <style>.a { fill: #f00; } #b { fill: none; stroke: #00f; stroke-width: 3 } rect.c { stroke: black }</style>
    <g fill="green" stroke="none">
      <rect class="a" x="0" y="0" width="10" height="10"/>
      <rect id="b" x="20" y="0" width="10" height="10"/>
      <rect class="c" x="40" y="0" width="10" height="10" style="fill:none;stroke-width:2"/>
      <rect x="60" y="0" width="10" height="10" fill="none"/>
      <rect x="60" y="20" width="10" height="10" fill-opacity="0"/>
      <rect x="60" y="40" width="10" height="10" style="display:none"/>
      <rect x="60" y="60" width="10" height="10" visibility="hidden"/>
      <g visibility="hidden"><rect x="80" y="0" width="10" height="10" visibility="visible"/></g>
      <g opacity="0"><rect x="80" y="20" width="10" height="10"/></g>
      <text x="0" y="50">hi</text>
      <use href="#d"/>
      <image href="x.png" width="10" height="10"/>
      <ellipse cx="50" cy="50" rx="10" ry="5"/>
      <line x1="0" y1="90" x2="10" y2="90" stroke="black" stroke-width="1"/>
      <line x1="0" y1="95" x2="10" y2="95"/>
      <polygon points="0,70 10,70 5,80"/>
      <polygon points="20,70 30,70 25,80" fill="none" stroke="red" stroke-width="0.5"/>
    </g>
  </svg>`;
  const r = importSvg(svg);
  const it = r.items;
  // Drawn (SVG frame): rect A (0,0,10,10) filled; rect B (20,0) stroke 3 → bbox 18.5..31.5 × -1.5..11.5; rect C (40,0) stroke 2;
  // rect (80,0) visible child of hidden group; ellipse 40..60 × 45..55; line y=90 w1 → x -0.5..10.5, y 89.5..90.5; two triangles.
  // Union: x -0.5..90 (rect at 80..90), y -1.5..90.5 → x' = x + 0.5, y' = 90.5 − y; size 90.5 × 92.
  eq(it.map(i => i.type).join(','), 'rect,rect,rect,rect,polygon,line,polygon,polygon', 'styles: item types in document order');
  ok(near(r.width, 90.5) && near(r.height, 92), `styles: size 90.5 × 92 (got ${r.width} × ${r.height})`);
  const [rA, rB, rC, rD, ell, ln, triF, triS] = it;
  ok(rA.filled && rA.width === 0 && near(rA.x, 5.5) && near(rA.y, 85.5), '.a → CSS class fill beats inherited group fill → filled rect at (5.5,85.5)');
  ok(!rB.filled && near(rB.width, 3) && near(rB.x, 25.5), '#b → CSS id: fill none + stroke 3 → unfilled rect width 3');
  ok(!rC.filled && near(rC.width, 2) && near(rC.x, 45.5), 'rect.c → tag.class stroke + style attr (fill:none; stroke-width 2 overrides CSS) → unfilled width 2');
  ok(rD.filled && near(rD.x, 85.5) && near(rD.y, 85.5), 'visibility=visible child of a visibility=hidden group is drawn (spec)');
  ok(!it.some(i => i.type === 'rect' && near(i.x, 65.5)), 'x=60 rects skipped: fill=none, fill-opacity=0, display:none, visibility=hidden');
  ok(!it.some(i => i.type === 'rect' && near(i.y, 90.5 - 25)), 'group opacity=0 subtree skipped');
  ok(r.warnings.some(w => /<text>/.test(w)) && r.warnings.some(w => /<use>/.test(w)) && r.warnings.some(w => /<image>/.test(w)), 'text/use/image → one warning each');
  eq(r.warnings.length, 3, 'exactly those 3 warnings');
  ok(!it.some(i => i.type === 'rect' && near(i.x, 5.5) && near(i.y, 90.5 - 5) && i !== rA), '<defs> content not drawn (only via <use>, which is skipped)');
  ok(ell.filled && ell.points.length >= 8 && nearArr(itemBBox(ell), [40.5, 35.5, 60.5, 45.5], 1e-3), 'ellipse → flattened filled polygon spanning 20 × 10');
  ok(near(ln.width, 1) && near(ln.x1, 0.5) && near(ln.y1, 0.5) && near(ln.x2, 10.5) && near(ln.y2, 0.5), 'stroked <line> imported (width 1); the unstroked <line> produced nothing');
  ok(triF.filled && triF.width === 0 && triF.points.length === 3 && nearArr(itemBBox(triF), [0.5, 10.5, 10.5, 20.5], 1e-6), 'filled <polygon> → filled 3-point polygon');
  ok(!triS.filled && near(triS.width, 0.5) && triS.points.length === 3, 'stroke-only <polygon> → unfilled closed polygon width 0.5');
  const bb = bboxOf(it); ok(near(bb[0], 0) && near(bb[1], 0), 'result shifted so bbox min = (0,0)');
  // stroked shapes under a non-similarity transform become polygons; similarity + rotation keep native rect with rot
  const r2 = importSvg('<svg width="10mm" viewBox="0 0 10 10"><rect x="0" y="0" width="4" height="2" transform="rotate(90)"/><rect x="0" y="0" width="4" height="2" transform="skewX(30)"/><circle cx="5" cy="5" r="1" transform="scale(1,2)"/></svg>');
  const nat = r2.items.find(i => i.type === 'rect'), pol = r2.items.filter(i => i.type === 'polygon');
  ok(nat && near(Math.abs(nat.rot), 90) && near(nat.w, 4) && near(nat.h, 2), 'rotated rect stays native with rot ±90');
  eq(pol.length, 2, 'skewed rect + non-uniformly scaled circle → polygons');
  // multi-line / nested svg / <a> / <switch>
  const r3 = importSvg('<svg width="10mm" viewBox="0 0 10 10"><a><switch><rect width="1" height="1"/></switch></a><svg x="5" y="5" width="2" height="2" viewBox="0 0 4 4"><rect width="4" height="4"/></svg></svg>');
  eq(r3.items.length, 2, 'a/switch/nested svg traversed');
  const nested = r3.items.find(i => near(i.w, 2));
  // nested <svg x=5 y=5 w=2 h=2 viewBox 0 0 4 4> → scale 0.5 → the 4×4 rect is 2×2 at SVG (5..7, 5..7); union bbox 0..7 → y' = 7 − y
  ok(nested && near(nested.h, 2) && nearArr(itemBBox(nested), [5, 0, 7, 2], 1e-6), `nested svg x/y + viewBox scale → 2×2 rect at x 5..7, y 0..2 (got ${nested && itemBBox(nested)})`);
  // ArrayBuffer input + BOM
  const buf = new TextEncoder().encode('﻿<svg width="10mm" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>').buffer;
  eq(importSvg(buf).items.length, 1, 'ArrayBuffer input with BOM');
  // errors
  assert.throws(() => importSvg('<html><body/></html>'), /no <svg>/, 'no <svg> → throws');
  n++;
  const empty = importSvg('<svg width="10mm" viewBox="0 0 10 10"><g/></svg>');
  ok(empty.items.length === 0 && empty.warnings.some(w => /no drawable/.test(w)) && empty.width === 0, 'empty drawing → no items + warning');
  // compound path (hole) → two filled polygons + one warning
  const cp = importSvg('<svg width="10mm" viewBox="0 0 10 10"><path d="M0 0h10v10h-10z M3 3h4v4h-4z"/></svg>');
  eq(cp.items.length, 2, 'compound path → 2 polygons'); ok(cp.warnings.some(w => /compound/.test(w)), 'compound warning');
  // stroke width with units
  const su = importSvg('<svg width="100mm" viewBox="0 0 100 100"><line x1="0" y1="0" x2="10" y2="0" stroke="#000" stroke-width="1mm"/></svg>');
  ok(near(su.items[0].width, 1 / PX, 1e-3), 'stroke-width "1mm" → converted via px user units (1mm = 3.78 user units = 3.78 mm here)');
}

console.log(`svgimport: ${n} checks`);
console.log('ALL PASS');
