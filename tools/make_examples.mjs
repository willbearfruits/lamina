// Builds example projects in examples/*.lamina.json. Run: node tools/make_examples.mjs
import fs from 'node:fs';
import { newDocument, makeItem, addStackStandoffs, addMountingHoles, uid, serializeDoc, nextRef } from '../js/model.js';
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
  n = 1; for (const [x, y] of [[8, 18], [20, 18], [32, 18], [8, 36], [20, 36], [32, 36]]) b.items.push(makeItem('part', { lib: 'jack_35_pj398sm', ref: 'J' + n++, x, y, side: 'bottom' }));
  b.items.push(makeItem('part', { lib: 'led_3mm', ref: 'D1', x: 20, y: 60, side: 'bottom' }));
  b.items.push(makeItem('text', { layer: 'F.Silk', x: 20.15, y: 118, text: 'DRONE', size: 3.5, thickness: 0.5, align: 'center' }));
  b.items.push(makeItem('text', { layer: 'F.Silk', x: 20.15, y: 48, text: 'IN   CV   OUT', size: 1.6, thickness: 0.25, align: 'center' }));
  return doc;
}

// ---------------------------------------------------------------------------
// A Daisy Seed breakout — the board daisypatcher patches are meant to land on.
// Module on the left, four knobs, an encoder, an OLED, jacks along the bottom.
function daisyBreakout() {
  const doc = newDocument({ name: 'daisy-seed-breakout', w: 110, h: 70, r: 3, color: 'black' });
  const b = doc.boards[0];
  addMountingHoles(b, { inset: 4 });
  const P = (lib, ref, x, y, rot = 0, value = '', side = 'top') =>
    b.items.push(makeItem('part', { lib, ref, value, x, y, rot, side }));
  const T = (x, y, text, size = 1.6, opts = {}) =>
    b.items.push(makeItem('text', { layer: 'F.Silk', x, y, text, size, thickness: size * 0.15, align: 'center', ...opts }));

  P('mod_daisy_seed', 'U1', 13, 35, 0, 'Daisy Seed');
  // knobs → ADC pins; the row order matches how you would read them left to right
  const knobs = [['RV1', 36, 'GRAIN'], ['RV2', 53, 'DENS'], ['RV3', 70, 'PITCH'], ['RV4', 87, 'TONE']];
  for (const [ref, x, label] of knobs) { P('pot_alpha_9mm', ref, x, 57, 0, 'B10k'); T(x, 46.5, label, 2); }
  P('enc_ec11', 'SW1', 36, 30, 0, 'nav');       T(36, 20.5, 'NAV');
  P('sw_tact_12x12', 'SW2', 60, 30, 0, 'boot'); T(60, 20.5, 'ALT');
  P('oled_096_i2c', 'DS1', 95, 30, 0, '0.96" I2C');
  const jacks = [['J1', 36, 'IN'], ['J2', 52, 'OUT L'], ['J3', 68, 'OUT R']];
  for (const [ref, x, label] of jacks) { P('jack_35_pj398sm', ref, x, 10, 0); T(x, 17.5, label, 1.4); }
  P('led_5mm', 'D1', 102, 57, 0, 'ON');
  T(55, 65.5, 'DAISY SEED BREAKOUT', 3, { font: 'sans-bold' });
  b.items.push(makeItem('text', { layer: 'B.Silk', x: 55, y: 35, text: 'patch it in daisypatcher', size: 2.4, thickness: 0.3, align: 'center', font: 'script' }));
  return doc;
}

