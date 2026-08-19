// node test/clip.test.mjs — the raster-backed area engine (js/lib/clip.js)
import assert from 'node:assert/strict';
import * as C from '../js/lib/clip.js';
import { resolveBoard, pointInPolygon, circlePoints, polygonArea } from '../js/geom.js';
import { twoBoardDoc } from './fixtures.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} ±${tol})`);
const pct = (got, want) => Math.abs(got - want) / Math.abs(want) * 100;
const within = (got, want, p, msg) => ok(pct(got, want) <= p, `${msg}: ${got.toFixed(4)} vs ${want.toFixed(4)} = ${pct(got, want).toFixed(3)}% off (max ${p}%)`);
const disc = (x, y, r) => ({ outer: circlePoints(x, y, r, 512), holes: [] });
const RES = { res: 0.05 };

// ---------------------------------------------------------------- normalisation
ok(C.normShapes(null).length === 0, 'normShapes(null) = []');
ok(C.normShapes([]).length === 0, 'normShapes([]) = []');
ok(C.normShapes([[0, 0], [1, 0], [1, 1]]).length === 1, 'normShapes(polygon)');
ok(C.normShapes([[[0, 0], [1, 0], [1, 1]]]).length === 1, 'normShapes([polygon])');
ok(C.normShapes({ outer: [[0, 0], [1, 0], [1, 1]] })[0].holes.length === 0, 'normShapes(shape) fills holes');
ok(C.normShapes([{ outer: [[0, 0], [1, 0], [1, 1]], holes: [] }]).length === 1, 'normShapes(shapes)');
ok(C.normShapes([[0, 0], [1, 1]]).length === 0, 'degenerate 2-point polygon dropped');
ok(C.normShapes('nonsense').length === 0, 'junk in, [] out');

// ---------------------------------------------------------------- known areas (1 %)
const SQ = [[0, 0], [10, 0], [10, 10], [0, 10]];
within(C.shapesArea(C.unionShapes(SQ, RES)), 100, 1, 'square 10×10');
within(C.shapesArea(C.unionShapes([disc(0, 0, 5)], RES)), Math.PI * 25, 1, 'disc r5');
const RING = C.ringShape(0, 0, 5, 2, 512);
const ringV = C.unionShapes([RING], RES);
within(C.shapesArea(ringV), Math.PI * (36 - 16), 1, 'ring r5 w2');
ok(ringV.length === 1 && ringV[0].holes.length === 1, 'ring vectorises to 1 shape with 1 hole');
within(C.shapesArea(C.subtractShapes(SQ, [disc(5, 5, 3)], RES)), 100 - Math.PI * 9, 1, 'square − disc');
const d1 = disc(0, 0, 5), d2 = disc(4, 0, 5);
const lens = 2 * 25 * Math.acos(4 / 10) - 2 * Math.sqrt(100 - 16);   // 2r²·acos(d/2r) − (d/2)·√(4r²−d²)
within(C.shapesArea(C.unionShapes([d1, d2], RES)), 2 * Math.PI * 25 - lens, 1, 'two discs union');
within(C.shapesArea(C.intersectShapes([d1], [d2], RES)), lens, 1, 'two discs intersect');
within(C.shapesArea(C.xorShapes([d1], [d2], RES)), 2 * Math.PI * 25 - 2 * lens, 1, 'two discs xor');
ok(C.xorShapes([d1], [d2], RES).length >= 1, 'xor is non-empty');
ok(C.intersectShapes([disc(0, 0, 1)], [disc(50, 50, 1)], RES).length === 0, 'disjoint intersect = []');
ok(C.shapesArea(C.subtractShapes(SQ, [disc(50, 50, 1)], RES)) === 100, 'disjoint subtract is the exact fast path');
ok(C.unionShapes(SQ, RES)[0].outer.length === 4, 'a rectangle stays a 4-point rectangle');

// hole survives a boolean
const donut = C.subtractShapes([disc(0, 0, 6)], [disc(0, 0, 3)], RES);
ok(donut.length === 1 && donut[0].holes.length === 1, 'subtract makes a hole, not a second shape');
within(C.shapesArea(donut), Math.PI * (36 - 9), 1, 'donut area');

