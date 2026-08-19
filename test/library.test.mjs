// node test/library.test.mjs — parts library sanity (built-ins + js/lib/parts_hardware.js)
import assert from 'node:assert/strict';
import { CATEGORIES, allParts, getFootprint, STACK_CONNECTOR_TYPES, HARDWARE_STACK_TYPES, stackConnector, stackConnectorOptions, searchParts } from '../js/library.js';
import { HARDWARE_PARTS } from '../js/lib/parts_hardware.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };
const near = (a, b, msg, tol = 1e-6) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); n++; };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

const SHAPES = new Set(['circle', 'rect', 'oval', 'roundrect']);
const LAYERS = new Set(['both', 'F', 'B']);
const GLAYERS = new Set(['F.Silk', 'B.Silk', 'F.Fab', 'B.Fab', 'F.Cu', 'B.Cu', 'F.Mask', 'B.Mask']);
const GTYPES = new Set(['line', 'circle', 'arc', 'rect', 'poly', 'polyline', 'text']);
const B3D = new Set(['box', 'cyl']);

// ---------- every hardware part is well formed ----------
ok(HARDWARE_PARTS.length >= 60, `hardware parts present (${HARDWARE_PARTS.length})`);
const seen = new Set();
for (const p of HARDWARE_PARTS) {
  const tag = `[${p.id}]`;
  ok(typeof p.id === 'string' && /^[a-z0-9_]+$/.test(p.id), `${tag} id is a lowercase key`);
  ok(!seen.has(p.id), `${tag} id unique within HARDWARE_PARTS`); seen.add(p.id);
  ok(typeof p.name === 'string' && p.name.length > 3, `${tag} name`);
  ok(CATEGORIES.includes(p.cat), `${tag} cat "${p.cat}" is one of CATEGORIES`);
  ok(typeof p.ref === 'string' && p.ref.length >= 1, `${tag} ref prefix`);
  ok(Array.isArray(p.pads), `${tag} pads array`);
  ok(Array.isArray(p.graphics) && p.graphics.length > 0, `${tag} graphics`);
  ok(p.courtyard && ((fin(p.courtyard.w) && fin(p.courtyard.h)) || (Array.isArray(p.courtyard.pts) && p.courtyard.pts.length >= 3)), `${tag} courtyard`);
  ok(fin(p.height) && p.height >= 0, `${tag} height number`);
  ok(Array.isArray(p.body3d), `${tag} body3d array`);
  ok(typeof p.desc === 'string' && p.desc.length > 20, `${tag} desc`);
  ok(typeof p.verify === 'boolean', `${tag} verify flag`);
  ok(Array.isArray(p.tags) && p.tags.length > 0, `${tag} tags`);
  ok(p.refText === false || (p.refPos && fin(p.refPos.x) && fin(p.refPos.y)), `${tag} refPos`);
  ok(p.meta && typeof p.meta === 'object', `${tag} meta`);
  for (const pad of p.pads) {
    ok(fin(pad.x) && fin(pad.y) && fin(pad.w) && fin(pad.h) && fin(pad.drill), `${tag} pad ${pad.name} finite geometry`);
    ok(pad.w > 0 && pad.h > 0 && pad.drill >= 0, `${tag} pad ${pad.name} positive size`);
    ok(SHAPES.has(pad.shape), `${tag} pad ${pad.name} shape "${pad.shape}"`);
    ok(LAYERS.has(pad.layer), `${tag} pad ${pad.name} layer "${pad.layer}"`);
    ok(typeof pad.name === 'string', `${tag} pad name is a string`);
    if (pad.layer === 'both') ok(pad.drill > 0 && pad.drill < Math.max(pad.w, pad.h), `${tag} pad ${pad.name} TH drill inside the pad`);
    else ok(pad.drill === 0, `${tag} pad ${pad.name} SMD has no drill`);
    if (pad.slotLen) ok(pad.slotLen > pad.drill && pad.slotLen <= Math.max(pad.w, pad.h) + 1e-9, `${tag} pad ${pad.name} slot within pad`);
  }
  for (const h of p.holes || []) ok(fin(h.x) && fin(h.y) && fin(h.d) && h.d > 0, `${tag} hole finite`);
  for (const g of p.graphics) { ok(GTYPES.has(g.t), `${tag} graphic type ${g.t}`); ok(GLAYERS.has(g.layer), `${tag} graphic layer ${g.layer}`); }
  for (const b of p.body3d) {
    const t = b.t;
    ok(['box', 'rbox', 'cyl', 'hex', 'sphere', 'torus', 'prism', 'pin', 'cone'].includes(t), `[${p.id}] body3d prim type ${t}`);
    if (t === 'box' || t === 'rbox') ok(b.w > 0 && b.d > 0 && b.h > 0, `[${p.id}] ${t} dims`);
    else if (t === 'cyl' || t === 'cone') ok(b.d > 0 && b.h > 0, `[${p.id}] ${t} dims`);
    else if (t === 'hex') ok((b.af > 0 || b.d > 0) && b.h > 0, `[${p.id}] hex dims`);
    else if (t === 'sphere') ok(b.d > 0, `[${p.id}] sphere dims`);
    else if (t === 'torus') ok(b.d > 0 && (b.thickness > 0 || b.t2 > 0), `[${p.id}] torus dims`);
    else if (t === 'prism') ok(Array.isArray(b.pts) && b.pts.length >= 3 && b.h > 0, `[${p.id}] prism dims`);
    else if (t === 'pin') ok((b.d > 0 || b.w > 0) && (b.len > 0 || b.h > 0), `[${p.id}] pin dims`);
    for (const k of ['x', 'y', 'z', 'w', 'd', 'h', 'af', 'len', 'r']) if (k in b) ok(Number.isFinite(b[k]), `[${p.id}] ${t}.${k} finite`);
  }
  if (p.through) {
    ok(fin(p.through.x) && fin(p.through.y), `${tag} through position`);
    ok((fin(p.through.d) && p.through.d > 0) || (p.through.slot && p.through.slot.len > 0 && p.through.slot.w > 0), `${tag} through.d > 0`);
    ok(p.panelDist == null || (fin(p.panelDist) && p.panelDist >= 0 && p.panelDist <= p.height), `${tag} panelDist sane`);
    ok(p.bushingLen == null || (fin(p.bushingLen) && p.bushingLen > 0), `${tag} bushingLen sane`);
  }
  // registered in the library and retrievable
  eq(getFootprint(p.id), p, `${tag} getFootprint returns the definition`);
}

