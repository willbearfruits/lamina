// Generates js/lib/parts_hardware.js from official KiCad footprints (lib-src/kicad/*.kicad_mod, CC-BY-SA 4.0 with the
// KiCad libraries exception) + hand-authored mechanical/3D metadata + a few manual footprints. Run: node tools/build_hardware_lib.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { importKicadFootprint } from '../js/import/kicad.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'lib-src', 'kicad');
const C = { black: '#1a1a1a', plastic: '#222', gold: '#c9a227', silver: '#b8b8b8', tin: '#c8ccd0', white: '#eee', red: '#c62828', blue: '#1e63c6', green: '#2e7d32', brass: '#b5a642', pcbgreen: '#0f6b3a', pcbblack: '#1c1c1c', pcbblue: '#123a7a', tan: '#c8b18a', gray: '#777', darkgray: '#444', copper: '#b87333', yellow: '#e0c341', ledred: '#ff3b30', clear: '#dfe', purple: '#4a1a6e', ledwhite: '#f4f4ff', chrome: '#cfd4d8', alu: '#a8adb2', shieldgray: '#9a9a9a', dark: '#08090b', bodyblack: '#242629', capblue: '#1b4a9c' };
const r3 = v => Math.round(v * 1000) / 1000;
const box = (w, d, h, color, x = 0, y = 0, z = 0) => ({ t: 'box', x: r3(x), y: r3(y), z: r3(z), w: r3(w), d: r3(d), h: r3(h), color });
const cyl = (d, h, color, x = 0, y = 0, z = 0, axis = 'z') => ({ t: 'cyl', x: r3(x), y: r3(y), z: r3(z), d: r3(d), h: r3(h), color, axis });

// ---------- 3D model kit: the extended body3d vocabulary (see docs/LIBRARY.md) ----------
const rbox = (w, d, h, color, x = 0, y = 0, z = 0, o = {}) => { const p = { t: 'rbox', x: r3(x), y: r3(y), z: r3(z), w: r3(w), d: r3(d), h: r3(h), r: r3(Math.max(0, Math.min(o.r ?? Math.min(0.4, w / 8, d / 8), w / 2 - 0.01, d / 2 - 0.01))), color }; if (o.bevel) p.bevel = r3(o.bevel); if (o.material) p.material = o.material; if (o.rot) p.rot = o.rot; return p; };
const cone = (d, d2, h, color, x = 0, y = 0, z = 0, axis = 'z', o = {}) => { const p = { t: 'cyl', x: r3(x), y: r3(y), z: r3(z), d: r3(d), d2: r3(d2), h: r3(h), color, axis }; if (o.seg) p.seg = o.seg; if (o.material) p.material = o.material; if (o.rot) p.rot = o.rot; return p; };
const tube = (d, bore, h, color, x = 0, y = 0, z = 0, axis = 'z') => ({ t: 'cyl', x: r3(x), y: r3(y), z: r3(z), d: r3(d), h: r3(h), bore: r3(bore), color, axis });
const hexp = (af, h, color, x = 0, y = 0, z = 0, o = {}) => { const p = { t: 'hex', x: r3(x), y: r3(y), z: r3(z), af: r3(af), h: r3(h), color }; if (o.bore) p.bore = r3(o.bore); if (o.axis) p.axis = o.axis; if (o.rot) p.rot = o.rot; return p; };
const dome = (d, color, x = 0, y = 0, z = 0, o = {}) => { const p = { t: 'sphere', x: r3(x), y: r3(y), z: r3(z), d: r3(d), cut: o.cut === null ? null : (o.cut || 'bottom'), color }; if (o.material) p.material = o.material; if (o.emissive) p.emissive = o.emissive; return p; };
const ring = (d, th, color, x = 0, y = 0, z = 0, axis = 'z') => { const p = { t: 'torus', x: r3(x), y: r3(y), z: r3(z), d: r3(d), thickness: r3(th), color }; if (axis !== 'z') p.axis = axis; return p; };
const prism = (pts, h, color, x = 0, y = 0, z = 0, o = {}) => { const p = { t: 'prism', x: r3(x), y: r3(y), z: r3(z), pts: pts.map(q => [r3(q[0]), r3(q[1])]), h: r3(h), color }; if (o.material) p.material = o.material; if (o.rot) p.rot = o.rot; return p; };
const lead = (x, y, len, o = {}) => { const p = { t: 'pin', x: r3(x), y: r3(y), len: r3(len), color: o.color || C.tin }; if (o.below != null) p.below = r3(o.below); if (o.shape) p.shape = o.shape; if (o.d) p.d = r3(o.d); if (o.w) p.w = r3(o.w); if (o.d2) p.d2 = r3(o.d2); if (o.z) p.z = r3(o.z); if (o.material) p.material = o.material; return p; };
const glow = (w, d, h, color, x = 0, y = 0, z = 0, tint) => ({ t: 'box', x: r3(x), y: r3(y), z: r3(z), w: r3(w), d: r3(d), h: r3(h), color, material: 'led', emissive: tint || color, emissiveIntensity: 0.95 });

// point helpers
const circPts = (r, n = 20, a0 = 0, a1 = 360) => Array.from({ length: n }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)]; });
// D-shaft cross-section: circle Ø d with a flat `flat` mm deep on the +Y side
function dShaftPts(d, flat = 1.5, n = 16) {
  const r = d / 2, a = Math.acos(Math.max(-0.99, Math.min(0.99, (r - flat) / r))), pts = [];
  for (let i = 0; i <= n; i++) { const t = a + (2 * Math.PI - 2 * a) * i / n; pts.push([r * Math.sin(t), r * Math.cos(t)]); }
  return pts;
}
// rounded/chamfered rectangle outline (crimped metal can etc.)
const chamfRect = (w, d, c) => [[-w / 2 + c, -d / 2], [w / 2 - c, -d / 2], [w / 2, -d / 2 + c], [w / 2, d / 2 - c], [w / 2 - c, d / 2], [-w / 2 + c, d / 2], [-w / 2, d / 2 - c], [-w / 2, -d / 2 + c]];
// thin curved band hugging a cylinder of radius r (polarity stripe)
function arcBand(r, a0, a1, t, n = 8) {
  const o = [], i2 = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; o.push([r * Math.cos(a), r * Math.sin(a)]); i2.push([(r - t) * Math.cos(a), (r - t) * Math.sin(a)]); }
  return o.concat(i2.reverse());
}
// threaded bushing / panel thread: smooth cylinder + a few thread ridges
function bushing(d, h, x = 0, y = 0, z = 0, color = C.chrome, axis = 'z') {
  const out = [{ t: 'cyl', x: r3(x), y: r3(y), z: r3(z), d: r3(d), h: r3(h), color, axis }];
  const n = Math.max(2, Math.min(5, Math.round(h / 1.9)));
  for (let i = 0; i < n; i++) {
    const f = (i + 0.75) / (n + 0.5) * h;
    out.push(axis === 'y' ? ring(d + 0.26, 0.3, color, x, y - h / 2 + f, z, 'y')
      : axis === 'x' ? ring(d + 0.26, 0.3, color, x - h / 2 + f, y, z, 'x')
        : ring(d + 0.26, 0.3, color, x, y, z + f));
  }
  return out;
}
// knurled shaft (encoder)
function knurl(d, h, x = 0, y = 0, z = 0, color = C.chrome) {
  const out = [{ t: 'cyl', x: r3(x), y: r3(y), z: r3(z), d: r3(d), h: r3(h), color, seg: 20 }];
  const n = Math.max(2, Math.min(6, Math.round(h / 2.4)));
  for (let i = 0; i < n; i++) out.push(ring(d + 0.34, 0.42, color, x, y, z + (i + 0.7) * h / (n + 0.4)));
  return out;
}
// metal connector shell with a mouth on the -Y face (USB-A / micro-B / USB-C)
function shellMouth(w, dep, h, mouthW, mouthH, tongueColor, x = 0, y = 0, z = 0, color = C.silver, tongueT = 0.7) {
  const front = Math.min(1.2, dep * 0.35), y0 = y - dep / 2, yf = y0 + front / 2;
  const sideW = Math.max(0.35, (w - mouthW) / 2), barH = Math.max(0.3, (h - mouthH) / 2);
  return [
    rbox(w, dep - front, h, color, x, y0 + front + (dep - front) / 2, z, { r: Math.min(0.6, h / 3) }),
    { t: 'box', x: r3(x - (mouthW + sideW) / 2), y: r3(yf), z: r3(z), w: r3(sideW), d: r3(front), h: r3(h), color },
    { t: 'box', x: r3(x + (mouthW + sideW) / 2), y: r3(yf), z: r3(z), w: r3(sideW), d: r3(front), h: r3(h), color },
    { t: 'box', x: r3(x), y: r3(yf), z: r3(z), w: r3(mouthW), d: r3(front), h: r3(barH), color },
    { t: 'box', x: r3(x), y: r3(yf), z: r3(z + h - barH), w: r3(mouthW), d: r3(front), h: r3(barH), color },
    { t: 'box', x: r3(x), y: r3(yf + front * 0.35), z: r3(z + barH), w: r3(mouthW - 0.2), d: r3(front * 0.75), h: r3(mouthH), color: C.dark },
    rbox(Math.max(0.8, mouthW - 1.6), front * 1.5, tongueT, tongueColor, x, yf + 0.25, z + (h - tongueT) / 2, { r: 0.2 }),
  ];
}
// PCB slab (module boards)
const pcbSlab = (w, d, t, color, x = 0, y = 0, z = 0) => rbox(w, d, t, color, x, y, z, { r: Math.min(1.2, w / 10, d / 10) });
// male header: plastic block + square gold pins that also go through the board
const maleHeaderPins = (pads, plasticH = 2.54, pinAbove = 6.0, below = 3.0) => pads.map(p => lead(p.x, p.y, plasticH + pinAbove, { shape: 'square', w: 0.64, below, color: C.gold }));
// female socket block: body + dark square dimples where the pins go in + solder tails
function femaleHeaderBody(pads, w, d, h = 8.5, x = 0, y = 0, color = C.black) {
  return [rbox(w, d, h, color, x, y, 0, { r: 0.25 }),
    ...pads.map(p => ({ t: 'box', x: r3(p.x), y: r3(p.y), z: r3(h - 1.0), w: 1.65, d: 1.65, h: 1.1, color: C.dark })),
    ...pads.map(p => lead(p.x, p.y, 0.05, { shape: 'square', w: 0.62, below: 2.6, color: C.tin }))];
}
const dShaftZ = (d, len, z, flat) => prism(dShaftPts(d, flat ?? d * 0.25), len, C.chrome, 0, 0, z);
const dShaftY = (d, len, x, y0, zc, flat) => { const q = prism(dShaftPts(d, flat ?? d * 0.25), len, C.chrome, x, y0 + len / 2, zc - len / 2); q.rot = [-90, 0, 0]; return q; };
const solderLug = (x, y, w = 2.2, d = 0.8) => rbox(w, d, 0.5, C.tin, x, y, 0, { r: 0.15 });
// vertical pot / encoder stack: metal front plate + threaded bushing + D shaft
const shaftStack = (bushD, bushLen, shaftD, shaftLen, z0, plateD) => [
  { t: 'cyl', x: 0, y: 0, z: r3(z0 - 0.55), d: r3(plateD), h: 0.7, color: C.alu, seg: 24 },
  ...bushing(bushD, bushLen, 0, 0, z0),
  { t: 'cyl', x: 0, y: 0, z: r3(z0 + bushLen), d: r3(shaftD), h: r3(Math.min(3.0, shaftLen * 0.25)), color: C.chrome, seg: 18 },
  dShaftZ(shaftD, shaftLen - Math.min(3.0, shaftLen * 0.25), z0 + bushLen + Math.min(3.0, shaftLen * 0.25)),
];
// rod of length `len` rising from (px,py,pz), tilted `deg` about X (leaning toward -Y)
function tiltedRod(d, len, deg, px, py, pz, color = C.chrome) {
  const a = deg * Math.PI / 180;
  return { t: 'cyl', x: r3(px), y: r3(py - (len / 2) * Math.sin(a)), z: r3(pz + (len / 2) * Math.cos(a) - len / 2), d: r3(d), h: r3(len), color, rot: [deg, 0, 0] };
}

function loadFp(file) { const fp = importKicadFootprint(fs.readFileSync(path.join(SRC, file + '.kicad_mod'), 'utf8')); return fp; }
function shift(fp, dx, dy) { // move origin: new = old - (dx,dy)
  for (const p of fp.pads) { p.x = r3(p.x - dx); p.y = r3(p.y - dy); }
  for (const h of fp.holes || []) { h.x = r3(h.x - dx); h.y = r3(h.y - dy); }
  for (const g of fp.graphics) { for (const k of ['x', 'x1', 'x2', 'cx']) if (k in g) g[k] = r3(g[k] - dx); for (const k of ['y', 'y1', 'y2', 'cy']) if (k in g) g[k] = r3(g[k] - dy); if (g.pts) g.pts = g.pts.map(([x, y]) => [r3(x - dx), r3(y - dy)]); }
  if (fp.courtyard) { if (fp.courtyard.pts) fp.courtyard.pts = fp.courtyard.pts.map(([x, y]) => [r3(x - dx), r3(y - dy)]); else { fp.courtyard.x = r3((fp.courtyard.x || 0) - dx); fp.courtyard.y = r3((fp.courtyard.y || 0) - dy); } }
  if (fp.refPos) { fp.refPos.x = r3(fp.refPos.x - dx); fp.refPos.y = r3(fp.refPos.y - dy); }
}
function fabCircle(fp, minR = 1) { return fp.graphics.filter(g => g.t === 'circle' && g.layer === 'F.Fab' && g.r >= minR).sort((a, b) => b.r - a.r)[0]; }
function crtBox(fp) { const c = fp.courtyard; if (!c) return null; if (c.pts) { const xs = c.pts.map(p => p[0]), ys = c.pts.map(p => p[1]); return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; } return { x: c.x || 0, y: c.y || 0, w: c.w, h: c.h }; }
function tidy(fp) { // round + drop unused
  fp.pads = fp.pads.map(p => { const o = { name: p.name, x: r3(p.x), y: r3(p.y), shape: p.shape, w: r3(p.w), h: r3(p.h), drill: r3(p.drill || 0), layer: p.layer }; if (p.rot) o.rot = r3(p.rot); if (p.slotLen) o.slotLen = r3(p.slotLen); if (p.plated === false) o.plated = false; return o; });
  fp.holes = (fp.holes || []).map(h => ({ x: r3(h.x), y: r3(h.y), d: r3(h.d) }));
  fp.graphics = fp.graphics.filter(g => g.layer === 'F.Silk' || g.layer === 'F.Fab').map(g => { const o = { ...g }; if (o.layer === 'F.Silk') { if (o.w != null && o.w > 0 && o.w < 0.15) o.w = 0.15; if (o.lw != null && o.lw < 0.15) o.lw = 0.15; } for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = r3(o[k]); if (o.pts) o.pts = o.pts.map(([x, y]) => [r3(x), r3(y)]); return o; });
  if (fp.courtyard && !fp.courtyard.pts) fp.courtyard = { x: r3(fp.courtyard.x || 0), y: r3(fp.courtyard.y || 0), w: r3(fp.courtyard.w), h: r3(fp.courtyard.h) };
  if (fp.refPos) fp.refPos = { x: r3(fp.refPos.x), y: r3(fp.refPos.y) };
  delete fp.body3d; delete fp.height; return fp;
}
// body from courtyard bbox with height h
const bodyFromCrt = (fp, h, color = C.black, z = 0, shrink = 0.6) => { const b = crtBox(fp); return b ? [rbox(Math.max(1, b.w - shrink), Math.max(1, b.h - shrink), h, color, b.x, b.y, z, { r: 0.4 })] : []; };

