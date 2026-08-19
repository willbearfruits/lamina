// Builds example projects in examples/*.lamina.json. Run: node tools/make_examples.mjs
import fs from 'node:fs';
import { newDocument, makeItem, addStackStandoffs, uid, serializeDoc, nextRef } from '../js/model.js';
import { getFootprint } from '../js/library.js';

function pedal() {
  const doc = newDocument({ name: 'pedal-sandwich', two: true, w: 100, h: 60, r: 3, color: 'black', color2: 'blue', gap: 12, name1: 'CIRCUIT', name2: 'CONTROLS' });
  addStackStandoffs(doc, { inset: 4 });
  doc.stack.links.push({ id: uid('L'), kind: 'connector', lib: 'b2b_hdr_1x08', ref: 'J1', x: 50, y: 6.5, rot: 90, opts: {} });
  const [main, panel] = doc.boards;
  const P = (b, lib, ref, x, y, rot = 0, side = 'top', extra = {}) => { const it = makeItem('part', { lib, ref, value: extra.value || '', x, y, rot, side, through: !!extra.through }); b.items.push(it); return it; };
  // panel-side controls live on the CIRCUIT board (top side) and poke through the CONTROLS panel
  P(main, 'pot_16mm', 'RV1', 22, 42, 0, 'top', { through: true, value: 'GAIN B100k' });
  P(main, 'pot_16mm', 'RV2', 50, 42, 0, 'top', { through: true, value: 'TONE B10k' });
  P(main, 'pot_16mm', 'RV3', 78, 42, 0, 'top', { through: true, value: 'LEVEL A100k' });
  P(main, 'sw_toggle_mts102', 'SW1', 36, 26, 90, 'top', { through: true, value: 'CLIP' });
  P(main, 'led_5mm', 'D1', 64, 26, 0, 'top', { through: true, value: 'ON' });
  P(panel, 'sw_footswitch_3pdt', 'SW2', 50, 20, 0, 'top', { value: 'BYPASS' });  // stomp switch mounts on the control board itself
  P(main, 'jack_635_pcb', 'J2', 10, 18, 90, 'bottom', { value: 'IN' });
  P(main, 'jack_635_pcb', 'J3', 90, 18, -90, 'bottom', { value: 'OUT' });
  P(main, 'jack_dc_55x21', 'J4', 86, 56, 0, 'bottom', { value: '9V DC' });
  P(main, 'dip_8', 'U1', 30, 10, 0, 'bottom', { value: 'TL072' });
  P(main, 'r_0805', 'R1', 66, 24, 0, 'bottom', { value: '10k' }); P(main, 'r_0805', 'R2', 66, 27, 0, 'bottom', { value: '100k' });
  P(main, 'c_0805', 'C1', 72, 24, 0, 'bottom', { value: '100n' }); P(main, 'cp_r_5x11', 'C2', 68, 8, 0, 'bottom', { value: '47u' });
  main.items.push(makeItem('text', { layer: 'B.Silk', x: 50, y: 55, text: 'LAMINA PEDAL v1', size: 2, thickness: 0.3, align: 'center' }));
  main.items.push(makeItem('text', { layer: 'F.Silk', x: 50, y: 55, text: 'CIRCUIT — top side faces the panel', size: 1.5, thickness: 0.2, align: 'center' }));
  // panel artwork
  panel.items.push(makeItem('text', { layer: 'F.Silk', x: 50, y: 52, text: 'MUDLIGHT', size: 6, thickness: 0.8, align: 'center' }));
  panel.items.push(makeItem('text', { layer: 'F.Silk', x: 22, y: 34, text: 'GAIN', size: 2, thickness: 0.3, align: 'center' }));
  panel.items.push(makeItem('text', { layer: 'F.Silk', x: 50, y: 34, text: 'TONE', size: 2, thickness: 0.3, align: 'center' }));
  panel.items.push(makeItem('text', { layer: 'F.Silk', x: 78, y: 34, text: 'LEVEL', size: 2, thickness: 0.3, align: 'center' }));
  panel.items.push(makeItem('text', { layer: 'F.Silk', x: 36, y: 20, text: 'CLIP', size: 1.6, thickness: 0.25, align: 'center' }));
  for (const x of [22, 50, 78]) panel.items.push(makeItem('circle', { layer: 'F.Silk', cx: x, cy: 42, r: 8, width: 0.3, filled: false }));
  for (const x of [22, 50, 78]) for (let i = 0; i < 11; i++) { const a = (-135 + 27 * i) * Math.PI / 180; const r0 = 8.6, r1 = 9.8; panel.items.push(makeItem('line', { layer: 'F.Silk', x1: x + r0 * Math.cos(a), y1: 42 + r0 * Math.sin(a), x2: x + r1 * Math.cos(a), y2: 42 + r1 * Math.sin(a), width: 0.25 })); }
  // copper art: exposed copper stripe (mask opening) at the bottom edge of the panel
  panel.items.push(makeItem('rect', { layer: 'F.Cu', x: 50, y: 4, w: 60, h: 3, filled: true }));
  panel.items.push(makeItem('rect', { layer: 'F.Mask', x: 50, y: 4, w: 60, h: 3, filled: true }));
  panel.items.push(makeItem('polygon', { layer: 'F.Silk', points: [[6, 24], [14, 30], [6, 30]], filled: true }));
  return doc;
}
function synthPanel() {
  const doc = newDocument({ name: 'euro-8hp-panel', w: 40.3, h: 128.5, r: 1, color: 'white', silkColor: 'black' });
  const b = doc.boards[0];
  b.items.push(makeItem('part', { lib: 'mount_m3', ref: 'H1', x: 7.5, y: 3, side: 'top' })); b.items.push(makeItem('part', { lib: 'mount_m3', ref: 'H2', x: 32.8, y: 125.5, side: 'top' }));
  b.items.push(makeItem('slot', { x: 7.5, y: 125.5, len: 5.5, w: 3.2, rot: 0 })); b.items.push(makeItem('slot', { x: 32.8, y: 3, len: 5.5, w: 3.2, rot: 0 }));
  let n = 1; for (const [x, y] of [[12, 105], [28, 105], [12, 80], [28, 80]]) b.items.push(makeItem('part', { lib: 'pot_alpha_9mm', ref: 'RV' + n++, x, y, side: 'bottom', value: 'B100k' }));
  n = 1; for (const [x, y] of [[8, 20], [20, 20], [32, 20], [8, 34], [20, 34], [32, 34]]) b.items.push(makeItem('part', { lib: 'jack_35_pj398sm', ref: 'J' + n++, x, y, side: 'bottom' }));
  b.items.push(makeItem('part', { lib: 'led_3mm', ref: 'D1', x: 20, y: 60, side: 'bottom' }));
  b.items.push(makeItem('text', { layer: 'F.Silk', x: 20.15, y: 118, text: 'DRONE', size: 3.5, thickness: 0.5, align: 'center' }));
  b.items.push(makeItem('text', { layer: 'F.Silk', x: 20.15, y: 46, text: 'IN   CV   OUT', size: 1.6, thickness: 0.25, align: 'center' }));
  return doc;
}
fs.mkdirSync('examples', { recursive: true });
fs.writeFileSync('examples/pedal-sandwich.lamina.json', serializeDoc(pedal()));
fs.writeFileSync('examples/euro-8hp-panel.lamina.json', serializeDoc(synthPanel()));
console.log('examples written');