// ---------- no duplicate ids across the whole library ----------
const all = allParts();
const ids = all.map(p => p.id);
eq(new Set(ids).size, ids.length, 'no duplicate ids across built-ins + hardware');
ok(all.length >= HARDWARE_PARTS.length + 60, `built-ins still present (${all.length} total)`);
for (const p of all) ok(CATEGORIES.includes(p.cat), `[${p.id}] category valid`);

// ---------- stack types ----------
const TYPES = [...STACK_CONNECTOR_TYPES, ...HARDWARE_STACK_TYPES];
ok(HARDWARE_STACK_TYPES.length >= 3, 'hardware stack types present');
for (const t of TYPES) {
  ok(fin(t.minGap) && fin(t.nominalGap) && fin(t.maxGap) && t.minGap <= t.nominalGap && t.nominalGap <= t.maxGap, `[${t.id}] min ≤ nominal ≤ max`);
  ok(typeof t.note === 'string' && t.note.length > 20, `[${t.id}] note`);
  for (const [r, nn] of [[1, 8], [2, 10]]) {
    const lo = t.lowerGen(r, nn), up = t.upperGen(r, nn);
    const flo = getFootprint(lo), fup = getFootprint(up);
    ok(flo && flo.pads.length === r * nn, `[${t.id}] lower ${lo} resolves with ${r * nn} pads`);
    ok(fup && fup.pads.length === r * nn, `[${t.id}] upper ${up} resolves with ${r * nn} pads`);
    // both halves must share the same pad grid (same local coordinates, mirrored placement is done by the resolver)
    for (let i = 0; i < flo.pads.length; i++) { near(flo.pads[i].x, fup.pads[i].x, `[${t.id}] ${lo}/${up} pad ${i} x`); near(flo.pads[i].y, fup.pads[i].y, `[${t.id}] pad ${i} y`); }
    const sc = stackConnector(`${t.id}_${r}x${String(nn).padStart(2, '0')}`);
    ok(sc && sc.isStackConnector && sc.pair.lower === lo && sc.pair.upper === up, `[${t.id}] stackConnector id resolves to the pair`);
    eq(getFootprint(`${t.id}_${r}x${String(nn).padStart(2, '0')}`)?.pair?.nominalGap, t.nominalGap, `[${t.id}] getFootprint on the b2b id`);
  }
}
ok(stackConnectorOptions().length >= TYPES.length * 11, 'stackConnectorOptions lists every type × size');
// engagement sanity for the b2b geometry documented in the notes
const lp = HARDWARE_STACK_TYPES.find(t => t.id === 'b2b_hdr_lp'); near(lp.nominalGap, 7.5, 'lp nominal'); ok(getFootprint('fhdr_1x08_lp5').height === 5.0, 'lp5 socket 5.0 mm');
const st = HARDWARE_STACK_TYPES.find(t => t.id === 'b2b_hdr_stack'); ok(st.minGap >= 8.5 && st.maxGap <= 12.5, 'stack range plausible'); ok(getFootprint('shdr_1x08').height > 8.5, 'stackable legs below board');
const lpin = HARDWARE_STACK_TYPES.find(t => t.id === 'b2b_longpin'); ok(getFootprint('hdr_1x08_l15').height > lpin.maxGap + 1.6, '15 mm pins reach through the upper board at max gap');
ok(getFootprint('hdr_1x08_pads').height === 0 && getFootprint('hdr_1x08_pads').body3d.length === 0, 'pads-only upper half has no body');

