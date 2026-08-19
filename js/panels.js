// Side panels: layers, properties inspector, parts library, DRC list, stack panel.
import { h, clear, field, numInput, textInput, select, checkbox, toast, modal } from './ui.js';
import { GRAPHIC_LAYERS, itemBBox, resolvePart, stackLinkItems, unionBBox } from './geom.js';
import { LAYER_COLORS } from './render.js';
import { BOARD_COLORS, THICKNESSES, FINISHES, SIZE_PRESETS, boardSize, uid, nextRef, newBoard, addStackStandoffs } from './model.js';
import { partsByCategory, searchParts, getFootprint, CATEGORIES, stackConnectorOptions, STACK_CONNECTOR_TYPES, HARDWARE_STACK_TYPES } from './library.js';
import { isUnmatched } from './match.js';
import { FONT_LIST, FONT_CATS, getFont } from './lib/fonts.js';
import { DRC_PRESETS, runDRC, drcSummary } from './drc.js';

const LAYER_LABELS = { 'F.Cu': 'Top copper', 'B.Cu': 'Bottom copper', 'F.Mask': 'Top mask (openings)', 'B.Mask': 'Bottom mask (openings)', 'F.Silk': 'Top silkscreen', 'B.Silk': 'Bottom silkscreen', 'F.Paste': 'Top paste', 'B.Paste': 'Bottom paste', 'F.Fab': 'Top fab (notes)', 'B.Fab': 'Bottom fab (notes)', 'Edge.Cuts': 'Edge cuts / cutouts' };
const LAYER_LIST = ['F.Silk', 'F.Mask', 'F.Cu', 'F.Paste', 'F.Fab', 'B.Silk', 'B.Mask', 'B.Cu', 'B.Paste', 'B.Fab', 'Edge.Cuts'];

export function renderLayersPanel(el, editor, store) {
  clear(el);
  const R = editor.resolved();
  const counts = {}; for (const l of LAYER_LIST) counts[l] = (R.layers[l] || []).length; counts['Edge.Cuts'] = R.cutouts.length;
  for (const l of LAYER_LIST) {
    const row = h('div', { class: 'layerrow' + (editor.activeLayer === l ? ' on' : ''), onclick: (e) => { if (e.target.tagName === 'INPUT') return; editor.activeLayer = l; renderLayersPanel(el, editor, store); editor.requestRender(); } },
      checkbox(editor.visible[l] !== false, v => { editor.visible[l] = v; editor.requestRender(); }),
      h('span', { class: 'sw', style: { background: LAYER_COLORS[l] } }),
      h('span', { title: l }, LAYER_LABELS[l] || l),
      h('span', { class: 'cnt' }, counts[l] || ''));
    el.append(row);
  }
  el.append(h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' } },
    h('button', { class: 'mini' + (editor.mode === 'realistic' ? ' on' : ''), onclick: () => { editor.mode = 'realistic'; renderLayersPanel(el, editor, store); editor.requestRender(); } }, 'Realistic'),
    h('button', { class: 'mini' + (editor.mode === 'layers' ? ' on' : ''), onclick: () => { editor.mode = 'layers'; renderLayersPanel(el, editor, store); editor.requestRender(); } }, 'Layers'),
    h('button', { class: 'mini' + (editor.showFar ? ' on' : ''), title: 'Show the far side faintly (realistic mode)', onclick: () => { editor.showFar = !editor.showFar; renderLayersPanel(el, editor, store); editor.requestRender(); } }, 'X-ray'),
    h('button', { class: 'mini' + (editor.ghostOther ? ' on' : ''), title: 'Ghost the other board of the stack', onclick: () => { editor.ghostOther = !editor.ghostOther; renderLayersPanel(el, editor, store); editor.requestRender(); } }, 'Ghost other'),
  ));
}

