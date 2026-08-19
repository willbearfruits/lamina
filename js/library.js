// LAMINA parts library — footprint definitions + parametric generators.
// Footprint schema: see docs/LIBRARY.md. All dims mm, local frame centred on the part origin,
// X right, Y up, pads/graphics as seen from the TOP of the board the part sits on.
import { HARDWARE_PARTS, HARDWARE_STACK_TYPES } from './lib/parts_hardware.js';
export { HARDWARE_STACK_TYPES };

export const CATEGORIES = ['Mechanical', 'Connectors', 'Jacks & Power', 'Controls', 'Switches', 'Indicators & Displays', 'Modules', 'Passives', 'ICs', 'Imported'];

const REG = new Map();
export function registerPart(def) { if (!def || !def.id) return; REG.set(def.id, def); return def; }
export function allParts() { return Array.from(REG.values()); }
export function partsByCategory() { const m = {}; for (const c of CATEGORIES) m[c] = []; for (const p of REG.values()) (m[p.cat] ||= []).push(p); return m; }
export function searchParts(q) { q = (q || '').toLowerCase().trim(); if (!q) return allParts(); return allParts().filter(p => (p.id + ' ' + p.name + ' ' + (p.desc || '') + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(q)); }

// ---------------- helpers ----------------
const S = 'F.Silk', FAB = 'F.Fab';
const silkRect = (w, h, lw = 0.15) => ({ t: 'rect', cx: 0, cy: 0, w, h, filled: false, lw, layer: S });
const fabRect = (w, h) => ({ t: 'rect', cx: 0, cy: 0, w, h, filled: false, lw: 0.1, layer: FAB });
// --- 3D primitives (body3d — see docs/LIBRARY.md for the full vocabulary) ---
const box = (w, d, h, color, x = 0, y = 0, z = 0) => ({ t: 'box', x, y, z, w, d, h, color });
const cyl = (d, h, color, x = 0, y = 0, z = 0, axis = 'z') => ({ t: 'cyl', x, y, z, d, h, color, axis });
export const COLORS = { black: '#1a1a1a', plastic: '#222', gold: '#c9a227', silver: '#b8b8b8', tin: '#c8ccd0', white: '#eee', red: '#c62828', blue: '#1e63c6', green: '#2e7d32', brass: '#b5a642', pcbgreen: '#0f6b3a', tan: '#c8b18a', gray: '#777', darkgray: '#444', copper: '#b87333', yellow: '#e0c341', ledred: '#ff3b30', clear: '#dfe', chrome: '#cfd4d8', alu: '#a8adb2', bodyblack: '#242629', dark: '#08090b', capblue: '#1b4a9c' };
const rbox = (w, d, h, color, x = 0, y = 0, z = 0, r, bevel) => { const o = { t: 'rbox', x, y, z, w, d, h, r: r ?? Math.min(0.35, w / 8, d / 8), color }; if (bevel) o.bevel = bevel; return o; };
const cone = (d, d2, h, color, x = 0, y = 0, z = 0, axis = 'z', seg) => { const o = { t: 'cyl', x, y, z, d, d2, h, color, axis }; if (seg) o.seg = seg; return o; };
const seg = (d, h, color, x, y, z, axis, s) => ({ t: 'cyl', x, y, z, d, h, color, axis, seg: s });
const ring = (d, th, color, x = 0, y = 0, z = 0, axis) => { const o = { t: 'torus', x, y, z, d, thickness: th, color }; if (axis && axis !== 'z') o.axis = axis; return o; };
const dome = (d, color, x = 0, y = 0, z = 0, cut = 'bottom') => ({ t: 'sphere', x, y, z, d, cut, color });
const prism = (pts, h, color, x = 0, y = 0, z = 0, rot) => { const o = { t: 'prism', x, y, z, pts, h, color }; if (rot) o.rot = rot; return o; };
const pin = (x, y, len, o = {}) => { const p = { t: 'pin', x, y, len, below: o.below ?? 2.2, color: o.color || COLORS.tin }; if (o.shape) p.shape = o.shape; if (o.d) p.d = o.d; if (o.w) p.w = o.w; if (o.d2) p.d2 = o.d2; if (o.z) p.z = o.z; return p; };
// circle Ø d with a flat `flat` mm deep on the +Y side (D shafts, LED flange, TO-92)
const dPts = (d, flat, n = 14) => { const r = d / 2, a = Math.acos(Math.max(-0.99, Math.min(0.99, (r - flat) / r))), pts = []; for (let i = 0; i <= n; i++) { const t = a + (2 * Math.PI - 2 * a) * i / n; pts.push([r * Math.sin(t), r * Math.cos(t)]); } return pts; };
// thin curved band hugging a cylinder of radius r (electrolytic polarity stripe)
const arcBandPts = (r, a0, a1, t, n = 8) => { const o = [], i2 = []; for (let k = 0; k <= n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; o.push([r * Math.cos(a), r * Math.sin(a)]); i2.push([(r - t) * Math.cos(a), (r - t) * Math.sin(a)]); } return o.concat(i2.reverse()); };
const V = 0.15; // default silk width

// ---------------- parametric generators ----------------
function pinHeader(rows, n, opts = {}) {
  const pitch = 2.54, female = !!opts.female, rightAngle = !!opts.ra;
  const w = rows * pitch, h = n * pitch;
  const pads = [];
  let k = 1;
  const x0 = -(rows - 1) * pitch / 2, y0 = (n - 1) * pitch / 2;
  for (let i = 0; i < n; i++) for (let r = 0; r < rows; r++) {
    // KiCad numbering for 2-row headers: 1,2 across a row, then next row
    pads.push({ name: String(k), x: x0 + r * pitch, y: y0 - i * pitch, shape: k === 1 ? 'rect' : 'oval', w: 1.7, h: 1.7, drill: 1.0, layer: 'both' });
    k++;
  }
  const bodyH = female ? 8.5 : 2.54;
  const id = `${female ? 'fhdr' : 'hdr'}_${rows}x${String(n).padStart(2, '0')}${rightAngle ? '_ra' : ''}`;
  const graphics = [silkRect(w, h), fabRect(w, h),
    { t: 'line', x1: -w / 2 - 0.3, y1: y0 + pitch / 2 + 0.3, x2: -w / 2 - 0.3, y2: y0 - pitch / 2, w: V, layer: S }, // pin-1 tick
    { t: 'line', x1: -w / 2 - 0.3, y1: y0 + pitch / 2 + 0.3, x2: x0 + pitch / 2 - 0.5, y2: y0 + pitch / 2 + 0.3, w: V, layer: S }];
  const body3d = female
    ? [rbox(w, h, bodyH, COLORS.black, 0, 0, 0, 0.25),
      ...pads.map(p => box(1.65, 1.65, 1.1, COLORS.dark, p.x, p.y, bodyH - 1.0)),
      ...pads.map(p => pin(p.x, p.y, 0.05, { shape: 'square', w: 0.62, below: 2.6, color: COLORS.tin }))]
    : [rbox(w, h, 2.54, COLORS.black, 0, 0, 0, 0.25),
      ...pads.map(p => pin(p.x, p.y, 6.0 + 2.54, { shape: 'square', w: 0.64, below: 3.0, color: COLORS.gold }))];
  return {
    id, name: `${female ? 'Female' : 'Pin'} header ${rows}×${n} 2.54 mm`, cat: 'Connectors', ref: 'J', tags: ['header', 'pin', 'connector', female ? 'socket' : 'male'],
    pads, graphics, courtyard: { w: w + 0.5, h: h + 0.5 }, refPos: { x: 0, y: h / 2 + 1.2 }, height: female ? 8.5 : 8.54, body3d,
    desc: female ? 'Female socket header 8.5 mm body' : 'Male pin header, 2.54 plastic + 6.0 pin above', meta: { pinLenAbove: 6.0, plastic: 2.54, socketDepth: 8.5 },
  };
}
function dip(n, width = 7.62) {
  const pitch = 2.54, per = n / 2, len = per * pitch;
  const pads = [];
  for (let i = 0; i < per; i++) pads.push({ name: String(i + 1), x: -width / 2, y: (per - 1) * pitch / 2 - i * pitch, shape: i === 0 ? 'rect' : 'oval', w: 1.6, h: 1.6, drill: 0.8, layer: 'both' });
  for (let i = 0; i < per; i++) pads.push({ name: String(per + i + 1), x: width / 2, y: -(per - 1) * pitch / 2 + i * pitch, shape: 'oval', w: 1.6, h: 1.6, drill: 0.8, layer: 'both' });
  const bw = width - 1.5, bh = len;
  const graphics = [silkRect(bw, bh), { t: 'arc', cx: 0, cy: bh / 2, r: 1, a0: 180, a1: 360, w: V, layer: S }, fabRect(bw, bh)];
  return { id: `dip_${n}${width > 8 ? '_w' : ''}`, name: `DIP-${n} ${width === 7.62 ? '7.62' : '15.24'} mm`, cat: 'ICs', ref: 'U', tags: ['dip', 'ic', 'socket'], pads, graphics, courtyard: { w: width + 2.2, h: bh + 1 }, refPos: { x: 0, y: bh / 2 + 1.5 }, height: 4.5, body3d: [
    rbox(bw, bh, 3.4, COLORS.bodyblack, 0, 0, 0.6, 0.3),
    seg(1.9, 0.45, '#0b0c0e', 0, bh / 2 - 0.35, 3.75, 'z', 12),                                   // pin-1 notch in the end wall
    seg(1.0, 0.3, '#0b0c0e', -bw / 2 + 1.4, bh / 2 - 1.4, 3.85, 'z', 10),                  // pin-1 dimple
    ...pads.map(p => box((width - bw) / 2 + 0.35, 0.52, 0.3, COLORS.tin, (p.x > 0 ? 1 : -1) * (bw + width) / 4, p.y, 2.35)),
    ...pads.map(p => pin(p.x, p.y, 2.45, { shape: 'square', w: 0.46, d: 0.3, below: 2.0, color: COLORS.tin })),
  ] };
}
function soic(n, pitch = 1.27, bodyW = 3.9, span = 5.4, padW = 1.55, padH = 0.6) {
  const per = n / 2, pads = [];
  const bodyL = per * pitch + 0.5;
  for (let i = 0; i < per; i++) pads.push({ name: String(i + 1), x: -span / 2, y: (per - 1) * pitch / 2 - i * pitch, shape: 'roundrect', w: padW, h: padH, drill: 0, layer: 'F' });
  for (let i = 0; i < per; i++) pads.push({ name: String(per + i + 1), x: span / 2, y: -(per - 1) * pitch / 2 + i * pitch, shape: 'roundrect', w: padW, h: padH, drill: 0, layer: 'F' });
  const graphics = [fabRect(bodyW, bodyL), { t: 'line', x1: -bodyW / 2, y1: bodyL / 2 + 0.2, x2: bodyW / 2, y2: bodyL / 2 + 0.2, w: V, layer: S }, { t: 'line', x1: -bodyW / 2, y1: -bodyL / 2 - 0.2, x2: bodyW / 2, y2: -bodyL / 2 - 0.2, w: V, layer: S }, { t: 'circle', cx: -span / 2 - padW / 2 - 0.5, cy: (per - 1) * pitch / 2, r: 0.2, w: 0, layer: S }];
  return { id: `soic_${n}`, name: `SOIC-${n} 1.27 mm`, cat: 'ICs', ref: 'U', tags: ['soic', 'smd', 'ic'], pads, graphics, courtyard: { w: span + padW + 0.5, h: bodyL + 0.5 }, refPos: { x: 0, y: bodyL / 2 + 1.2 }, height: 1.75, body3d: [
    rbox(bodyW, bodyL, 1.0, COLORS.bodyblack, 0, 0, 0.15, 0.12),
    seg(0.55, 0.14, '#3a3d42', -bodyW / 2 + 0.55, bodyL / 2 - 0.55, 1.12, 'z', 8),
    ...pads.map(p => box(0.4, padH * 0.85, 0.62, COLORS.tin, (p.x > 0 ? 1 : -1) * (bodyW / 2 + 0.2), p.y, 0.1)),
    ...pads.map(p => box((span - bodyW) / 2 - 0.1, padH * 0.85, 0.16, COLORS.tin, (p.x > 0 ? 1 : -1) * (bodyW + span) / 4, p.y, 0.04)),
  ] };
}
function chip(code, kind) {
  const dims = { '0402': [1.0, 0.5, 0.6, 0.6, 0.5], '0603': [1.6, 0.8, 0.9, 0.95, 0.8], '0805': [2.0, 1.25, 1.15, 1.45, 1.0], '1206': [3.2, 1.6, 1.15, 1.8, 2.0], '2512': [6.3, 3.2, 1.6, 3.4, 4.9] }[code];
  const [L, W, padW, padH, gap] = dims;
  const px = (gap + padW) / 2;
  const isC = kind === 'C';
  return {
    id: `${kind.toLowerCase()}_${code}`, name: `${isC ? 'Capacitor' : kind === 'L' ? 'Inductor' : kind === 'D' ? 'Diode/LED' : 'Resistor'} ${code} SMD`, cat: 'Passives', ref: kind, tags: ['smd', code, 'chip'],
    pads: [{ name: '1', x: -px, y: 0, shape: 'roundrect', w: padW, h: padH, drill: 0, layer: 'F' }, { name: '2', x: px, y: 0, shape: 'roundrect', w: padW, h: padH, drill: 0, layer: 'F' }],
    graphics: [fabRect(L, W), { t: 'line', x1: -gap / 2 + 0.2, y1: W / 2 + 0.25, x2: gap / 2 - 0.2, y2: W / 2 + 0.25, w: 0.15, layer: S }, { t: 'line', x1: -gap / 2 + 0.2, y1: -W / 2 - 0.25, x2: gap / 2 - 0.2, y2: -W / 2 - 0.25, w: 0.15, layer: S }],
    courtyard: { w: gap + 2 * padW + 0.5, h: padH + 0.5 }, refPos: { x: 0, y: W / 2 + 1.1 }, height: 0.6, body3d: (() => { const bh = isC ? 0.85 : 0.5, cw = Math.min(0.35, L * 0.22);
      return [box(L - 2 * cw, W, bh, isC ? COLORS.tan : '#23272b', 0, 0, 0.02),
        box(cw, W, bh, COLORS.tin, -(L - cw) / 2, 0, 0.02), box(cw, W, bh, COLORS.tin, (L - cw) / 2, 0, 0.02)]; })(),
  };
}
function axial(pitchIn, name, id, bodyL, bodyD, drill = 0.8, pad = 1.6, ref = 'R', color = COLORS.tan) {
  const p = pitchIn * 2.54;
  return { id, name, cat: 'Passives', ref, tags: ['tht', 'axial'], pads: [{ name: '1', x: -p / 2, y: 0, shape: 'rect', w: pad, h: pad, drill, layer: 'both' }, { name: '2', x: p / 2, y: 0, shape: 'oval', w: pad, h: pad, drill, layer: 'both' }],
    graphics: [silkRect(bodyL, bodyD), { t: 'line', x1: -p / 2 + pad / 2 + 0.3, y1: 0, x2: -bodyL / 2, y2: 0, w: V, layer: S }, { t: 'line', x1: p / 2 - pad / 2 - 0.3, y1: 0, x2: bodyL / 2, y2: 0, w: V, layer: S }],
    courtyard: { w: p + pad + 0.5, h: bodyD + 0.5 }, refPos: { x: 0, y: bodyD / 2 + 1.1 }, height: bodyD + 0.5,
    body3d: (() => {
      const zc = bodyD / 2, cap = 0.55, core = bodyL - 2 * cap, run = Math.max(0.2, (p - bodyL) / 2);
      const bands = ref === 'D'
        ? [['#f0f0f0', bodyL * 0.30]]                                                     // cathode band
        : [['#4a3520', -bodyL * 0.24], ['#c62828', -bodyL * 0.08], ['#e0c341', bodyL * 0.08], ['#b8a06a', bodyL * 0.28]];
      return [
        seg(bodyD, core, color, 0, 0, zc, 'x', 16),
        cone(bodyD * 0.7, bodyD, cap, color, -(core + cap) / 2, 0, zc, 'x', 14),
        cone(bodyD, bodyD * 0.7, cap, color, (core + cap) / 2, 0, zc, 'x', 14),
        ...bands.map(([c, bx]) => seg(bodyD + 0.05, bodyD * 0.22, c, bx, 0, zc, 'x', 16)),
        seg(0.55, run, COLORS.tin, -(bodyL + run) / 2, 0, zc, 'x', 8),
        seg(0.55, run, COLORS.tin, (bodyL + run) / 2, 0, zc, 'x', 8),
        pin(-p / 2, 0, zc, { d: 0.55, below: 2.2, color: COLORS.tin }), pin(p / 2, 0, zc, { d: 0.55, below: 2.2, color: COLORS.tin }),
      ];
    })() };
}
function radialCap(pitch, d, id, name) {
  return { id, name, cat: 'Passives', ref: 'C', tags: ['tht', 'radial', 'electrolytic'], pads: [{ name: '1', x: -pitch / 2, y: 0, shape: 'rect', w: 1.6, h: 1.6, drill: 0.8, layer: 'both' }, { name: '2', x: pitch / 2, y: 0, shape: 'oval', w: 1.6, h: 1.6, drill: 0.8, layer: 'both' }],
    graphics: [{ t: 'circle', cx: 0, cy: 0, r: d / 2, w: V, layer: S }, { t: 'text', x: -pitch / 2, y: d / 2 + 1.0, text: '+', size: 1.0, thickness: 0.15, layer: S }], courtyard: { w: d + 0.6, h: d + 0.6 }, refPos: { x: 0, y: d / 2 + 1.8 }, height: d * 1.4,
    body3d: (() => { const H = d * 1.4, s = Math.max(14, Math.min(26, Math.round(d * 3)));
      return [
        seg(d - 0.4, 0.7, '#14161c', 0, 0, 0, 'z', s),                                    // rubber bung
        seg(d, H - 0.85, COLORS.capblue, 0, 0, 0.7, 'z', s),
        ring(d + 0.06, 0.5, '#12356f', 0, 0, H - 1.5),                                    // crimp groove
        seg(d - 0.5, 0.18, '#8a9099', 0, 0, H - 0.18, 'z', s),                            // aluminium top
        box(d * 0.8, 0.3, 0.1, '#5d636b', 0, 0, H - 0.05), box(0.3, d * 0.8, 0.1, '#5d636b', 0, 0, H - 0.05),  // top cross score
        prism(arcBandPts(d / 2 + 0.04, -52, 52, 0.32), H - 1.6, '#e4e8ee', 0, 0, 0.7),    // '-' polarity stripe (pin 2 side)
      ]; })() };
}
function ceramicCap(pitch, id, name) {
  return { id, name, cat: 'Passives', ref: 'C', tags: ['tht', 'ceramic', 'film'], pads: [{ name: '1', x: -pitch / 2, y: 0, shape: 'rect', w: 1.6, h: 1.6, drill: 0.8, layer: 'both' }, { name: '2', x: pitch / 2, y: 0, shape: 'oval', w: 1.6, h: 1.6, drill: 0.8, layer: 'both' }],
    graphics: [silkRect(pitch + 1.5, 3), fabRect(pitch + 1.5, 3)], courtyard: { w: pitch + 2.5, h: 3.6 }, refPos: { x: 0, y: 2.6 }, height: 5,
    body3d: [rbox(pitch + 1.2, 2.6, 4.0, COLORS.yellow, 0, 0, 0.8, Math.min(1.1, (pitch + 1.2) / 4), 0.25),
      pin(-pitch / 2, 0, 0.85, { d: 0.5, below: 2.2 }), pin(pitch / 2, 0, 0.85, { d: 0.5, below: 2.2 })] };
}
function to92() {
  return { id: 'to92', name: 'TO-92 (inline 2.54)', cat: 'ICs', ref: 'Q', tags: ['tht', 'transistor', 'to92', 'regulator'], pads: [{ name: '1', x: -2.54, y: 0, shape: 'rect', w: 1.5, h: 1.5, drill: 0.75, layer: 'both' }, { name: '2', x: 0, y: 0, shape: 'oval', w: 1.5, h: 1.5, drill: 0.75, layer: 'both' }, { name: '3', x: 2.54, y: 0, shape: 'oval', w: 1.5, h: 1.5, drill: 0.75, layer: 'both' }],
    graphics: [{ t: 'arc', cx: 0, cy: 0, r: 2.6, a0: 200, a1: 340, w: V, layer: S }, { t: 'line', x1: -2.45, y1: -0.9, x2: 2.45, y2: -0.9, w: V, layer: S }], courtyard: { w: 6, h: 6 }, refPos: { x: 0, y: 3.5 }, height: 5.5,
    body3d: [prism(dPts(4.8, 1.35, 14), 0.6, '#15171a', 0, 0.55, 0, [0, 0, 180]),
      prism(dPts(4.8, 1.35, 14), 3.9, COLORS.bodyblack, 0, 0.55, 0.6, [0, 0, 180]),
      cone(4.6, 3.4, 0.6, COLORS.bodyblack, 0, 0.55, 4.5, 'z', 16),
      ...[-2.54, 0, 2.54].map(x => pin(x, 0, 0.7, { d: 0.5, below: 2.4, color: COLORS.tin }))] };
}
function sot23() {
  return { id: 'sot23', name: 'SOT-23', cat: 'ICs', ref: 'Q', tags: ['smd', 'sot23', 'transistor'], pads: [{ name: '1', x: -0.95, y: -1.0, shape: 'roundrect', w: 0.6, h: 1.0, drill: 0, layer: 'F' }, { name: '2', x: 0.95, y: -1.0, shape: 'roundrect', w: 0.6, h: 1.0, drill: 0, layer: 'F' }, { name: '3', x: 0, y: 1.0, shape: 'roundrect', w: 0.6, h: 1.0, drill: 0, layer: 'F' }],
    graphics: [fabRect(1.3, 2.9)], courtyard: { w: 3.2, h: 3.4 }, refPos: { x: 0, y: 2.3 }, height: 1.1,
    body3d: [rbox(1.3, 2.9, 0.95, COLORS.bodyblack, 0, 0, 0.14, 0.12),
      box(0.4, 0.5, 0.55, COLORS.tin, -0.85, -1.0, 0.08), box(0.4, 0.5, 0.55, COLORS.tin, 0.85, -1.0, 0.08), box(0.4, 0.5, 0.55, COLORS.tin, 0, 1.0, 0.08)] };
}
function mountHole(thread, holeD, ringD) {
  return { id: `mount_${thread.toLowerCase().replace('.', '')}`, name: `Mounting hole ${thread} (Ø${holeD})`, cat: 'Mechanical', ref: 'H', tags: ['hole', 'mount', 'screw', thread], pads: [], holes: [{ x: 0, y: 0, d: holeD }],
    graphics: [{ t: 'circle', cx: 0, cy: 0, r: ringD / 2, w: V, layer: S }], courtyard: { w: ringD + 0.5, h: ringD + 0.5 }, refText: false, height: 0, body3d: [], holeD, meta: { thread } };
}
function mountHolePlated(thread, holeD, ringD) {
  return { id: `mount_${thread.toLowerCase().replace('.', '')}_pth`, name: `Mounting hole ${thread} plated (Ø${holeD}, ring Ø${ringD})`, cat: 'Mechanical', ref: 'H', tags: ['hole', 'mount', 'pth', thread], pads: [{ name: '1', x: 0, y: 0, shape: 'circle', w: ringD, h: ringD, drill: holeD, layer: 'both' }],
    graphics: [], courtyard: { w: ringD + 0.5, h: ringD + 0.5 }, refText: false, height: 0, body3d: [], holeD, meta: { thread } };
}
function standoff(thread, holeD, af) {
  return { id: `standoff_${thread.toLowerCase().replace('.', '')}`, name: `Standoff ${thread} (hex ${af} AF)`, cat: 'Mechanical', ref: 'H', tags: ['standoff', 'spacer', thread], pads: [], holes: [{ x: 0, y: 0, d: holeD }],
    graphics: [{ t: 'circle', cx: 0, cy: 0, r: af / 2 * 1.1, w: V, layer: S }], courtyard: { w: af + 1, h: af + 1 }, refText: false, height: 0, body3d: [], holeD, hexAF: af, isStandoff: true, meta: { thread, lengths: [3, 4, 5, 6, 8, 10, 11, 12, 15, 18, 20, 25, 30] } };
}

// ---------------- registration ----------------
[mountHole('M2', 2.2, 4.5), mountHole('M2.5', 2.7, 5.5), mountHole('M3', 3.2, 6.5), mountHole('M4', 4.3, 8),
 mountHolePlated('M2.5', 2.7, 5.0), mountHolePlated('M3', 3.2, 6.0),
 standoff('M2', 2.2, 4), standoff('M2.5', 2.7, 5), standoff('M3', 3.2, 5.5),
 dip(8), dip(14), dip(16), dip(18), dip(20), dip(28, 15.24), dip(40, 15.24),
 soic(8), soic(14), soic(16), to92(), sot23(),
 chip('0402', 'R'), chip('0603', 'R'), chip('0805', 'R'), chip('1206', 'R'), chip('2512', 'R'), chip('0402', 'C'), chip('0603', 'C'), chip('0805', 'C'), chip('1206', 'C'), chip('0805', 'L'), chip('0805', 'D'), chip('1206', 'D'),
 axial(4, 'Resistor axial 0.4" (10.16 mm)', 'r_axial_10', 6.5, 2.5), axial(3, 'Resistor axial 0.3" (7.62 mm)', 'r_axial_7', 6.0, 2.3), axial(5, 'Resistor axial 0.5" (12.7 mm) 1W', 'r_axial_12', 9, 3.5, 0.9, 1.8),
 axial(3, 'Diode axial DO-35 0.3"', 'd_do35', 4.0, 2.0, 0.8, 1.6, 'D', COLORS.gray), axial(4, 'Diode axial DO-41 0.4"', 'd_do41', 5.2, 2.7, 1.0, 1.9, 'D', COLORS.black),
 radialCap(2.5, 5, 'cp_r_5x11', 'Electrolytic cap Ø5 P2.5'), radialCap(2.5, 6.3, 'cp_r_6x11', 'Electrolytic cap Ø6.3 P2.5'), radialCap(3.5, 8, 'cp_r_8x11', 'Electrolytic cap Ø8 P3.5'), radialCap(5, 10, 'cp_r_10x16', 'Electrolytic cap Ø10 P5'),
 ceramicCap(2.5, 'c_th_2.5', 'Ceramic/film cap P2.5'), ceramicCap(5.0, 'c_th_5', 'Ceramic/film cap P5.0'), ceramicCap(7.5, 'c_th_7.5', 'Film cap P7.5'),
 pinHeader(1, 2), pinHeader(1, 3), pinHeader(1, 4), pinHeader(1, 5), pinHeader(1, 6), pinHeader(1, 8), pinHeader(1, 10), pinHeader(1, 12), pinHeader(1, 15), pinHeader(1, 16), pinHeader(1, 20),
 pinHeader(2, 3), pinHeader(2, 4), pinHeader(2, 5), pinHeader(2, 8), pinHeader(2, 10), pinHeader(2, 20),
 pinHeader(1, 4, { female: true }), pinHeader(1, 6, { female: true }), pinHeader(1, 8, { female: true }), pinHeader(1, 10, { female: true }), pinHeader(1, 15, { female: true }), pinHeader(1, 16, { female: true }), pinHeader(1, 20, { female: true }), pinHeader(2, 8, { female: true }), pinHeader(2, 20, { female: true }),
].forEach(registerPart);
for (const p of HARDWARE_PARTS) registerPart(p);

// ---------------- stack connector pairs ----------------
// pair = { lower: <lib id on lower board top side>, upper: <lib id on upper board bottom side>, nominalGap, minGap, maxGap }
export const STACK_CONNECTOR_TYPES = [
  { id: 'b2b_hdr', name: 'Pin header ↔ female header (8.5 mm)', nominalGap: 11.0, minGap: 10.5, maxGap: 12.5, lowerGen: (r, n) => `hdr_${r}x${String(n).padStart(2, '0')}`, upperGen: (r, n) => `fhdr_${r}x${String(n).padStart(2, '0')}`, note: 'Male 2.54 plastic + 8.5 socket body = 11.0 nominal; pins engage 6 mm at 11.0, ≥4 mm up to 12.5.' },
];
export function stackConnector(id) {
  // id like b2b_hdr_1x08 (optionally _lp etc.)
  const m = /^(b2b_[a-z_]+?)_(\d)x(\d+)$/.exec(id); if (!m) return null;
  const type = STACK_CONNECTOR_TYPES.find(t => t.id === m[1]) || HARDWARE_STACK_TYPES.find(t => t.id === m[1]);
  if (!type) return null;
  const rows = +m[2], n = +m[3];
  return { id, name: `${type.name} ${rows}×${n}`, cat: 'Connectors', pair: { lower: type.lowerGen(rows, n), upper: type.upperGen(rows, n), nominalGap: type.nominalGap, minGap: type.minGap, maxGap: type.maxGap }, note: type.note, isStackConnector: true };
}

// ---------------- lookup (registry + generators) ----------------
export function getFootprint(id, part) {
  if (!id) return null;
  if (REG.has(id)) return REG.get(id);
  let m;
  if ((m = /^(f?hdr)_(\d)x(\d+)(_ra)?$/.exec(id))) { const d = pinHeader(+m[2], +m[3], { female: m[1] === 'fhdr', ra: !!m[4] }); return registerPart(d); }
  if ((m = /^dip_(\d+)(_w)?$/.exec(id))) return registerPart(dip(+m[1], m[2] ? 15.24 : 7.62));
  if ((m = /^soic_(\d+)$/.exec(id))) return registerPart(soic(+m[1]));
  if (id.startsWith('b2b_')) return stackConnector(id);
  return null;
}
export function partRefPrefix(lib) { const fp = getFootprint(lib); return fp?.ref || 'X'; }
export function stackConnectorOptions() {
  const out = [];
  for (const t of [...STACK_CONNECTOR_TYPES, ...HARDWARE_STACK_TYPES]) for (const [r, n] of [[1, 4], [1, 6], [1, 8], [1, 10], [1, 12], [1, 15], [1, 16], [1, 20], [2, 8], [2, 10], [2, 20]]) out.push(stackConnector(`${t.id}_${r}x${String(n).padStart(2, '0')}`));
  return out.filter(Boolean);
}