const PARTS = [];
function K(id, file, o) { // KiCad-sourced part
  const fp = loadFp(file);
  if (o.originAt === 'fabCircle') { const c = fabCircle(fp, o.minR ?? 1); if (c) shift(fp, c.cx, c.cy); }
  else if (o.originAt === 'crt') { const b = crtBox(fp); if (b) shift(fp, b.x, b.y); }
  else if (Array.isArray(o.originAt)) shift(fp, o.originAt[0], o.originAt[1]);
  else if (o.originAt === 'padCenter') { const xs = fp.pads.map(p => p.x), ys = fp.pads.map(p => p.y); shift(fp, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2); }
  tidy(fp);
  const body3d = typeof o.body3d === 'function' ? o.body3d(fp) : (o.body3d || bodyFromCrt(fp, o.height || 3));
  const part = { id, name: o.name, cat: o.cat, ref: o.ref, tags: o.tags || [], desc: o.desc || '', verify: !!o.verify, pads: fp.pads, holes: fp.holes, graphics: fp.graphics, courtyard: fp.courtyard, refPos: o.refPos || fp.refPos, height: o.height, body3d, meta: { kicadFootprint: file, ...(o.meta || {}) } };
  if (o.through) part.through = o.through; if (o.bushingLen != null) part.bushingLen = o.bushingLen; if (o.panelDist != null) part.panelDist = o.panelDist; if (o.throughLabel) part.throughLabel = o.throughLabel; if (o.refText === false) part.refText = false; if (o.defaultValue) part.defaultValue = o.defaultValue;
  PARTS.push(part); return part;
}
function M(part) { PARTS.push(part); return part; } // manual part
const V = 0.15, S = 'F.Silk', FAB = 'F.Fab';
const silkRect = (w, h, cx = 0, cy = 0, lw = V) => ({ t: 'rect', cx, cy, w, h, filled: false, lw, layer: S });
const fabRect = (w, h, cx = 0, cy = 0) => ({ t: 'rect', cx, cy, w, h, filled: false, lw: 0.1, layer: FAB });
const thPad = (name, x, y, d = 1.7, drill = 1.0, first = false) => ({ name: String(name), x: r3(x), y: r3(y), shape: first ? 'rect' : 'oval', w: d, h: d, drill, layer: 'both' });

// ================= KiCad-sourced extras (pads verbatim from lib-src/kicad via importKicadFootprint) =================
// These complement the researched block below; ids that the researched block also defines were removed from here.
K('pot_bourns_ptv09a', 'Potentiometer_Bourns_PTV09A-1_Single_Vertical', { name: 'Pot 9 mm vertical, Bourns PTV09A (no bushing)', cat: 'Controls', ref: 'RV', tags: ['pot', '9mm', 'bourns'], originAt: 'fabCircle', height: 15, through: { x: 0, y: 0, d: 7.4 }, throughLabel: 'shaft', panelDist: 7,
  desc: 'Origin = shaft centre. PTV09A-1 (no threaded bushing) — the panel just clears the shaft. Height ≈ 15 mm shaft variant; verify.', verify: true,
  body3d: () => [rbox(11.0, 9.8, 0.9, C.black, -1.5, 0, 0, { r: 0.4 }), rbox(9.5, 9.0, 5.6, C.bodyblack, -1.5, 0, 0.9, { r: 0.5 }), { t: 'cyl', x: 0, y: 0, z: 5.9, d: 8.4, h: 0.6, color: C.alu, seg: 22 }, { t: 'cyl', x: 0, y: 0, z: 6.5, d: 6, h: 2.5, color: C.chrome, seg: 18 }, dShaftZ(6, 6.0, 9.0)], meta: { datasheet: 'https://www.bourns.com/docs/Product-Datasheets/PTV09.pdf', mpn: 'PTV09A-1' } });
K('pot_alps_rk09k', 'Potentiometer_Alps_RK09K_Single_Vertical', { name: 'Pot 9 mm vertical, Alps RK09K', cat: 'Controls', ref: 'RV', tags: ['pot', '9mm', 'alps'], originAt: 'fabCircle', height: 20, through: { x: 0, y: 0, d: 7.4 }, panelDist: 7, bushingLen: 5,
  desc: 'Origin = shaft centre. Alps RK09K (metal shaft, some variants threaded). Heights approximate — verify.', verify: true, body3d: () => [rbox(11.0, 9.8, 0.9, C.black, -1.5, 0, 0, { r: 0.4 }), rbox(9.5, 9.0, 5.6, C.bodyblack, -1.5, 0, 0.9, { r: 0.5 }), ...shaftStack(7, 5, 6, 8, 6.5, 8.4)], meta: { datasheet: 'https://tech.alpsalpine.com/e/products/detail/RK09K1130A5S/' } });
K('pot_9mm_ra', 'Potentiometer_Bourns_PTV09A-2_Single_Horizontal', { name: 'Pot 9 mm right-angle (PTV09A-2 / Alpha RD901F-20)', cat: 'Controls', ref: 'RV', tags: ['pot', '9mm', 'right angle', 'horizontal'], originAt: 'padCenter', height: 10.5,
  desc: 'Shaft parallel to the board (points +Y away from the pins). Origin = middle pin. Use for pots that stick out of a board edge — no panel hole in a stacked board.', verify: true,
  body3d: (fp) => { const b = crtBox(fp); const yb = b ? b.y + b.h / 2 : 10; return [rbox(9.5, 6.5, 11, C.bodyblack, 0, yb - 5.2, 0, { r: 0.5 }), rbox(10.2, 1.0, 11, C.black, 0, yb - 2.0, 0, { r: 0.3 }), ...bushing(7, 5, 0, yb - 1.0, 5.5, C.chrome, 'y'), dShaftY(6, 10, 0, yb + 1.6, 5.5)]; }, meta: { datasheet: 'https://www.bourns.com/docs/Product-Datasheets/PTV09.pdf' } });
K('pot_16mm', 'Potentiometer_Piher_PC-16_Single_Vertical', { name: 'Pot 16 mm vertical (Piher PC-16 / Alpha 16 mm, 5 mm pitch, Ø7 bushing)', cat: 'Controls', ref: 'RV', tags: ['pot', '16mm', 'piher', 'alpha'], originAt: 'fabCircle', height: 22, through: { x: 0, y: 0, d: 7.4 }, throughLabel: 'bushing', bushingLen: 7, panelDist: 9,
  desc: 'Origin = shaft centre. 3 pins at 5.0 mm (same as Alpha RV16AF). Body ≈9 mm to the M7 bushing shoulder, bushing ~7 mm, shaft to ~22 mm — verify for your exact pot.', verify: true,
  body3d: () => [{ t: 'cyl', x: 0, y: 0, z: 0, d: 16.8, h: 1.0, color: C.black, seg: 26 }, { t: 'cyl', x: 0, y: 0, z: 1.0, d: 16.0, h: 7.6, color: C.bodyblack, seg: 26 }, ...shaftStack(7, 7, 6, 6, 9, 12.5)], meta: { datasheet: 'https://www.piher-nacesa.com/pdf/11-PC16v03.pdf' } });
K('pot_16mm_ra', 'Potentiometer_Alps_RK163_Single_Horizontal', { name: 'Pot 16 mm right-angle (Alps RK163 / Alpha 16 mm R/A)', cat: 'Controls', ref: 'RV', tags: ['pot', '16mm', 'right angle', 'pedal'], originAt: 'padCenter', height: 17,
  desc: 'The classic pedal pot: solder to the board, bushing through the enclosure wall/panel sideways. Origin = middle pin; shaft points +Y away from the pins.', verify: true,
  body3d: (fp) => { const b = crtBox(fp); const yb = b ? b.y + b.h / 2 : 12; const y0 = yb - 8; return [{ t: 'cyl', x: 0, y: y0 - 4.6, z: 8.5, d: 16.5, h: 9.2, color: C.bodyblack, axis: 'y', seg: 26 }, rbox(17, 1.0, 16.5, C.black, 0, y0 - 9.7, 0, { r: 0.3 }), ...bushing(7, 7, 0, y0 + 3.5, 8.5, C.chrome, 'y'), dShaftY(6, 11, 0, y0 + 7, 8.5)]; }, meta: { datasheet: 'https://tech.alpsalpine.com/e/products/category/potentiometer/sub/01/series/rk163/' } });
K('pot_trim_3386p', 'Potentiometer_Bourns_3386P_Vertical', { name: 'Trimmer 3386P (top adjust)', cat: 'Controls', ref: 'RV', tags: ['trimmer', 'trimpot', '3386'], originAt: 'crt', height: 5.1, desc: 'Bourns 3386P single-turn trimmer, 2.54 mm pins.', body3d: () => [rbox(9.5, 9.5, 4.5, C.capblue, 0, 0, 0.3, { r: 0.5 }), { t: 'cyl', x: -0.9, y: 0, z: 4.8, d: 3.4, h: 0.45, color: C.alu, seg: 16 }, { t: 'box', x: -0.9, y: 0, z: 5.05, w: 3.0, d: 0.55, h: 0.3, color: C.dark }], meta: { datasheet: 'https://www.bourns.com/docs/Product-Datasheets/3386.pdf' } });
K('jack_35_pj320d', 'Jack_3.5mm_PJ320D_Horizontal', { name: '3.5 mm jack PJ-320D 4-pole (SMD, board edge)', cat: 'Jacks & Power', ref: 'J', tags: ['jack', '3.5mm', 'pj320', 'trrs', 'smd'], originAt: 'crt', height: 5.5, desc: 'PJ-320D (a.k.a. PJ-320A style) horizontal 4-pole; opening at the -X end, mount at the board edge.', body3d: (fp) => bodyFromCrt(fp, 5, C.black), meta: { datasheet: 'https://datasheet.lcsc.com/lcsc/2110271930_XKB-Connectivity-PJ-320D_C2895388.pdf' } });
K('jack_35_pj320e', 'Jack_3.5mm_PJ320E_Horizontal', { name: '3.5 mm jack PJ-320E 5-pin (SMD, board edge)', cat: 'Jacks & Power', ref: 'J', tags: ['jack', '3.5mm', 'pj320', 'smd'], originAt: 'crt', height: 5.5, desc: 'PJ-320E horizontal; opening at the +Y end.', body3d: (fp) => bodyFromCrt(fp, 5, C.black) });
K('jack_635_nmj4hcd2', 'Jack_6.35mm_Neutrik_NMJ4HCD2_Horizontal', { name: '6.35 mm mono jack Neutrik NMJ4HCD2 (horizontal, panel nut)', cat: 'Jacks & Power', ref: 'J', tags: ['jack', '6.35mm', '1/4', 'neutrik', 'mono', 'big jack'], originAt: 'padCenter', height: 14.5, desc: 'Mono version of the NMJ6HCD2; opening at the -X end.', body3d: (fp) => { const b = crtBox(fp); const x0 = b.x - b.w / 2; return [rbox(b.w - 6, 16, 14, C.bodyblack, b.x + 3, 0, 0.5, { r: 0.8 }), ...bushing(9.5, 6, x0 + 2, 0, 7.5, C.chrome, 'x'), hexp(13, 2.4, C.chrome, x0 + 6.2, 0, 7.5, { bore: 9.5, axis: 'x' }), { t: 'cyl', x: x0 - 1.4, y: 0, z: 7.5, d: 6.5, h: 1.2, color: C.dark, axis: 'x' }]; }, meta: { datasheet: 'https://www.neutrik.com/en/product/nmj4hcd2', mpn: 'NMJ4HCD2' } });
K('usb_c_16p_gct', 'USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal', { name: 'USB-C receptacle 16-pin GCT USB4105 (top mount)', cat: 'Jacks & Power', ref: 'J', tags: ['usb', 'usb-c', 'gct'], originAt: 'crt', height: 3.3, desc: 'GCT USB4105-xx-A, 16 pins, top mount, TH shell posts.', body3d: (fp) => { const b = crtBox(fp); return shellMouth(Math.max(4, b.w - 1.2), Math.max(3, b.h - 0.8), 3.26, 6.6, 1.9, C.white, b.x, b.y, 0, C.silver, 0.6); }, meta: { datasheet: 'https://gct.co/files/drawings/usb4105.pdf' } });
K('sw_tact_ksa', 'SW_Tactile_Straight_KSA0Axx1LFTR', { name: 'Tactile switch C&K KSA (6 mm, 4-pin TH)', cat: 'Switches', ref: 'SW', tags: ['tact', 'tactile', 'button'], originAt: 'crt', height: 5.0, desc: 'C&K KSA0Axx1LFTR family.', body3d: () => [rbox(6.2, 6.2, 3.4, C.bodyblack, 0, 0, 0, { r: 0.4 }), { t: 'cyl', x: 0, y: 0, z: 3.1, d: 6.0, h: 0.45, color: C.alu, seg: 20 }, cone(3.6, 3.3, 1.5, C.bodyblack, 0, 0, 3.5)] });
K('sw_slide_spdt', 'SW_Slide_SPDT_Straight_CK_OS102011MS2Q', { name: 'Slide switch SPDT C&K OS102011MS2Q (TH, 2.54)', cat: 'Switches', ref: 'SW', tags: ['slide', 'switch', 'spdt'], originAt: 'padCenter', height: 6, desc: 'Small SPDT slide (also fits the generic SS12D00 pinout: 3 pins 2.54 mm — verify body/actuator).', body3d: (fp) => bodyFromCrt(fp, 3.4, C.alu).concat([{ t: 'box', x: 0, y: 0, z: 3.2, w: 5.2, d: 1.5, h: 0.35, color: C.dark }, rbox(1.6, 1.4, 2.8, C.bodyblack, -1.3, 0, 3.4, { r: 0.3 })]) });