// ---------------------------------------------------------------- rasterize / vectorize
const mk = C.rasterize(SQ, RES);
ok(mk.w * mk.h > 0 && mk.res === 0.05, 'rasterize returns a mask at the asked resolution');
within(C.maskArea(mk), 100, 1, 'mask pixel area');
within(C.shapesArea(C.vectorize(mk, {})), 100, 1, 'vectorize round-trip');
const warns = [];
const coarse = C.rasterize([[0, 0], [400, 0], [400, 400], [0, 400]], { res: 0.01, warnings: warns });
ok(coarse.res > 0.01 && warns.length > 0, 'mask cap degrades resolution and warns');
ok(coarse.w * coarse.h <= C.MAX_PX, 'degraded mask respects the pixel cap');

// ---------------------------------------------------------------- offset
for (const delta of [1.5, -1.5, 0.4]) {
  const off = C.offsetShapes([disc(0, 0, 5)], delta, RES);
  const bb = C.shapesBBox(off);
  near((bb[2] - bb[0]) / 2, 5 + delta, 0.05, `offset disc by ${delta} → radius 5${delta > 0 ? '+' : ''}${delta}`);
  near((bb[3] - bb[1]) / 2, 5 + delta, 0.05, `offset disc by ${delta} (y)`);
}
within(C.shapesArea(C.offsetShapes([disc(0, 0, 5)], 1, RES)), Math.PI * 36, 1, 'grown disc area');
ok(C.offsetShapes([disc(0, 0, 1)], -2, RES).length === 0, 'over-shrink vanishes without crashing');
const offSq = C.offsetShapes([SQ], 1, RES);
within(C.shapesArea(offSq), 100 + 4 * 10 + Math.PI, 1, 'grown square = square + 4 sides + round corners');

// ---------------------------------------------------------------- roundCorners
const r = 2;
const rc = C.roundCorners([SQ], r, RES);
const lo = 100 - 4 * r * r * (1 - Math.PI / 4);
ok(C.shapesArea(rc) <= 100 + 1e-6, 'roundCorners never grows the square');
ok(C.shapesArea(rc) >= lo * 0.99, `roundCorners area ${C.shapesArea(rc).toFixed(3)} ≈ ideal ${lo.toFixed(3)}`);
within(C.shapesArea(rc), lo, 1, 'roundCorners square area');
// concave corners round too: an L keeps more area than a pure convex cut would predict
const L = [[0, 0], [20, 0], [20, 6], [6, 6], [6, 20], [0, 20]];
const rcL = C.roundCorners([L], 1.5, RES);
ok(rcL.length === 1 && C.shapesArea(rcL) > 0, 'roundCorners on a concave shape returns one shape');
ok(C.shapesArea(rcL) > C.shapesArea(C.offsetShapes(C.offsetShapes([L], -1.5, RES), 1.5, RES)) - 1e-9, 'close+open keeps more than open alone');

// ---------------------------------------------------------------- shapesFromPrims
const stad = C.shapesFromPrims([{ t: 'line', x1: 0, y1: 0, x2: 10, y2: 0, w: 1 }]);
ok(stad.length === 1, '10 mm line → one stadium');
within(C.shapesArea(stad), 10 + Math.PI / 4, 1, 'stadium area = 10·1 + π/4');
const bbS = C.shapesBBox(stad);
near(bbS[0], -0.5, 0.02, 'stadium starts at −w/2'); near(bbS[2], 10.5, 0.02, 'stadium ends at 10+w/2');
const ringPrim = C.shapesFromPrims([{ t: 'circle', cx: 0, cy: 0, r: 5, w: 2 }]);
ok(ringPrim[0].holes.length === 1, 'circle prim with w>0 is a ring');
within(C.shapesArea(ringPrim), Math.PI * (36 - 16), 2, 'ring prim area');
const discPrim = C.shapesFromPrims([{ t: 'circle', cx: 0, cy: 0, r: 5, w: 0 }]);
ok(discPrim[0].holes.length === 0, 'circle prim with w===0 is a disc');
const polyPrim = C.shapesFromPrims([{ t: 'poly', pts: SQ, holes: [] }]);
ok(C.shapesArea(polyPrim) === 100, 'filled poly passes through exactly');
const plPrim = C.shapesFromPrims([{ t: 'polyline', pts: [[0, 0], [10, 0], [10, 10]], w: 1 }], { union: true, ...RES });
within(C.shapesArea(plPrim), 20 + Math.PI / 4, 2, 'unioned polyline = 20 mm of stroke + one round cap-pair');
ok(C.shapesFromPrims([{ t: 'text', x: 0, y: 0, text: 'x' }]).length === 0, 'text prims are skipped (caller flattens them)');
ok(C.shapesFromPrims(null).length === 0, 'shapesFromPrims(null) = []');