// A small ESP32-S3 audio board: module, two knobs, in/out jacks and a header
// for an I2S DAC. The ESP32 has no audio hardware of its own — that header is
// where the PCM5102A or MAX98357A goes.
function esp32Audio() {
  const doc = newDocument({ name: 'esp32-s3-audio', w: 76, h: 52, r: 2, color: 'blue' });
  const b = doc.boards[0];
  addMountingHoles(b, { inset: 3.5 });
  const P = (lib, ref, x, y, rot = 0, value = '') => b.items.push(makeItem('part', { lib, ref, value, x, y, rot, side: 'top' }));
  const T = (x, y, text, size = 1.4) => b.items.push(makeItem('text', { layer: 'F.Silk', x, y, text, size, thickness: size * 0.16, align: 'center' }));

  P('mod_esp32_s3_zero', 'U1', 14, 26, 0, 'ESP32-S3-Zero');
  P('pot_alpha_9mm', 'RV1', 38, 37, 0, 'B10k'); T(38, 28.5, 'A');
  P('pot_alpha_9mm', 'RV2', 55, 37, 0, 'B10k'); T(55, 28.5, 'B');
  P('jack_35_pj398sm', 'J1', 38, 13, 0);        T(38, 20.5, 'IN');
  P('jack_35_pj398sm', 'J2', 55, 13, 0);        T(55, 20.5, 'OUT');
  P('hdr_1x04', 'J3', 69, 26, 0, 'I2S DAC');
  T(69, 33, 'I2S', 1.3);
  P('led_3mm', 'D1', 69, 15, 0);
  b.items.push(makeItem('text', { layer: 'F.Silk', x: 34, y: 47, text: 'ESP32-S3 AUDIO', size: 2.6, thickness: 0.4, align: 'center', font: 'sans-bold' }));
  return doc;
}

// A 1590B faceplate: no components at all — just the holes the enclosure needs
// and the artwork. Export PDF 1:1 to print a drill template, or DXF for a CNC.
// Also the font showcase: five families on one board.
function faceplate() {
  const doc = newDocument({ name: '1590b-faceplate', w: 110, h: 58, r: 3, color: 'purple', silkColor: 'white' });
  const b = doc.boards[0];
  const H = (x, y, d) => b.items.push(makeItem('hole', { x, y, d }));
  const T = (x, y, text, size, font = 'sans', thickness = null) =>
    b.items.push(makeItem('text', { layer: 'F.Silk', x, y, text, size, thickness: thickness ?? size * 0.14, align: 'center', font }));

  // Panel holes — 16 mm pot bushings, a 3PDT stomp, an LED bezel, a toggle.
  for (const x of [27, 55, 83]) H(x, 38, 7.5);
  H(55, 13, 12.5);   // 3PDT footswitch
  H(55, 26, 5.2);    // 5 mm LED
  H(27, 13, 6.5);    // SPDT toggle
  H(83, 13, 6.5);
  // Knob skirts + tick marks: the art that tells you where the knob points.
  for (const x of [27, 55, 83]) {
    b.items.push(makeItem('circle', { layer: 'F.Silk', cx: x, cy: 38, r: 9, width: 0.3 }));
    for (let i = 0; i < 11; i++) {
      const a = (-135 + 27 * i) * Math.PI / 180, r0 = 9.6, r1 = 11;
      b.items.push(makeItem('line', { layer: 'F.Silk', x1: x + r0 * Math.cos(a), y1: 38 + r0 * Math.sin(a), x2: x + r1 * Math.cos(a), y2: 38 + r1 * Math.sin(a), width: 0.25 }));
    }
  }
  T(55, 49, 'HOLLOW SUN', 5.5, 'gothic-eng', 0.8);
  T(27, 27, 'DRIVE', 2.2, 'sans-bold');
  T(11, 49, 'fuzz', 3, 'script');
  T(83, 27, 'LEVEL', 2.2, 'sans-bold');
  T(27, 5.5, 'BRIGHT', 1.6, 'roman');
  T(83, 5.5, 'OCTAVE', 1.6, 'roman');
  T(55, 32.5, 'BYPASS', 1.4, 'times-italic');
  // Copper art: a bare-copper bar under the title (mask opening over copper).
  for (const layer of ['F.Cu', 'F.Mask']) b.items.push(makeItem('rect', { layer, x: 55, y: 47, w: 44, h: 0.8, filled: true }));
  b.items.push(makeItem('text', { layer: 'B.Silk', x: 55, y: 29, text: 'drill template — print at 100%', size: 2, thickness: 0.3, align: 'center' }));
  return doc;
}