// ================= RESEARCHED PARTS (hand-authored from datasheets, KiCad + JLC/EasyEDA footprints) =================
// Everything in this block is scoped so its helpers do not clash with the K()-infrastructure above.
{
const S = 'F.Silk', FAB = 'F.Fab', V = 0.15;
const C = { black: '#1a1a1a', plastic: '#222', gold: '#c9a227', silver: '#b8b8b8', tin: '#c8ccd0', white: '#eee', red: '#c62828', blue: '#1e63c6', green: '#2e7d32', brass: '#b5a642', pcbgreen: '#0f6b3a', pcbblack: '#1c1c1c', pcbblue: '#123a7a', tan: '#c8b18a', gray: '#777', darkgray: '#444', copper: '#b87333', yellow: '#e0c341', ledred: '#ff3b30', clear: '#dfe', shieldgray: '#9a9a9a' };

// ---------- helpers ----------
const rect = (w, h, o = {}) => ({ t: 'rect', cx: o.cx || 0, cy: o.cy || 0, w, h, rot: o.rot || 0, rx: o.rx || 0, filled: !!o.filled, lw: o.lw ?? V, layer: o.layer || S });
const silkRect = (w, h, cx = 0, cy = 0) => rect(w, h, { cx, cy });
const fabRect = (w, h, cx = 0, cy = 0) => rect(w, h, { cx, cy, lw: 0.1, layer: FAB });
const circle = (r, cx = 0, cy = 0, w = V, layer = S) => ({ t: 'circle', cx, cy, r, w, layer });
const line = (x1, y1, x2, y2, w = V, layer = S) => ({ t: 'line', x1, y1, x2, y2, w, layer });
const poly = (pts, o = {}) => ({ t: 'polyline', pts, w: o.w ?? V, closed: o.closed !== false, layer: o.layer || S });
const text = (x, y, txt, size = 0.8, o = {}) => ({ t: 'text', x, y, text: txt, size, thickness: o.thickness ?? 0.15, rot: o.rot || 0, align: o.align || 'center', layer: o.layer || S });
const box = (w, d, h, color, x = 0, y = 0, z = 0) => ({ t: 'box', x, y, z, w, d, h, color });
const cyl = (d, h, color, x = 0, y = 0, z = 0, axis = 'z') => ({ t: 'cyl', x, y, z, d, h, color, axis });
// through-hole pad: d = pad diameter (or w/h), drill; opts: shape, w, h, rot, slotLen
const th = (name, x, y, d, drill, o = {}) => ({ name: String(name), x, y, shape: o.shape || 'circle', w: o.w ?? d, h: o.h ?? d, drill, layer: 'both', ...(o.rot ? { rot: o.rot } : {}), ...(o.slotLen ? { slotLen: o.slotLen } : {}) });
const th1 = (name, x, y, d, drill, o = {}) => th(name, x, y, d, drill, { ...o, shape: 'rect' });      // pin-1 square
const slotPad = (name, x, y, w, h, slotW, slotLen, rot = 0, shape = 'oval') => ({ name: String(name), x, y, shape, w, h, drill: slotW, slotLen, rot, layer: 'both' });
const smd = (name, x, y, w, h, o = {}) => ({ name: String(name), x, y, shape: o.shape || 'roundrect', w, h, drill: 0, layer: 'F', ...(o.rot ? { rot: o.rot } : {}) });
const hole = (x, y, d) => ({ x, y, d });
const cy4 = (x0, y0, x1, y1) => ({ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });   // courtyard from bbox
const pin1mark = (x, y, r = 0.3) => ({ t: 'circle', cx: x, cy: y, r, w: 0, layer: S });

// 2-row / 1-row 2.54 grid, numbered like KiCad pin headers (across the rows first): matches library.js pinHeader().
function headerPads(rows, n, pitch = 2.54, padD = 1.7, drill = 1.0) {
  const pads = []; let k = 1;
  const x0 = -(rows - 1) * pitch / 2, y0 = (n - 1) * pitch / 2;
  for (let i = 0; i < n; i++) for (let r = 0; r < rows; r++) { pads.push({ name: String(k), x: x0 + r * pitch, y: y0 - i * pitch, shape: k === 1 ? 'rect' : 'oval', w: padD, h: padD, drill, layer: 'both' }); k++; }
  return pads;
}
// Module pin rows numbered DIP-style: 1..n down the left column (top→bottom), n+1..2n up the right column.
function moduleRows(n, rowSpacing, pitch = 2.54, padD = 1.7, drill = 1.0, yShift = 0) {
  const pads = []; const y0 = (n - 1) * pitch / 2 + yShift, xl = -rowSpacing / 2, xr = rowSpacing / 2;
  for (let i = 0; i < n; i++) pads.push({ name: String(i + 1), x: xl, y: y0 - i * pitch, shape: i === 0 ? 'rect' : 'oval', w: padD, h: padD, drill, layer: 'both' });
  for (let i = 0; i < n; i++) pads.push({ name: String(n + i + 1), x: xr, y: y0 - (n - 1 - i) * pitch, shape: 'oval', w: padD, h: padD, drill, layer: 'both' });
  return pads;
}
const headerSpacers3d = (rowSpacing, n, pitch = 2.54, h = 2.54, yShift = 0) => {
  const out = [], y0 = (n - 1) * pitch / 2 + yShift;
  for (const x of [-rowSpacing / 2, rowSpacing / 2]) {
    out.push(rbox(2.54, n * pitch, h, C.black, x, yShift, 0, { r: 0.2 }));
    for (let i = 0; i < n; i++) out.push(lead(x, y0 - i * pitch, h + 0.7, { shape: 'square', w: 0.64, below: 3.0, color: C.gold }));
  }
  return out;
};
const modBase = (name, w, hgt, pcbT, color = C.pcbblack) => pcbSlab(w, hgt, pcbT, color, 0, 0, 2.54);

const add = (p) => M(p);

// =====================================================================================================
// CONTROLS — potentiometers, trimmer, encoder
// =====================================================================================================
// Alpha 9 mm vertical (RD901F-40 family; KiCad Potentiometer_Alpha_RD901F-40-00D_Single_Vertical, Y flipped,
// origin moved to the shaft). Heights from the Taiwan Alpha 9 mm drawing (SLH-211 sheet, Tayda A-1856 datasheet):
// PCB → bushing tip 10 mm, of which the M7×0.75 bushing is 5.0 mm → shoulder 5.0 mm above the PCB; 15 mm shaft (L).
function pot9(id, name, lugY, extra) {
  return {
    id, name, cat: 'Controls', ref: 'RV', tags: ['pot', 'potentiometer', '9mm', 'alpha', 'vertical', 'through'], verify: false,
    desc: extra.desc,
    pads: [th1('1', -7.5, 2.5, 1.8, 1.0), th('2', -7.5, 0, 1.8, 1.0), th('3', -7.5, -2.5, 1.8, 1.0),
      slotPad('MP', 0, lugY, 3.24, 2.72, 1.1, 1.8, extra.slotRot || 0), slotPad('MP', 0, -lugY, 3.24, 2.72, 1.1, 1.8, extra.slotRot || 0)],
    graphics: [silkRect(11.35, 9.5, -0.825, 0), fabRect(11.35, 9.5, -0.825, 0), circle(3.5), circle(3.0, 0, 0, 0.1, FAB), pin1mark(-7.5, 4.0), text(-8.6, 4.4, '1', 0.7)],
    courtyard: cy4(-8.7, -6.6, 5.1, 6.6), refPos: { x: -1, y: 7.4 }, height: 25,
    body3d: [rbox(11.35, 9.5, 1.0, C.black, -0.825, 0, 0, { r: 0.4 }), rbox(10.6, 8.9, 4.0, C.bodyblack, -0.825, 0, 1.0, { r: 0.5 }),
      ...shaftStack(7, 5.0, 6, 15, 5.0, 8.6), ...[2.5, 0, -2.5].map(y => solderLug(-7.0, y, 2.2, 0.9))],
    through: { x: 0, y: 0, d: 7.4 }, throughLabel: 'shaft', panelDist: 5.0, bushingLen: 5.0,
    meta: { mfr: 'Taiwan Alpha', mpn: extra.mpn, datasheet: extra.datasheet, bushing: 'M7x0.75, 5.0 mm', nut: '10 mm AF hex + washer', shaftLen: 15, shaftD: 6, panelHole: 7.4, lugSpacing: lugY * 2, lugSlot: '1.8x1.1', pinLen: 3.5, ...(extra.meta || {}) },
  };
}
add(pot9('pot_alpha_9mm', 'Alpha 9 mm pot RD901F-40 (vertical, M7)', 4.8, {
  mpn: 'RD901F-40-15R1', datasheet: 'https://www.taiwanalpha.com.tw/downloads?target=products&id=113',
  desc: '9 mm Alpha RD901F-40 vertical pot: 3 pins 2.5 mm pitch 7.5 mm behind the shaft, two 1.8x1.1 mounting-lug slots 9.6 mm apart (KiCad RD901F-40-00D). Body 11.35x9.5, top of body 5.0 mm above the PCB, M7x0.75 bushing 5 mm, 15 mm shaft. Bourns PTV09A-6 (metal bushing) has lugs 10.6 mm apart at 7.0 mm; Tayda 9 mm pots have lugs 11.4 mm apart → use pot_9mm_tayda.',
}));
add(pot9('pot_9mm_tayda', 'Alpha 9 mm pot, Tayda A-1848/A-1856 (lugs 11.4)', 5.7, {
  slotRot: 90, mpn: 'SLH-211 (Tayda A-1848 lin / A-1856 log)', datasheet: 'http://www.taydaelectronics.com/datasheets/A-1856.pdf',
  desc: 'Same 9 mm Alpha vertical pot as sold by Tayda: 3 pins 2.5 mm pitch 7.5 mm behind the shaft, lug slots 1.8x1.1 at 11.4 mm spacing, slots running ALONG the lug line (Tayda datasheet A-1856 / A-1848; note the RD901F-40 KiCad footprint has them across). Body 9.5 wide x 11.35, shoulder 5.0 mm above PCB, M7x0.75 x 5 mm bushing, 15 mm shaft, 25 mm total.',
}));

// Alpha 16 mm vertical PC-mount (shaft perpendicular to the PCB, pins straight down). Pin row 5.0 mm pitch,
// 10.9 mm from the shaft axis (Taiwan Alpha 16 mm catalogue, PV/-30 terminal PCB detail; Piher PC-16 vertical in KiCad
// puts it at 10.5 mm). Body Ø17, 9.2 mm deep, M7x0.75 bushing 6.5 mm, 15 mm shaft. Bracket / lug positions vary by
// vendor and are NOT modelled — verify:true.
add({
  id: 'pot_alpha_16mm', name: 'Alpha 16 mm pot, vertical PC mount (RV16AF / RD16 / WH148-type)', cat: 'Controls', ref: 'RV', tags: ['pot', 'potentiometer', '16mm', 'alpha', 'vertical', 'through'], verify: true,
  desc: '16 mm vertical PC-mount pot standing on its back plate, shaft up: 3 pins at 5.0 mm pitch on a row 10.9 mm from the shaft (Alpha catalogue PV detail; Piher PC16 = 10.5 — check yours), Ø1.2 pins → 1.3 mm drills. Body Ø17 (drawn with the 15 mm terminal block), 9.2 mm to the bushing shoulder, M7x0.75 x 6.5 mm bushing, 15 mm shaft (31 mm total). Vendors add brackets/lugs in different places — measure before ordering.',
  pads: [th1('1', -5, -10.9, 2.6, 1.3), th('2', 0, -10.9, 2.6, 1.3), th('3', 5, -10.9, 2.6, 1.3)],
  graphics: [circle(8.5), circle(8.5, 0, 0, 0.1, FAB), silkRect(15, 4.4, 0, -10.6), circle(3.5), text(-6.4, -13.6, '1', 0.7)],
  courtyard: cy4(-8.9, -13.4, 8.9, 8.9), refPos: { x: 0, y: 9.9 }, height: 31,
  body3d: [{ t: 'cyl', x: 0, y: 0, z: 0, d: 17.4, h: 1.0, color: C.black, seg: 28 }, { t: 'cyl', x: 0, y: 0, z: 1.0, d: 17, h: 8.2, color: C.bodyblack, seg: 28 },
    rbox(15, 4.4, 6, C.bodyblack, 0, -10.6, 0, { r: 0.4 }), ...shaftStack(7, 6.5, 6, 15, 9.2, 13.5)],
  through: { x: 0, y: 0, d: 7.4 }, throughLabel: 'shaft', panelDist: 9.2, bushingLen: 6.5,
  meta: { mfr: 'Taiwan Alpha (also Song Huei / WH148 clones)', mpn: 'RV16AF-30 (PV) family', datasheet: 'https://electricdruid.net/wp-content/uploads/2016/12/Taiwan-Alpha-16mm-pots-datasheet.pdf', bushing: 'M7x0.75, 6.5 mm', shaftLen: 15, panelHole: 7.4, pinRowFromShaft: 10.9 },
});
// Alpha 16 mm right-angle PC mount (RV16AF-20 "PH terminal" / WH148-1A-2): shaft parallel to the PCB.
// Pins 5.0 mm pitch, 3.8 mm in front of the back plate, shaft centre 12.5 mm above the PCB (H=12.5 in the Alpha
// catalogue and the WH148-1A-2 drawing). Body Ø17, 9.1–9.2 deep, bushing M7x0.75 6.2–6.5 mm, shaft L=15/20.
add({
  id: 'pot_alpha_16mm_ra', name: 'Alpha 16 mm pot, right-angle PC mount (RV16AF-20 / WH148-1A-2)', cat: 'Controls', ref: 'RV', tags: ['pot', 'potentiometer', '16mm', 'alpha', 'right-angle', 'horizontal', 'pedal'], verify: false,
  desc: 'Classic pedal pot: 16 mm Alpha standing upright on 3 bent pins (5.0 mm pitch, Ø1.2 → 1.3 mm drills), shaft parallel to the board pointing +Y, shaft centre 12.5 mm above the PCB. Back plate 3.8 mm behind the pin row, body 9.2 mm deep, M7x0.75 x 6.5 mm bushing, 15 mm shaft (ends 26.6 mm in front of the pins). No panel hole in a stacked board — the shaft exits the enclosure SIDE; courtyard covers body + bushing only.',
  pads: [th1('1', -5, 0, 2.6, 1.3), th('2', 0, 0, 2.6, 1.3), th('3', 5, 0, 2.6, 1.3)],
  graphics: [silkRect(17, 9.2, 0, 0.8), fabRect(17, 9.2, 0, 0.8), line(-3.5, 5.4, -3.5, 11.9), line(3.5, 5.4, 3.5, 11.9), line(-3.5, 11.9, 3.5, 11.9), line(-3, 11.9, -3, 26.9, 0.1, FAB), line(3, 11.9, 3, 26.9, 0.1, FAB), line(-3, 26.9, 3, 26.9, 0.1, FAB), text(-6.6, -1.9, '1', 0.7)],
  courtyard: cy4(-8.75, -4.3, 8.75, 12.2), refPos: { x: 0, y: -2.2 }, height: 21,
  body3d: [{ t: 'cyl', x: 0, y: 1.4, z: 12.5, d: 17, h: 8.0, color: C.bodyblack, axis: 'y', seg: 28 },
    rbox(17.4, 1.2, 17, C.black, 0, -3.2, 4.0, { r: 0.3 }), ...bushing(7, 6.5, 0, 8.65, 12.5, C.chrome, 'y'), dShaftY(6, 15, 0, 11.9, 12.5),
    ...[-5, 0, 5].map(x => rbox(0.6, 1.0, 4.2, C.tin, x, 0, 0, { r: 0.1 }))],
  meta: { mfr: 'Taiwan Alpha (WH148-1A-2 clones identical)', mpn: 'RV16AF-20-15F', datasheet: 'https://electricdruid.net/wp-content/uploads/2016/12/Taiwan-Alpha-16mm-pots-datasheet.pdf', shaftCentreZ: 12.5, bushing: 'M7x0.75, 6.5 mm', shaftLen: 15, panelHole: 7.4, pinLen: 3.5 },
});
// Bourns 3362P trimmer: 3 pins in line at 2.54 mm (that is what the "P" suffix means), Ø0.46 pins, body 6.6 x 7.0 x 4.7.
add({
  id: 'pot_trim_3362p', name: 'Trimmer Bourns 3362P (in-line 2.54)', cat: 'Controls', ref: 'RV', tags: ['trimmer', 'trimpot', '3362', 'bourns'], verify: true,
  desc: 'Bourns 3362P single-turn trimmer: 3 pins in one line at 2.54 mm pitch (Ø0.46 → 0.8 mm drills), body 6.6 x 7.0, 4.7 mm tall, top-adjust. Pad pitch is certain; the body offset relative to the pin row (drawn 1.5 mm from the pin-side edge) is from memory — verify.',
  pads: [th1('1', -2.54, 0, 1.5, 0.8), th('2', 0, 0, 1.5, 0.8), th('3', 2.54, 0, 1.5, 0.8)],
  graphics: [silkRect(6.6, 7.0, 0, 2.0), fabRect(6.6, 7.0, 0, 2.0), circle(1.2, 0, 2.5), line(-0.8, 2.5, 0.8, 2.5), text(-3.4, -1.3, '1', 0.7)],
  courtyard: cy4(-3.6, -1.6, 3.6, 5.8), refPos: { x: 0, y: 6.4 }, height: 5.0,
  body3d: [rbox(6.6, 7.0, 4.4, C.capblue, 0, 2.0, 0.3, { r: 0.4 }), { t: 'cyl', x: 0, y: 2.5, z: 4.7, d: 2.8, h: 0.4, color: C.alu, seg: 14 }, { t: 'box', x: 0, y: 2.5, z: 4.95, w: 2.5, d: 0.45, h: 0.3, color: C.dark }],
  meta: { mfr: 'Bourns', mpn: '3362P-1-xxxLF', datasheet: 'https://www.bourns.com/docs/product-datasheets/3362.pdf' },
});
// EC11 rotary encoder with push switch. Pads = KiCad RotaryEncoder_Alps_EC11E-Switch_Vertical (origin on the shaft):
// A/C/B 2.5 mm pitch 7.5 mm on one side, S1/S2 5.0 mm pitch 7.0 mm on the other, two 2.8x1.5 tab slots 11.2 mm apart.
// Heights from the Alps EC11E09444A8 drawing (LCSC C1322538): body 4.5 mm above the PCB, M7x0.75 bushing 7 mm,
// 21 mm overall (Alps "L" is measured from the PCB: L15/L20/L25 → 15/20/25 mm total).
add({
  id: 'enc_ec11', name: 'Rotary encoder EC11 with switch (Alps EC11E / Bourns PEC11R / clones)', cat: 'Controls', ref: 'SW', tags: ['encoder', 'rotary', 'ec11', 'switch', 'through'], verify: false,
  desc: 'EC11 incremental encoder + push switch: A/C/B pins 2.5 mm pitch 7.5 mm from the shaft, S1/S2 5.0 mm pitch 7.0 mm on the other side, mounting tabs 11.2 mm apart (2.8x1.5 slots). Body 12 x 11.6, 4.5 mm tall, M7x0.75 bushing 7 mm (5 mm on short types), Ø6 D/knurled shaft, 21 mm total for the 20 mm-class part (15 mm for L15). Alps EC11E09444A8 also has two locating pegs (Ø2.05 at the shaft centre, 2.2x1.6 slot 4.5 mm toward A/C/B) — add NPTH holes if you use it; generic clones are flat.',
  pads: [th1('A', -7.5, 2.5, 2.0, 1.0), th('C', -7.5, 0, 2.0, 1.0), th('B', -7.5, -2.5, 2.0, 1.0), th('S1', 7.0, -2.5, 2.0, 1.0), th('S2', 7.0, 2.5, 2.0, 1.0),
    slotPad('MP', 0, 5.6, 3.2, 2.0, 1.5, 2.8, 0, 'rect'), slotPad('MP', 0, -5.6, 3.2, 2.0, 1.5, 2.8, 0, 'rect')],
  graphics: [poly([[-6, -4.8], [-5, -5.8], [6, -5.8], [6, 5.8], [-6, 5.8]]), fabRect(12, 11.6), circle(3.5), circle(3.0, 0, 0, 0.1, FAB), text(-8.6, 4.2, 'A', 0.7), text(8.4, 4.2, 'S', 0.7)],
  courtyard: cy4(-9.0, -7.1, 8.5, 7.1), refPos: { x: 0, y: 7.9 }, height: 21,
  body3d: [prism(chamfRect(12, 11.6, 1.7), 4.2, C.alu, 0, 0, 0),
    ...[[-5.2, 5.0], [5.2, 5.0], [-5.2, -5.0], [5.2, -5.0]].map(([x, y]) => rbox(1.6, 1.6, 0.9, C.alu, x, y, 4.2, { r: 0.3 })),
    { t: 'cyl', x: 0, y: 0, z: 4.0, d: 9.6, h: 0.6, color: C.alu, seg: 22 }, ...bushing(7, 7, 0, 0, 4.5), ...knurl(6, 9.5, 0, 0, 11.5)],
  through: { x: 0, y: 0, d: 7.4 }, throughLabel: 'shaft', panelDist: 4.5, bushingLen: 7.0,
  meta: { mfr: 'Alps Alpine (Bourns PEC11R, generic EC11 clones share the footprint)', mpn: 'EC11E09444A8 / PEC11R-4220F-S0024', lcsc: 'C1322538', datasheet: 'https://www.lcsc.com/datasheet/lcsc_datasheet_2410010003_ALPSALPINE-EC11E09444A8_C1322538.pdf', bushing: 'M7x0.75, 7 mm (5 mm on L15 types)', heights: { L15: 15, L20: 21, L25: 25 }, panelHole: 7.4 },
});

// =====================================================================================================
// JACKS & POWER
// =====================================================================================================
// Thonkiconn PJ398SM / PJ301M-12: KiCad Jack_3.5mm_QingPu_WQP-PJ398SM_Vertical + the Thonk drawing: body 9 x 10.5,
// 9.0 mm tall (PCB → bushing shoulder), Ø6 bushing 5.5 mm long (4.5 threaded), socket centre 6.48 mm from the S pin.
function pj301(id, name, mpn, extraDesc) {
  return {
    id, name, cat: 'Jacks & Power', ref: 'J', tags: ['jack', '3.5mm', 'mono', 'thonkiconn', 'eurorack', 'vertical', 'through'], verify: false,
    desc: `3.5 mm mono jack with switch, vertical PCB mount (Thonkiconn family): pins S / TN(switch) / T at 0 / 3.1 / 11.4 mm on one line, socket centre 6.48 mm above S. Body 9 x 10.45, 9.0 mm tall to the shoulder, M6 bushing 5.5 mm (4.5 mm threaded), 14.5 mm overall; panel hole 6.2. ${extraDesc}`,
    pads: [th1('S', 0, -6.48, 2.0, 1.25), th('TN', 0, -3.38, 2.1, 1.45), th('T', 0, 4.92, 2.1, 1.45)],
    graphics: [silkRect(9, 10.45, 0, 0.78), fabRect(9, 10.45, 0, 0.78), circle(1.8), circle(3.0), line(0, -6.48, 0, -4.45, 0.1, FAB), text(1.9, -6.6, 'S', 0.7), text(1.9, 4.9, 'T', 0.7)],
    courtyard: cy4(-5.0, -7.7, 5.0, 6.5), refPos: { x: 0, y: 7.2 }, height: 14.5,
    body3d: [rbox(9, 10.45, 8.4, C.bodyblack, 0, 0.78, 0, { r: 0.6 }), { t: 'cyl', x: 0, y: 0, z: 8.4, d: 8.6, h: 0.6, color: C.bodyblack, seg: 22 },
      ...bushing(6, 5.5, 0, 0, 9.0), hexp(8, 2.0, C.chrome, 0, 0, 9.1, { bore: 6 }), { t: 'cyl', x: 0, y: 0, z: 13.95, d: 3.6, h: 0.55, color: C.dark, seg: 14 }],
    through: { x: 0, y: 0, d: 6.2 }, throughLabel: 'bushing', panelDist: 9.0, bushingLen: 5.5,
    meta: { mfr: 'QingPu (WQP-PJ398SM) / Kobiconn / Thonk', mpn, datasheet: 'https://www.thonk.co.uk/thonkiconn-pj398sm-datasheet/', bushing: 'M6, 5.5 mm (4.5 threaded)', nut: 'M6 hex', panelHole: 6.2 },
  };
}
add(pj301('jack_35_pj301m', 'Jack 3.5 mm mono PJ301M-12 (Thonkiconn family, vertical)', 'PJ301M-12', 'PJ301M-12 and PJ398SM share this footprint (jack_35_pj398sm is the same definition).'));
add(pj301('jack_35_pj398sm', 'Jack 3.5 mm mono PJ398SM Thonkiconn (vertical)', 'PJ398SM', 'Identical footprint to PJ301M-12 (alias entry so both names are searchable).'));
// PJ-320A 4-pole 3.5 mm (XKB, LCSC C2884926) — through-hole, pads from the JLCPCB/EasyEDA footprint (easyeda2kicad).
add({
  id: 'jack_35_pj320a', name: 'Jack 3.5 mm TRRS PJ-320A (horizontal, TH)', cat: 'Jacks & Power', ref: 'J', tags: ['jack', '3.5mm', 'trrs', 'stereo', 'pj-320a', 'horizontal'], verify: true,
  desc: '3.5 mm 4-pole jack, horizontal, opening toward −X: body 12.2 x 6.1 x 5, barrel 2 mm past the body. Pad positions/slots from the JLCPCB (EasyEDA) footprint for XKB PJ-320A C2884926: 4 slotted pins (2/3/4 on the +Y row, 5 on the −Y row) + two Ø1.2 locating pegs; slot width widened from 0.5 to 0.65 mm for fab minimums. Pin functions and the datasheet drawing were not verified.',
  pads: [slotPad('2', -2.9, 2.4, 2.1, 1.1, 0.65, 1.6), slotPad('3', 0.1, 2.4, 2.1, 1.1, 0.65, 1.6), slotPad('4', 4.1, 2.4, 2.1, 1.1, 0.65, 1.6), slotPad('5', 5.1, -2.4, 2.1, 1.1, 0.65, 1.6)],
  holes: [hole(-4.5, 0, 1.2), hole(2.5, 0, 1.2)],
  graphics: [silkRect(12.2, 6.1), fabRect(12.2, 6.1), silkRect(2.0, 5.0, -7.1, 0), fabRect(2.0, 5.0, -7.1, 0)],
  courtyard: cy4(-8.4, -3.3, 6.4, 3.3), refPos: { x: 0, y: 4.0 }, height: 5.0,
  body3d: [rbox(12.2, 6.1, 5.0, C.bodyblack, 0, 0, 0, { r: 0.5 }), { t: 'cyl', x: -7.1, y: 0, z: 2.5, d: 5.0, h: 2.0, color: C.bodyblack, axis: 'x', seg: 18 }, { t: 'cyl', x: -8.25, y: 0, z: 2.5, d: 3.4, h: 0.5, color: C.dark, axis: 'x', seg: 14 }],
  meta: { mfr: 'XKB / Korean Hroparts', mpn: 'PJ-320A', lcsc: 'C2884926', datasheet: 'https://www.lcsc.com/datasheet/C2884926.pdf' },
});
// Neutrik NMJ6HCD2 (horizontal 1/4" stereo, switched). Pads = KiCad Jack_6.35mm_Neutrik_NMJ6HCD2_Horizontal (origin moved to
// the body centre): T/R/S at 6.35 mm pitch, switch row 16.23 mm away, Ø3.0 pads / 1.4 drills. Heights not read from a drawing.
add({
  id: 'jack_635_pcb', name: 'Jack 6.35 mm stereo Neutrik NMJ6HCD2 (horizontal)', cat: 'Jacks & Power', ref: 'J', tags: ['jack', '6.35mm', '1/4', 'guitar', 'neutrik', 'stereo', 'horizontal'], verify: true,
  desc: 'Neutrik NMJ6HCD2 M-series 1/4" stereo jack with switch contacts, horizontal PCB mount, ferrule toward −X: pins T/R/S at 6.35 mm pitch, TN/RN/SN 16.23 mm behind them (Ø3.0 pads, 1.4 mm drills, KiCad). Body 20.6 x 18.2, ferrule 3/8"-32 (panel hole 9.5–10, panel ≤ 4.7 mm) 2.9 mm past the body. Height (12.5) and jack-axis height (~6.4) are estimates. No panel hole in a stacked board — exits the enclosure side.',
  pads: [th1('T', -6.35, 8.115, 3.0, 1.4), th('R', 0, 8.115, 3.0, 1.4), th('S', 6.35, 8.115, 3.0, 1.4), th('TN', -6.35, -8.115, 3.0, 1.4), th('RN', 0, -8.115, 3.0, 1.4), th('SN', 6.35, -8.115, 3.0, 1.4)],
  graphics: [silkRect(20.6, 18.2), fabRect(20.6, 18.2), silkRect(2.9, 8.7, -11.75, 0), silkRect(3.0, 11.4, 11.85, 0), text(-6.35, 10.2, 'T', 0.7)],
  courtyard: cy4(-13.7, -9.6, 13.9, 9.6), refPos: { x: 0, y: 10.4 }, height: 12.5,
  body3d: [rbox(20.6, 18.2, 12.5, C.bodyblack, 0, 0, 0, { r: 1.0 }), { t: 'cyl', x: -10.9, y: 0, z: 6.4, d: 11.5, h: 1.6, color: C.bodyblack, axis: 'x', seg: 22 },
    ...bushing(9.5, 3.4, -12.4, 0, 6.4, C.chrome, 'x'), hexp(13.5, 2.2, C.chrome, -11.6, 0, 6.4, { bore: 9.5, axis: 'x' }),
    { t: 'cyl', x: -13.85, y: 0, z: 6.4, d: 6.6, h: 0.7, color: C.dark, axis: 'x', seg: 16 }, rbox(3.0, 11.4, 10, C.bodyblack, 11.85, 0, 0, { r: 0.4 })],
  meta: { mfr: 'Neutrik', mpn: 'NMJ6HCD2', datasheet: 'https://www.neutrik.com/en/product/nmj6hcd2', bushing: '3/8"-32 UNEF ferrule', panelHole: 9.5, panelMax: 4.7, shaftCentreZ: 6.4 },
});
// DC-005 5.5/2.1 barrel jack: KiCad Connector_BarrelJack:BarrelJack_Horizontal (origin moved to the body centre; JLC's
// DC-005 footprint C16214 agrees within 0.15 mm). Body 14.5 x 9.0 x 11, opening toward +X.
add({
  id: 'jack_dc_55x21', name: 'DC barrel jack 5.5/2.1 DC-005 (horizontal)', cat: 'Jacks & Power', ref: 'J', tags: ['dc', 'barrel', 'power', 'dc-005', '2.1mm', 'horizontal'], verify: false,
  desc: 'DC-005 5.5 x 2.1 mm barrel jack, horizontal, opening toward +X: centre pin (1) and sleeve (2) on 3 mm slots 6 mm apart, switch (3) on a 3 mm slot 4.7 mm to the side. Body 14.5 x 9.0 x 11 (KiCad BarrelJack_Horizontal = JLC DC-005 within 0.15 mm).',
  pads: [slotPad('1', 6.45, 0, 3.5, 3.5, 1.0, 3.0, 90, 'rect'), slotPad('2', 0.45, 0, 3.5, 3.0, 1.0, 3.0, 90, 'roundrect'), slotPad('3', 3.45, -4.7, 3.5, 3.5, 1.0, 3.0, 0, 'roundrect')],
  graphics: [silkRect(14.5, 9.0), fabRect(14.5, 9.0), line(7.25, -2.75, 8.0, -2.75), line(7.25, 2.75, 8.0, 2.75), text(6.45, 2.6, '1', 0.7)],
  courtyard: cy4(-7.55, -6.75, 8.45, 4.75), refPos: { x: 0, y: 5.6 }, height: 11.0,
  body3d: [rbox(14.5, 9.0, 11.0, C.bodyblack, 0, 0, 0, { r: 0.8 }), tube(8.2, 5.4, 1.4, C.bodyblack, 7.6, 0, 6.0, 'x'),
    { t: 'cyl', x: 5.8, y: 0, z: 6.0, d: 5.4, h: 4.0, color: C.dark, axis: 'x', seg: 18 }, { t: 'cyl', x: 5.5, y: 0, z: 6.0, d: 1.9, h: 4.6, color: C.chrome, axis: 'x', seg: 12 }],
  meta: { mfr: 'generic (Ninigi / XKB DC-005)', mpn: 'DC-005', lcsc: 'C16214', datasheet: 'https://www.lcsc.com/product-detail/C16214.html', plug: '5.5 x 2.1 mm' },
});
// USB-C 16-pin receptacles (SMD signal pads + 4 through-hole shell tabs). Signal pads: A1/B12 and A4/B9 etc. are merged
// pairs as in JLC's footprint. Y-up: connector opening faces −Y (KiCad +y). Pads from KiCad USB_C_Receptacle_HRO_TYPE-C-31-M-12
// (= JLC C165948) and USB_C_Receptacle_XKB_U262-16XN-4BVC11 (LCSC C319148).
function usbC16(id, name, padY, padH, shellY1, shellY2, npthY, bodyD, height, verify, desc, meta) {
  const wide = 0.6, narrow = 0.3;
  const pads = [smd('A1B12', -3.25, padY, wide, padH), smd('A4B9', -2.45, padY, wide, padH), smd('B4A9', 2.45, padY, wide, padH), smd('B1A12', 3.25, padY, wide, padH),
    smd('B8', -1.75, padY, narrow, padH), smd('A5', -1.25, padY, narrow, padH), smd('B7', -0.75, padY, narrow, padH), smd('A6', -0.25, padY, narrow, padH),
    smd('A7', 0.25, padY, narrow, padH), smd('B6', 0.75, padY, narrow, padH), smd('A8', 1.25, padY, narrow, padH), smd('B5', 1.75, padY, narrow, padH),
    slotPad('SH', -4.32, shellY1, 2.1, 1.0, 0.6, 1.7, 90), slotPad('SH', 4.32, shellY1, 2.1, 1.0, 0.6, 1.7, 90), slotPad('SH', -4.32, shellY2, 1.6, 1.0, 0.6, 1.2, 90), slotPad('SH', 4.32, shellY2, 1.6, 1.0, 0.6, 1.2, 90)];
  return {
    id, name, cat: 'Jacks & Power', ref: 'J', tags: ['usb', 'usb-c', 'type-c', '16p', 'connector', 'smd'], verify, desc, pads,
    holes: [hole(-2.89, npthY, 0.65), hole(2.89, npthY, 0.65)],
    graphics: [fabRect(8.94, bodyD), line(-4.5, -bodyD / 2, -4.5, -1.9), line(4.5, -bodyD / 2, 4.5, -1.9), line(-4.5, -bodyD / 2, 4.5, -bodyD / 2), text(-3.25, padY + 1.4, 'A1', 0.6)],
    courtyard: cy4(-5.32, -bodyD / 2 - 0.5, 5.32, padY + padH / 2 + 0.5), refPos: { x: 0, y: padY + 2.4 }, height,
    body3d: shellMouth(8.94, bodyD, height, 6.6, Math.max(0.9, height - 1.5), C.white, 0, 0, 0, C.silver, 0.6),
    meta: { ...meta, orientation: `opening faces −Y; front face at y=${-bodyD / 2}; put the board edge at y≈${(-bodyD / 2 + 0.3).toFixed(2)} (front ~0.3 mm proud) or flush` },
  };
}
add(usbC16('usb_c_16p', 'USB-C receptacle 16-pin HRO TYPE-C-31-M-12 / GCT USB4105', 4.045, 1.45, 3.13, -1.05, 2.6, 7.30, 3.26, false,
  'USB 2.0 Type-C receptacle, 16 contacts (12 pads: A1/B12 GND, A4/B9 VBUS, CC1, CC2, D±x2, SBU1/2) + 4 through-hole shell tabs (0.6 mm slots), 2 Ø0.65 locating pegs. Body 8.94 x 7.30 x 3.26, opening toward −Y. HRO TYPE-C-31-M-12 = JLCPCB C165948 (their default USB-C); GCT USB4105-GF-A shares the pattern with 1.15 mm pads.',
  { mfr: 'Korean Hroparts (HRO)', mpn: 'TYPE-C-31-M-12', lcsc: 'C165948', datasheet: 'https://www.lcsc.com/datasheet/lcsc_datasheet_2205251630_Korean-Hroparts-Elec-TYPE-C-31-M-12_C165948.pdf', alt: 'GCT USB4105-GF-A, XKB U262-16XN-4BVC11' }));
add(usbC16('usb_c_16p_th', 'USB-C receptacle 16-pin XKB U262-16XN-4BVC11 (TH shell legs)', 3.67, 1.15, 3.105, -1.075, 2.605, 7.35, 3.16, true,
  'USB 2.0 Type-C receptacle, 16 contacts on SMD pads + 4 through-hole shell legs (0.6 x 1.7 / 0.6 x 1.2 slots), XKB U262-16XN-4BVC11 (LCSC C319148, KiCad USB_C_Receptacle_XKB_U262-16XN-4BVC11). Body 8.94 x 7.35 x 3.16, opening toward −Y. Same tab pattern family as HRO M-12 (usb_c_16p) — the fully-through-hole "16P DIP/vertical" types (e.g. SHOU HAN TYPE-C 16PLC) are NOT this footprint; verify against your part.',
  { mfr: 'XKB Connectivity', mpn: 'U262-16XN-4BVC11', lcsc: 'C319148', datasheet: 'https://datasheet.lcsc.com/szlcsc/1811141824_XKB-Enterprise-U262-161N-4BVC11_C319148.pdf' }));
// USB micro-B, Amphenol 10118194 (KiCad Connector_USB:USB_Micro-B_Amphenol_10118194_Horizontal). Opening faces −Y.
add({
  id: 'usb_microb', name: 'USB micro-B receptacle Amphenol 10118194 (SMD + TH shell)', cat: 'Jacks & Power', ref: 'J', tags: ['usb', 'micro-b', 'micro usb', 'connector', 'smd'], verify: false,
  desc: 'USB micro-B receptacle, horizontal, SMD signal pads (0.65 mm pitch) + shell soldered by 4 SMD pads and 4 through-hole slots (0.5 mm wide — check your fab minimum; JLCPCB accept it on their basic part C10418 whose shell legs sit 0.1 mm away). Body 7.3 x 5.0, 2.6 mm tall, opening toward −Y.',
  pads: [smd('1', -1.3, 1.4, 0.4, 1.35), smd('2', -0.65, 1.4, 0.4, 1.35), smd('3', 0, 1.4, 0.4, 1.35), smd('4', 0.65, 1.4, 0.4, 1.35), smd('5', 1.3, 1.4, 0.4, 1.35),
    smd('SH', -3.025, -1.3, 1.45, 1.55), smd('SH', -1.0, -1.3, 1.5, 1.55), smd('SH', 1.0, -1.3, 1.5, 1.55), smd('SH', 3.025, -1.3, 1.45, 1.55),
    slotPad('SH', -3.5, -1.3, 1.55, 0.89, 0.5, 1.15, 90), slotPad('SH', 3.5, -1.3, 1.55, 0.89, 0.5, 1.15, 90), slotPad('SH', -2.5, 1.4, 1.25, 0.95, 0.55, 0.85, 0), slotPad('SH', 2.5, 1.4, 1.25, 0.95, 0.55, 0.85, 0)],
  graphics: [fabRect(7.3, 5.0, 0, -0.95), line(-3.76, -3.45, 3.76, -3.45), line(-3.76, -3.45, -3.76, -2.3), line(3.76, -3.45, 3.76, -2.3), text(-1.3, 2.7, '1', 0.6)],
  courtyard: cy4(-4.45, -3.95, 4.45, 2.6), refPos: { x: 0, y: 3.5 }, height: 2.6,
  body3d: shellMouth(7.3, 5.0, 2.6, 5.4, 1.5, C.bodyblack, 0, -0.95, 0, C.silver, 0.55),
  meta: { mfr: 'Amphenol ICC', mpn: '10118194-0001LF', datasheet: 'https://cdn.amphenol-icc.com/media/wysiwyg/files/drawing/10118194.pdf', altJLC: 'C10418 (MICRO-USB-SMD_5P-P0.65-H-F, JLC basic)' },
});
// USB-A through-hole horizontal (Molex 67643 / Stewart SS-52100 / generic). KiCad USB_A_Molex_67643_Horizontal, origin at
// the pin-row centre; opening faces −Y (14.4 x 15.3 shell footprint).
add({
  id: 'usb_a_th', name: 'USB-A receptacle, through-hole horizontal (Molex 67643 / generic)', cat: 'Jacks & Power', ref: 'J', tags: ['usb', 'usb-a', 'type-a', 'connector', 'tht'], verify: true,
  desc: 'USB-A female, horizontal TH: 4 pins at 2.5/2.0/2.5 mm (Ø0.95 drills), two Ø2.3 shell posts 13.14 mm apart 2.71 mm behind the pin row. Shell 14.4 wide x 15.3 deep, opening toward −Y. Pads = KiCad Molex 67643 (Stewart SS-52100 identical); the 7 mm height is the usual USB-A envelope, not read from the drawing.',
  pads: [th1('1', -3.5, 0, 1.6, 0.95), th('2', -1.0, 0, 1.6, 0.95), th('3', 1.0, 0, 1.6, 0.95), th('4', 3.5, 0, 1.6, 0.95), th('SH', -6.57, -2.71, 3.0, 2.3), th('SH', 6.57, -2.71, 3.0, 2.3)],
  graphics: [silkRect(14.4, 15.26, 0, -5.36), fabRect(14.4, 15.26, 0, -5.36), text(-3.5, 1.6, '1', 0.7)],
  courtyard: cy4(-8.6, -13.5, 8.6, 2.8), refPos: { x: 0, y: 3.4 }, height: 7.0,
  body3d: shellMouth(13.2, 15.26, 7.0, 11.6, 5.2, C.white, 0, -5.36, 0, C.silver, 1.9),
  meta: { mfr: 'Molex', mpn: '67643-0910', datasheet: 'https://www.molex.com/pdm_docs/sd/676430910_sd.pdf' },
});
// 5.08 mm screw terminals (KF301/DG301 5.0-pitch clones and Phoenix MKDS 1,5/x-5.08 both fit; Ø2.6 pads on 1.4 mm drills).
function term508(n) {
  const w = 5.08 * n, xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 5.08);
  return {
    id: `term_${n}p_508`, name: `Screw terminal ${n}-pole 5.08 mm (KF301 / MKDS 1,5)`, cat: 'Jacks & Power', ref: 'J', tags: ['terminal', 'screw', '5.08', 'kf301', 'phoenix', 'power'], verify: false,
    desc: `${n}-pole 5.08 mm screw terminal block, wire entry toward −Y. Pads Ø2.6 / 1.4 mm drills take the 5.0 mm KF301/DG301 clones (LCSC C474881 etc., 10 x 7.6 x 10 mm body) and Phoenix MKDS 1,5/${n}-5.08 (KiCad, ${w.toFixed(1)} x 9.8 x 13.8 mm). Body drawn as KF301 (7.6 deep, 10 mm tall).`,
    pads: xs.map((x, i) => (i === 0 ? th1 : th)(String(i + 1), x, 0, 2.6, 1.4)),
    graphics: [silkRect(w, 7.6, 0, 0.2), fabRect(w, 7.6, 0, 0.2), line(-w / 2, -2.4, w / 2, -2.4), ...xs.map(x => circle(1.6, x, 1.6)), text(xs[0], 4.9, '1', 0.7)],
    courtyard: cy4(-w / 2 - 0.3, -3.9, w / 2 + 0.3, 4.3), refPos: { x: 0, y: 5.6 }, height: 10.0,
    body3d: [rbox(w, 7.6, 9.0, C.green, 0, 0.2, 0, { r: 0.6 }),
      ...xs.map(x => ({ t: 'cyl', x, y: -3.9, z: 3.2, d: 3.4, h: 1.0, color: C.dark, axis: 'y', seg: 14 })),
      ...xs.map(x => ({ t: 'cyl', x, y: 1.6, z: 8.5, d: 3.4, h: 0.8, color: C.chrome, seg: 14 })),
      ...xs.map(x => ({ t: 'box', x, y: 1.6, z: 9.2, w: 3.2, d: 0.5, h: 0.3, color: C.dark }))],
    meta: { mfr: 'generic (KF301-5.0) / Phoenix Contact (MKDS 1,5)', mpn: `KF301-5.0-${n}P / MKDS 1,5/${n}-5.08`, lcsc: n === 2 ? 'C474881' : undefined, wire: '≤1.5 mm² / 16 AWG', pitchNote: 'clones are 5.0 mm — 0.08 mm/pole error is absorbed by the 1.4 mm drills' },
  };
}
add(term508(2)); add(term508(3));