// ---------- properties ----------
export function renderProps(el, titleEl, editor, store, app) {
  clear(el);
  const items = store.selectedItems(); const links = store.selectedLinks(); const doc = store.doc; const board = store.board;
  const wrap = h('div', { class: 'props' }); el.append(wrap);
  if (items.length + links.length === 0) { titleEl.textContent = 'Board'; renderBoardProps(wrap, editor, store, app); return; }
  if (items.length + links.length > 1) {
    titleEl.textContent = `${items.length + links.length} selected`;
    const types = {}; for (const it of items) types[it.type] = (types[it.type] || 0) + 1; for (const l of links) types[l.kind] = (types[l.kind] || 0) + 1;
    wrap.append(h('div', { class: 'hint' }, Object.entries(types).map(([k, v]) => `${v} ${k}`).join(', ')));
    // common layer change
    const layered = items.filter(i => i.layer && i.type !== 'trace' && i.type !== 'region');
    if (layered.length) wrap.append(field('Layer', select(GRAPHIC_LAYERS.concat(['Edge.Cuts']).map(l => [l, l]), layered[0].layer, v => store.mutate(d => { for (const it of d.boards[store.boardIndex].items) if (store.selection.has(it.id) && it.layer && it.type !== 'trace' && it.type !== 'region') it.layer = v; }, 'layer'))));
    wrap.append(actions(editor, store, app));
    return;
  }
  if (links.length === 1) { titleEl.textContent = 'Stack item'; renderLinkProps(wrap, links[0], editor, store, app); return; }
  const it = items[0]; titleEl.textContent = it.type.toUpperCase() + (it.type === 'part' ? ' ' + it.ref : '');
  const upd = (fn, label = 'edit') => store.mutate(d => { const x = d.boards[store.boardIndex].items.find(i => i.id === it.id); if (x) fn(x); }, label);
  const N = (key, opts) => numInput(it[key], v => upd(x => { x[key] = v; }), opts);
  const T = (key, opts) => textInput(it[key], v => upd(x => { x[key] = v; }), opts);
  const layerSel = () => field('Layer', select(GRAPHIC_LAYERS.concat(['Edge.Cuts']).map(l => [l, l]), it.layer, v => upd(x => { x.layer = v; })));
  const cuLayerSel = () => field('Layer', select([['F.Cu', 'F.Cu'], ['B.Cu', 'B.Cu']], it.layer, v => upd(x => { x.layer = v; })));
  const xy = (kx = 'x', ky = 'y') => field('Position X / Y', h('div', { class: 'pair' }, N(kx, { step: 0.5 }), N(ky, { step: 0.5 })));
  switch (it.type) {
    case 'line': wrap.append(layerSel(), field('Start', h('div', { class: 'pair' }, N('x1'), N('y1'))), field('End', h('div', { class: 'pair' }, N('x2'), N('y2'))), field('Width', N('width', { step: 0.05, min: 0.05 }))); break;
    case 'arc': wrap.append(layerSel(), field('Centre', h('div', { class: 'pair' }, N('cx'), N('cy'))), field('Radius', N('r', { step: 0.5, min: 0.05 })), field('Angles', h('div', { class: 'pair' }, N('a0', { step: 5 }), N('a1', { step: 5 }))), field('Width', N('width', { step: 0.05, min: 0.05 }))); break;
    case 'circle': wrap.append(layerSel(), field('Centre', h('div', { class: 'pair' }, N('cx'), N('cy'))), field('Radius', N('r', { step: 0.5, min: 0.05 })), it.layer !== 'Edge.Cuts' ? field('Filled', checkbox(it.filled, v => upd(x => { x.filled = v; }))) : h('div', { class: 'hint' }, 'On Edge.Cuts a circle is a round cutout.'), !it.filled ? field('Width', N('width', { step: 0.05, min: 0.05 })) : null); break;
    case 'rect': wrap.append(layerSel(), xy(), field('Width × Height', h('div', { class: 'pair' }, N('w', { step: 0.5, min: 0.1 }), N('h', { step: 0.5, min: 0.1 }))), field('Rotation', N('rot', { step: 15 })), field('Corner radius', N('rx', { step: 0.5, min: 0 })), it.layer !== 'Edge.Cuts' ? field('Filled', checkbox(it.filled, v => upd(x => { x.filled = v; }))) : h('div', { class: 'hint' }, 'On Edge.Cuts a rectangle is a cutout.'), !it.filled ? field('Line width', N('width', { step: 0.05, min: 0.05 })) : null); break;
    case 'polygon': wrap.append(layerSel(), field('Points', h('span', {}, it.points.length + ' (drag handles)')), it.layer !== 'Edge.Cuts' ? field('Filled', checkbox(it.filled, v => upd(x => { x.filled = v; }))) : h('div', { class: 'hint' }, 'On Edge.Cuts a polygon is a cutout.'), !it.filled ? field('Line width', N('width', { step: 0.05, min: 0.05 })) : null, field('', h('button', { class: 'mini', onclick: () => editPoints(it, upd) }, 'Edit points as text…'))); break;
    case 'text': {
      const ta = h('textarea', { rows: 2 }, it.text); ta.addEventListener('input', () => upd(x => { x.text = ta.value; })); ta.id = 'prop-text';
      const f = getFont(it.font || 'sans');
      wrap.append(layerSel(), field('Text', ta, { full: false }), field('Font', fontSelect(it.font || 'sans', v => upd(x => { x.font = v; }))), h('div', { class: 'hint' }, f.note || ''), xy(), field('Size (cap height)', N('size', { step: 0.25, min: 0.3 })), field('Stroke', N('thickness', { step: 0.05, min: 0.05 })), field('Rotation', N('rot', { step: 15 })), field('Align', select([['left', 'left'], ['center', 'center'], ['right', 'right']], it.align || 'left', v => upd(x => { x.align = v; }))), field('Letter spacing', N('letterSpacing', { step: 0.1 })), field('Line spacing', numInput(it.lineHeight ?? 1.6, v => upd(x => { x.lineHeight = v; }), { step: 0.1, min: 0.6 })), field('Curve (arc radius)', h('div', { class: 'pair' }, numInput(it.arc || 0, v => upd(x => { x.arc = v; }), { step: 2, title: 'Bend the text over a circle: positive = arch up, negative = arch down, 0 = straight' }), h('button', { class: 'mini', title: 'Bend it around the nearest circle/part centre', onclick: () => { const r = Math.round((it.size || 2) * 6); upd(x => { x.arc = x.arc ? 0 : r; }); } }, 'toggle'))), field('Mirror', checkbox(it.mirror, v => upd(x => { x.mirror = v; }))), h('div', { class: 'hint' }, 'Stroke fonts render identically in every export. Silk text ≥1.0 mm cap / 0.15 mm stroke for JLC; heavy faces (triplex, gothic) need ≥2 mm.'));
      break;
    }
    case 'image': wrap.append(layerSel(), xy(), field('Width × Height', h('div', { class: 'pair' }, numInput(it.w, v => upd(x => { const asp = x.h / x.w; x.w = v; if (app.lockAspect !== false) x.h = v * asp; }), { step: 1, min: 0.5 }), numInput(it.h, v => upd(x => { const asp = x.w / x.h; x.h = v; if (app.lockAspect !== false) x.w = v * asp; }), { step: 1, min: 0.5 }))), field('Rotation', N('rot', { step: 15 })), field('Threshold', numInput(it.threshold ?? 128, v => upd(x => { x.threshold = v; }), { step: 8, min: 0, max: 255, live: true })), field('Invert', checkbox(it.invert, v => upd(x => { x.invert = v; }))), field('Dither', checkbox(it.dither, v => upd(x => { x.dither = v; }))), field('Mirror', checkbox(it.mirror, v => upd(x => { x.mirror = v; }))), h('div', { class: 'hint' }, 'Dark pixels become ink (silk / copper / mask opening). Exports vectorise the thresholded bitmap; keep features ≥ 0.15 mm.'),
      field('Resolution', h('div', { class: 'pair' }, numInput(it.dpi || 96, v => { if (v > 0) app.imageSetDpi(it, v); }, { step: 10, min: 10, title: 'Pixels per inch — sets the physical size' }), h('button', { class: 'mini', title: 'Size it exactly as the file says (its pixel size at its own dpi)', onclick: () => app.imageOriginalSize(it) }, 'Original size'))),
      field('', h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
        h('button', { class: 'mini', onclick: () => app.replaceImage(it) }, 'Replace image…'),
        h('button', { class: 'mini', title: 'Scale to 80% of the board width, keeping the aspect', onclick: () => { const [W] = boardSize(store.board); const k = W * 0.8 / it.w; store.mutate(d => { const x = d.boards[store.boardIndex].items.find(i => i.id === it.id); if (x) { x.w = +(x.w * k).toFixed(2); x.h = +(x.h * k).toFixed(2); } }, 'image size'); } }, 'Fit board'),
        h('button', { class: 'mini', title: 'Centre on the board', onclick: () => { const [W, H] = boardSize(store.board); store.mutate(d => { const x = d.boards[store.boardIndex].items.find(i => i.id === it.id); if (x) { x.x = W / 2; x.y = H / 2; } }, 'centre'); } }, 'Centre')))); break;
    case 'pad': wrap.append(xy(), field('Shape', select([['circle', 'circle'], ['rect', 'rect'], ['oval', 'oval'], ['roundrect', 'roundrect']], it.shape, v => upd(x => { x.shape = v; }))), field('Size W × H', h('div', { class: 'pair' }, N('w', { step: 0.1, min: 0.1 }), N('h', { step: 0.1, min: 0.1 }))), field('Drill (0 = SMD)', N('drill', { step: 0.1, min: 0 })), field('Slot length', N('slot', { step: 0.5, min: 0 })), field('Layer', select([['both', 'through-hole (both)'], ['F', 'top SMD'], ['B', 'bottom SMD']], it.layer, v => upd(x => { x.layer = v; }))), field('Rotation', N('rot', { step: 15 })), field('Name / Net', h('div', { class: 'pair' }, T('name'), T('net'))), field('Plated', checkbox(it.plated !== false, v => upd(x => { x.plated = v; }))), field('Mask margin', numInput(it.maskMargin ?? doc.drc.maskMargin, v => upd(x => { x.maskMargin = v; }), { step: 0.01 }))); break;
    case 'hole': wrap.append(xy(), field('Diameter', N('d', { step: 0.1, min: 0.3 })), h('div', { class: 'hint' }, 'Non-plated (NPTH). Use a Pad with drill for plated holes.')); break;
    case 'slot': wrap.append(xy(), field('Length', N('len', { step: 0.5, min: 0.5 })), field('Width', N('w', { step: 0.1, min: 0.5 })), field('Rotation', N('rot', { step: 15 }))); break;
    case 'via': wrap.append(xy(), field('Diameter', N('d', { step: 0.1, min: 0.3 })), field('Drill', N('drill', { step: 0.05, min: 0.2 })), field('Net', T('net')), field('Tented', checkbox(it.tented !== false, v => upd(x => { x.tented = v; })))); break;
    case 'path': wrap.append(layerSel(), field('Width', N('width', { step: 0.05, min: 0.05 })), field('Closed', checkbox(it.closed, v => upd(x => { x.closed = v; }))), field('Points', h('span', {}, it.points.length + ' (drag handles)')), field('', h('button', { class: 'mini', onclick: () => editPoints(it, upd) }, 'Edit points as text…'))); break;
    case 'trace': wrap.append(cuLayerSel(), field('Width', N('width', { step: 0.05, min: 0.1 })), field('Net', T('net')), field('Points', h('span', {}, it.points.length + ' (drag handles)'))); break;
    case 'region': wrap.append(cuLayerSel(), field('Net', T('net')), field('Points', h('span', {}, it.points.length + ' (drag handles)')), h('div', { class: 'hint' }, 'Filled copper polygon (no automatic clearance — keep other nets away).')); break;
    case 'part': {
      const fp = it.fp || getFootprint(it.lib);
      wrap.append(field('Reference', T('ref')), field('Value', T('value')), field('Footprint', h('span', { title: it.lib }, (fp?.name || it.lib), fp?.verify ? h('span', { class: 'badge warn', title: 'Dimensions not fully verified against a datasheet' }, 'verify') : null)), xy(), field('Rotation', N('rot', { step: 15 })), field('Side', select([['top', 'top'], ['bottom', 'bottom']], it.side, v => upd(x => { x.side = v; }))));
      if (fp?.through && doc.stack.enabled && store.boardIndex === 0) wrap.append(field('Through upper board', checkbox(it.through, v => upd(x => { x.through = v; }, 'through'))), h('div', { class: 'hint' }, `Adds a Ø${fp.through.d} mm hole in the upper board at this part${fp.panelDist != null ? `; ideal gap ${fp.panelDist} mm` : ''}${fp.bushingLen != null ? `, bushing ${fp.bushingLen} mm` : ''}.`));
      if (fp) wrap.append(h('div', { class: 'hint' }, `Height ${fp.height ?? '?'} mm · ${fp.pads?.length || 0} pads${fp.meta?.datasheet ? ' · ' : ''}`, fp.meta?.datasheet ? h('a', { href: fp.meta.datasheet, target: '_blank', style: { color: 'var(--accent2)' } }, 'datasheet') : null));
      if (fp?.desc) wrap.append(h('div', { class: 'hint' }, fp.desc));
      if (isUnmatched(it)) wrap.append(h('div', { class: 'hint' }, h('span', { class: 'badge warn' }, 'imported footprint'), ' not from the library — no 3D body, height or through-hole data until you match it.'));
      wrap.append(field('', h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
        h('button', { class: 'mini', onclick: () => app.replaceFootprintDialog([it]) }, 'Replace footprint…'),
        h('button', { class: 'mini', title: 'Select every part that uses this footprint', onclick: () => { const ids = store.board.items.filter(x => x.type === 'part' && x.lib === it.lib).map(x => x.id); store.select(ids); } }, 'Select same'))));
      wrap.append(field('Hide ref text', checkbox(it.hideRef, v => upd(x => { x.hideRef = v; }))), field('Locked', checkbox(it.locked, v => upd(x => { x.locked = v; }))));
      break;
    }
  }
  wrap.append(actions(editor, store, app));
}
function editPoints(it, upd) {
  const ta = h('textarea', { rows: 10, style: { width: '100%', fontFamily: 'var(--mono)' } }, it.points.map(p => p.map(v => +v.toFixed(3)).join(', ')).join('\n'));
  modal({ title: 'Polygon points (x, y per line, mm)', body: ta, buttons: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: () => { const pts = ta.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split(/[,\s]+/).map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite)); if (pts.length < 3) { toast('need ≥3 points', 'err'); return false; } upd(x => { x.points = pts; }); } }] });
}
function actions(editor, store, app) {
  const sel = store.selectedItems();
  const cuShapes = sel.filter(i => (i.type === 'rect' || i.type === 'circle' || i.type === 'polygon' || i.type === 'text') && (i.layer === 'F.Cu' || i.layer === 'B.Cu'));
  return h('div', { class: 'actions' },
    cuShapes.length ? h('button', { class: 'mini', title: 'Copy this copper shape to the mask layer so the copper is exposed (bare copper / HASL / gold art)', onclick: () => { const ids = []; store.mutate(d => { const b = d.boards[store.boardIndex]; for (const it of cuShapes) { const c = JSON.parse(JSON.stringify(it)); c.id = uid(); c.layer = it.layer.replace('.Cu', '.Mask'); b.items.push(c); ids.push(c.id); } }, 'mask opening'); store.select(ids); } }, '+ Expose (mask opening)') : null,
    h('button', { class: 'mini', onclick: () => editor.rotateSelection(90) }, '↻ 90°'), h('button', { class: 'mini', onclick: () => editor.rotateSelection(-90) }, '↺ 90°'),
    h('button', { class: 'mini', onclick: () => editor.flipSelectionSide() }, 'Flip side'), h('button', { class: 'mini', onclick: () => editor.duplicateSelection() }, 'Duplicate'),
    h('button', { class: 'mini', onclick: () => store.deleteSelected() }, 'Delete'),
    h('button', { class: 'mini', onclick: () => app.zoomToSelection() }, 'Zoom to'),
    store.doc.boards.length > 1 ? h('button', { class: 'mini', title: 'Move selection to the other board', onclick: () => app.moveSelectionToOtherBoard() }, 'To other board') : null);
}
function renderLinkProps(wrap, link, editor, store, app) {
  const fp = getFootprint(link.lib) || {};
  const upd = (fn) => store.mutate(d => { const l = d.stack.links.find(x => x.id === link.id); if (l) fn(l); }, 'stack');
  wrap.append(field('Kind', h('span', {}, link.kind + ' — ' + (fp.name || link.lib))), field('Position X / Y', h('div', { class: 'pair' }, numInput(link.x, v => upd(l => { l.x = v; })), numInput(link.y, v => upd(l => { l.y = v; })))));
  if (link.kind === 'standoff') {
    wrap.append(field('Thread', select([['standoff_m2', 'M2'], ['standoff_m25', 'M2.5'], ['standoff_m3', 'M3']], link.lib, v => upd(l => { l.lib = v; }))), field('Hole Ø override', numInput(link.opts?.holeD ?? fp.holeD ?? 3.2, v => upd(l => { l.opts = l.opts || {}; l.opts.holeD = v; }), { step: 0.1 })), h('div', { class: 'hint' }, `Length = stack gap (${store.doc.stack.gap} mm). Holes are added to both boards; a hex spacer is drawn in 3D.`));
  } else if (link.kind === 'connector') {
    const pr = fp.pair || {};
    wrap.append(field('Reference', textInput(link.ref || '', v => upd(l => { l.ref = v; }))), field('Rotation', numInput(link.rot || 0, v => upd(l => { l.rot = v; }), { step: 90 })), field('Type', select(stackConnectorOptions().map(o => [o.id, o.name]), link.lib, v => upd(l => { l.lib = v; }))), field('Swap halves', checkbox(link.opts?.flip, v => upd(l => { l.opts = l.opts || {}; l.opts.flip = v; }), 'female on lower board')));
    wrap.append(h('div', { class: 'hint' }, `Lower board (top side): ${link.opts?.flip ? pr.upper : pr.lower} · Upper board (bottom side): ${link.opts?.flip ? pr.lower : pr.upper}. Gap ${pr.nominalGap} nominal (${pr.minGap}–${pr.maxGap}). ${fp.note || ''}`));
  }
  wrap.append(actions(editor, store, app));
}
function renderBoardProps(wrap, editor, store, app) {
  const doc = store.doc, b = store.board;
  const upd = (fn, label = 'board') => store.mutate(d => fn(d.boards[store.boardIndex], d), label);
  wrap.append(h('h4', {}, `Board: ${b.name}`));
  wrap.append(field('Name', textInput(b.name, v => upd(x => { x.name = v; }))));
  const o = b.outline;
  wrap.append(field('Shape', select([['rect', 'Rectangle'], ['circle', 'Circle'], ['polygon', 'Polygon']], o.type, v => upd(x => { const [W, H] = boardSize(x); if (v === 'rect') x.outline = { type: 'rect', w: W, h: H, r: 0 }; else if (v === 'circle') x.outline = { type: 'circle', d: Math.max(W, H) }; else x.outline = { type: 'polygon', points: [[0, 0], [W, 0], [W, H], [0, H]] }; }))));
  if (o.type === 'rect') wrap.append(field('Width × Height', h('div', { class: 'pair' }, numInput(o.w, v => upd(x => { x.outline.w = v; }), { step: 1, min: 3 }), numInput(o.h, v => upd(x => { x.outline.h = v; }), { step: 1, min: 3 }))), field('Corner radius', numInput(o.r || 0, v => upd(x => { x.outline.r = v; }), { step: 0.5, min: 0 })), field('Preset', select([['', '— pick —'], ...SIZE_PRESETS.filter(p => !p.circle && p.id !== 'custom').map(p => [p.id, p.name])], '', v => { const p = SIZE_PRESETS.find(x => x.id === v); if (p) upd(x => { x.outline.w = p.w; x.outline.h = p.h; }); })));
  else if (o.type === 'circle') wrap.append(field('Diameter', numInput(o.d, v => upd(x => { x.outline.d = v; }), { step: 1, min: 3 })));
  else wrap.append(field('Points', h('span', {}, o.points.length)), field('', h('button', { class: 'mini', onclick: () => editPoints({ points: o.points }, fn => upd(x => { const t = { points: x.outline.points }; fn(t); x.outline.points = t.points; })) }, 'Edit points as text…')), h('div', { class: 'hint' }, 'Tip: import an outline from SVG/DXF via File → Import, or draw a polygon on Edge.Cuts and use “Use as outline” (right panel when selected).'));
  wrap.append(field('Thickness', select(THICKNESSES.map(t => [t, t + ' mm']), b.thickness, v => upd(x => { x.thickness = +v; }))));
  wrap.append(field('Mask colour', h('div', { class: 'swatches', style: { display: 'flex', gap: '4px' } }, Object.entries(BOARD_COLORS).map(([k, c]) => h('div', { class: 'swatch' + (b.color === k ? ' on' : ''), title: c.name, style: { background: c.mask, width: '22px', height: '18px', borderRadius: '3px', border: b.color === k ? '2px solid var(--accent)' : '2px solid transparent', cursor: 'pointer' }, onclick: () => upd(x => { x.color = k; }) })))));
  wrap.append(field('Silk colour', select([['white', 'White'], ['black', 'Black']], b.silkColor, v => upd(x => { x.silkColor = v; }))), field('Finish', select(FINISHES.map(f => [f, f]), b.finish, v => upd(x => { x.finish = v; }))), field('Copper', select([[1, '1 oz'], [2, '2 oz']], b.copperOz, v => upd(x => { x.copperOz = +v; }))));
  if (doc.boards.length > 1) wrap.append(field('Offset in stack', h('div', { class: 'pair' }, numInput(b.offset?.x || 0, v => upd(x => { x.offset = x.offset || { x: 0, y: 0 }; x.offset.x = v; })), numInput(b.offset?.y || 0, v => upd(x => { x.offset = x.offset || { x: 0, y: 0 }; x.offset.y = v; })))));
  // stack section
  wrap.append(h('h4', {}, 'Stack'));
  if (!doc.stack.enabled || doc.boards.length < 2) {
    wrap.append(h('div', { class: 'hint' }, 'Single board.'), h('button', { class: 'mini', onclick: () => app.addSecondBoard() }, '+ Add second board (sandwich)'));
  } else {
    const st = doc.stack; const types = [...STACK_CONNECTOR_TYPES, ...HARDWARE_STACK_TYPES];
    const conns = st.links.filter(l => l.kind === 'connector'); const sos = st.links.filter(l => l.kind === 'standoff' || l.kind === 'screw');
    const gapRange = conns.map(l => getFootprint(l.lib)?.pair).filter(Boolean);
    const gapOk = gapRange.every(p => st.gap >= p.minGap - 1e-6 && st.gap <= p.maxGap + 1e-6);
    wrap.append(field('Gap (mm)', h('div', { class: 'pair' }, numInput(st.gap, v => store.mutate(d => { d.stack.gap = v; d.stack.gapSource = 'manual'; }, 'gap'), { step: 0.5, min: 1 }), h('span', { class: 'badge ' + (gapOk ? 'ok' : 'err') }, gapOk ? 'ok' : 'check'))));
    if (gapRange.length) wrap.append(h('div', { class: 'hint' }, `Connector allows ${Math.max(...gapRange.map(p => p.minGap))}–${Math.min(...gapRange.map(p => p.maxGap))} mm (nominal ${gapRange[0].nominalGap}). `, h('button', { class: 'mini', onclick: () => store.mutate(d => { d.stack.gap = gapRange[0].nominalGap; d.stack.gapSource = 'connector'; }, 'gap') }, 'Use nominal')));
    const std = getFootprint('standoff_m3')?.meta?.lengths || [];
    wrap.append(h('div', { class: 'hint' }, `Standoffs: ${sos.length} × ${st.gap} mm ${std.includes(st.gap) ? '(stock length ✓)' : '(not stock — nearest ' + std.reduce((bb, a) => Math.abs(a - st.gap) < Math.abs(bb - st.gap) ? a : bb, std[0]) + ')'} · Connectors: ${conns.length}`));
    wrap.append(h('div', { class: 'actions' },
      h('button', { class: 'mini', onclick: () => { store.mutate(d => addStackStandoffs(d, { inset: 4 }), 'standoffs'); } }, '+ 4 corner standoffs'),
      h('button', { class: 'mini', onclick: () => app.addConnectorDialog() }, '+ Connector…'),
      h('button', { class: 'mini', onclick: () => app.showHardware() }, 'Hardware list'),
      h('button', { class: 'mini', onclick: () => app.removeSecondBoard() }, 'Remove upper board')));
    // list links
    for (const l of st.links) { const fp = getFootprint(l.lib) || {}; wrap.append(h('div', { class: 'linkrow' + (store.selection.has(l.id) ? ' on' : ''), onclick: () => store.select(l.id) }, h('span', {}, l.kind === 'connector' ? '⧉' : '⬡'), h('span', {}, `${l.ref ? l.ref + ' ' : ''}${fp.name || l.lib} @ ${(+l.x).toFixed(1)}, ${(+l.y).toFixed(1)}`), h('button', { class: 'mini del', onclick: (e) => { e.stopPropagation(); store.mutate(d => { d.stack.links = d.stack.links.filter(x => x.id !== l.id); }, 'delete'); } }, '×'))); }
    const thr = doc.boards[0].items.filter(i => i.type === 'part' && i.through);
    if (thr.length) wrap.append(h('div', { class: 'hint' }, 'Through parts: ' + thr.map(p => p.ref).join(', ')));
  }
  wrap.append(h('h4', {}, 'Document'));
  wrap.append(field('Project name', textInput(doc.name, v => store.mutate(d => { d.name = v; }, 'name'))), field('Design rules', select(Object.entries(DRC_PRESETS).map(([k, v]) => [k, v.name]), doc.drcPreset, v => store.mutate(d => { d.drcPreset = v; }, 'drc'))), field('Mask margin', numInput(doc.drc.maskMargin, v => store.mutate(d => { d.drc.maskMargin = v; }, 'drc'), { step: 0.01 })), field('Notes', textInput(doc.meta?.notes || '', v => store.mutate(d => { d.meta.notes = v; }, 'notes'))));
}

