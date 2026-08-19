// Representative documents for exporter tests (node, no DOM).
import { newDocument, makeItem, addMountingHoles, addStackStandoffs, uid } from '../js/model.js';

export function twoBoardDoc() {
  const doc = newDocument({ name: 'fixture-two', two: true, w: 100, h: 60, r: 3, color: 'black', color2: 'red', gap: 11 });
  const [main, panel] = doc.boards;
  addStackStandoffs(doc, { inset: 4 });
  doc.stack.links.push({ id: uid('L'), kind: 'connector', lib: 'b2b_hdr_1x08', ref: 'J1', x: 50, y: 8, rot: 90, opts: {} });
  main.items.push(makeItem('part', { lib: 'dip_8', ref: 'U1', value: 'TL072', x: 30, y: 30, rot: 0, side: 'top' }));
  main.items.push(makeItem('part', { lib: 'r_0805', ref: 'R1', value: '10k', x: 45, y: 30, rot: 90, side: 'top' }));
  main.items.push(makeItem('part', { lib: 'r_axial_10', ref: 'R2', value: '1M', x: 60, y: 30, rot: 0, side: 'bottom' }));
  main.items.push(makeItem('part', { lib: 'hdr_1x03', ref: 'J2', value: '', x: 85, y: 30, rot: 0, side: 'top' }));
  main.items.push(makeItem('trace', { layer: 'F.Cu', points: [[30, 40], [45, 40], [45, 33]], width: 0.4, net: 'SIG' }));
  main.items.push(makeItem('trace', { layer: 'B.Cu', points: [[10, 10], [90, 10]], width: 0.6, net: 'GND' }));
  main.items.push(makeItem('via', { x: 45, y: 40, d: 0.8, drill: 0.4, net: 'SIG' }));
  main.items.push(makeItem('pad', { x: 20, y: 50, shape: 'rect', w: 3, h: 2, drill: 0, layer: 'F', name: 'TP1', net: 'SIG' }));
  main.items.push(makeItem('pad', { x: 25, y: 50, shape: 'oval', w: 2.2, h: 1.6, drill: 1.0, layer: 'both', name: 'P2', net: 'GND' }));
  main.items.push(makeItem('region', { layer: 'B.Cu', points: [[60, 40], [90, 40], [90, 55], [60, 55]], net: 'GND' }));
  main.items.push(makeItem('text', { layer: 'F.Silk', x: 50, y: 52, text: 'LAMINA MAIN v1', size: 2, thickness: 0.3, align: 'center' }));
  main.items.push(makeItem('text', { layer: 'B.Silk', x: 50, y: 5, text: 'bottom text', size: 1.5, thickness: 0.2, align: 'center' }));
  main.items.push(makeItem('line', { layer: 'F.Silk', x1: 5, y1: 45, x2: 95, y2: 45, width: 0.3 }));
  main.items.push(makeItem('arc', { layer: 'F.Silk', cx: 70, cy: 30, r: 4, a0: 0, a1: 270, width: 0.2 }));
  main.items.push(makeItem('circle', { layer: 'F.Mask', cx: 12, cy: 30, r: 3, filled: true }));
  main.items.push(makeItem('rect', { layer: 'F.Cu', x: 12, y: 30, w: 4, h: 4, rot: 45, filled: true }));
  main.items.push(makeItem('polygon', { layer: 'F.Silk', points: [[70, 45], [80, 45], [75, 50]], filled: true }));
  main.items.push(makeItem('rect', { layer: 'Edge.Cuts', x: 50, y: 30, w: 8, h: 6, rot: 0 }));  // internal cutout
  main.items.push(makeItem('hole', { x: 90, y: 50, d: 6 }));
  main.items.push(makeItem('slot', { x: 15, y: 15, len: 8, w: 2.2, rot: 30 }));
  panel.items.push(makeItem('text', { layer: 'F.Silk', x: 50, y: 30, text: 'PANEL', size: 5, thickness: 0.6, align: 'center' }));
  panel.items.push(makeItem('circle', { layer: 'F.Silk', cx: 20, cy: 30, r: 8, width: 0.4, filled: false }));
  panel.items.push(makeItem('rect', { layer: 'F.Cu', x: 80, y: 30, w: 20, h: 12, rot: 0, rx: 2, filled: true }));
  panel.items.push(makeItem('rect', { layer: 'F.Mask', x: 80, y: 30, w: 20, h: 12, rot: 0, rx: 2, filled: true }));
  panel.items.push(makeItem('image', { layer: 'F.Silk', x: 50, y: 15, w: 20, h: 10, src: '', threshold: 128 }));
  return doc;
}
export function oneBoardDoc() {
  const doc = newDocument({ name: 'fixture-one', w: 50, h: 50, r: 0, color: 'green' });
  const b = doc.boards[0];
  addMountingHoles(b, { inset: 3.5, lib: 'mount_m25' });
  b.items.push(makeItem('part', { lib: 'soic_8', ref: 'U1', value: 'NE555', x: 25, y: 25, rot: 0, side: 'top' }));
  b.items.push(makeItem('part', { lib: 'c_0603', ref: 'C1', value: '100n', x: 32, y: 25, rot: 90, side: 'top' }));
  b.items.push(makeItem('text', { layer: 'F.Silk', x: 25, y: 45, text: 'ONE', size: 3, thickness: 0.4, align: 'center' }));
  b.items.push(makeItem('trace', { layer: 'F.Cu', points: [[10, 10], [40, 10], [40, 20]], width: 0.5, net: 'VCC' }));
  return doc;
}
// A tiny synthetic bitmap for image items: 8x4 checkerboard-ish "L" glyph
export function fakeBitmapFor(item) { const w = 8, h = 4, data = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = (x < 2 || y === h - 1) ? 1 : 0; return { w, h, data }; }