// =====================================================================================================
// CONNECTORS — JST, headers for stacking
// =====================================================================================================
function jstXH(n) {
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 2.5), w = 2.5 * (n - 1) + 4.9;
  return {
    id: `jst_xh_${n}`, name: `JST XH B${n}B-XH-A ${n}-pin 2.5 mm (top entry)`, cat: 'Connectors', ref: 'J', tags: ['jst', 'xh', 'connector', 'wire-to-board', '2.5mm'], verify: false,
    desc: `JST XH ${n}-pin shrouded header, 2.5 mm pitch, vertical/top entry (KiCad JST_XH_B${n}B-XH-A). Housing ${w.toFixed(1)} x 5.75, 7.0 mm tall; polarising wall on the −Y side.`,
    pads: xs.map((x, i) => ({ name: String(i + 1), x, y: 0, shape: i === 0 ? 'rect' : 'oval', w: 1.7, h: 1.95, drill: 0.95, layer: 'both' })),
    graphics: [silkRect(w, 5.75, 0, -0.525), fabRect(w, 5.75, 0, -0.525), line(-w / 2, -3.4, -w / 2, -2.4, 0.3), line(w / 2, -3.4, w / 2, -2.4, 0.3), text(xs[0], 3.2, '1', 0.7)],
    courtyard: cy4(-w / 2 - 0.5, -3.9, w / 2 + 0.5, 2.85), refPos: { x: 0, y: 3.5 }, height: 7.0,
    body3d: [rbox(w, 5.75, 1.4, C.white, 0, -0.525, 0, { r: 0.3 }),
      { t: 'box', x: -(w / 2 - 0.5), y: -0.525, z: 1.4, w: 1.0, d: 5.75, h: 5.6, color: C.white },
      { t: 'box', x: (w / 2 - 0.5), y: -0.525, z: 1.4, w: 1.0, d: 5.75, h: 5.6, color: C.white },
      { t: 'box', x: 0, y: 1.85, z: 1.4, w, d: 1.0, h: 5.6, color: C.white },
      { t: 'box', x: 0, y: -3.0, z: 1.4, w, d: 0.8, h: 3.4, color: C.white },
      ...xs.map(x => lead(x, 0, 5.4, { shape: 'square', w: 0.64, below: 2.6, color: C.gold }))],
    meta: { mfr: 'JST', mpn: `B${n}B-XH-A`, datasheet: 'https://www.jst-mfg.com/product/pdf/eng/eXH.pdf' },
  };
}
add(jstXH(2)); add(jstXH(3)); add(jstXH(4));
function jstPH(n) {
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 2.0), w = 2.0 * (n - 1) + 4.3;
  return {
    id: `jst_ph_${n}`, name: `JST PH B${n}B-PH-K ${n}-pin 2.0 mm (top entry)`, cat: 'Connectors', ref: 'J', tags: ['jst', 'ph', 'connector', 'wire-to-board', '2.0mm'], verify: false,
    desc: `JST PH ${n}-pin shrouded header, 2.0 mm pitch, top entry (KiCad JST_PH_B${n}B-PH-K). Housing ${w.toFixed(1)} x 4.9, 6.0 mm tall; polarising wall on the −Y side.`,
    pads: xs.map((x, i) => ({ name: String(i + 1), x, y: 0, shape: i === 0 ? 'rect' : 'oval', w: 1.2, h: 1.75, drill: 0.75, layer: 'both' })),
    graphics: [silkRect(w, 4.9, 0, -0.35), fabRect(w, 4.9, 0, -0.35), line(-w / 2, -2.8, -w / 2, -1.9, 0.3), line(w / 2, -2.8, w / 2, -1.9, 0.3), text(xs[0], 2.6, '1', 0.6)],
    courtyard: cy4(-w / 2 - 0.5, -3.3, w / 2 + 0.5, 2.2), refPos: { x: 0, y: 3.0 }, height: 6.0,
    body3d: [rbox(w, 4.9, 1.2, C.white, 0, -0.35, 0, { r: 0.25 }),
      { t: 'box', x: -(w / 2 - 0.45), y: -0.35, z: 1.2, w: 0.9, d: 4.9, h: 4.8, color: C.white },
      { t: 'box', x: (w / 2 - 0.45), y: -0.35, z: 1.2, w: 0.9, d: 4.9, h: 4.8, color: C.white },
      { t: 'box', x: 0, y: 1.65, z: 1.2, w, d: 0.9, h: 4.8, color: C.white },
      { t: 'box', x: 0, y: -2.4, z: 1.2, w, d: 0.7, h: 2.9, color: C.white },
      ...xs.map(x => lead(x, 0, 4.6, { shape: 'square', w: 0.5, below: 2.4, color: C.gold }))],
    meta: { mfr: 'JST', mpn: `B${n}B-PH-K-S`, datasheet: 'https://www.jst-mfg.com/product/pdf/eng/ePH.pdf' },
  };
}
add(jstPH(2)); add(jstPH(4));