// ---------------------------------------------------------------- board / keepout / usable
const doc = twoBoardDoc();
const R = resolveBoard(doc.boards[0], doc);
const board = C.boardArea(R, RES);
ok(board.length === 1 && board[0].holes.length === R.cutouts.length, 'boardArea = outline with the cutouts as holes');
within(C.shapesArea(board), 100 * 60 - (4 * 4 - Math.PI * 9) - 8 * 6, 0.5, 'board area (rounded corners r3, one 8×6 cutout)');
const keep = C.keepoutShapes(R, RES);
ok(keep.length > 0, 'keepout is non-empty');
const usable = C.usableArea(R, RES);
ok(usable.length > 0, 'usable area is non-empty');
ok(C.shapesArea(usable) > 1000 && C.shapesArea(usable) < 100 * 60, 'usable area is a sane fraction of the board');
let badDrill = 0, badPad = 0;
for (const d of R.drills) if (C.pointInShapes(usable, d.x, d.y)) badDrill++;
for (const p of R.pads) if (C.pointInShapes(usable, p.x, p.y)) badPad++;
ok(R.drills.length > 4 && R.pads.length > 4, 'fixture really has drills and pads');
ok(badDrill === 0, `no drill centre is usable (${badDrill} leaked)`);
ok(badPad === 0, `no pad centre is usable (${badPad} leaked)`);
for (const d of R.drills) ok(C.pointInShapes(keep, d.x, d.y), 'drill centre is inside the keepout');
for (const p of R.pads) ok(C.pointInShapes(keep, p.x, p.y), 'pad centre is inside the keepout');
ok(!C.pointInShapes(usable, 50, 30), 'the Edge.Cuts cutout is not usable');
let outside = 0;
for (const s of usable) for (const [x, y] of s.outer) if (!pointInPolygon(x, y, R.outline)) outside++;
ok(outside === 0, `usable stays inside the board outline (${outside} stray vertices)`);
// edge margin really bites
const nearEdge = usable.some(s => s.outer.some(([x, y]) => x < 0.3 || y < 0.3 || x > 99.7 || y > 59.7));
ok(!nearEdge, 'usable respects the 0.5 mm edge margin');
const noEdge = C.usableArea(R, { ...RES, edgeMargin: 0 });
ok(C.shapesArea(noEdge) > C.shapesArea(usable), 'edgeMargin:0 gives more usable area');
const cuKeep = C.keepoutShapes(R, { ...RES, copperLayers: ['F.Cu'] });
ok(C.shapesArea(cuKeep) > C.shapesArea(keep), 'copper layers add to the keepout');
ok(C.pointInShapes(cuKeep, 45, 40), 'a trace on F.Cu is inside the copper keepout');
const bigMargin = C.usableArea(R, { ...RES, holeMargin: 2, padMargin: 2, partMargin: 2 });
ok(C.shapesArea(bigMargin) < C.shapesArea(usable), 'bigger margins → less usable area');