// ---------- parts panel ----------
export function renderPartsPanel(el, editor, store, query = '') {
  clear(el);
  const q = (query || '').trim();
  const list = q ? searchParts(q) : null;
  const byCat = partsByCategory();
  const stackOpts = store.doc.stack.enabled ? stackConnectorOptions() : [];
  const cats = q ? { Results: list } : { ...(stackOpts.length ? { 'Stack (both boards)': [{ id: 'standoff_m3', name: 'Standoff M3', tags: [] }, { id: 'standoff_m25', name: 'Standoff M2.5', tags: [] }, { id: 'standoff_m2', name: 'Standoff M2', tags: [] }, ...stackOpts] } : {}), ...byCat };
  const closed = editor._catsClosed ||= new Set(['Passives', 'ICs', 'Connectors', 'Imported']);
  for (const [cat, parts] of Object.entries(cats)) {
    if (!parts || !parts.length) continue;
    const head = h('div', { class: 'cat' + (closed.has(cat) && !q ? ' closed' : ''), onclick: () => { if (closed.has(cat)) closed.delete(cat); else closed.add(cat); head.classList.toggle('closed'); } }, `${cat} (${parts.length})`);
    const items = h('div', { class: 'items' });
    for (const p of parts) {
      const row = h('div', { class: 'pt' + (editor.tool === 'part' && editor.toolParams.partLib === p.id ? ' on' : ''), title: (p.desc || '') + (p.verify ? ' ⚠ verify vs datasheet' : ''), onclick: () => { editor.setTool('part', { partLib: p.id }); renderPartsPanel(el, editor, store, query); } }, h('span', {}, p.name, p.verify ? h('span', { class: 'verify' }, ' ⚠') : null), h('small', {}, p.pair ? `${p.pair.nominalGap} mm` : (p.height ? p.height + ' mm' : '')));
      items.append(row);
    }
    el.append(head, items);
  }
  if (!q) el.append(h('div', { class: 'cat', style: { cursor: 'default' } }, ''), h('button', { class: 'mini', onclick: () => editor.hooks.importFootprint && editor.hooks.importFootprint() }, 'Import KiCad footprint (.kicad_mod)…'));
}