// Stacking-header variants. Pad geometry identical to library.js pinHeader() (same numbering, pin 1 square).
const HDR_SIZES = [[1, 4], [1, 6], [1, 8], [1, 10], [1, 12], [1, 15], [1, 16], [1, 20], [2, 8], [2, 10], [2, 20]];
const nn = (n) => String(n).padStart(2, '0');
function hdrOutline(rows, n) {
  const w = rows * 2.54, h = n * 2.54, x0 = -(rows - 1) * 2.54 / 2, y0 = (n - 1) * 2.54 / 2;
  return [silkRect(w, h), fabRect(w, h), line(-w / 2 - 0.3, y0 + 1.27 + 0.3, -w / 2 - 0.3, y0 - 1.27), line(-w / 2 - 0.3, y0 + 1.27 + 0.3, x0 + 1.27 - 0.5, y0 + 1.27 + 0.3)];
}
for (const [rows, n] of HDR_SIZES) {
  const w = rows * 2.54, h = n * 2.54, pads = headerPads(rows, n), tag = `${rows}x${nn(n)}`;
  // low-profile 5.0 mm female socket (Harwin M20-78x, "5 mm SIP socket")
  add({ id: `fhdr_${tag}_lp5`, name: `Female header ${rows}×${n} 2.54 mm, low profile 5.0 mm`, cat: 'Connectors', ref: 'J', tags: ['header', 'female', 'socket', 'low-profile', 'stack'], verify: false,
    desc: 'Female socket header with a 5.0 mm insulator (Harwin M20-784/785 style, 3.0 mm tails). Socket depth ≈ 4.5 mm: 6 mm male pins bottom out unless trimmed to ~4.5 mm.', pads, graphics: hdrOutline(rows, n), courtyard: { w: w + 0.5, h: h + 0.5 }, refPos: { x: 0, y: h / 2 + 1.2 }, height: 5.0,
    body3d: femaleHeaderBody(pads, w, h, 5.0), meta: { plastic: 5.0, socketDepth: 4.5, tail: 3.0, mfr: 'Harwin', mpn: `M20-78${rows === 1 ? '2' : '3'}xx46`, datasheet: 'https://cdn.harwin.com/pdfs/M20-78x.pdf' } });
  // Arduino-style stacking header: 8.5 mm socket body ABOVE the board, 10.5 mm legs through it (as the UPPER half of a
  // stack it is placed on the upper board's bottom side: the 3D legs point into the gap, the socket body is drawn
  // above a 1.6 mm board at z<0).
  add({ id: `shdr_${tag}`, name: `Stackable header ${rows}×${n} 2.54 mm (8.5 mm socket + 10.5 mm legs)`, cat: 'Connectors', ref: 'J', tags: ['header', 'female', 'stackable', 'stacking', 'arduino', 'shield', 'stack'], verify: false,
    desc: 'Arduino/shield stacking header: 8.5 mm female body on TOP of the board, 10.5 mm legs through it → 8.9 mm below a 1.6 mm board plugging into an 8.5 mm female header on the board underneath. height = legs below the board; the socket body adds 8.5 mm above.', pads, graphics: hdrOutline(rows, n), courtyard: { w: w + 0.5, h: h + 0.5 }, refPos: { x: 0, y: h / 2 + 1.2 }, height: 8.9,
    body3d: [...pads.map(p => lead(p.x, p.y, 8.9, { shape: 'square', w: 0.64, below: 0, color: C.gold })), rbox(w, h, 8.5, C.black, 0, 0, -(1.6 + 8.5), { r: 0.25 }), ...pads.map(p => ({ t: 'box', x: p.x, y: p.y, z: -(1.6 + 1.1), w: 1.65, d: 1.65, h: 1.1, color: C.dark }))], meta: { plastic: 8.5, legLen: 10.5, legBelow1p6: 8.9, bodyAbove: 8.5, mfr: 'Adafruit / Samtec ESQ / generic', datasheet: 'https://www.adafruit.com/product/85' } });
  // long-pin male header: 2.54 plastic + 15 mm pins above (tails 3 mm) — the LOWER half of b2b_longpin
  add({ id: `hdr_${tag}_l15`, name: `Pin header ${rows}×${n} 2.54 mm, 15 mm long pins`, cat: 'Connectors', ref: 'J', tags: ['header', 'pin', 'male', 'long', 'stack'], verify: false,
    desc: 'Male header with 15 mm pins above the 2.54 mm plastic (17.54 mm total above the board): passes straight through a board 8–13 mm above and is soldered there (b2b_longpin).', pads, graphics: hdrOutline(rows, n), courtyard: { w: w + 0.5, h: h + 0.5 }, refPos: { x: 0, y: h / 2 + 1.2 }, height: 17.54,
    body3d: [rbox(w, h, 2.54, C.black, 0, 0, 0, { r: 0.25 }), ...maleHeaderPins(pads, 2.54, 15.0, 3.0)], meta: { pinLenAbove: 15.0, plastic: 2.54, tail: 3.0 } });
  // solder pads for long pins arriving from below — the UPPER half of b2b_longpin (no body of its own)
  add({ id: `hdr_${tag}_pads`, name: `Solder pads ${rows}×${n} 2.54 mm for through-pins from the board below`, cat: 'Connectors', ref: 'J', tags: ['header', 'pads', 'stack', 'through-pins'], verify: false,
    desc: 'Plain 2.54 mm pad grid: the 15 mm pins of a hdr_*_l15 header on the lower board come up through these holes and are soldered from above. No body; the pin stubs protrude 17.54 − gap − t above the upper board.', pads, graphics: hdrOutline(rows, n), courtyard: { w: w + 0.5, h: h + 0.5 }, refPos: { x: 0, y: h / 2 + 1.2 }, height: 0,
    body3d: [], meta: { pinLenAbove: 0 } });
}