// ---------------------------------------------------------------- hatch
const REG = [[[0, 0], [20, 0], [20, 20], [0, 20]]];
const h1 = C.hatchFill(REG, { angle: 0, spacing: 1, offset: 0.5, ...RES });
ok(h1.lines.length === 20, `20 horizontal lines at spacing 1 (got ${h1.lines.length})`);
const ys = h1.lines.map(l => l[0][1]).sort((a, b) => a - b);
for (let i = 0; i < ys.length; i++) near(ys[i], 0.5 + i, 1e-9, 'hatch line y position');
for (const l of h1.lines) {
  ok(l.length === 2, 'hatch line is a single segment');
  near(Math.min(l[0][0], l[1][0]), 0, 1e-9, 'hatch clipped at x=0');
  near(Math.max(l[0][0], l[1][0]), 20, 1e-9, 'hatch clipped at x=20');
}
const h45 = C.hatchFill(REG, { angle: 45, spacing: 2, crosshatch: true, ...RES });
ok(h45.lines.length > 20, 'crosshatch produces both directions');
let hatchOut = 0;
for (const l of h45.lines) for (let i = 0; i + 1 < l.length; i++) {
  const mx = (l[i][0] + l[i + 1][0]) / 2, my = (l[i][1] + l[i + 1][1]) / 2;
  if (!C.pointInShapes(REG, mx, my)) hatchOut++;
}
ok(hatchOut === 0, `every hatch segment is inside the region (${hatchOut} outside)`);
// hatch respects holes
const HOLED = [{ outer: [[0, 0], [20, 0], [20, 20], [0, 20]], holes: [[[8, 8], [12, 8], [12, 12], [8, 12]]] }];
const hh = C.hatchFill(HOLED, { angle: 0, spacing: 1, offset: 0.5, ...RES });
ok(hh.lines.filter(l => l[0][1] > 8 && l[0][1] < 12).every(l => l.length === 2) === true, 'hatch is split by the hole');
ok(hh.lines.length > 20, 'lines crossing the hole become two pieces');
for (const l of hh.lines) ok(!C.pointInShapes([{ outer: [[8, 8], [12, 8], [12, 12], [8, 12]], holes: [] }], (l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2), 'no hatch inside the hole');

// ---------------------------------------------------------------- dots / scatter
const dots = C.dotFill(REG, { spacing: 2, d: 0.8, ...RES });
ok(dots.length > 50, `dotFill produced ${dots.length} dots`);
let minGapDots = Infinity;
const cen = dots.map(s => { const bb = C.shapesBBox([s]); return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, (bb[2] - bb[0]) / 2]; });
for (let i = 0; i < cen.length; i++) for (let j = i + 1; j < cen.length; j++) minGapDots = Math.min(minGapDots, Math.hypot(cen[i][0] - cen[j][0], cen[i][1] - cen[j][1]));
near(minGapDots, 2, 1e-6, 'dotFill grid spacing is exactly `spacing`');
for (const s of dots) for (const [x, y] of s.outer) ok(C.pointInShapes(REG, x, y), 'every dot vertex is inside the region');
for (const c of cen) near(c[2], 0.4, 0.02, 'dot radius = d/2');
const hexDots = C.dotFill(REG, { spacing: 2, d: 0.8, grid: 'hex', ...RES });
ok(hexDots.length > 50 && hexDots.length !== dots.length, 'hex grid differs from square grid');
const jitDots = C.dotFill(REG, { spacing: 2, d: 0.8, jitter: 0.4, seed: 7, ...RES });
ok(JSON.stringify(jitDots) !== JSON.stringify(dots), 'jitter moves the dots');
for (const s of jitDots) for (const [x, y] of s.outer) ok(C.pointInShapes(REG, x, y), 'jittered dots stay inside');

const sc = C.scatter(REG, { count: 120, minD: 0.5, maxD: 2, minGap: 0.3, seed: 3, ...RES });
ok(sc.length > 20, `scatter placed ${sc.length} shapes`);
const scc = sc.map(s => { const bb = C.shapesBBox([s]); return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, (bb[2] - bb[0]) / 2]; });
let scBad = 0;
for (let i = 0; i < scc.length; i++) for (let j = i + 1; j < scc.length; j++) {
  if (Math.hypot(scc[i][0] - scc[j][0], scc[i][1] - scc[j][1]) < scc[i][2] + scc[j][2] + 0.3 - 1e-6) scBad++;
}
ok(scBad === 0, `scatter respects minGap (${scBad} violations)`);
for (const s of sc) for (const [x, y] of s.outer) ok(C.pointInShapes(REG, x, y), 'every scattered vertex is inside');
for (const c of scc) ok(c[2] >= 0.25 - 1e-9 && c[2] <= 1 + 1e-9, 'scatter diameters stay within [minD,maxD]');
ok(C.scatter(REG, { shape: 'square', count: 20, seed: 1, ...RES })[0].outer.length === 4, 'square scatter has 4-point shapes');
ok(C.scatter(REG, { shape: 'triangle', count: 20, seed: 1, ...RES })[0].outer.length === 3, 'triangle scatter has 3-point shapes');