// ---------- DRC ----------
export function renderDRC(el, findings, editor, store, app) {
  clear(el);
  if (!findings) { el.append(h('div', { class: 'summary' }, 'Run DRC to check fab rules, edges, clearances and the stack.')); return; }
  const s = drcSummary(findings);
  el.append(h('div', { class: 'summary' }, `${s.errors} errors · ${s.warnings} warnings · ${s.infos} notes — ${DRC_PRESETS[store.doc.drcPreset]?.name || ''}`));
  const order = { error: 0, warn: 1, info: 2 };
  for (const f of findings.slice().sort((a, b) => order[a.level] - order[b.level])) {
    el.append(h('div', { class: 'f ' + f.level, onclick: () => { store.setBoardIndex(f.board); editor.zoomToBBox([f.x - 8, f.y - 8, f.x + 8, f.y + 8]); const ids = (f.ids || []).filter(id => id && store.board.items.some(i => i.id === id)); if (ids.length) store.select(ids); } }, h('span', { class: 'lv' }, f.level === 'error' ? 'ERR' : f.level === 'warn' ? 'WARN' : 'i'), h('span', {}, `${store.doc.boards[f.board]?.name || ''}: ${f.msg}`)));
  }
}


// grouped font picker
export function fontSelect(value, onChange) {
  const sel = h('select', {});
  for (const cat of FONT_CATS) {
    const g = document.createElement('optgroup'); g.label = cat;
    for (const f of FONT_LIST.filter(x => x.cat === cat)) { const o = h('option', { value: f.id, selected: f.id === (value || 'sans'), title: f.note }, f.name); g.append(o); }
    sel.append(g);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