// =====================================================================================================
// SWITCHES
// =====================================================================================================
add({
  id: 'sw_tact_6x6', name: 'Tactile switch 6x6 mm (4-pin, H5)', cat: 'Switches', ref: 'SW', tags: ['tact', 'tactile', 'button', 'push', '6x6'], verify: false,
  desc: '6 x 6 mm through-hole tact switch: pins on a 6.5 x 4.5 mm grid (Ø1.1 drills), pins on the same 6.5 mm side are internally shorted (both named 1 / 2). Body 6 x 6, 5.0 mm to the top of the Ø3.5 plunger (H4.3/7/9.5 variants share the footprint).',
  pads: [th('1', -3.25, 2.25, 2.0, 1.1), th('1', 3.25, 2.25, 2.0, 1.1), th('2', -3.25, -2.25, 2.0, 1.1), th('2', 3.25, -2.25, 2.0, 1.1)],
  graphics: [silkRect(6, 6), fabRect(6, 6), circle(1.75)],
  courtyard: { w: 9.5, h: 7.5 }, refPos: { x: 0, y: 4.5 }, height: 5.0,
  body3d: [rbox(6, 6, 3.3, C.bodyblack, 0, 0, 0, { r: 0.4 }), { t: 'cyl', x: 0, y: 0, z: 3.0, d: 5.8, h: 0.5, color: C.alu, seg: 20 }, cone(3.6, 3.3, 1.5, C.bodyblack, 0, 0, 3.5)],
  meta: { mfr: 'generic (Omron B3F-10xx, Alps SKHH, C&K PTS645)', mpn: 'B3F-1000', datasheet: 'https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf', plungerD: 3.5, heights: [4.3, 5.0, 7.0, 8.5, 9.5, 13] },
});
add({
  id: 'sw_tact_12x12', name: 'Tactile switch 12x12 mm (4-pin, H7.3)', cat: 'Switches', ref: 'SW', tags: ['tact', 'tactile', 'button', 'push', '12x12'], verify: false,
  desc: '12 x 12 mm through-hole tact switch: pins on a 12.5 x 5.0 mm grid (Ø1.4 drills; KiCad SW_PUSH-12mm and JLC C136699 agree), pins on the same 12.5 mm side shorted (named 1 / 2). Body 12 x 12, 7.3 mm to the plunger top (4.3–13 mm variants).',
  pads: [th('1', -6.25, 2.5, 2.5, 1.4), th('1', 6.25, 2.5, 2.5, 1.4), th('2', -6.25, -2.5, 2.5, 1.4), th('2', 6.25, -2.5, 2.5, 1.4)],
  graphics: [silkRect(12, 12), fabRect(12, 12), circle(1.75)],
  courtyard: { w: 15.5, h: 14.5 }, refPos: { x: 0, y: 7.5 }, height: 7.3,
  body3d: [rbox(12, 12, 4.1, C.bodyblack, 0, 0, 0, { r: 0.5 }), { t: 'cyl', x: 0, y: 0, z: 3.8, d: 11.6, h: 0.5, color: C.alu, seg: 22 }, cone(3.8, 3.4, 3.0, C.bodyblack, 0, 0, 4.3)],
  meta: { mfr: 'generic (E-Switch TL1100, Omron B3F-4055)', mpn: 'TL1100 / B3F-4055', lcsc: 'C136699', datasheet: 'https://sten-eswitch-13110800-production.s3.amazonaws.com/system/asset/product_line/data_sheet/143/TL1100.pdf', heights: [4.3, 5.0, 6.0, 7.3, 8.5, 9.5, 13] },
});
// MTS-102 sub-mini toggle (Jietong / generic): 3 flat pins 0.8x2.0 at 4.7 mm, body 13.2 x 7.9 x 9.5, M6x0.75 bushing 8.8 mm, Ø3 lever 11 mm.
add({
  id: 'sw_toggle_mts102', name: 'Toggle MTS-102 SPDT ON-ON (sub-mini, M6)', cat: 'Switches', ref: 'SW', tags: ['toggle', 'mts-102', 'spdt', 'sub-mini', 'through'], verify: false,
  desc: 'MTS-102 sub-miniature toggle, PC pins: 3 flat 0.8 x 2.0 mm pins at 4.7 mm pitch (2.4 x 1.0 slots along Y), body 13.2 x 7.9 x 9.5 mm sitting on the board, M6x0.75 bushing 8.8 mm (nut + lock ring), Ø3 lever 11 mm → 29.3 mm overall. Panel: Ø6.4 hole (the lock ring wants an extra Ø2.4 anti-rotation hole 6.4 mm along the pin row — add it by hand if used). MTS-103 (ON-OFF-ON) is the same footprint.',
  pads: [slotPad('1', -4.7, 0, 3.4, 2.0, 1.0, 2.4, 90, 'rect'), slotPad('2', 0, 0, 3.4, 2.0, 1.0, 2.4, 90), slotPad('3', 4.7, 0, 3.4, 2.0, 1.0, 2.4, 90)],
  graphics: [silkRect(13.2, 7.9), fabRect(13.2, 7.9), circle(3.0), line(-6.6, 0, 6.6, 0, 0.1, FAB), text(-4.7, -2.9, '1', 0.7)],
  courtyard: { w: 14.2, h: 8.9 }, refPos: { x: 0, y: 5.0 }, height: 29.3,
  body3d: [rbox(13.2, 7.9, 8.2, C.bodyblack, 0, 0, 0, { r: 0.5 }), { t: 'cyl', x: 0, y: 0, z: 8.2, d: 9.4, h: 1.3, color: C.chrome, seg: 22 },
    ...bushing(6, 8.8, 0, 0, 9.5), hexp(8.2, 2.0, C.chrome, 0, 0, 9.7, { bore: 6 }),
    tiltedRod(3, 10, 20, 0, 0, 18.3), { t: 'sphere', x: 0, y: -3.42, z: 25.99, d: 3.4, cut: null, color: C.chrome }],
  through: { x: 0, y: 0, d: 6.4 }, throughLabel: 'bushing', panelDist: 9.5, bushingLen: 8.8,
  meta: { mfr: 'Ningbo Jietong (generic MTS)', mpn: 'MTS-102', datasheet: 'https://www.jietongswitch.com/miniature-toggle-switch-mts-102-products/', bushing: 'M6x0.75, 8.8 mm', panelHole: 6.4, antiRotationHole: 'Ø2.4 at 6.4 mm', pinLen: 4 },
});
add({
  id: 'sw_toggle_mts202', name: 'Toggle MTS-202 DPDT ON-ON (sub-mini, M6)', cat: 'Switches', ref: 'SW', tags: ['toggle', 'mts-202', 'dpdt', 'sub-mini', 'through'], verify: true,
  desc: 'MTS-202 sub-miniature DPDT toggle, PC pins: 2 rows of 3 flat 0.8 x 2.0 pins, 4.7 mm pitch; row spacing drawn at 4.7 mm (UNVERIFIED — MTS-202 drawings quote 4.7 or 5.0; measure). Body 13.2 x 8.6 x 9.5, M6x0.75 bushing 8.8 mm, Ø3 lever 11 mm, 29.3 mm overall; Ø6.4 panel hole (+ Ø2.4 anti-rotation hole 6.4 mm along the rows). MTS-203 (ON-OFF-ON) is the same footprint.',
  pads: [slotPad('1', -4.7, 2.35, 3.4, 2.0, 1.0, 2.4, 90, 'rect'), slotPad('2', 0, 2.35, 3.4, 2.0, 1.0, 2.4, 90), slotPad('3', 4.7, 2.35, 3.4, 2.0, 1.0, 2.4, 90), slotPad('4', -4.7, -2.35, 3.4, 2.0, 1.0, 2.4, 90), slotPad('5', 0, -2.35, 3.4, 2.0, 1.0, 2.4, 90), slotPad('6', 4.7, -2.35, 3.4, 2.0, 1.0, 2.4, 90)],
  graphics: [silkRect(13.2, 8.6), fabRect(13.2, 8.6), circle(3.0), text(-4.7, 4.9, '1', 0.7)],
  courtyard: { w: 14.2, h: 9.6 }, refPos: { x: 0, y: 5.4 }, height: 29.3,
  body3d: [rbox(13.2, 8.6, 8.2, C.bodyblack, 0, 0, 0, { r: 0.5 }), { t: 'cyl', x: 0, y: 0, z: 8.2, d: 9.4, h: 1.3, color: C.chrome, seg: 22 },
    ...bushing(6, 8.8, 0, 0, 9.5), hexp(8.2, 2.0, C.chrome, 0, 0, 9.7, { bore: 6 }),
    tiltedRod(3, 10, 20, 0, 0, 18.3), { t: 'sphere', x: 0, y: -3.42, z: 25.99, d: 3.4, cut: null, color: C.chrome }],
  through: { x: 0, y: 0, d: 6.4 }, throughLabel: 'bushing', panelDist: 9.5, bushingLen: 8.8,
  meta: { mfr: 'Ningbo Jietong (generic MTS)', mpn: 'MTS-202', bushing: 'M6x0.75, 8.8 mm', panelHole: 6.4, rowSpacing: '4.7 (verify)' },
});
// 3PDT stomp switch (AionFX / Taiwan Alpha SF12020F / generic blue): 9 lugs 2.0 x 0.75 x 3.2 on a 5.3 (across poles) x 4.8 (along a
// pole) grid, body 19.6 x 17.0, 16.7 mm to the shoulder, M12x0.75 thread 11.5 mm, Ø10 button 5 mm, drill Ø12.5.
add({
  id: 'sw_footswitch_3pdt', name: 'Footswitch 3PDT latching (M12 stomp switch)', cat: 'Switches', ref: 'SW', tags: ['footswitch', '3pdt', 'stomp', 'pedal', 'latching', 'through'], verify: true,
  desc: 'Standard 3PDT stomp switch (AionFX datasheet / Alpha SF12020F / generic blue): 9 solder lugs 2.0 x 0.75 mm in a 3x3 grid, poles (1-2-3, 2 = common) run along Y at 4.8 mm, poles are 5.3 mm apart along X (2.7 x 1.1 slots). Body 19.6 x 17.0, 16.7 mm from the lug base to the shoulder, M12x0.75 thread 11.5 mm, Ø10 button 5 mm proud → 33.2 mm; panel hole 12.5 mm. Grid axis assignment (5.3 vs 4.8) was inferred from the drawing views — verify with the switch in hand.',
  pads: [1, 2, 3].flatMap(col => [1, 2, 3].map(row => { const k = (col - 1) * 3 + row; const x = (col - 2) * 5.3, y = (2 - row) * 4.8; return slotPad(String(k), x, y, 3.6, 2.2, 1.1, 2.7, 0, k === 1 ? 'rect' : 'oval'); })),
  graphics: [silkRect(19.6, 17.0), fabRect(19.6, 17.0), circle(6.0), circle(5.0, 0, 0, 0.1, FAB), text(-7.6, 6.6, '1', 0.7)],
  courtyard: { w: 20.6, h: 18.0 }, refPos: { x: 0, y: 9.7 }, height: 33.2,
  body3d: [rbox(19.6, 17.0, 15.4, '#1b3a6b', 0, 0, 0, { r: 1.2 }), { t: 'cyl', x: 0, y: 0, z: 15.4, d: 17.6, h: 1.3, color: C.chrome, seg: 26 },
    ...bushing(12, 11.5, 0, 0, 16.7), hexp(14.6, 2.8, C.chrome, 0, 0, 17.1, { bore: 12 }),
    { t: 'cyl', x: 0, y: 0, z: 28.2, d: 10, h: 3.6, color: C.chrome, seg: 22 }, cone(10, 7.4, 1.4, C.chrome, 0, 0, 31.8)],
  through: { x: 0, y: 0, d: 12.5 }, throughLabel: 'bushing', panelDist: 16.7, bushingLen: 11.5,
  meta: { mfr: 'generic (Taiwan Alpha SF12020F, AionFX)', mpn: '3PDT latching', datasheet: 'https://aionfx.com/app/files/datasheets/aionfx-3pdt-stomp-switch.pdf', bushing: 'M12x0.75, 11.5 mm', panelHole: 12.5, lugLen: 3.2, nuts: 2 },
});
// SS-12D00 SPDT slide switch: 3 pins Ø0.9 holes at 2.5 mm, body 8.5 x 3.5 x 3.5, handle 1.5 wide.
add({
  id: 'sw_slide_ss12d00', name: 'Slide switch SS12D00 SPDT (vertical, 3 pin)', cat: 'Switches', ref: 'SW', tags: ['slide', 'ss12d00', 'spdt', 'switch'], verify: false,
  desc: 'SS-12D00 SPDT slide switch, vertical actuator: 3 pins at 2.5 mm pitch (Ø0.9 holes per the Vimex drawing), body 8.5 x 3.5, 3.5 mm tall + handle (G3/G4/G5 = 3/4/5 mm handles → ~6.5–8.5 mm total; drawn 7.2). Pin 2 is common.',
  pads: [th1('1', -2.5, 0, 1.6, 0.9), th('2', 0, 0, 1.6, 0.9), th('3', 2.5, 0, 1.6, 0.9)],
  graphics: [silkRect(8.5, 3.5), fabRect(8.5, 3.5), silkRect(1.5, 1.5, -1.8, 0)],
  courtyard: { w: 9.5, h: 4.5 }, refPos: { x: 0, y: 2.7 }, height: 7.2,
  body3d: [rbox(8.5, 3.5, 3.4, C.alu, 0, 0, 0, { r: 0.3 }), { t: 'box', x: 0, y: 0, z: 3.2, w: 5.6, d: 1.5, h: 0.4, color: C.dark }, rbox(1.5, 1.4, 3.4, C.bodyblack, -1.8, 0, 3.4, { r: 0.3 })],
  meta: { mfr: 'generic (Vimex SS-12D00, Shouhan SS12D00G4)', mpn: 'SS12D00G4', datasheet: 'https://www.vimex.com/switches/techdocs/SS12D00-tech.pdf', travel: 2.0 },
});
add({
  id: 'sw_dip_4', name: 'DIP switch 4-position, 2.54 mm slide', cat: 'Switches', ref: 'SW', tags: ['dip', 'dip switch', 'slide', '4'], verify: false,
  desc: '4-way slide DIP switch, 2 x 4 pins on 2.54 mm pitch, 7.62 mm row spacing (KiCad SW_DIP_SPSTx04_Slide_9.78x12.34mm). Body 9.78 x 12.34, ~5.7 mm tall. Pins 1-4 down the −X side pair with 8-5 opposite.',
  pads: [...[0, 1, 2, 3].map(i => (i === 0 ? th1 : th)(String(i + 1), -3.81, 3.81 - i * 2.54, 1.6, 0.8)), ...[0, 1, 2, 3].map(i => th(String(5 + i), 3.81, -3.81 + i * 2.54, 1.6, 0.8))],
  graphics: [silkRect(9.78, 12.34), fabRect(9.78, 12.34), ...[0, 1, 2, 3].map(i => rect(2.4, 1.2, { cx: 0, cy: 3.81 - i * 2.54, layer: FAB, lw: 0.1 })), text(0, 5.5, 'ON', 0.6), text(-5.4, 5.0, '1', 0.6)],
  courtyard: { w: 10.3, h: 13.0 }, refPos: { x: 0, y: 7.4 }, height: 5.7,
  body3d: [rbox(9.78, 12.34, 5.2, C.red, 0, 0, 0, { r: 0.5 }), { t: 'box', x: 0, y: 0, z: 4.9, w: 3.4, d: 11.4, h: 0.5, color: '#7a1010' },
    ...[0, 1, 2, 3].map(i => rbox(2.4, 1.4, 1.0, C.white, -0.5, 3.81 - i * 2.54, 4.9, { r: 0.2 }))],
  meta: { mfr: 'generic (CTS 206-4, Omron A6H)', mpn: 'DS-04 / 206-4', datasheet: 'https://www.ctscorp.com/wp-content/uploads/206-208.pdf' },
});