// ---------------------------------------------------------------- the rest of the generators
const gens = {
  spiral: C.spiral(REG, { spacing: 1, ...RES }),
  concentric: C.concentric(REG, { spacing: 1, ...RES }),
  concentricPt: C.concentric(REG, { spacing: 1.5, from: 'point', x: 10, y: 10, ...RES }),
  maze: C.mazeFill(REG, { cell: 2, seed: 5, ...RES }),
  truchetArcs: C.truchet(REG, { cell: 3, seed: 5, ...RES }),
  truchetLines: C.truchet(REG, { cell: 3, seed: 5, style: 'lines', ...RES }),
  flow: C.flowLines(REG, { spacing: 1.5, step: 0.4, seed: 2, ...RES }),
  contour: C.contourNoise(REG, { levels: 6, scale: 8, seed: 2, ...RES }),
};
for (const [k, g] of Object.entries(gens)) {
  ok(g.lines.length > 0, `${k} produced ${g.lines.length} polylines`);
  let bad = 0, pts = 0;
  for (const l of g.lines) {
    ok(l.length >= 2, `${k}: every polyline has ≥2 points`);
    pts += l.length;
    for (let i = 0; i + 1 < l.length; i++) {
      const mx = (l[i][0] + l[i + 1][0]) / 2, my = (l[i][1] + l[i + 1][1]) / 2;
      if (!C.pointInShapes(REG, mx, my)) bad++;
    }
  }
  ok(bad === 0, `${k}: all ${pts} points clipped inside the region (${bad} outside)`);
}
ok(gens.spiral.lines.length >= 1, 'spiral fills the square in one or more passes');
const discReg = [disc(0, 0, 10)];
const spDisc = C.spiral(discReg, { spacing: 1, cx: 0, cy: 0, ...RES });
ok(spDisc.lines.length === 1, 'a spiral that never leaves a round region is one polyline');
ok(spDisc.lines[0].length > 100, 'spiral is finely sampled');
ok(gens.concentric.lines.length >= 8, 'concentric gives ~half-width/spacing rings');
ok(gens.truchetArcs.lines.length !== gens.truchetLines.lines.length || JSON.stringify(gens.truchetArcs) !== JSON.stringify(gens.truchetLines), 'truchet styles differ');
// generators inside a region with a hole keep out of it
const HOLE = [{ outer: [[8, 8], [12, 8], [12, 12], [8, 12]], holes: [] }];
for (const g of [C.spiral(HOLED, { spacing: 1, ...RES }), C.mazeFill(HOLED, { cell: 2, seed: 1, ...RES }), C.flowLines(HOLED, { spacing: 1.5, seed: 1, ...RES })]) {
  let inHole = 0;
  for (const l of g.lines) for (let i = 0; i + 1 < l.length; i++) if (C.pointInShapes(HOLE, (l[i][0] + l[i + 1][0]) / 2, (l[i][1] + l[i + 1][1]) / 2)) inHole++;
  ok(inHole === 0, 'generators keep out of region holes');
}

// voronoi
const vor = C.voronoi(REG, { count: 25, seed: 4, gap: 0.6, relax: 1, ...RES });
ok(vor.length > 5, `voronoi produced ${vor.length} cells`);
ok(C.shapesArea(vor) < 400 && C.shapesArea(vor) > 200, 'voronoi cells cover most of the region minus the gaps');
let vorOut = 0;   // raster-derived, so allow the half-pixel quantisation of the boundary
for (const s of vor) for (const [x, y] of s.outer) if (x < -0.1 || x > 20.1 || y < -0.1 || y > 20.1) vorOut++;
ok(vorOut === 0, `voronoi cells stay inside the region (${vorOut} stray vertices)`);
ok(vor.every(s => s.holes.length === 0), 'voronoi cells have no holes');
// the gap really separates the cells: no two cell centroids sit closer than the gap allows
const vorCent = vor.map(s => { const bb = C.shapesBBox([s]); return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]; });
ok(new Set(vorCent.map(c => c.join(','))).size === vorCent.length, 'voronoi cells are distinct');
ok(C.shapesArea(vor) < C.shapesArea(C.voronoi(REG, { count: 25, seed: 4, gap: 0, relax: 1, ...RES })), 'a bigger gap eats more area');