// The smallest useful starting point: a blank 4HP Eurorack panel with the
// mounting slots already in the right places. Duplicate it and build on it.
function euro4hp() {
  const doc = newDocument({ name: 'euro-4hp-blank', w: 20, h: 128.5, r: 1, color: 'black', silkColor: 'white' });
  const b = doc.boards[0];
  b.items.push(makeItem('slot', { x: 7.5, y: 3, len: 5.5, w: 3.2, rot: 0 }));
  b.items.push(makeItem('slot', { x: 12.5, y: 125.5, len: 5.5, w: 3.2, rot: 0 }));
  const P = (lib, ref, x, y, value = '') => b.items.push(makeItem('part', { lib, ref, value, x, y, rot: 0, side: 'bottom' }));
  P('pot_alpha_9mm', 'RV1', 10, 95, 'B100k');
  P('led_3mm', 'D1', 10, 72);
  P('jack_35_pj398sm', 'J1', 10, 40);
  P('jack_35_pj398sm', 'J2', 10, 22);
  const T = (y, text, size, font = 'sans') => b.items.push(makeItem('text', { layer: 'F.Silk', x: 10, y, text, size, thickness: size * 0.16, align: 'center', font }));
  T(115, 'UTIL', 3, 'sans-bold');
  T(85, 'AMT', 1.8);
  T(50, 'IN', 1.6);
  T(32, 'OUT', 1.6);
  T(8, '4HP', 1.4);
  return doc;
}

const EXAMPLES = [
  { file: 'pedal-sandwich', title: 'Pedal sandwich (two boards)', make: pedal,
    blurb: 'The flagship: a circuit board and a control panel stacked with standoffs and a board-to-board header, knobs poking through the panel. Shows the whole two-board model, panel artwork and copper art.' },
  { file: 'daisy-seed-breakout', title: 'Daisy Seed breakout', make: daisyBreakout,
    blurb: 'A dev board for the Electro-Smith Daisy Seed: module, four knobs, encoder, OLED and audio jacks. The board a daisypatcher patch is meant to land on.' },
  { file: 'esp32-s3-audio', title: 'ESP32-S3 audio board', make: esp32Audio,
    blurb: 'ESP32-S3-Zero with two knobs, in/out jacks and a header for an I2S DAC — the ESP32 has no audio hardware of its own.' },
  { file: 'euro-8hp-panel', title: 'Eurorack 8HP panel', make: synthPanel,
    blurb: 'A 3U 8HP panel with the mounting slots in the right places, four pots, six jacks and an LED, all rear-mounted.' },
  { file: 'euro-4hp-blank', title: 'Eurorack 4HP starter', make: euro4hp,
    blurb: 'The smallest useful starting point: a blank 4HP panel with correct mounting slots, two jacks, a pot and an LED. Duplicate it and build on it.' },
  { file: '1590b-faceplate', title: '1590B faceplate / drill template', make: faceplate,
    blurb: 'No components at all — just the holes a 1590B enclosure needs plus artwork in five stroke fonts and a bare-copper bar. Export PDF at 1:1 to print a drill template, or DXF for a CNC.' },
];

fs.mkdirSync('examples', { recursive: true });
const index = [];
for (const ex of EXAMPLES) {
  const doc = ex.make();
  fs.writeFileSync(`examples/${ex.file}.lamina.json`, serializeDoc(doc));
  const boards = doc.boards.map(b => `${b.name} ${b.w ?? '?'}×${b.h ?? '?'} mm`).join(' + ');
  index.push({ file: ex.file, title: ex.title, blurb: ex.blurb, boards, parts: doc.boards.reduce((n, b) => n + b.items.filter(i => i.type === 'part').length, 0) });
}
fs.writeFileSync('examples/index.json', JSON.stringify(index, null, 2) + '\n');
console.log(`examples written: ${index.length} + index.json`);