// =====================================================================================================
// INDICATORS & DISPLAYS
// =====================================================================================================
function ledTHT(id, name, dia, hgt, flangeD, flangeH) {
  return {
    id, name, cat: 'Indicators & Displays', ref: 'D', tags: ['led', 'tht', `${dia}mm`, 'indicator', 'through'], verify: false,
    desc: `${dia} mm through-hole LED, 2.54 mm lead pitch (KiCad LED_D${dia.toFixed(1)}mm), origin on the lens axis, cathode (pin 1, square) at −X on the flat side. Height ${hgt} mm dome top with the flange on the board — raise it on its leads to meet a panel; the through hole is ${(dia + 0.2).toFixed(1)} mm (use a bezel/holder for a clean look).`,
    pads: [th1('1', -1.27, 0, 1.8, 0.9), th('2', 1.27, 0, 1.8, 0.9)],
    graphics: [{ t: 'arc', cx: 0, cy: 0, r: dia / 2 + 0.25, a0: 110, a1: 430, w: V, layer: S }, line(-dia / 2 - 0.05, -Math.sin(70 * Math.PI / 180) * (dia / 2 + 0.25), -dia / 2 - 0.05, Math.sin(70 * Math.PI / 180) * (dia / 2 + 0.25)), circle(dia / 2, 0, 0, 0.1, FAB), text(-2.6, -0.4, 'K', 0.6)],
    courtyard: { w: dia + 1.8, h: dia + 1.4 }, refPos: { x: 0, y: dia / 2 + 1.5 }, height: hgt,
    body3d: (() => { const f = prism(dShaftPts(flangeD, 0.55, 14), flangeH, C.ledred, 0, 0, 0); f.rot = [0, 0, 90]; f.material = 'led';
      return [f, { t: 'cyl', x: 0, y: 0, z: flangeH, d: dia, h: r3(hgt - flangeH - dia / 2), color: C.ledred, material: 'led', seg: 18 },
        dome(dia, C.ledred, 0, 0, r3(hgt - dia / 2), { material: 'led' }),
        lead(-1.27, 0, 0.4, { d: 0.5, below: 2.6, color: C.tin }), lead(1.27, 0, 0.4, { d: 0.5, below: 3.4, color: C.tin })]; })(),
    through: { x: 0, y: 0, d: dia + 0.2 }, throughLabel: 'lens',
    meta: { mfr: 'generic', mpn: `LED ${dia} mm`, lensD: dia, flangeD, panelHole: dia + 0.2, notes: 'no fixed panelDist — LED height is set by how far it is raised on its leads (max ~25 mm)' },
  };
}
add(ledTHT('led_3mm', 'LED 3 mm THT (2.54 pitch)', 3, 5.4, 3.8, 1.0));
add(ledTHT('led_5mm', 'LED 5 mm THT (2.54 pitch)', 5, 8.7, 5.8, 1.0));
add({
  id: 'led_ws2812b_5050', name: 'LED WS2812B 5050 addressable RGB (SMD)', cat: 'Indicators & Displays', ref: 'D', tags: ['led', 'ws2812b', 'neopixel', 'rgb', 'smd', '5050'], verify: false,
  desc: 'WS2812B 5.0 x 5.0 mm PLCC-4 addressable RGB LED (KiCad LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm): pads 1.5 x 0.9 on a 4.9 x 3.3 grid; pin 1 = VDD (top-left, chamfered corner), 2 = DOUT, 3 = GND, 4 = DIN. 1.6 mm tall.',
  pads: [smd('1', -2.45, 1.65, 1.5, 0.9), smd('2', -2.45, -1.65, 1.5, 0.9), smd('3', 2.45, -1.65, 1.5, 0.9), smd('4', 2.45, 1.65, 1.5, 0.9)],
  graphics: [fabRect(5, 5), poly([[-3.5, 2.75], [-3.5, 1.9]], { closed: false }), poly([[3.5, 2.75], [3.5, 1.9]], { closed: false }), poly([[-3.5, -2.75], [-3.5, -1.9]], { closed: false }), poly([[3.5, -2.75], [3.5, -1.9]], { closed: false }), line(-3.5, 2.75, -3.0, 2.75), line(3.5, 2.75, 3.0, 2.75), line(-3.5, -2.75, -3.0, -2.75), line(3.5, -2.75, 3.0, -2.75), line(-2.5, 2.5, -1.7, 2.5, 0.1, FAB), line(-2.5, 2.5, -2.5, 1.7, 0.1, FAB), line(-2.5, 1.7, -1.7, 2.5, 0.1, FAB)],
  courtyard: { w: 6.9, h: 5.5 }, refPos: { x: 0, y: 3.6 }, height: 1.6,
  body3d: [prism(chamfRect(5, 5, 0.9), 1.35, C.white, 0, 0, 0), { t: 'cyl', x: 0, y: 0, z: 1.35, d: 3.9, h: 0.35, color: C.clear, material: 'glass', seg: 18 },
    { t: 'box', x: -0.6, y: 0.5, z: 1.3, w: 1.1, d: 1.0, h: 0.16, color: '#2b3a44' }, { t: 'box', x: 0.7, y: -0.4, z: 1.3, w: 0.7, d: 0.7, h: 0.14, color: '#c8b57a' }],
  meta: { mfr: 'Worldsemi', mpn: 'WS2812B-B', lcsc: 'C2761795', datasheet: 'https://cdn-shop.adafruit.com/datasheets/WS2812B.pdf', pinout: { 1: 'VDD', 2: 'DOUT', 3: 'GND', 4: 'DIN' } },
});
// 0.96" I2C OLED module (4-pin GND/VCC/SCL/SDA). Board 27.3 x 27.8, header on the +Y edge, 4 x Ø2.0 holes (typ 23.5 x 23.8).
add({
  id: 'oled_096_i2c', name: 'OLED module 0.96" 128x64 I2C (4-pin)', cat: 'Indicators & Displays', ref: 'DS', tags: ['oled', 'display', 'ssd1306', 'i2c', 'module', '0.96'], verify: true,
  desc: '0.96" 128x64 SSD1306 I2C module on the ubiquitous 27.3 x 27.8 mm blue/black PCB: 4-pin 2.54 mm header (GND VCC SCL SDA) 1.5 mm from the +Y edge, 4 x Ø2.0 mounting holes drawn on a 23.5 x 23.8 grid (batches differ — most have 4 corner holes, some only 2; measure). Glass 26.7 x 19.3 with the 21.7 x 10.9 active area below the header. Height 7.0 = module hanging on its header (2.54) + PCB + glass.',
  pads: [th1('1', -3.81, 12.4, 1.7, 1.0), th('2', -1.27, 12.4, 1.7, 1.0), th('3', 1.27, 12.4, 1.7, 1.0), th('4', 3.81, 12.4, 1.7, 1.0)],
  holes: [hole(-11.75, 11.9, 2.0), hole(11.75, 11.9, 2.0), hole(-11.75, -11.9, 2.0), hole(11.75, -11.9, 2.0)],
  graphics: [silkRect(27.3, 27.8), fabRect(27.3, 27.8), fabRect(26.7, 19.3, 0, -2.6), rect(21.7, 10.9, { cx: 0, cy: -4.4, layer: FAB, lw: 0.1 }), text(-3.81, 10.6, 'GND', 0.5), text(-1.27, 10.6, 'VCC', 0.5), text(1.27, 10.6, 'SCL', 0.5), text(3.81, 10.6, 'SDA', 0.5)],
  courtyard: { w: 27.8, h: 28.3 }, refPos: { x: 0, y: 14.9 }, height: 7.0,
  body3d: [rbox(10.16, 2.54, 2.54, C.black, 0, 12.4, 0, { r: 0.25 }), ...[-3.81, -1.27, 1.27, 3.81].map(x => lead(x, 12.4, 3.14, { shape: 'square', w: 0.64, below: 3.0, color: C.gold })),
    pcbSlab(27.3, 27.8, 1.2, C.pcbblue, 0, 0, 2.54), rbox(26.7, 19.3, 1.5, '#0b0d10', 0, -2.6, 3.74, { r: 0.4 }),
    glow(21.7, 10.9, 0.08, '#8fd8ff', 0, -4.4, 5.24), { t: 'box', x: 0, y: 6.4, z: 3.74, w: 24, d: 1.2, h: 0.9, color: '#c8a24a' }],
  meta: { mfr: 'generic (Heltec / Winstar-type modules)', mpn: 'GME12864-11 / SSD1306 0.96" I2C', holePattern: '23.5 x 23.8 (typ)', notes: 'hole pattern and header offset vary by batch' },
});
// 16x2 character LCD (WC1602A / HD44780 modules): 80 x 36 board, 16 pins along the +Y edge starting 8 mm from the −X edge,
// 4 x Ø2.5 holes at 75 x 31 (KiCad Display:WC1602A + Wincom drawing).
add({
  id: 'lcd_1602', name: 'LCD 16x2 character module (WC1602A / HD44780)', cat: 'Indicators & Displays', ref: 'DS', tags: ['lcd', '1602', 'hd44780', 'display', 'module', '16x2'], verify: false,
  desc: '16x2 character LCD module 80 x 36 mm: 16-pin 2.54 mm row on the +Y edge (pin 1 at x=−32, 2.5 mm from the edge), 4 x Ø2.5 holes at 75 x 31 mm, bezel 71.2 x 24 (viewing area 64.5 x 16). Module is 13.2 mm thick; height 15.8 assumes it stands on its own 2.54 mm male header soldered into this board (add 6 for 8.5 mm female headers).',
  pads: Array.from({ length: 16 }, (_, i) => ({ name: String(i + 1), x: -32 + i * 2.54, y: 15.5, shape: i === 0 ? 'rect' : 'oval', w: 1.8, h: 2.6, drill: 1.2, layer: 'both' })),
  holes: [hole(-37.5, 15.5, 2.5), hole(37.5, 15.5, 2.5), hole(-37.5, -15.5, 2.5), hole(37.5, -15.5, 2.5)],
  graphics: [silkRect(80, 36), fabRect(80, 36), fabRect(71.2, 24.0, 0, -1.5), rect(64.5, 16.0, { cx: 0, cy: -1.5, layer: FAB, lw: 0.1 }), text(-32, 13.4, '1', 0.7), text(6.1, 13.4, '16', 0.7)],
  courtyard: { w: 80.5, h: 36.5 }, refPos: { x: 0, y: 19.0 }, height: 15.8,
  body3d: [rbox(40.64, 2.54, 2.54, C.black, -12.95, 15.5, 0, { r: 0.25 }), ...Array.from({ length: 16 }, (_, i) => lead(-32 + i * 2.54, 15.5, 3.14, { shape: 'square', w: 0.64, below: 3.0, color: C.gold })),
    pcbSlab(80, 36, 1.6, C.pcbgreen, 0, 0, 2.54), rbox(71.2, 24, 9.4, '#1b1e22', 0, -1.5, 4.14, { r: 0.6 }),
    { t: 'box', x: 0, y: -1.5, z: 13.4, w: 66, d: 17.6, h: 0.3, color: '#101418' }, glow(64.5, 16, 0.12, '#9fe86a', 0, -1.5, 13.7)],
  meta: { mfr: 'Wincom / generic', mpn: 'WC1602A / 1602A', datasheet: 'https://hades.mech.northwestern.edu/images/f/f7/LCD16x2_HJ1602A.pdf', thickness: 13.2, holes: '4 x Ø2.5 at 75 x 31' },
});