// halftone: darker → bigger dots
const IW = 64, IH = 64;
const grad = { w: IW, h: IH, data: new Uint8Array(IW * IH), x: 10, y: 10, wmm: 20, hmm: 20 };
for (let j = 0; j < IH; j++) for (let i = 0; i < IW; i++) grad.data[j * IW + i] = Math.round(255 * i / (IW - 1)); // black at the left
const ht = C.halftone(REG, grad, { spacing: 1.2, minD: 0.1, maxD: 1.1, angle: 0, ...RES });
ok(ht.length > 100, `halftone produced ${ht.length} dots`);
const dia = s => { const bb = C.shapesBBox([s]); return bb[2] - bb[0]; };
const cx = s => { const bb = C.shapesBBox([s]); return (bb[0] + bb[2]) / 2; };
const dark = ht.filter(s => cx(s) < 6), light = ht.filter(s => cx(s) > 14);
const avg = a => a.reduce((t, s) => t + dia(s), 0) / a.length;
ok(dark.length > 10 && light.length > 10, 'halftone covers both ends of the gradient');
ok(avg(dark) > avg(light) * 1.5, `halftone dots grow with darkness (${avg(dark).toFixed(2)} vs ${avg(light).toFixed(2)})`);
for (const s of ht) { const d = dia(s); ok(d >= 0.09 && d <= 1.15, 'halftone diameters stay within [minD,maxD]'); }
for (const s of ht) for (const [x, y] of s.outer) ok(C.pointInShapes(REG, x, y), 'halftone dots stay inside');
// 1-bit ink bitmaps work too (that is what js/import/image.js produces)
const ink = { w: 8, h: 8, data: new Uint8Array(64).fill(0), x: 10, y: 10, wmm: 20, hmm: 20 };
for (let i = 0; i < 32; i++) ink.data[i] = 1;                       // top half is ink
const htInk = C.halftone(REG, ink, { spacing: 2, minD: 0.2, maxD: 1.4, ...RES });
ok(htInk.length > 10, '1-bit halftone works');
ok(avg(htInk.filter(s => C.shapesBBox([s])[1] > 12)) > avg(htInk.filter(s => C.shapesBBox([s])[1] < 8)), '1-bit halftone: inked half gets the big dots');
ok(C.halftone(REG, null, RES).length === 0, 'halftone(null image) = []');