// ---------- spot checks ----------
const P = (id) => { const p = getFootprint(id); ok(p, `spot: ${id} exists`); return p; };
{
  const p = P('pot_alpha_9mm');
  const pins = p.pads.filter(x => /^[123]$/.test(x.name)), lugs = p.pads.filter(x => x.name === 'MP');
  eq(pins.length, 3, 'pot 9 mm: 3 pins'); eq(lugs.length, 2, 'pot 9 mm: 2 lugs');
  near(Math.abs(pins[0].y - pins[1].y), 2.5, 'pot 9 mm pin pitch 2.5'); near(Math.abs(pins[1].y - pins[2].y), 2.5, 'pot 9 mm pin pitch 2.5 (2)');
  ok(lugs.every(l => l.slotLen === 1.8 && l.drill === 1.1), 'pot 9 mm lug slots 1.8x1.1'); near(Math.abs(lugs[0].y - lugs[1].y), 9.6, 'pot 9 mm lugs 9.6 apart');
  near(pins[0].x, -7.5, 'pot 9 mm pins 7.5 behind the shaft'); ok(p.through && p.through.d === 7.4 && p.panelDist === 5.0 && p.bushingLen === 5.0 && p.height === 25, 'pot 9 mm heights');
  eq(pins[0].shape, 'rect', 'pot 9 mm pin 1 square');
  const t = P('pot_9mm_tayda'); near(Math.abs(t.pads[3].y - t.pads[4].y), 11.4, 'tayda 9 mm lugs 11.4 apart');
}
{
  const p = P('pot_alpha_16mm_ra'); const xs = p.pads.map(x => x.x).sort((a, b) => a - b); near(xs[1] - xs[0], 5.0, '16 mm RA pitch 5.0'); near(xs[2] - xs[1], 5.0, '16 mm RA pitch 5.0 (2)'); ok(!p.through && p.meta.shaftCentreZ === 12.5, '16 mm RA has no panel hole, shaft 12.5 up');
  const v = P('pot_alpha_16mm'); ok(v.through && v.through.d === 7.4 && v.verify === true, '16 mm vertical flagged verify');
}
{
  const p = P('enc_ec11');
  const pins = p.pads.filter(x => x.name !== 'MP'), tabs = p.pads.filter(x => x.name === 'MP');
  eq(pins.length, 5, 'EC11: 5 pins'); eq(tabs.length, 2, 'EC11: 2 tab slots');
  const abc = pins.filter(x => 'ACB'.includes(x.name)); ok(abc.every(x => x.x === -7.5), 'EC11 A/C/B 7.5 from the shaft'); near(Math.abs(p.pads.find(x => x.name === 'A').y - p.pads.find(x => x.name === 'B').y), 5.0, 'EC11 A–B 5.0 (2.5 pitch)');
  const s = pins.filter(x => x.name.startsWith('S')); ok(s.every(x => x.x === 7.0), 'EC11 S1/S2 7.0 from the shaft'); near(Math.abs(s[0].y - s[1].y), 5.0, 'EC11 switch pitch 5.0');
  near(Math.abs(tabs[0].y - tabs[1].y), 11.2, 'EC11 tabs 11.2 apart'); ok(tabs.every(t => t.slotLen === 2.8 && t.drill === 1.5), 'EC11 tab slots 2.8x1.5');
  ok(p.through.d === 7.4 && p.panelDist === 4.5 && p.bushingLen === 7.0, 'EC11 heights');
}
{
  const p = P('usb_c_16p'); const smd = p.pads.filter(x => x.layer === 'F'), th = p.pads.filter(x => x.layer === 'both');
  eq(smd.length, 12, 'USB-C: 12 SMD pads'); eq(th.length, 4, 'USB-C: 4 TH shell slots'); ok(th.every(x => x.slotLen > 0), 'USB-C shell pads are slots'); eq((p.holes || []).length, 2, 'USB-C: 2 pegs');
  ok(smd.every(x => x.y === 4.045), 'USB-C pads on one row'); ok(smd.some(x => x.name === 'A5' && x.x === -1.25) && smd.some(x => x.name === 'B5' && x.x === 1.75), 'USB-C CC pads at ±1.25/1.75');
  const q = P('usb_c_16p_th'); eq(q.pads.filter(x => x.layer === 'F').length, 12, 'USB-C TH-shell variant: 12 SMD pads'); ok(q.verify === true, 'USB-C TH-shell variant flagged verify');
}
{
  const p = P('lcd_1602'); eq(p.pads.length, 16, 'LCD 1602: 16 pads'); eq(p.holes.length, 4, 'LCD 1602: 4 holes');
  near(p.pads[1].x - p.pads[0].x, 2.54, 'LCD pitch 2.54'); near(Math.abs(p.holes[0].x - p.holes[1].x), 75, 'LCD holes 75 apart'); near(Math.abs(p.holes[0].y - p.holes[2].y), 31, 'LCD holes 31 apart'); ok(p.holes.every(h => h.d === 2.5), 'LCD holes Ø2.5');
}
{
  const p = P('mod_pi_pico'); eq(p.pads.length, 40, 'Pico: 40 pads'); const xs = [...new Set(p.pads.map(x => x.x))].sort((a, b) => a - b); near(xs[1] - xs[0], 17.78, 'Pico rows 17.78');
  near(p.pads[0].y - p.pads[1].y, 2.54, 'Pico pitch 2.54'); eq(p.pads[0].name, '1', 'Pico pin 1 first'); eq(p.pads[39].name, '40', 'Pico pin 40 last'); near(p.pads[39].y, p.pads[0].y, 'Pico pin 40 opposite pin 1'); eq(p.holes.length, 4, 'Pico 4 holes'); near(Math.abs(p.holes[0].y - p.holes[2].y), 47, 'Pico holes 47'); near(Math.abs(p.holes[0].x - p.holes[1].x), 11.4, 'Pico holes 11.4');
  for (const [id, rs, np] of [['mod_esp32_c3_supermini', 15.24, 16], ['mod_esp32_s3_zero', 15.24, 18], ['mod_daisy_seed', 15.24, 40], ['mod_arduino_nano', 15.24, 30], ['mod_wemos_d1_mini', 22.86, 16]]) {
    const m = P(id); eq(m.pads.length, np, `${id}: ${np} pads`); const mx = [...new Set(m.pads.map(x => x.x))].sort((a, b) => a - b); near(mx[1] - mx[0], rs, `${id} rows ${rs}`);
  }
}
{
  const x2 = P('jst_xh_2'); near(x2.pads[1].x - x2.pads[0].x, 2.5, 'JST XH pitch 2.5'); eq(x2.pads[0].shape, 'rect', 'JST XH pin 1 square'); eq(P('jst_xh_4').pads.length, 4, 'JST XH 4 pads');
  const p2 = P('jst_ph_2'); near(p2.pads[1].x - p2.pads[0].x, 2.0, 'JST PH pitch 2.0'); eq(P('jst_ph_4').pads.length, 4, 'JST PH 4 pads');
}
{
  const p = P('jack_35_pj301m'); const s = p.pads.find(x => x.name === 'S'), t = p.pads.find(x => x.name === 'T'), tn = p.pads.find(x => x.name === 'TN');
  near(tn.y - s.y, 3.1, 'PJ301M S→TN 3.1'); near(t.y - s.y, 11.4, 'PJ301M S→T 11.4'); near(-s.y, 6.48, 'PJ301M socket 6.48 above S'); ok(p.through.d === 6.2 && p.panelDist === 9.0, 'PJ301M through/panel');
  const q = P('jack_35_pj398sm'); eq(JSON.stringify(q.pads), JSON.stringify(p.pads), 'PJ398SM alias shares the pads');
  const dc = P('jack_dc_55x21'); eq(dc.pads.length, 3, 'DC-005: 3 slotted pads'); ok(dc.pads.every(x => x.slotLen === 3.0), 'DC-005 slots 3.0');
  const t2 = P('term_2p_508'); near(t2.pads[1].x - t2.pads[0].x, 5.08, 'terminal pitch 5.08'); eq(P('term_3p_508').pads.length, 3, '3-pole terminal');
}
{
  const p = P('sw_footswitch_3pdt'); eq(p.pads.length, 9, '3PDT: 9 lugs'); const xs = [...new Set(p.pads.map(x => x.x))].sort((a, b) => a - b), ys = [...new Set(p.pads.map(x => x.y))].sort((a, b) => a - b);
  eq(xs.length, 3, '3PDT 3 columns'); eq(ys.length, 3, '3PDT 3 rows'); ok(p.through.d >= 12.2 && p.verify === true, '3PDT M12 hole, flagged verify');
  const m = P('sw_toggle_mts102'); eq(m.pads.length, 3, 'MTS-102: 3 pins'); near(m.pads[2].x - m.pads[0].x, 9.4, 'MTS-102 pitch 4.7'); ok(m.through.d > 6 && m.panelDist === 9.5, 'MTS-102 panel');
  eq(P('sw_toggle_mts202').pads.length, 6, 'MTS-202: 6 pins'); eq(P('sw_dip_4').pads.length, 8, 'DIP-4: 8 pads'); eq(P('sw_tact_6x6').pads.length, 4, 'tact 6x6: 4 pads'); eq(P('sw_slide_ss12d00').pads.length, 3, 'SS12D00: 3 pads');
  const t12 = P('sw_tact_12x12'); const tx = [...new Set(t12.pads.map(x => x.x))].sort((a, b) => a - b), ty = [...new Set(t12.pads.map(x => x.y))].sort((a, b) => a - b); near(tx[1] - tx[0], 12.5, 'tact 12x12 span 12.5'); near(ty[1] - ty[0], 5.0, 'tact 12x12 span 5.0');
}
{
  const l3 = P('led_3mm'), l5 = P('led_5mm'); near(l3.pads[1].x - l3.pads[0].x, 2.54, 'LED 3 mm pitch'); ok(l3.through.d === 3.2 && l5.through.d === 5.2, 'LED panel holes'); eq(l3.pads[0].shape, 'rect', 'LED cathode square');
  const ws = P('led_ws2812b_5050'); eq(ws.pads.length, 4, 'WS2812B 4 pads'); ok(ws.pads.every(x => x.layer === 'F' && x.drill === 0), 'WS2812B SMD');
  const o = P('oled_096_i2c'); eq(o.pads.length, 4, 'OLED 4 pins'); eq(o.holes.length, 4, 'OLED 4 holes'); ok(o.verify === true, 'OLED flagged verify');
  const f = P('feet_rubber_pad'); eq(f.pads.length, 0, 'foot has no pads'); ok(f.refText === false, 'foot hides ref');
}
// search finds hardware parts
ok(searchParts('thonkiconn').some(p => p.id === 'jack_35_pj398sm'), 'search by tag/name works');
ok(searchParts('ec11').some(p => p.id === 'enc_ec11'), 'search ec11');

console.log(`ALL PASS ${n}/${n}`);