// =====================================================================================================
// MODULES — dev boards mounted on 2.54 mm headers (module PCB 2.54 mm above this board on male-header plastic)
// =====================================================================================================
// module USB connector: metal shell with a mouth. dir = +1 → opening faces +Y (the module's far end).
function usbBox(w, d, h, y, z, dir = 1) {
  const ps = shellMouth(w, d, h, Math.max(1.6, w - 2.8), Math.max(0.8, h - 1.3), C.white, 0, dir > 0 ? -y : y, z, C.silver, Math.min(0.8, h * 0.3));
  if (dir > 0) for (const q of ps) q.y = r3(-q.y);
  return ps;
}
add({
  id: 'mod_esp32_c3_supermini', name: 'ESP32-C3 SuperMini (2x8, 15.24 mm rows)', cat: 'Modules', ref: 'U', tags: ['esp32', 'esp32-c3', 'supermini', 'module', 'dev board', 'wifi'], verify: false,
  desc: 'ESP32-C3 SuperMini dev board 18 x 22.5 mm on 2 x 8 pins, 2.54 mm pitch, 15.24 mm (0.6") row spacing (matches the house KiCad footprint ESP32-C3-SuperMini_THT). USB-C at the +Y end (overhangs ~1.3 mm), ceramic antenna at −Y. Numbered DIP-style: 1-8 down the −X column, 9-16 up the +X column. Height 6.8 on its own male header.',
  pads: moduleRows(8, 15.24), graphics: [silkRect(18, 22.5), fabRect(18, 22.5), fabRect(9, 7.35, 0, 8.4), pin1mark(-9.6, 8.89), text(0, 0, 'ESP32-C3', 1.0, { layer: FAB })],
  courtyard: { w: 18.5, h: 25.5 }, refPos: { x: 0, y: 12.6 }, height: 6.8,
  body3d: [...headerSpacers3d(15.24, 8), modBase('c3', 18, 22.5, 1.0), ...usbBox(9, 7.35, 3.2, 8.4, 3.54),
    rbox(13.2, 11.2, 1.0, C.shieldgray, 0, -2.2, 3.54, { r: 0.4 }), { t: 'box', x: 0, y: -9.4, z: 3.54, w: 9.5, d: 3.0, h: 0.12, color: C.gold },
    rbox(2.6, 1.6, 0.9, C.bodyblack, -6.5, 6.5, 3.54, { r: 0.2 }), rbox(2.6, 1.6, 0.9, C.bodyblack, 6.5, 6.5, 3.54, { r: 0.2 })],
  meta: { mfr: 'generic (Tenstar / AITRIP)', mpn: 'ESP32-C3 SuperMini', pcbT: 1.0, rowSpacing: 15.24, notes: 'USB-C 3.2 mm is the tallest part' },
});
add({
  id: 'mod_esp32_s3_zero', name: 'Waveshare ESP32-S3-Zero (2x9, 15.24 mm rows)', cat: 'Modules', ref: 'U', tags: ['esp32', 'esp32-s3', 'waveshare', 'zero', 'module', 'dev board'], verify: false,
  desc: 'Waveshare ESP32-S3-Zero 18 x 23.5 mm on 2 x 9 pins, 2.54 mm pitch, 15.24 mm rows (verified against the published KiCad footprint; also castellated). USB-C at +Y (1.3 mm overhang), WS2812 + BOOT/RESET on top. Numbered DIP-style: 1-9 down −X (5V GND 3V3 IO1-IO6), 10-18 up +X (IO7-IO13, IO44/RX, IO43/TX). Height 6.8 on its own male header.',
  pads: moduleRows(9, 15.24), graphics: [silkRect(18, 23.5), fabRect(18, 23.5), fabRect(9, 7.35, 0, 8.9), pin1mark(-9.6, 10.16), text(0, 0, 'S3-Zero', 1.0, { layer: FAB })],
  courtyard: { w: 18.5, h: 26.5 }, refPos: { x: 0, y: 13.1 }, height: 6.8,
  body3d: [...headerSpacers3d(15.24, 9), modBase('s3', 18, 23.5, 1.0), ...usbBox(9, 7.35, 3.2, 8.9, 3.54),
    rbox(15.0, 12.2, 1.0, C.shieldgray, 0, -2.0, 3.54, { r: 0.4 }), { t: 'box', x: 0, y: -9.9, z: 3.54, w: 9.5, d: 3.0, h: 0.12, color: C.gold },
    ...Array.from({ length: 9 }, (_, i) => 10.16 - i * 2.54).flatMap(y => [-9, 9].map(x => ({ t: 'cyl', x, y, z: 2.54, d: 1.4, h: 1.0, color: C.copper, seg: 8 })))],
  meta: { mfr: 'Waveshare', mpn: 'ESP32-S3-Zero', datasheet: 'https://www.waveshare.com/wiki/ESP32-S3-Zero', pcbT: 1.0, rowSpacing: 15.24 },
});
add({
  id: 'mod_daisy_seed', name: 'Electrosmith Daisy Seed (2x20, 15.24 mm rows)', cat: 'Modules', ref: 'U', tags: ['daisy', 'seed', 'electrosmith', 'audio', 'module', 'dev board', 'stm32h7'], verify: true,
  desc: 'Daisy Seed 18 x 51 mm on 2 x 20 pins, 2.54 mm pitch, 15.24 mm rows (KiCad Module:Electrosmith_Daisy_Seed). Micro-USB at +Y. It has components on BOTH sides, so it must sit on headers (never flush). Height 7.5 = 2.54 header + 1.6 PCB + ~3.4 (USB) — the height figure is an estimate; verify pin 1 corner against the pinout card.',
  pads: moduleRows(20, 15.24, 2.54, 1.7, 1.1), graphics: [silkRect(18, 51), fabRect(18, 51), fabRect(7.5, 5.5, 0, 23.0), pin1mark(-9.6, 24.13), text(0, 0, 'DAISY SEED', 1.0, { rot: 90, layer: FAB })],
  courtyard: { w: 18.5, h: 52.5 }, refPos: { x: 0, y: 26.4 }, height: 7.5,
  body3d: [...headerSpacers3d(15.24, 20), modBase('seed', 18, 51, 1.6, C.pcbgreen), ...usbBox(7.5, 5.5, 2.8, 23.0, 4.14),
    rbox(10, 10, 1.7, '#101215', 0, 6, 4.14, { r: 0.3 }), { t: 'cyl', x: -3.6, y: 9.4, z: 5.84, d: 1.0, h: 0.12, color: '#3d434a', seg: 8 },
    rbox(9, 11, 1.1, '#101215', 0, -8, 4.14, { r: 0.3 }), rbox(4.5, 4, 0.9, '#101215', -5, -20, 4.14, { r: 0.2 }),
    rbox(6, 2.2, 0.9, C.white, 0, -23.6, 4.14, { r: 0.2 })],
  meta: { mfr: 'Electrosmith', mpn: 'Daisy Seed rev7', datasheet: 'https://daisy.nyc3.cdn.digitaloceanspaces.com/products/seed/Daisy_Seed_datasheet_v1.0.6.pdf', pcbT: 1.6, rowSpacing: 15.24, bothSides: true },
});
add({
  id: 'mod_arduino_nano', name: 'Arduino Nano (2x15, 15.24 mm rows)', cat: 'Modules', ref: 'U', tags: ['arduino', 'nano', 'module', 'dev board', 'atmega328'], verify: false,
  desc: 'Arduino Nano / Nano Every 45.7 x 17.8 mm on 2 x 15 pins, 2.54 mm pitch, 15.24 mm rows (KiCad Module:Arduino_Nano_WithMountingHoles), 4 x Ø1.78 holes on the pin-row lines 2.54 mm beyond the rows. Mini-USB at +Y (1.3 mm overhang), 2x3 ICSP header at −Y (tallest thing: 8.5 mm). Height 12.7 with the ICSP header, ~8 without.',
  pads: moduleRows(15, 15.24, 2.54, 1.6, 1.0, 1.27), holes: [hole(-7.62, 21.59, 1.78), hole(7.62, 21.59, 1.78), hole(-7.62, -19.05, 1.78), hole(7.62, -19.05, 1.78)],
  graphics: [silkRect(17.78, 45.72), fabRect(17.78, 45.72), fabRect(7.7, 9.3, 0, 19.0), fabRect(7.62, 5.08, 0, -19.5), pin1mark(-9.6, 19.05), text(0, 0, 'NANO', 1.0, { rot: 90, layer: FAB })],
  courtyard: { w: 18.3, h: 47.5 }, refPos: { x: 0, y: 24.0 }, height: 12.7,
  body3d: [...headerSpacers3d(15.24, 15, 2.54, 2.54, 1.27), modBase('nano', 17.78, 45.72, 1.6, C.pcbblue), ...usbBox(7.7, 9.3, 3.9, 19.0, 4.14),
    rbox(7.62, 5.08, 2.54, C.black, 0, -19.5, 4.14, { r: 0.2 }), ...[-2.54, 0, 2.54].flatMap(x => [-1.27, 1.27].map(y => lead(x, -19.5 + y, 8.54, { shape: 'square', w: 0.64, below: 0, color: C.gold, z: 4.14 }))),
    rbox(7, 7, 1.0, '#101215', 0, 2, 4.14, { r: 0.25 }), rbox(3.4, 2.6, 1.1, '#101215', -5, 10, 4.14, { r: 0.2 }),
    ...[-3, 0, 3].map(x => ({ t: 'box', x, y: 13.5, z: 4.14, w: 1.6, d: 0.9, h: 0.6, color: C.green }))],
  meta: { mfr: 'Arduino', mpn: 'A000005 (Nano) / ABX00028 (Nano Every)', datasheet: 'https://docs.arduino.cc/hardware/nano', pcbT: 1.6, rowSpacing: 15.24 },
});
add({
  id: 'mod_pi_pico', name: 'Raspberry Pi Pico / Pico W / Pico 2 (2x20, 17.78 mm rows)', cat: 'Modules', ref: 'U', tags: ['raspberry pi', 'pico', 'rp2040', 'rp2350', 'module', 'dev board'], verify: false,
  desc: 'Raspberry Pi Pico family 21 x 51 mm on 2 x 20 pins, 2.54 mm pitch, 17.78 mm (0.7") rows (KiCad Module:RaspberryPi_Pico_Common_THT), 4 x Ø2.1 holes at 47 x 11.4 mm. Micro-USB at +Y (1.3 mm overhang), BOOTSEL and 3-pin debug header on top; the castellated SMD pads are not modelled. Height 6.5 on its own male header.',
  pads: moduleRows(20, 17.78, 2.54, 1.7, 1.0), holes: [hole(-5.7, 23.5, 2.1), hole(5.7, 23.5, 2.1), hole(-5.7, -23.5, 2.1), hole(5.7, -23.5, 2.1)],
  graphics: [silkRect(21, 51), fabRect(21, 51), fabRect(7.5, 5.5, 0, 23.0), pin1mark(-10.9, 24.13), text(0, 0, 'PICO', 1.0, { rot: 90, layer: FAB })],
  courtyard: { w: 21.5, h: 52.5 }, refPos: { x: 0, y: 26.4 }, height: 6.5,
  body3d: [...headerSpacers3d(17.78, 20), modBase('pico', 21, 51, 1.0, C.pcbgreen), ...usbBox(7.5, 5.5, 2.9, 23.0, 3.54),
    rbox(7.2, 7.2, 0.9, '#101215', 0, 10, 3.54, { r: 0.25 }), { t: 'cyl', x: -2.6, y: 12.4, z: 4.44, d: 0.9, h: 0.12, color: '#3d434a', seg: 8 },
    rbox(4.4, 3.4, 0.9, '#101215', 0, 2.5, 3.54, { r: 0.2 }), rbox(3.6, 4.2, 1.9, C.white, 0, 15.5, 3.54, { r: 0.35 }),
    ...Array.from({ length: 20 }, (_, i) => 24.13 - i * 2.54).flatMap(y => [-10.5, 10.5].map(x => ({ t: 'cyl', x, y, z: 2.54, d: 1.4, h: 1.0, color: C.copper, seg: 8 })))],
  meta: { mfr: 'Raspberry Pi', mpn: 'SC0915 (Pico) / SC0918 (Pico W) / SC1631 (Pico 2)', datasheet: 'https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf', pcbT: 1.0, rowSpacing: 17.78 },
});
add({
  id: 'mod_wemos_d1_mini', name: 'Wemos / LOLIN D1 mini ESP8266 (2x8, 22.86 mm rows)', cat: 'Modules', ref: 'U', tags: ['wemos', 'lolin', 'd1 mini', 'esp8266', 'module', 'dev board', 'wifi'], verify: true,
  desc: 'D1 mini 25.4 x 34.3 mm on 2 x 8 pins, 2.54 mm pitch, 22.86 mm (0.9") rows (official v4 drawing); micro-USB at −Y, ESP-12F/antenna at +Y, two Ø2.0 holes 2.5 mm in from the sides near the antenna end. The pin rows sit ~8.9 mm from the USB edge (scaled from the drawing, ±0.3 — verify:true for that offset only). Height 7.0 on its own male header.',
  pads: moduleRows(8, 22.86, 2.54, 1.7, 1.0, 0.65), holes: [hole(-10.2, 13.75, 2.0), hole(10.2, 13.75, 2.0)],
  graphics: [silkRect(25.4, 34.3), fabRect(25.4, 34.3), fabRect(16, 24, 0, 5), fabRect(7.5, 5.5, 0, -14.9), pin1mark(-13.4, 9.55), text(0, 0, 'D1 mini', 1.0, { layer: FAB })],
  courtyard: { w: 25.9, h: 35.5 }, refPos: { x: 0, y: 18.0 }, height: 7.0,
  body3d: [...headerSpacers3d(22.86, 8, 2.54, 2.54, 0.65), modBase('d1', 25.4, 34.3, 1.0, C.pcbblue),
    rbox(16, 19, 2.9, C.shieldgray, 0, 2.5, 3.54, { r: 0.4 }), { t: 'box', x: 0, y: 14.2, z: 3.54, w: 12, d: 3.4, h: 0.12, color: C.gold },
    ...usbBox(7.5, 5.5, 2.9, -14.9, 3.54, -1)],
  meta: { mfr: 'LOLIN (Wemos)', mpn: 'D1 mini v4', datasheet: 'https://www.wemos.cc/en/latest/_static/files/dim_d1_mini_v4.0.0.pdf', pcbT: 1.0, rowSpacing: 22.86 },
});

// =====================================================================================================
// MECHANICAL
// =====================================================================================================
add({
  id: 'feet_rubber_pad', name: 'Rubber foot Ø10 x 4 (adhesive bumper)', cat: 'Mechanical', ref: 'H', tags: ['foot', 'feet', 'bumper', 'rubber', 'mechanical'], verify: false,
  desc: 'Self-adhesive rubber bumper Ø10 mm x 4 mm tall (3M SJ5302-type). No pads; keeps a 10.5 mm courtyard clear and shows in 3D — place on the outside face of the bottom board.',
  pads: [], holes: [], graphics: [circle(5.0), circle(5.0, 0, 0, 0.1, FAB)], courtyard: { w: 10.5, h: 10.5 }, refText: false, refPos: { x: 0, y: 6 }, height: 4.0,
  body3d: [cone(10, 9.0, 4, '#151515', 0, 0, 0, 'z', { seg: 22, material: 'rubber' })], meta: { mfr: '3M', mpn: 'SJ5302 (Bumpon)', datasheet: 'https://www.3m.com/3M/en_US/p/d/b40071076/' },
});

}

const STACK_TYPES = [
  {
    id: 'b2b_hdr_lp', name: 'Pin header ↔ low-profile 5.0 mm female', nominalGap: 7.5, minGap: 7.5, maxGap: 9.5,
    lower: ['hdr', ''], upper: ['fhdr', '_lp5'],
    note: 'Male 2.54 mm plastic + 5.0 mm socket = 7.54 nominal. Pin insertion = 13.54 − gap: 6.0 mm at 7.5, 4.0 mm at 9.5. Standard 6 mm male pins are LONGER than the ~4.5 mm socket depth: they bottom out at a ~9.0 mm gap unless trimmed to ~4.5 mm (or use a pass-through socket) — trim them to actually reach 7.5.',
  },
  {
    id: 'b2b_hdr_stack', name: 'Female 8.5 mm ↔ Arduino stackable header (legs through the upper board)', nominalGap: 10.0, minGap: 8.5, maxGap: 11.5,
    lower: ['fhdr', ''], upper: ['shdr', ''],
    note: 'Lower board carries a normal 8.5 mm female header; the upper board carries a stacking header (8.5 mm socket on its top, 10.5 mm legs → 8.9 mm below a 1.6 mm board). Leg tip sits gap − 8.9 above the lower board and enters the 8.5 mm socket 17.4 − gap mm: it can only bottom out at 8.5–8.9 (upper board resting on the socket) if the socket is open right through; typical sockets stop the pin at 7–7.5 mm depth so the boards settle at 9.9–10.4 → use a 10 mm standoff (nominal). Samtec-style 6.35 mm-deep sockets give 11.0; ≥ 6 mm engagement remains up to 11.5. Upper boards ≠ 1.6 mm shift everything by the difference.',
  },
  {
    id: 'b2b_longpin', name: '15 mm long-pin header straight through the upper board (soldered both boards)', nominalGap: 11.0, minGap: 8.0, maxGap: 12.5,
    lower: ['hdr', '_l15'], upper: ['hdr', '_pads'],
    note: 'Male header with 15 mm pins (17.54 mm above the lower board) on the lower board; the pins pass through plain 2.54 mm pads on the upper board and are SOLDERED there — a permanent, very rigid stack (no unplugging). Pin protrusion above the upper board = 17.54 − gap − t: 4.9 mm at 11.0/1.6, 7.9 at 8.0, 3.4 at 12.5 (keep ≥ 1.5 mm for the solder joint). Gap set by standoffs; 11 mm is the stock length that also clears 8.5 mm sockets elsewhere on the boards.',
  },
  {
    id: 'b2b_pinstrip', name: 'Female ↔ female with a double-ended pin strip', nominalGap: 19.5, minGap: 19.5, maxGap: 22,
    lower: ['fhdr', ''], upper: ['fhdr', ''],
    note: '8.5 mm female on both boards joined by a male-male pin strip (2.54 plastic + 6 mm pins each side): 8.5 + 2.54 + 8.5 = 19.5 nominal; ≥4 mm engagement up to 22. Use when tall parts (jacks, footswitches) sit between the boards.',
  },
];

// ---------- emit ----------
const nn2 = "${String(n).padStart(2, '0')}";
// Silk text below 1.0 mm cap height does not print reliably (JLC minimum) — bump pin markers up.
for (const part of PARTS) for (const g of part.graphics || []) {
  if (g.t === 'text' && (g.layer || 'F.Silk').endsWith('.Silk') && g.size < 1.0) { g.size = 1.0; if ((g.thickness || 0) < 0.15) g.thickness = 0.15; }
}
let out = `// GENERATED by tools/build_hardware_lib.mjs — do not edit by hand (edit the generator, then: node tools/build_hardware_lib.mjs).
// Pads: KiCad-sourced parts (K(...) entries) load lib-src/kicad/*.kicad_mod verbatim (official KiCad footprint library,
// CC-BY-SA 4.0 with the KiCad Libraries Exception); the researched parts (M(...) block) were typed from the same KiCad
// footprints / JLCPCB-EasyEDA footprints / manufacturer drawings — sources in each part's meta. Heights, bushings,
// panel distances and 3D bodies are LAMINA additions; verify:true marks parts with unverified numbers (see desc).
export const HARDWARE_PARTS = ${JSON.stringify(PARTS)};
export const HARDWARE_STACK_TYPES = [
${STACK_TYPES.map(t => `  { id: ${JSON.stringify(t.id)}, name: ${JSON.stringify(t.name)}, nominalGap: ${t.nominalGap}, minGap: ${t.minGap}, maxGap: ${t.maxGap}, lowerGen: (r, n) => \`${t.lower[0]}_\${r}x\${String(n).padStart(2, '0')}${t.lower[1]}\`, upperGen: (r, n) => \`${t.upper[0]}_\${r}x\${String(n).padStart(2, '0')}${t.upper[1]}\`, note: ${JSON.stringify(t.note)} },`).join('\n')}
];
`;
fs.writeFileSync(path.join(root, 'js', 'lib', 'parts_hardware.js'), out);
console.log(`wrote js/lib/parts_hardware.js: ${PARTS.length} parts, ${STACK_TYPES.length} stack types, ${(out.length / 1024).toFixed(0)} kB`);