// ---------------------------------------------------------------- determinism
const same = (f) => JSON.stringify(f()) === JSON.stringify(f());
ok(same(() => C.dotFill(REG, { spacing: 2, d: 0.8, jitter: 0.3, seed: 9, ...RES })), 'dotFill deterministic');
ok(same(() => C.scatter(REG, { count: 60, seed: 9, ...RES })), 'scatter deterministic');
ok(same(() => C.voronoi(REG, { count: 20, seed: 9, ...RES })), 'voronoi deterministic');
ok(same(() => C.mazeFill(REG, { cell: 2, seed: 9, ...RES })), 'mazeFill deterministic');
ok(same(() => C.truchet(REG, { cell: 3, seed: 9, ...RES })), 'truchet deterministic');
ok(same(() => C.flowLines(REG, { spacing: 2, seed: 9, ...RES })), 'flowLines deterministic');
ok(same(() => C.contourNoise(REG, { levels: 4, seed: 9, ...RES })), 'contourNoise deterministic');
const seedChanges = (f) => JSON.stringify(f(1)) !== JSON.stringify(f(2));
ok(seedChanges(s => C.scatter(REG, { count: 60, seed: s, ...RES })), 'scatter seed matters');
ok(seedChanges(s => C.voronoi(REG, { count: 20, seed: s, ...RES })), 'voronoi seed matters');
ok(seedChanges(s => C.mazeFill(REG, { cell: 2, seed: s, ...RES })), 'maze seed matters');
ok(seedChanges(s => C.truchet(REG, { cell: 3, seed: s, ...RES })), 'truchet seed matters');
ok(seedChanges(s => C.flowLines(REG, { spacing: 2, seed: s, ...RES })), 'flow seed matters');
ok(seedChanges(s => C.contourNoise(REG, { levels: 4, seed: s, ...RES })), 'contour seed matters');
ok(seedChanges(s => C.dotFill(REG, { spacing: 2, jitter: 0.4, seed: s, ...RES })), 'jittered dots seed matters');
const rn = C.rng(42); const rn2 = C.rng(42);
ok(rn() === rn2() && rn() === rn2(), 'rng(seed) is reproducible');
ok(C.rng(1)() !== C.rng(2)(), 'different seeds give different streams');
ok(C.valueNoise(1.5, 2.5, 1) === C.valueNoise(1.5, 2.5, 1) && C.valueNoise(1.5, 2.5, 1) !== C.valueNoise(1.5, 2.5, 2), 'value noise is deterministic and seed-dependent');
// Normalise line endings first: `.` does not match \r in a JS regex, so on a
// CRLF checkout `/\/\/.*$/` matches nothing, no comment is stripped, and this
// assertion trips on clip.js's own line-2 comment saying it uses neither.
const srcNoComments = (await (await import('node:fs/promises')).readFile(new URL('../js/lib/clip.js', import.meta.url), 'utf8'))
  .replace(/\r\n?/g, '\n')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
