// New-project wizard: layout → size → look → hardware/stack → name.
import { h, clear, modal, numInput, select, checkbox } from './ui.js';
import { newDocument, addMountingHoles, addStackStandoffs, SIZE_PRESETS, BOARD_COLORS, THICKNESSES, FINISHES, uid, nextRef, boardSize } from './model.js';
import { stackConnectorOptions, getFootprint, STACK_CONNECTOR_TYPES, HARDWARE_STACK_TYPES } from './library.js';
import { DRC_PRESETS } from './drc.js';
import { outlinePoints } from './geom.js';

export function runWizard(onCreate, extra = {}) {
  const S = { two: false, preset: 'jlc100', w: 100, h: 100, r: 2, shape: 'rect', d: 60, sameSize: true, w2: 100, h2: 100, color: 'green', color2: 'green', silk: 'white', silk2: 'white', thickness: 1.6, thickness2: 1.6, finish: 'HASL', mount: 'mount_m3', inset: 4, addMount: true, connType: 'b2b_hdr', connRows: 1, connPins: 8, addConn: true, gapMode: 'connector', gap: 11, name: 'my-board', drc: 'jlcpcb-2layer', name1: 'MAIN', name2: 'PANEL' };
  let step = 0; const STEPS = ['Layout', 'Size & shape', 'Look', 'Hardware', 'Finish'];
  const body = h('div', { class: 'wiz' });
  const m = modal({ title: 'New project', body, width: 'min(760px, 96vw)', buttons: [
    { label: 'Cancel', onClick: () => true },
    { label: '‹ Back', onClick: () => { if (step > 0) { step--; render(); } return false; } },
    { label: 'Next ›', primary: true, onClick: () => { if (step < STEPS.length - 1) { step++; render(); return false; } create(); return true; } },
  ] });
  const backBtn = m.foot.querySelectorAll('button')[1], nextBtn = m.foot.querySelectorAll('button')[2];
  if (extra.shortcuts) { const l = h('div', { class: 'left' }); for (const s of extra.shortcuts) l.append(h('button', { onclick: () => { m.close(); s.run(); } }, s.label)); m.foot.prepend(l); }
  function setTitle() { m.setTitle(h('span', {}, 'New project ', h('span', { class: 'step' }, `Step ${step + 1}/${STEPS.length} — ${STEPS[step]}`))); backBtn.disabled = step === 0; nextBtn.textContent = step === STEPS.length - 1 ? 'Create' : 'Next ›'; }
  function card(label, sub, icon, on, onClick) { return h('div', { class: 'opt' + (on ? ' on' : ''), onclick: onClick }, h('span', { class: 'big' }, icon), label, h('small', {}, sub)); }
  function preview() {
    const c = h('canvas', { width: 640, height: 200 }); const ctx = c.getContext('2d');
    const boards = S.two ? [[S.w, S.h, S.color], [S.sameSize ? S.w : S.w2, S.sameSize ? S.h : S.h2, S.color2]] : [[S.w, S.h, S.color]];
    const totalW = boards.reduce((a, b) => a + b[0], 0) + 20 * (boards.length - 1); const maxH = Math.max(...boards.map(b => b[1]));
    const sc = Math.min(560 / totalW, 160 / maxH); let x = (640 - totalW * sc) / 2;
    for (const [w, hh, col] of boards) {
      const pts = outlinePoints(S.shape === 'circle' ? { type: 'circle', d: w } : { type: 'rect', w, h: hh, r: S.r });
      ctx.save(); ctx.translate(x, 100 + hh * sc / 2); ctx.scale(sc, -sc); ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fillStyle = BOARD_COLORS[col].mask; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 0.4; ctx.stroke();
      if (S.addMount) { const ins = S.inset; for (const [hx, hy] of [[ins, ins], [w - ins, ins], [w - ins, hh - ins], [ins, hh - ins]]) { ctx.beginPath(); ctx.arc(hx, hy, 1.6, 0, Math.PI * 2); ctx.fillStyle = '#1b1d22'; ctx.fill(); } }
      ctx.restore(); ctx.fillStyle = '#9aa0ab'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${w} × ${hh} mm`, x + w * sc / 2, 100 + hh * sc / 2 + 16); x += w * sc + 20 * sc;
    }
    return h('div', { class: 'preview' }, c);
  }
  function render() {
    clear(body); setTitle();
    if (step === 0) {
      body.append(h('div', { class: 'opts' },
        card('One board', 'a single PCB: art board, panel, circuit', '▭', !S.two, () => { S.two = false; render(); }),
        card('Two boards (sandwich)', 'main board + panel/control board joined by headers & standoffs', '▭\n▭', S.two, () => { S.two = true; render(); })),
        h('div', { class: 'note' }, 'You can add or remove the second board later (Board menu).'));
      if (S.two) body.append(h('div', { class: 'grid' }, h('label', {}, 'Lower board name'), textIn(S, 'name1'), h('label', {}, 'Upper board name'), textIn(S, 'name2')));
    } else if (step === 1) {
      const presetSel = select(SIZE_PRESETS.map(p => [p.id, p.name]), S.preset, v => { S.preset = v; const p = SIZE_PRESETS.find(x => x.id === v); if (p.circle) { S.shape = 'circle'; S.w = S.h = p.circle; } else { S.shape = 'rect'; S.w = p.w; S.h = p.h; } render(); });
      body.append(h('div', { class: 'grid' },
        h('label', {}, 'Preset'), presetSel,
        h('label', {}, 'Shape'), select([['rect', 'Rectangle'], ['circle', 'Circle']], S.shape, v => { S.shape = v; render(); }),
        ...(S.shape === 'rect' ? [h('label', {}, 'Width × Height (mm)'), h('div', { class: 'pair', style: { display: 'flex', gap: '6px' } }, numInput(S.w, v => { S.w = v; S.preset = 'custom'; refreshPreview(); }, { step: 1, min: 5 }), numInput(S.h, v => { S.h = v; S.preset = 'custom'; refreshPreview(); }, { step: 1, min: 5 })), h('label', {}, 'Corner radius (mm)'), numInput(S.r, v => { S.r = v; refreshPreview(); }, { step: 0.5, min: 0 })] : [h('label', {}, 'Diameter (mm)'), numInput(S.w, v => { S.w = S.h = v; refreshPreview(); }, { step: 1, min: 5 })]),
      ));
      if (S.two) body.append(h('div', { class: 'grid' }, h('label', {}, 'Upper board size'), checkbox(S.sameSize, v => { S.sameSize = v; render(); }, 'same as lower board'), ...(S.sameSize ? [] : [h('label', {}, 'Upper W × H'), h('div', { style: { display: 'flex', gap: '6px' } }, numInput(S.w2, v => { S.w2 = v; refreshPreview(); }, { step: 1 }), numInput(S.h2, v => { S.h2 = v; refreshPreview(); }, { step: 1 }))])));
      body.append(h('div', { class: 'note' }, 'JLCPCB: boards up to 100 × 100 mm are the cheapest tier (5 pcs). Hammond presets are the enclosure’s inside floor — leave clearance for the walls.'));
      body.append(preview());
    } else if (step === 2) {
      const sw = (key) => h('div', { class: 'swatches' }, Object.entries(BOARD_COLORS).map(([k, c]) => h('div', { class: 'swatch' + (S[key] === k ? ' on' : ''), style: { background: c.mask }, title: c.name, onclick: () => { S[key] = k; render(); } })));
      const g = h('div', { class: 'grid' + (S.two ? ' two' : '') }, h('label', {}), h('b', {}, S.two ? S.name1 : 'Board'), S.two ? h('b', {}, S.name2) : null,
        h('label', {}, 'Solder mask'), sw('color'), S.two ? sw('color2') : null,
        h('label', {}, 'Silkscreen'), select([['white', 'White'], ['black', 'Black']], S.silk, v => { S.silk = v; }), S.two ? select([['white', 'White'], ['black', 'Black']], S.silk2, v => { S.silk2 = v; }) : null,
        h('label', {}, 'Thickness (mm)'), select(THICKNESSES.map(t => [t, t]), S.thickness, v => { S.thickness = +v; }), S.two ? select(THICKNESSES.map(t => [t, t]), S.thickness2, v => { S.thickness2 = +v; }) : null,
        h('label', {}, 'Surface finish'), select(FINISHES.map(f => [f, f]), S.finish, v => { S.finish = v; }), S.two ? h('span', { class: 'note' }, 'same') : null,
      );
      body.append(g, h('div', { class: 'note' }, 'White silk on black mask needs ≥0.2 mm strokes to stay legible. ENIG (gold) shows exposed copper art best; HASL is silver.'), preview());
    } else if (step === 3) {
      body.append(h('h4', {}, S.two ? 'Standoffs (both boards)' : 'Mounting holes'));
      body.append(h('div', { class: 'grid' },
        h('label', {}, S.two ? 'Add corner standoffs' : 'Add corner holes'), checkbox(S.addMount, v => { S.addMount = v; render(); }, '4 × at the corners'),
        h('label', {}, 'Thread'), select([['mount_m2', 'M2 (Ø2.2)'], ['mount_m25', 'M2.5 (Ø2.7)'], ['mount_m3', 'M3 (Ø3.2)'], ['mount_m4', 'M4 (Ø4.3)']], S.mount, v => { S.mount = v; }),
        h('label', {}, 'Inset from edges (mm)'), numInput(S.inset, v => { S.inset = v; refreshPreview(); }, { step: 0.5, min: 2 })));
      if (S.two) {
        const types = [...STACK_CONNECTOR_TYPES, ...HARDWARE_STACK_TYPES];
        const t = types.find(x => x.id === S.connType) || types[0];
        const gapInfo = () => { const tt = types.find(x => x.id === S.connType); return tt ? `nominal ${tt.nominalGap} mm (works ${tt.minGap}–${tt.maxGap} mm)` : ''; };
        body.append(h('h4', {}, 'Board-to-board connector'));
        body.append(h('div', { class: 'grid' },
          h('label', {}, 'Add a connector'), checkbox(S.addConn, v => { S.addConn = v; render(); }, 'place one at the bottom edge (move it later)'),
          h('label', {}, 'Type'), select(types.map(x => [x.id, x.name]), S.connType, v => { S.connType = v; if (S.gapMode === 'connector') S.gap = types.find(x => x.id === v).nominalGap; render(); }),
          h('label', {}, 'Rows × pins'), h('div', { style: { display: 'flex', gap: '6px' } }, select([[1, '1 row'], [2, '2 rows']], S.connRows, v => { S.connRows = +v; }), select([2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20].map(n => [n, n + ' pins']), S.connPins, v => { S.connPins = +v; })),
          h('label', {}, 'Gap between boards'), h('div', {}, select([['connector', 'from connector: ' + gapInfo()], ['manual', 'manual']], S.gapMode, v => { S.gapMode = v; if (v === 'connector') S.gap = t.nominalGap; render(); })),
          h('label', {}, 'Gap (mm)'), numInput(S.gap, v => { S.gap = v; S.gapMode = 'manual'; render(); }, { step: 0.5, min: 2 }),
        ));
        const std = (getFootprint('standoff_m3')?.meta?.lengths) || [];
        body.append(h('div', { class: 'note' }, t ? t.note : '', h('br'), `Standoff length = gap = ${S.gap} mm — ${std.includes(S.gap) ? 'a stock length ✓' : 'not a stock length (stock: ' + std.join('/') + '); consider ' + std.reduce((b, a) => Math.abs(a - S.gap) < Math.abs(b - S.gap) ? a : b, std[0]) + ' mm'}`));
        body.append(h('div', { class: 'note' }, 'Parts on the lower board that must poke through the upper board (pots, jacks, toggles, LEDs): tick “through upper board” in their Properties — LAMINA adds the matching hole and checks bushing lengths against the gap.'));
      }
    } else if (step === 4) {
      body.append(h('div', { class: 'grid' }, h('label', {}, 'Project name'), textIn(S, 'name'), h('label', {}, 'Design rules'), select(Object.entries(DRC_PRESETS).map(([k, v]) => [k, v.name]), S.drc, v => { S.drc = v; })));
      body.append(h('div', { class: 'note' }, 'Summary: ', h('b', {}, S.two ? 'two boards' : 'one board'), `, ${S.shape === 'circle' ? 'Ø' + S.w : S.w + ' × ' + S.h} mm, ${BOARD_COLORS[S.color].name.toLowerCase()} mask, ${S.thickness} mm, ${S.finish}${S.two ? ', gap ' + S.gap + ' mm' : ''}${S.addMount ? ', 4 × ' + S.mount.replace('mount_', '').toUpperCase() : ''}.`), preview());
    }
  }
  function refreshPreview() { const p = body.querySelector('.preview'); if (p) p.replaceWith(preview()); }
  function textIn(obj, key) { const i = h('input', { type: 'text', value: obj[key] }); i.addEventListener('input', () => { obj[key] = i.value; }); return i; }
  function create() {
    const opts = { name: S.name, two: S.two, w: S.w, h: S.h, r: S.r, color: S.color, color2: S.color2, silkColor: S.silk, thickness: S.thickness, finish: S.finish, gap: S.gap, drcPreset: S.drc, name1: S.name1, name2: S.name2 };
    if (S.shape === 'circle') opts.circle = S.w;
    const doc = newDocument(opts);
    if (S.two) { const up = doc.boards[1]; up.silkColor = S.silk2; up.thickness = S.thickness2; if (!S.sameSize && S.shape === 'rect') up.outline = { type: 'rect', w: S.w2, h: S.h2, r: S.r }; }
    if (S.addMount) { if (S.two) addStackStandoffs(doc, { inset: S.inset, lib: S.mount.replace('mount_', 'standoff_') }); else addMountingHoles(doc.boards[0], { inset: S.inset, lib: S.mount }); }
    if (S.two && S.addConn) { const [W] = boardSize(doc.boards[0]); const id = `${S.connType}_${S.connRows}x${String(S.connPins).padStart(2, '0')}`; doc.stack.links.push({ id: uid('L'), kind: 'connector', lib: id, ref: 'J1', x: Math.round(W / 2), y: S.inset + 6, rot: 0, opts: {} }); doc.stack.gapSource = S.gapMode; }
    onCreate(doc);
  }
  render();
  return m;
}