ok(!/Math\.random\s*\(|Date\.now\s*\(/.test(srcNoComments), 'clip.js calls neither Math.random nor Date.now');

// ---------------------------------------------------------------- polylines -> areas
const pls = C.polylinesToShapes([[[0, 0], [10, 0]]], 1, RES);
within(C.shapesArea(pls), 10 + Math.PI / 4, 2, 'polylinesToShapes = stadium');
ok(C.polylinesToShapes({ lines: [[[0, 0], [10, 0]]] }, 1, RES).length === 1, 'polylinesToShapes accepts {lines}');
ok(C.polylinesToShapes([], 1, RES).length === 0, 'polylinesToShapes([]) = []');

// ---------------------------------------------------------------- item converters
const si = C.shapesToItems(donut, { layer: 'F.Cu' });
ok(si.items.length === 2, 'a shape with one hole makes 2 polygon items');
ok(si.warnings.length === 1 && /hole/.test(si.warnings[0]), 'and warns about the hole');
ok(si.items.every(i => i.type === 'polygon' && i.layer === 'F.Cu' && i.filled === true && i.id), 'polygon items are well formed');
ok(si.items[0].id !== si.items[1].id, 'ids are unique inside one call');
ok(C.shapesToItems(donut, { layer: 'F.Silk', filled: false, width: 0.3 }).items.every(i => i.filled === false && i.width === 0.3), 'unfilled + width honoured');
ok(C.shapesToItems(donut, { idFn: () => 'zz' }).items.every(i => i.id === 'zz'), 'idFn is used');
const li = C.linesToItems(spDisc, { layer: 'F.Silk', width: 0.3 });
ok(li.items.length === 1 && li.items[0].type === 'path' && li.items[0].width === 0.3, 'a long polyline becomes a path item');
ok(li.items[0].points.length === spDisc.lines[0].length, 'path keeps every point');
ok(C.linesToItems(h1, { layer: 'F.Silk' }).items.every(i => i.type === 'line'), '2-point lines become line items');
ok(C.linesToItems(spDisc, { layer: 'F.Cu' }).items[0].type === 'trace', 'copper polylines become traces');
ok(C.linesToItems(spDisc, { layer: 'F.Silk', mode: 'lines' }).items.every(i => i.type === 'line'), "mode:'lines' explodes into line items");
ok(C.linesToItems({ lines: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, { layer: 'F.Silk' }).items[0].type === 'polygon', 'closed polylines become unfilled polygons');
ok(C.linesToItems([], {}).items.length === 0, 'linesToItems([]) = []');
ok(C.linesToItems({ lines: [[[0, 0]]] }, {}).items.length === 0, 'single-point polylines are dropped');

// ---------------------------------------------------------------- degenerate input never hangs
const nasty = [
  [], [[0, 0]], [[0, 0], [0, 0], [0, 0]],
  [[0, 0], [10, 0], [0, 10], [10, 10]],                 // self-intersecting bow-tie
  [[0, 0], [1, 0], [1, 0], [1, 1], [0, 1], [0, 1]],      // duplicate points
  [[0, 0], [1e-6, 0], [1e-6, 1e-6]],                    // sub-pixel
];
for (const p of nasty) {
  const u = C.unionShapes(p, RES);
  ok(Array.isArray(u), 'unionShapes survives degenerate input');
  ok(Array.isArray(C.offsetShapes(p, 0.5, RES)), 'offsetShapes survives degenerate input');
  ok(Array.isArray(C.subtractShapes(SQ, p, RES)), 'subtract survives degenerate input');
  ok(Array.isArray(C.hatchFill(p, { spacing: 1, ...RES }).lines), 'hatchFill survives degenerate input');
  ok(Array.isArray(C.dotFill(p, { spacing: 1, ...RES })), 'dotFill survives degenerate input');
}
const bow = C.unionShapes([[0, 0], [10, 0], [0, 10], [10, 10]], RES);   // self-intersecting bow-tie
ok(bow.length >= 1, 'a self-intersecting polygon is repaired into valid shapes');
within(C.shapesArea(bow), 50, 2, 'bow-tie even-odd area = 2 × 25');
const twoIslands = C.unionShapes([disc(0, 0, 2), disc(9, 0, 2)], RES);
ok(twoIslands.length === 2, 'a union of separated shapes stays two shapes');
ok(C.usableArea({ outline: null }, RES).length === 0, 'usableArea(no outline) = []');
ok(C.boardArea({}, RES).length === 0, 'boardArea({}) = []');
ok(C.hatchFill([], { spacing: 0 }).lines.length === 0, 'zero spacing does not hang');
ok(C.spiral(REG, { spacing: 0.0001, turns: 1e9, ...RES }).lines.length >= 0, 'absurd spiral is clamped, not infinite');
ok(C.concentric(REG, { spacing: 0.001, maxRings: 1e9, ...RES }).lines.length <= 5000, 'concentric rings are capped');

// ---------------------------------------------------------------- timing
const t0 = Date.now();
const bigDoc = twoBoardDoc();
bigDoc.boards[0].outline = { type: 'rect', w: 100, h: 100, r: 3 };
const bigR = resolveBoard(bigDoc.boards[0], bigDoc);
const tRes = Date.now();
const bigBoard = C.boardArea(bigR, RES);
const tBoard = Date.now();
const bigUnion = C.unionShapes(bigBoard.concat([disc(50, 50, 20)]), RES);
const tUnion = Date.now();
const bigOffset = C.offsetShapes(bigBoard, -1, RES);
const tOffset = Date.now();
const bigUsable = C.usableArea(bigR, RES);
const tUsable = Date.now();
const bigHatch = C.hatchFill(bigUsable, { spacing: 1, angle: 30, ...RES });
const tHatch = Date.now();
ok(bigUsable.length > 0 && bigHatch.lines.length > 50, 'the 100×100 board pipeline produced geometry');
ok(tOffset - tUnion < 3000 && tUnion - tBoard < 3000, 'union/offset of a 100×100 board are fast');
console.log(`timing (100×100 mm board @ res 0.05 = ${Math.round(100 / 0.05)}² px):`
  + ` resolve ${tRes - t0}ms · boardArea ${tBoard - tRes}ms · union ${tUnion - tBoard}ms`
  + ` · offset ${tOffset - tUnion}ms · usableArea ${tUsable - tOffset}ms · hatch(${bigHatch.lines.length} lines) ${tHatch - tUsable}ms`
  + ` · total ${tHatch - t0}ms`);

console.log(`${n} assertions`);
console.log('ALL PASS');
