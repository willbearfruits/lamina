// LAMINA application shell: menus, toolbar, panels, keyboard, file IO, export dialog, autosave.
import { Store, newDocument, newBoard, makeItem, serializeDoc, parseDoc, validateDoc, boardSize, addMountingHoles, addStackStandoffs, uid, nextRef, BOARD_COLORS } from './model.js';
import { Editor2D, TOOL_HINTS, isTyping } from './editor2d.js';
import { View3D } from './view3d.js';
import { runWizard } from './wizard.js';
import { renderLayersPanel, renderProps, renderPartsPanel, renderDRC, fontSelect } from './panels.js';
import { h, clear, modal, toast, confirmDlg, promptDlg, select, numInput, checkbox, field, contextMenu, closeContextMenu, textInput } from './ui.js';
import { suggestReplacements, groupUnmatched, isUnmatched, padStats, scoreMatch } from './match.js';
import { drawFootprint } from './fppreview.js';
import { openDesignStudio, OPS } from './effects.js';
import { imagePlacement, imageDensity, naturalSizeMm, loadImage as loadImg } from './import/image.js';
import { runDRC, drcSummary, DRC_PRESETS } from './drc.js';
import { GRAPHIC_LAYERS, itemBBox, unionBBox, stackLinkItems, resolveBoard, translateItem } from './geom.js';
import { ImageCache, readFileAsDataURL, loadImage } from './import/image.js';
import { makeZip, downloadBytes, downloadText, safeName, stamp } from './export/common.js';
import { getFootprint, registerPart, stackConnectorOptions } from './library.js';
import { hardwareList } from './export/bom.js';

const APP_VERSION = '0.1.0';
const AUTOSAVE_KEY = 'lamina.autosave.v1';

class App {
  constructor() {
    this.store = new Store(newDocument({ name: 'untitled' }));
    this.imageCache = new ImageCache();
    this.canvas = document.getElementById('canvas2d');
    this.editor = new Editor2D(this.canvas, this.store, {
      imageCache: this.imageCache,
      status: (m) => this.setStatus(m),
      coords: (x, y) => { document.getElementById('st-coords').textContent = `x ${x.toFixed(2)}  y ${y.toFixed(2)}`; },
      hud: (t) => { document.getElementById('hud').textContent = t; },
      toolChanged: (t) => this.refreshTools(),
      focusProp: (id) => setTimeout(() => { const el = document.getElementById('prop-' + id); if (el) { el.focus(); el.select && el.select(); } }, 30),
      pickImage: () => this.pickImageForTool(),
      contextMenu: (x, y, pos, hit) => this.contextMenuAt(x, y, pos, hit),
      partPicked: (lib) => { this.recentParts = [lib, ...(this.recentParts || []).filter(l => l !== lib)].slice(0, 8); },
      importFootprint: () => this.importKicadFootprint(),
    });
    this.view3d = null; this.currentView = '2d'; this.drcFindings = null; this.fileName = null; this.lockAspect = true;
    this.buildMenus(); this.buildToolbar(); this.buildTools(); this.bindKeys(); this.bindStore(); this.bindResize();
    this.refreshAll();
    this.electron = !!window.lamina;
    if (this.electron && window.lamina.onCommand) window.lamina.onCommand(cmd => this.command(cmd));
    this.startup();
  }
  // ---------- startup / autosave ----------
  startup() {
    if (location.search.includes('selftest')) { import('./selftest.js').then(m => m.runSelfTest(this)); return; }
    const qs = new URLSearchParams(location.search); const load = qs.get('load');
    if (load) { fetch(load).then(r => r.text()).then(t => { this.fileName = load.split('/').pop(); this.loadDoc(parseDoc(t)); const b = parseInt(qs.get('board') || '0'); if (b) this.store.setBoardIndex(b); if (qs.get('view') === '3d') setTimeout(() => { this.showView('3d'); setTimeout(() => this.view3d.viewFrom(qs.get('from') || 'iso'), 300); }, 200); if (qs.get('flip')) this.editor.setFlip(true); }).catch(e => toast('Could not load ' + load + ': ' + e.message, 'err', 6000)); return; }
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    let restored = false;
    if (saved) { try { const d = JSON.parse(saved); if (d && d.doc && d.doc.boards) { const shortcuts = [{ label: `Restore "${d.doc.name}" (autosave ${new Date(d.at).toLocaleString()})`, run: () => { this.loadDoc(parseDoc(d.doc)); toast('Restored autosave'); } }, { label: 'Open file…', run: () => this.openFile() }]; runWizard(doc => this.loadDoc(doc), { shortcuts }); restored = true; } } catch (e) { /* ignore */ } }
    if (!restored) runWizard(doc => this.loadDoc(doc), { shortcuts: [{ label: 'Open file…', run: () => this.openFile() }, { label: 'Import KiCad board…', run: () => this.importKicadBoard() }, { label: 'Import DipTrace board (.asc)…', run: () => this.importDiptraceBoard() }, { label: 'Browse examples…', run: () => this.browseExamples() }] });
  }
  // Examples are listed in examples/index.json (written by tools/make_examples.mjs),
  // so adding one is a generator edit — no UI change, and the same list feeds
  // the opening wizard and the Help menu.
  // Bundled assets: fetch() on the web, an allow-listed IPC read in the
  // desktop build (Chromium blocks fetch on file:// URLs, so the packaged
  // app would otherwise have no examples at all).
  async _appText(rel) {
    if (this.electron && window.lamina.readAppFile) {
      const t = await window.lamina.readAppFile(rel);
      if (t == null) throw new Error('not found: ' + rel);
      return t;
    }
    const r = await fetch(rel);
    if (!r.ok) throw new Error(String(r.status));
    return r.text();
  }
  async exampleIndex() {
    if (this._examples) return this._examples;
    try { this._examples = JSON.parse(await this._appText('examples/index.json')); }
    catch { this._examples = []; }
    return this._examples;
  }
  async browseExamples() {
    const list = await this.exampleIndex();
    if (!list.length) { toast('No examples found next to the app', 'err'); return; }
    const body = h('div', { class: 'examples' });
    for (const ex of list) {
      const card = h('button', { class: 'example-card', onclick: () => { close(); this.loadExample(ex.file); } },
        h('div', { class: 'example-title' }, ex.title),
        h('div', { class: 'example-blurb' }, ex.blurb),
        h('div', { class: 'example-meta hint' }, `${ex.boards} · ${ex.parts} part${ex.parts === 1 ? '' : 's'}`));
      body.append(card);
    }
    let dlg;
    const close = () => dlg && dlg.close();
    dlg = modal({ title: 'Open an example', body, width: '640px', buttons: [{ label: 'Cancel' }] });
    return dlg;
  }
  loadExample(name) { this._appText(`examples/${name}.lamina.json`).then(t => { this.fileName = null; this.loadDoc(parseDoc(t)); toast('Example loaded — File → Save as to keep your own copy'); }).catch(e => toast('Could not load example: ' + e.message, 'err')); }
  autosave() { clearTimeout(this._as); this._as = setTimeout(() => { try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ at: Date.now(), doc: this.store.doc })); } catch (e) { /* quota */ } }, 800); }
  loadDoc(doc) { const errs = validateDoc(doc); if (errs.length) toast(errs.slice(0, 3).join('; '), 'err', 5000); this.store.replaceDoc(doc); this.drcFindings = null; this.editor.drcMarkers = []; this.refreshAll(); this.editor.fitToBoard(); this.editor.setTool('select'); }
  // ---------- store binding ----------
  bindStore() {
    this.store.on('change', (e) => { this.autosave(); this.refreshPanels(); if (this.view3d && this.currentView === '3d') this.view3d.rebuild(); });
    this.store.on('selection', () => this.refreshProps());
    this.store.on('board', () => { this.refreshBoardTabs(); this.refreshPanels(); });
    this.store.on('doc', () => { this.refreshBoardTabs(); this.refreshPanels(); });
  }
  bindResize() { const ro = new ResizeObserver(() => { this.editor.resize(); if (this.view3d) this.view3d.resize(); }); ro.observe(document.getElementById('canvaswrap')); this.editor.resize(); }
  refreshAll() { this.refreshBoardTabs(); this.refreshPanels(); this.refreshTools(); document.getElementById('docname').textContent = this.store.doc.name + (this.fileName ? ' — ' + this.fileName : ''); }
  refreshPanels() { renderLayersPanel(document.getElementById('layers'), this.editor, this.store); this.refreshProps(); renderPartsPanel(document.getElementById('partlist'), this.editor, this.store, document.getElementById('partsearch').value); renderDRC(document.getElementById('drclist'), this.drcFindings, this.editor, this.store, this); document.getElementById('docname').textContent = this.store.doc.name + (this.fileName ? ' — ' + this.fileName : ''); this.updateStatusBar(); }
  refreshProps() { renderProps(document.getElementById('props'), document.getElementById('props-title'), this.editor, this.store, this); }
  refreshBoardTabs() {
    const el = clear(document.getElementById('boardtabs')); const doc = this.store.doc;
    doc.boards.forEach((b, i) => el.append(h('button', { class: i === this.store.boardIndex ? 'on' : '', onclick: () => this.store.setBoardIndex(i), title: b.role === 'upper' ? 'Upper board (panel)' : 'Lower board' }, `${i === 0 ? '▁ ' : '▔ '}${b.name}`)));
    if (doc.boards.length < 2) el.append(h('button', { class: 'mini', title: 'Add a second board (sandwich)', onclick: () => this.addSecondBoard(), style: { alignSelf: 'center' } }, '+ board'));
    const flip = this.editor.view.flip;
    const setSide = (b) => { if (this.editor.view.flip !== b) { this.editor.setFlip(b); this.refreshBoardTabs(); this.refreshPanels(); } };
    el.append(h('div', { id: 'sideswitch', title: 'Which side of the board you are looking at (Shift+V) — the bottom view is mirrored, like the real board' },
      h('button', { class: flip ? '' : 'on', onclick: () => setSide(false) }, 'TOP'),
      h('button', { class: flip ? 'on bottom' : '', onclick: () => setSide(true) }, 'BOTTOM')));
    el.append(h('span', { class: 'side-note' }, flip ? 'mirrored view' : ''));
  }
  updateStatusBar() { document.getElementById('st-grid').textContent = `grid ${this.editor.grid.size} mm`; document.getElementById('st-snap').textContent = (this.editor.grid.snap ? 'grid snap' : 'no grid snap') + (this.editor.grid.objects ? ' + objects' : ''); document.getElementById('st-zoom').textContent = `${(this.editor.view.scale / this.editor.dpr).toFixed(1)} px/mm`; }
  setStatus(m) { document.getElementById('st-msg').textContent = m || ''; }
  // ---------- menus ----------
  buildMenus() {
    const M = (label, items) => { const dd = h('div', { class: 'dd' }); for (const it of items) { if (it === '-') { dd.append(h('div', { class: 'sep' })); continue; } dd.append(h('div', { class: 'it' + (it.disabled ? ' disabled' : ''), onclick: () => { closeAll(); it.run(); } }, h('span', {}, it.label), h('span', { class: 'k' }, it.key || ''))); } const m = h('div', { class: 'menu' }, h('button', { onclick: (e) => { const was = m.classList.contains('open'); closeAll(); if (!was) m.classList.add('open'); e.stopPropagation(); }, onmouseenter: () => { if (document.querySelector('.menu.open')) { closeAll(); m.classList.add('open'); } } }, label), dd); return m; };
    const closeAll = () => document.querySelectorAll('.menu.open').forEach(x => x.classList.remove('open'));
    document.addEventListener('click', closeAll);
    const menus = document.getElementById('menus');
    menus.append(
      M('File', [{ label: 'New project…', key: 'Ctrl+N', run: () => this.newProject() }, { label: 'Open…', key: 'Ctrl+O', run: () => this.openFile() }, { label: 'Open example…', run: () => this.browseExamples() }, { label: 'Save', key: 'Ctrl+S', run: () => this.save() }, { label: 'Save as…', key: 'Ctrl+Shift+S', run: () => this.save(true) }, '-', { label: 'Import KiCad board (.kicad_pcb)…', run: () => this.importKicadBoard() }, { label: 'Import KiCad footprint (.kicad_mod)…', run: () => this.importKicadFootprint() }, { label: 'Import DipTrace board (ASCII .asc)…', run: () => this.importDiptraceBoard() }, { label: 'Import SVG graphics…', run: () => this.importSvgGraphics() }, { label: 'Import image (PNG/JPG)…', run: () => this.pickImageForTool() }, '-', { label: 'Export…', key: 'Ctrl+E', run: () => this.exportDialog() }, { label: 'Quick: JLCPCB zip (this board)', run: () => this.quickExport('fab') }, { label: 'Quick: KiCad', run: () => this.quickExport('kicad') }, { label: 'Quick: PNG renders', run: () => this.quickExport('png') }, '-', { label: 'Project settings (name, rules)', run: () => { this.store.clearSelection(); } }]),
      M('Edit', [{ label: 'Undo', key: 'Ctrl+Z', run: () => this.store.undo() }, { label: 'Redo', key: 'Ctrl+Y', run: () => this.store.redo() }, '-', { label: 'Select all', key: 'Ctrl+A', run: () => this.editor.selectAll() }, { label: 'Copy', key: 'Ctrl+C', run: () => this.editor.copySelection() }, { label: 'Cut', key: 'Ctrl+X', run: () => this.editor.cutSelection() }, { label: 'Paste (at cursor)', key: 'Ctrl+V', run: () => this.editor.paste() }, { label: 'Duplicate', key: 'Ctrl+D', run: () => this.editor.duplicateSelection() }, { label: 'Delete', key: 'Del', run: () => this.store.deleteSelected() }, '-', { label: 'Rotate 90° CCW', key: 'R', run: () => this.editor.rotateSelection(90) }, { label: 'Rotate 90° CW', key: 'Shift+R', run: () => this.editor.rotateSelection(-90) }, { label: 'Rotate by…', run: async () => { const v = parseFloat(await promptDlg('Rotate by (degrees, CCW)', '45')); if (Number.isFinite(v)) this.editor.rotateSelection(v); } }, { label: 'Flip side (top↔bottom)', key: 'F', run: () => this.editor.flipSelectionSide() }, { label: 'Move to other board', run: () => this.moveSelectionToOtherBoard() }, { label: 'Align / distribute…', run: () => this.alignDialog() }, { label: 'Repeat / array…', run: () => this.arrayDialog() }, { label: 'Mirror horizontally', run: () => this.editor.mirrorSelection('h') }, { label: 'Mirror vertically', run: () => this.editor.mirrorSelection('v') }, '-', { label: 'Use selected polygon as board outline', run: () => this.useAsOutline() }, '-', { label: 'Replace footprint…', run: () => this.replaceFootprintDialog(this.store.selectedItems().filter(i => i.type === 'part')) }, { label: 'Match imported parts to library…', run: () => this.matchUnknownDialog() }]),
      M('View', [{ label: 'Fit board', key: 'Home', run: () => this.editor.fitToBoard() }, { label: 'Zoom in', key: '+', run: () => this.editor.zoomAt(this.canvas.width / 2, this.canvas.height / 2, 1.25) }, { label: 'Zoom out', key: '−', run: () => this.editor.zoomAt(this.canvas.width / 2, this.canvas.height / 2, 0.8) }, { label: 'Zoom to selection', run: () => this.zoomToSelection() }, '-', { label: 'View from bottom', key: 'V', run: () => { this.editor.setFlip(!this.editor.view.flip); this.refreshBoardTabs(); } }, { label: 'Realistic / Layers mode', key: 'M', run: () => { this.editor.mode = this.editor.mode === 'realistic' ? 'layers' : 'realistic'; this.refreshPanels(); this.editor.requestRender(); } }, { label: 'Toggle grid', key: 'G', run: () => { this.editor.grid.show = !this.editor.grid.show; this.editor.requestRender(); } }, { label: 'Toggle snap', key: 'S', run: () => { this.editor.grid.snap = !this.editor.grid.snap; this.updateStatusBar(); } }, '-', { label: '2D editor', key: '1', run: () => this.showView('2d') }, { label: '3D preview', key: '2', run: () => this.showView('3d') }]),
      M('Design', [{ label: 'Design studio (generators & effects)…', key: 'Ctrl+G', run: () => openDesignStudio(this) },
        '-', ...OPS.filter(o => o.kind === 'gen').slice(0, 8).map(o => ({ label: 'Generate: ' + o.name, run: () => openDesignStudio(this, o.id) })),
        '-', ...OPS.filter(o => o.kind === 'fx').map(o => ({ label: o.name, run: () => openDesignStudio(this, o.id) }))]),
      M('Board', [{ label: 'Board settings (deselect)', run: () => this.store.clearSelection() }, { label: 'Add 4 corner mounting holes…', run: () => this.addMountHolesDialog() }, { label: 'Add second board (sandwich)', run: () => this.addSecondBoard() }, { label: 'Remove upper board', run: () => this.removeSecondBoard() }, { label: 'Swap upper/lower boards', run: () => this.swapBoards() }, '-', { label: 'Stack: add connector…', run: () => this.addConnectorDialog() }, { label: 'Stack: add 4 corner standoffs', run: () => this.store.mutate(d => addStackStandoffs(d, { inset: 4 }), 'standoffs') }, { label: 'Stack: hardware list', run: () => this.showHardware() }, '-', { label: 'Run design rule check', key: 'Ctrl+R', run: () => this.runDRC() }, { label: 'Clear DRC markers', run: () => { this.drcFindings = null; this.editor.drcMarkers = []; this.refreshPanels(); this.editor.requestRender(); } }]),
      M('Help', [{ label: 'Keyboard shortcuts', key: '?', run: () => this.showShortcuts() }, { label: 'Browse examples…', run: () => this.browseExamples() }, '-', { label: 'How exports map to tools (JLC, KiCad, DipTrace, FlatCAM, Blender)', run: () => this.showExportGuide() }, { label: 'About LAMINA', run: () => modal({ title: 'LAMINA ' + APP_VERSION, body: h('div', {}, h('p', {}, 'PCB design studio — board shape, colours, holes, graphics, copper art, parts, two-board sandwiches, 3D preview, and exports for JLCPCB, KiCad, DipTrace, FlatCAM, Blender, CNC.'), h('p', { class: 'hint' }, 'No build step, no cloud: everything runs locally in this window. Project files are plain JSON (.lamina.json).')), buttons: [{ label: 'Close' }] }) }]),
    );
    document.querySelectorAll('#viewtabs button').forEach(b => b.addEventListener('click', () => this.showView(b.dataset.view)));
    document.getElementById('btn-drc').addEventListener('click', () => this.runDRC());
    document.getElementById('partsearch').addEventListener('input', (e) => renderPartsPanel(document.getElementById('partlist'), this.editor, this.store, e.target.value));
    document.getElementById('filein').addEventListener('change', (e) => this._onFileInput(e));
  }
  buildTools() {
    const tools = [['select', '↖', 'Select (V)'], ['line', '╱', 'Line (L)'], ['rect', '▭', 'Rectangle (R)'], ['circle', '○', 'Circle (C)'], ['arc', '◜', 'Arc (A)'], ['polygon', '⬠', 'Polygon (P)'], ['text', 'T', 'Text (T)'], ['image', '🖼', 'Image (I)'], ['measure', '⟷', 'Measure (K)'], ['pad', '◉', 'Pad (D)'], ['hole', '◌', 'Hole (H)'], ['slot', '⬭', 'Slot'], ['via', '•', 'Via'], ['trace', '⤳', 'Trace (W)'], ['region', '▰', 'Copper region'], ['part', '⊞', 'Place part']];
    const el = clear(document.getElementById('tools'));
    for (const [id, ic, title] of tools) el.append(h('button', { 'data-tool': id, title, onclick: () => this.editor.setTool(id) }, h('span', { class: 'ic' }, ic), id));
    this.refreshTools();
  }
  refreshTools() { document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === this.editor.tool)); }
  buildToolbar() {
    const tb = clear(document.getElementById('toolbar')); const ed = this.editor; const tp = ed.toolParams;
    const layerSel = select(GRAPHIC_LAYERS.concat(['Edge.Cuts']).map(l => [l, l]), ed.activeLayer, v => { ed.activeLayer = v; this.refreshPanels(); ed.requestRender(); }); layerSel.id = 'tb-layer';
    tb.append(h('div', { class: 'grp' }, h('label', {}, 'Layer'), layerSel));
    tb.append(h('div', { class: 'grp' }, h('label', {}, 'Line'), numInput(tp.width, v => { tp.width = v; }, { step: 0.05, min: 0.05, title: 'Line width (mm)' }), checkbox(tp.filled, v => { tp.filled = v; }, 'filled')));
    tb.append(h('div', { class: 'grp' }, h('label', {}, 'Text'), numInput(tp.textSize, v => { tp.textSize = v; }, { step: 0.25, min: 0.3, title: 'Text cap height (mm)' }), numInput(tp.textThick, v => { tp.textThick = v; }, { step: 0.05, min: 0.05, title: 'Stroke (mm)' }), fontSelect(tp.textFont || 'sans', v => { tp.textFont = v; })));
    tb.append(h('div', { class: 'grp' }, h('label', {}, 'Pad'), select([['circle', '●'], ['rect', '■'], ['oval', '⬬'], ['roundrect', '▢']], tp.padShape, v => { tp.padShape = v; }), numInput(tp.padW, v => { tp.padW = v; }, { step: 0.1, min: 0.1, title: 'Pad W' }), numInput(tp.padH, v => { tp.padH = v; }, { step: 0.1, min: 0.1, title: 'Pad H' }), h('label', {}, 'drill'), numInput(tp.padDrill, v => { tp.padDrill = v; }, { step: 0.1, min: 0, title: 'Drill Ø (0 = SMD)' })));
    tb.append(h('div', { class: 'grp' }, h('label', {}, 'Hole Ø'), numInput(tp.holeD, v => { tp.holeD = v; }, { step: 0.1, min: 0.3 }), h('label', {}, 'Trace'), numInput(tp.traceWidth, v => { tp.traceWidth = v; }, { step: 0.05, min: 0.1 }), h('label', {}, 'Via'), numInput(tp.viaD, v => { tp.viaD = v; }, { step: 0.1, min: 0.3, title: 'Via Ø' }), numInput(tp.viaDrill, v => { tp.viaDrill = v; }, { step: 0.05, min: 0.2, title: 'Via drill' })));
    tb.append(h('div', { class: 'grp' }, h('label', {}, 'Grid'), select([[0.1, '0.1'], [0.25, '0.25'], [0.5, '0.5'], [1, '1'], [1.27, '1.27'], [2, '2'], [2.54, '2.54'], [5, '5']], ed.grid.size, v => { ed.grid.size = +v; this.updateStatusBar(); ed.requestRender(); }), checkbox(ed.grid.snap, v => { ed.grid.snap = v; this.updateStatusBar(); }, 'snap'), checkbox(ed.grid.objects, v => { ed.grid.objects = v; this.updateStatusBar(); }, 'objects')));
    tb.append(h('div', { class: 'grp' }, h('button', { class: 'mini', title: 'Generators & effects (Ctrl+G)', onclick: () => openDesignStudio(this) }, '✦ Design'), h('button', { class: 'mini', onclick: () => this.runDRC() }, '✓ DRC'), h('button', { class: 'mini primary', onclick: () => this.exportDialog() }, '⇩ Export…')));
  }
  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (isTyping()) { if (e.key === 'Escape') document.activeElement.blur(); return; }
      const k = e.key; const ctrl = e.ctrlKey || e.metaKey; const ed = this.editor;
      if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.store.redo(); else this.store.undo(); return; }
      if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); this.store.redo(); return; }
      if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); this.save(e.shiftKey); return; }
      if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); this.openFile(); return; }
      if (ctrl && k.toLowerCase() === 'n') { e.preventDefault(); this.newProject(); return; }
      if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); this.exportDialog(); return; }
      if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); ed.selectAll(); return; }
      if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); ed.duplicateSelection(); return; }
      if (ctrl && k.toLowerCase() === 'c') { e.preventDefault(); ed.copySelection(); return; }
      if (ctrl && k.toLowerCase() === 'x') { e.preventDefault(); ed.cutSelection(); return; }
      if (ctrl && k.toLowerCase() === 'v') { e.preventDefault(); ed.paste(); return; }
      if (ctrl && k.toLowerCase() === 'r') { e.preventDefault(); this.runDRC(); return; }
      if (ctrl && k.toLowerCase() === 'g') { e.preventDefault(); openDesignStudio(this); return; }
      if (ctrl) return;
      switch (k) {
        case 'Escape': ed.cancelTool(); break;
        case 'Enter': ed.finishTool(); break;
        case 'Delete': case 'Backspace': this.store.deleteSelected(); break;
        case 'v': ed.setTool('select'); break; case 'l': ed.setTool('line'); break; case 'r': if (this.store.selection.size || ed.tool === 'part') ed.rotateSelection(90); else ed.setTool('rect'); break; case 'R': ed.rotateSelection(-90); break;
        case 'c': ed.setTool('circle'); break; case 'a': ed.setTool('arc'); break; case 'p': ed.setTool('polygon'); break; case 't': ed.setTool('text'); break; case 'i': ed.setTool('image'); break; case 'd': ed.setTool('pad'); break; case 'h': ed.setTool('hole'); break; case 'w': ed.setTool('trace'); break; case 'k': ed.setTool('measure'); break;
        case 'f': ed.flipSelectionSide(); break; case 'M': ed.mirrorSelection('h'); break; case 'V': ed.setFlip(!ed.view.flip); this.refreshBoardTabs(); break;
        case 'g': ed.grid.show = !ed.grid.show; ed.requestRender(); break; case 's': ed.grid.snap = !ed.grid.snap; this.updateStatusBar(); break; case 'm': ed.mode = ed.mode === 'realistic' ? 'layers' : 'realistic'; this.refreshPanels(); ed.requestRender(); break;
        case 'Home': ed.fitToBoard(); break; case '+': case '=': ed.zoomAt(this.canvas.width / 2, this.canvas.height / 2, 1.25); break; case '-': ed.zoomAt(this.canvas.width / 2, this.canvas.height / 2, 0.8); break;
        case '1': this.showView('2d'); break; case '2': this.showView('3d'); break; case '?': this.showShortcuts(); break;
        case 'ArrowLeft': ed.nudge(-(e.shiftKey ? 10 : 1) * ed.grid.size, 0); e.preventDefault(); break; case 'ArrowRight': ed.nudge((e.shiftKey ? 10 : 1) * ed.grid.size, 0); e.preventDefault(); break; case 'ArrowUp': ed.nudge(0, (e.shiftKey ? 10 : 1) * ed.grid.size); e.preventDefault(); break; case 'ArrowDown': ed.nudge(0, -(e.shiftKey ? 10 : 1) * ed.grid.size); e.preventDefault(); break;
        case 'Tab': e.preventDefault(); if (this.store.doc.boards.length > 1) this.store.setBoardIndex(this.store.boardIndex ? 0 : 1); break;
      }
    });
  }
  command(cmd) { const map = { new: () => this.newProject(), open: () => this.openFile(), save: () => this.save(), saveas: () => this.save(true), export: () => this.exportDialog(), undo: () => this.store.undo(), redo: () => this.store.redo(), drc: () => this.runDRC(), fit: () => this.editor.fitToBoard(), view3d: () => this.showView('3d'), view2d: () => this.showView('2d'), shortcuts: () => this.showShortcuts() }; (map[cmd] || (() => {}))(); }
  // ---------- views ----------
  showView(v) {
    this.currentView = v; document.querySelectorAll('#viewtabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    document.getElementById('view3d').classList.toggle('hidden', v !== '3d'); this.canvas.classList.toggle('hidden', v === '3d');
    if (v === '3d') { if (!this.view3d) { this.view3d = new View3D(document.getElementById('canvas3d'), this.store, { imageProviderFor: (color) => this.editor.imageProvider(color) }); this.build3DBar(); } this.view3d.start(); this.view3d.rebuild(); this.view3d.resize(); }
    else if (this.view3d) this.view3d.stop();
    if (v === '2d') this.editor.resize();
  }
  build3DBar() {
    const bar = clear(document.getElementById('v3dbar')); const v = this.view3d;
    bar.append(h('label', {}, 'Explode'), numInput(1, x => { v.explode = x; v.rebuild(); }, { step: 0.5, min: 1, max: 5 }), checkbox(true, x => { v.showParts = x; v.rebuild(); }, 'parts'));
    if (this.store.doc.boards.length > 1) bar.append(checkbox(true, x => { v.showBoard[0] = x; v.rebuild(); }, 'lower'), checkbox(true, x => { v.showBoard[1] = x; v.rebuild(); }, 'upper'));
    for (const [k, l] of [['iso', 'Iso'], ['top', 'Top'], ['bottom', 'Bottom'], ['front', 'Front'], ['side', 'Side']]) bar.append(h('button', { class: 'mini', onclick: () => v.viewFrom(k) }, l));
    bar.append(h('button', { class: 'mini', onclick: () => v.frame() }, 'Fit'), h('button', { class: 'mini', onclick: () => { const url = v.snapshotPNG(); fetch(url).then(r => r.arrayBuffer()).then(ab => downloadBytes(safeName(this.store.doc.name) + '-3d.png', new Uint8Array(ab), 'image/png')); } }, 'Snapshot PNG'));
  }
  // ---------- file ----------
  newProject() { runWizard(doc => { this.fileName = null; this.loadDoc(doc); }); }
  _pickFile(accept) { return new Promise(res => { const fi = document.getElementById('filein'); fi.accept = accept; fi.value = ''; this._fileRes = res; fi.click(); }); }
  _onFileInput(e) { const f = e.target.files && e.target.files[0]; const r = this._fileRes; this._fileRes = null; if (r) r(f || null); }
  async openFile() {
    if (this.electron) { const r = await window.lamina.openFile([{ name: 'LAMINA project', extensions: ['json', 'lamina'] }]); if (!r) return; try { this.fileName = r.name; this.loadDoc(parseDoc(r.text)); } catch (err) { toast('Open failed: ' + err.message, 'err'); } return; }
    const f = await this._pickFile('.json,.lamina,application/json'); if (!f) return;
    try { const text = await f.text(); this.fileName = f.name; this.loadDoc(parseDoc(text)); toast('Opened ' + f.name); } catch (err) { toast('Open failed: ' + err.message, 'err', 5000); }
  }
  async save(as = false) {
    const doc = this.store.doc; const name = safeName(doc.name) + '.lamina.json';
    const text = serializeDoc(doc);
    if (this.electron) { const r = await window.lamina.saveText(name, text, as ? null : this._lastPath); if (r) { this._lastPath = r; this.fileName = r.split(/[\\/]/).pop(); this.store.dirty = false; toast('Saved ' + this.fileName); this.refreshAll(); } return; }
    downloadText(name, text, 'application/json'); this.store.dirty = false; this.fileName = name; toast('Saved ' + name + ' (download)'); this.refreshAll();
  }
  async importKicadBoard() {
    const f = this.electron ? await window.lamina.openFile([{ name: 'KiCad board', extensions: ['kicad_pcb'] }]).then(r => r && ({ name: r.name, text: async () => r.text })) : await this._pickFile('.kicad_pcb'); if (!f) return;
    try {
      const { importKicad } = await import('./import/kicad.js'); const text = await f.text(); const { board, warnings } = importKicad(text);
      const how = await new Promise(res => modal({ title: 'Import KiCad board', body: h('div', {}, h('p', {}, `Imported "${f.name}": ${board.items.length} items, ${boardSize(board).map(v => v.toFixed(1)).join(' × ')} mm.`), warnings.length ? h('pre', { class: 'mono' }, warnings.slice(0, 20).join('\n')) : null, h('p', {}, 'Where should it go?')), buttons: [{ label: 'Cancel', onClick: () => res(null) }, { label: 'Replace current board', onClick: () => res('replace') }, { label: 'Add as new board', onClick: () => res('add') }, { label: 'New project', primary: true, onClick: () => res('new') }] }));
      if (!how) return;
      if (how === 'new') { const doc = newDocument({ name: f.name.replace(/\.kicad_pcb$/, '') }); doc.boards = [board]; board.role = 'lower'; this.fileName = null; this.loadDoc(doc); }
      else if (how === 'replace') this.store.mutate(d => { board.role = d.boards[this.store.boardIndex].role; d.boards[this.store.boardIndex] = board; }, 'import');
      else this.store.mutate(d => { board.role = d.boards.length ? 'upper' : 'lower'; d.boards.push(board); if (d.boards.length === 2) d.stack.enabled = true; }, 'import');
      toast('KiCad board imported');
    } catch (err) { console.error(err); toast('KiCad import failed: ' + err.message, 'err', 6000); }
  }
  async importDiptraceBoard() {
    // DipTrace: PCB Layout → File → Save As → "DipTrace ASCII (*.asc)" (the binary .dip is not readable)
    const f = this.electron ? await window.lamina.openFile([{ name: 'DipTrace ASCII PCB', extensions: ['asc'] }]).then(r => r && ({ name: r.name, text: async () => r.text })) : await this._pickFile('.asc,.txt'); if (!f) return;
    try {
      const { importDiptraceAsc } = await import('./import/diptrace.js'); const text = await f.text(); const { board, warnings } = importDiptraceAsc(text, { name: f.name });
      const how = await new Promise(res => modal({ title: 'Import DipTrace board', body: h('div', {}, h('p', {}, `Imported "${f.name}": ${board.items.length} items, ${boardSize(board).map(v => v.toFixed(1)).join(' × ')} mm.`), warnings.length ? h('pre', { class: 'mono' }, warnings.slice(0, 20).join('\n')) : null, h('p', { class: 'hint' }, 'DipTrace ASCII is reverse-engineered: pads, outline, traces, vias, holes and texts are exact; pattern silk of rotated parts and copper pours are best-effort (see warnings).'), h('p', {}, 'Where should it go?')), buttons: [{ label: 'Cancel', onClick: () => res(null) }, { label: 'Replace current board', onClick: () => res('replace') }, { label: 'Add as new board', onClick: () => res('add') }, { label: 'New project', primary: true, onClick: () => res('new') }] }));
      if (!how) return;
      if (how === 'new') { const doc = newDocument({ name: f.name.replace(/\.asc$/i, '') }); doc.boards = [board]; board.role = 'lower'; this.fileName = null; this.loadDoc(doc); }
      else if (how === 'replace') this.store.mutate(d => { board.role = d.boards[this.store.boardIndex].role; d.boards[this.store.boardIndex] = board; }, 'import');
      else this.store.mutate(d => { board.role = d.boards.length ? 'upper' : 'lower'; d.boards.push(board); if (d.boards.length === 2) d.stack.enabled = true; }, 'import');
      toast('DipTrace board imported');
    } catch (err) { console.error(err); toast('DipTrace import failed: ' + err.message, 'err', 6000); }
  }
  async importKicadFootprint() {
    const f = this.electron ? await window.lamina.openFile([{ name: 'KiCad footprint', extensions: ['kicad_mod'] }]).then(r => r && ({ name: r.name, text: async () => r.text })) : await this._pickFile('.kicad_mod'); if (!f) return;
    try { const { importKicadFootprint } = await import('./import/kicad.js'); const fp = importKicadFootprint(await f.text()); fp.id = 'kicad:' + (fp.name || f.name.replace(/\.kicad_mod$/, '')); fp.cat = 'Imported'; registerPart(fp); this.editor.setTool('part', { partLib: fp.id }); this.refreshPanels(); toast(`Footprint "${fp.name}" ready — click to place`); this._importedFps = (this._importedFps || []); this._importedFps.push(fp); } catch (err) { toast('Footprint import failed: ' + err.message, 'err', 6000); }
  }
  async importSvgGraphics() {
    const f = this.electron ? await window.lamina.openFile([{ name: 'SVG', extensions: ['svg'] }]).then(r => r && ({ name: r.name, text: async () => r.text })) : await this._pickFile('.svg'); if (!f) return;
    try {
      const { importSvg } = await import('./import/svg.js'); const text = await f.text();
      const wIn = numInput(30, () => {}, { step: 1 }); const laySel = select(GRAPHIC_LAYERS.concat(['Edge.Cuts']).map(l => [l, l]), this.editor.activeLayer, () => {});
      const ok = await new Promise(res => modal({ title: 'Import SVG graphics', body: h('div', { class: 'props' }, field('Target width (mm)', wIn), field('Layer', laySel), h('div', { class: 'hint' }, 'Filled shapes → filled polygons; stroked paths → outlines. Choose Edge.Cuts to import a board outline (then Edit → Use selected polygon as board outline).')), buttons: [{ label: 'Cancel', onClick: () => res(false) }, { label: 'Import', primary: true, onClick: () => res(true) }] }));
      if (!ok) return;
      const r = importSvg(text, { targetWidth: parseFloat(wIn.value) || 30, layer: laySel.value });
      if (!r.items.length) { toast('No importable shapes found', 'err'); return; }
      const [W, H] = boardSize(this.store.board); const dx = (W - r.width) / 2, dy = (H - r.height) / 2; const ids = [];
      this.store.mutate(d => { const b = d.boards[this.store.boardIndex]; for (const it of r.items) { translateItem(it, dx, dy); b.items.push(it); ids.push(it.id); } }, 'import svg');
      this.store.select(ids); if (r.warnings.length) toast(r.warnings.slice(0, 2).join(' · '), '', 5000); else toast(`Imported ${r.items.length} shapes`);
    } catch (err) { console.error(err); toast('SVG import failed: ' + err.message, 'err', 6000); }
  }
  async pickImageForTool() {
    const f = this.electron ? await window.lamina.openFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]).then(r => r && r.dataUrl ? { dataUrl: r.dataUrl } : null) : await this._pickFile('image/*'); if (!f) return;
    const src = f.dataUrl || await readFileAsDataURL(f);
    const pl = await imagePlacement(src);
    const [W, H] = boardSize(this.store.board);
    let w = pl.w, h = pl.h, note = `${pl.px[0]}×${pl.px[1]} px @ ${pl.dpi} dpi (${pl.source}) → ${pl.w.toFixed(1)} × ${pl.h.toFixed(1)} mm`;
    if (w > W * 3 || h > H * 3) { const k = Math.min(W * 0.8 / w, H * 0.8 / h); w = +(w * k).toFixed(2); h = +(h * k).toFixed(2); note += ` — scaled to fit the board (${w} × ${h} mm); use “Original size” in Properties to restore`; }
    this.editor.setTool('image', { imageSrc: src, imageAspect: pl.px[0] / pl.px[1], imageW: w, imageH: h, imageDpi: pl.dpi });
    this.setStatus('Click to place · ' + note);
  }
  async imageOriginalSize(item) {
    try { const pl = await imagePlacement(item.src); this.store.mutate(d => { const it = d.boards[this.store.boardIndex].items.find(i => i.id === item.id); if (it) { it.w = pl.w; it.h = pl.h; it.dpi = pl.dpi; } }, 'image size'); toast(`Original size: ${pl.px[0]}×${pl.px[1]} px @ ${pl.dpi} dpi = ${pl.w} × ${pl.h} mm`); }
    catch (e) { toast('Could not read the image: ' + e.message, 'err'); }
  }
  async imageSetDpi(item, dpi) {
    try { const pl = await imagePlacement(item.src); const w = +(pl.px[0] / dpi * 25.4).toFixed(3), hh = +(pl.px[1] / dpi * 25.4).toFixed(3); this.store.mutate(d => { const it = d.boards[this.store.boardIndex].items.find(i => i.id === item.id); if (it) { it.w = w; it.h = hh; it.dpi = dpi; } }, 'image dpi'); } catch (e) { toast(e.message, 'err'); }
  }
  async replaceImage(item) {
    const f = this.electron ? await window.lamina.openFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]).then(r => r && r.dataUrl ? { dataUrl: r.dataUrl } : null) : await this._pickFile('image/*'); if (!f) return;
    const src = f.dataUrl || await readFileAsDataURL(f); const img = await loadImage(src);
    this.store.mutate(d => { const it = d.boards[this.store.boardIndex].items.find(i => i.id === item.id); if (it) { it.src = src; it.h = it.w * img.height / img.width; } }, 'image');
  }
  // ---------- board ops ----------
  addSecondBoard() {
    const doc = this.store.doc; if (doc.boards.length >= 2) { toast('Already two boards'); return; }
    this.store.mutate(d => { const b0 = d.boards[0]; const b = newBoard({ name: 'PANEL', role: 'upper', outline: JSON.parse(JSON.stringify(b0.outline)), thickness: b0.thickness, color: b0.color, silkColor: b0.silkColor, finish: b0.finish }); d.boards.push(b); d.stack.enabled = true; d.stack.gap = d.stack.gap || 11; if (!d.stack.links.length) addStackStandoffs(d, { inset: 4 }); }, 'add board');
    toast('Second board added — Tab switches boards; stack settings are in the Board panel');
  }
  async removeSecondBoard() { const doc = this.store.doc; if (doc.boards.length < 2) return; if (!(await confirmDlg('Remove the upper board and all its items?', 'Remove'))) return; this.store.mutate(d => { d.boards.splice(1, 1); d.stack.enabled = false; d.stack.links = []; }, 'remove board'); this.store.setBoardIndex(0); }
  swapBoards() { const doc = this.store.doc; if (doc.boards.length < 2) return; this.store.mutate(d => { d.boards.reverse(); d.boards[0].role = 'lower'; d.boards[1].role = 'upper'; for (const b of d.boards) for (const it of b.items) if (it.type === 'part') { /* sides stay */ } }, 'swap boards'); }
  moveSelectionToOtherBoard() { const st = this.store; if (st.doc.boards.length < 2 || !st.selection.size) return; const from = st.boardIndex, to = from ? 0 : 1; const ids = new Set(st.selection); st.mutate(d => { const src = d.boards[from], dst = d.boards[to]; const mv = src.items.filter(i => ids.has(i.id)); src.items = src.items.filter(i => !ids.has(i.id)); dst.items.push(...mv); }, 'move to board'); st.setBoardIndex(to); st.select(Array.from(ids)); }
  useAsOutline() { const items = this.store.selectedItems(); const poly = items.find(i => i.type === 'polygon' || (i.type === 'rect') || i.type === 'circle'); if (!poly) { toast('Select a polygon, rectangle or circle first', 'err'); return; } this.store.mutate(d => { const b = d.boards[this.store.boardIndex]; if (poly.type === 'polygon') { const bb = itemBBox(poly, d); const pts = poly.points.map(([x, y]) => [x - bb[0], y - bb[1]]); b.outline = { type: 'polygon', points: pts }; } else if (poly.type === 'rect') b.outline = { type: 'rect', w: poly.w, h: poly.h, r: poly.rx || 0 }; else b.outline = { type: 'circle', d: poly.r * 2 }; b.items = b.items.filter(i => i.id !== poly.id); }, 'outline'); this.editor.fitToBoard(); toast('Board outline updated'); }
  addMountHolesDialog() { const libSel = select([['mount_m2', 'M2 (Ø2.2)'], ['mount_m25', 'M2.5 (Ø2.7)'], ['mount_m3', 'M3 (Ø3.2)'], ['mount_m4', 'M4 (Ø4.3)'], ['mount_m3_pth', 'M3 plated (Ø3.2, ring 6)']], 'mount_m3', () => {}); const inset = numInput(4, () => {}, { step: 0.5 }); modal({ title: 'Add corner mounting holes', body: h('div', { class: 'props' }, field('Thread', libSel), field('Inset from edges', inset)), buttons: [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: () => { this.store.mutate(d => addMountingHoles(d.boards[this.store.boardIndex], { inset: parseFloat(inset.value) || 4, lib: libSel.value }), 'mount holes'); } }] }); }
  addConnectorDialog() {
    if (!this.store.doc.stack.enabled) { toast('Add a second board first'); return; }
    const opts = stackConnectorOptions(); const sel = select(opts.map(o => [o.id, o.name]), 'b2b_hdr_1x08', () => {}); const flip = checkbox(false, () => {}, 'female half on the LOWER board'); const useNom = checkbox(true, () => {}, 'set the stack gap to this connector\'s nominal');
    modal({ title: 'Add board-to-board connector', body: h('div', { class: 'props' }, field('Connector', sel), field('', flip), field('', useNom), h('div', { class: 'hint' }, 'The connector is placed at the board centre — drag it where you want it. It exists on both boards (male half on one, female on the other).')), buttons: [{ label: 'Cancel' }, { label: 'Add', primary: true, onClick: () => { const fp = getFootprint(sel.value); const [W, H] = boardSize(this.store.doc.boards[0]); this.store.mutate(d => { d.stack.links.push({ id: uid('L'), kind: 'connector', lib: sel.value, ref: nextRef(d.boards[0], 'hdr_1x02', d), x: Math.round(W / 2), y: Math.round(H / 2), rot: 0, opts: { flip: flip.querySelector('input').checked } }); if (useNom.querySelector('input').checked && fp?.pair) { d.stack.gap = fp.pair.nominalGap; d.stack.gapSource = 'connector'; } }, 'connector'); } }] });
  }
  showHardware() { modal({ title: 'Stack hardware', body: h('pre', { class: 'mono' }, hardwareList(this.store.doc)), buttons: [{ label: 'Copy', onClick: () => { navigator.clipboard?.writeText(hardwareList(this.store.doc)); return false; } }, { label: 'Close', primary: true }] }); }
  zoomToSelection() { const st = this.store; let bb = null; for (const it of st.selectedItems()) bb = unionBBox(bb, itemBBox(it, st.doc)); for (const l of st.selectedLinks()) bb = unionBBox(bb, [l.x - 3, l.y - 3, l.x + 3, l.y + 3]); if (bb) this.editor.zoomToBBox(bb); }
  alignDialog() {
    const st = this.store; const items = st.selectedItems(); if (items.length < 2) { toast('Select 2+ items'); return; }
    const doAlign = (mode) => st.mutate(d => { const b = d.boards[st.boardIndex]; const sel = b.items.filter(i => st.selection.has(i.id)); const bbs = sel.map(i => itemBBox(i, d)); const all = bbs.reduce((a, x) => unionBBox(a, x), null);
      if (mode === 'left') sel.forEach((i, k) => translateItem(i, all[0] - bbs[k][0], 0)); if (mode === 'right') sel.forEach((i, k) => translateItem(i, all[2] - bbs[k][2], 0)); if (mode === 'top') sel.forEach((i, k) => translateItem(i, 0, all[3] - bbs[k][3])); if (mode === 'bottom') sel.forEach((i, k) => translateItem(i, 0, all[1] - bbs[k][1]));
      if (mode === 'hcenter') sel.forEach((i, k) => translateItem(i, (all[0] + all[2]) / 2 - (bbs[k][0] + bbs[k][2]) / 2, 0)); if (mode === 'vcenter') sel.forEach((i, k) => translateItem(i, 0, (all[1] + all[3]) / 2 - (bbs[k][1] + bbs[k][3]) / 2));
      if (mode === 'hdist' || mode === 'vdist') { const ax = mode === 'hdist' ? 0 : 1; const order = sel.map((i, k) => k).sort((p, q) => bbs[p][ax] - bbs[q][ax]); const first = bbs[order[0]], last = bbs[order[order.length - 1]]; const span = (last[ax] + last[ax + 2]) / 2 - (first[ax] + first[ax + 2]) / 2; order.forEach((k, n) => { const target = (first[ax] + first[ax + 2]) / 2 + span * n / (order.length - 1); const cur = (bbs[k][ax] + bbs[k][ax + 2]) / 2; translateItem(sel[k], ax === 0 ? target - cur : 0, ax === 1 ? target - cur : 0); }); } }, 'align');
    modal({ title: 'Align / distribute', body: h('div', { class: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, ...[['left', '⇤ Left'], ['hcenter', '↔ Centre'], ['right', '⇥ Right'], ['top', '⤒ Top'], ['vcenter', '↕ Middle'], ['bottom', '⤓ Bottom'], ['hdist', '⋯ Distribute H'], ['vdist', '⋮ Distribute V']].map(([m, l]) => h('button', { onclick: () => doAlign(m) }, l))), buttons: [{ label: 'Done', primary: true }] });
  }
  // ---------- DRC ----------
  runDRC() { const t0 = performance.now(); this.drcFindings = runDRC(this.store.doc); this.editor.drcMarkers = this.drcFindings.filter(f => f.level !== 'info'); this.refreshPanels(); this.editor.requestRender(); const s = drcSummary(this.drcFindings); toast(`DRC: ${s.errors} errors, ${s.warnings} warnings (${(performance.now() - t0).toFixed(0)} ms)`, s.errors ? 'err' : ''); }
  // ---------- export ----------
  bitmapFor() { return (item) => this.imageCache.bitmapFor(item); }
  async ensureImagesLoaded() { const doc = this.store.doc; const pending = []; for (const b of doc.boards) for (const it of b.items) if (it.type === 'image' && it.src && !this.imageCache.get(it)) pending.push(new Promise(res => { this.imageCache.ensure(it, res); setTimeout(res, 4000); })); await Promise.all(pending); }
  async collect(kinds, opts = {}) {
    await this.ensureImagesLoaded();
    const doc = this.store.doc; const bitmapFor = this.bitmapFor(); const files = []; const imageProviderFor = (color) => this.editor.imageProvider(color);
    const boards = opts.boards;
    if (kinds.fab) { const { exportFabBundle } = await import('./export/fab.js'); files.push(...exportFabBundle(doc, { bitmapFor, boards, gcode: false })); }
    if (kinds.gcode) { const { exportGcode } = await import('./export/gcode.js'); files.push(...exportGcode(doc, { bitmapFor, boards, ...(opts.gcode || {}) })); }
    if (kinds.kicad) { const { exportKicad } = await import('./export/kicad.js'); files.push(...exportKicad(doc, { bitmapFor, boards })); }
    if (kinds.dxf) { const { exportDxf } = await import('./export/dxf.js'); files.push(...exportDxf(doc, { bitmapFor, boards })); }
    if (kinds.svg) { const { exportSvg } = await import('./export/svg.js'); files.push(...exportSvg(doc, { bitmapFor, boards, perLayer: true }).map(f => ({ ...f, name: f.name.startsWith('svg/') ? f.name : 'svg/' + f.name }))); }
    if (kinds.pdf) { const { exportPdf } = await import('./export/pdf.js'); files.push(...exportPdf(doc, { bitmapFor, boards, paper: opts.paper || 'A4' }).map(f => ({ ...f, name: f.name.startsWith('pdf/') ? f.name : 'pdf/' + f.name }))); }
    if (kinds.png || kinds.jpeg) { const { exportRaster } = await import('./export/raster.js'); if (kinds.png) files.push(...await exportRaster(doc, { dpi: opts.dpi || 600, format: 'png', imageProviderFor, boards, transparent: !!opts.transparent })); if (kinds.jpeg) files.push(...await exportRaster(doc, { dpi: opts.dpi || 600, format: 'jpeg', imageProviderFor, boards })); }
    if (kinds.threed) { const { export3D } = await import('./export/three.js'); files.push(...await export3D(doc, { imageProviderFor })); }
    if (kinds.bom) { const { exportBOM } = await import('./export/bom.js'); files.push(...exportBOM(doc, { boards })); }
    if (kinds.project) files.push({ name: safeName(doc.name) + '.lamina.json', data: serializeDoc(doc) });
    if (kinds.readme !== false) files.push({ name: 'README.txt', data: this.bundleReadme(kinds) });
    return files;
  }
  bundleReadme(kinds) {
    const doc = this.store.doc; const L = [`LAMINA export bundle — ${doc.name} — ${stamp()}`, '', 'Folders:'];
    if (kinds.fab) L.push('  gerber/<board>/   → JLCPCB: zip ONE board folder and upload it as-is (Gerber RS-274X + Excellon PTH/NPTH). FlatCAM: open the .GTL/.GBL + .DRL files.');
    if (kinds.kicad) L.push('  kicad/            → open <board>.kicad_pcb in KiCad pcbnew (footprints are embedded). DipTrace: File → Import → KiCAD board.');
    if (kinds.dxf) L.push('  dxf/              → DipTrace (File → Import → DXF, mm), Fusion/FreeCAD/Inkscape, laser cutters. Outline on BoardOutline, holes on Drill_*.');
    if (kinds.svg) L.push('  svg/              → true-scale SVG (mm): top/bottom renders, per-layer files, outline-only file for enclosures/laser.');
    if (kinds.pdf) L.push('  pdf/              → 1:1 printable pages (renders + one page per layer). Print at 100% / no scaling.');
    if (kinds.png || kinds.jpeg) L.push('  images/           → PNG/JPEG renders top & bottom (bottom is mirrored, as you would see it).');
    if (kinds.threed) L.push('  3d/               → STL (mesh), OBJ+MTL (colours), GLB (textured, best for Blender: File → Import → glTF).');
    if (kinds.gcode) L.push('  gcode/            → GRBL G-code: drilling, outline cut with tabs, silk engraving. Isolation routing: use FlatCAM with the gerbers.');
    if (kinds.bom) L.push('  bom/              → JLCPCB BOM + CPL (pick & place) CSVs, hardware.txt (standoffs/screws/connectors).');
    if (kinds.project) L.push(`  ${safeName(doc.name)}.lamina.json → the editable LAMINA project (File → Open).`);
    L.push('', 'Coordinates in every file: millimetres, origin at the board\'s bottom-left corner (KiCad files are offset to 20,20 mm on the sheet).');
    return L.join('\n') + '\n';
  }
  async quickExport(kind) {
    try {
      const doc = this.store.doc; const stem = safeName(doc.name);
      if (kind === 'fab') { const bi = this.store.boardIndex; const files = await this.collect({ fab: true, readme: false }, { boards: [bi] }); const bstem = safeName(doc.boards[bi].name); const inner = files.filter(f => f.name.startsWith('gerber/')).map(f => ({ name: f.name.split('/').pop(), data: f.data })); const readme = files.find(f => f.name === 'README-fab.txt'); if (readme) inner.push(readme); downloadBytes(`${stem}-${bstem}-jlcpcb.zip`, makeZip(inner), 'application/zip'); toast(`JLCPCB zip for ${bstem} — upload it directly`); }
      else if (kind === 'kicad') { const files = await this.collect({ kicad: true, readme: false }); if (files.length === 1) downloadText(files[0].name.split('/').pop(), files[0].data); else downloadBytes(`${stem}-kicad.zip`, makeZip(files), 'application/zip'); }
      else if (kind === 'png') { const files = await this.collect({ png: true, readme: false }, { dpi: 600 }); downloadBytes(`${stem}-renders.zip`, makeZip(files), 'application/zip'); }
    } catch (err) { console.error(err); toast('Export failed: ' + err.message, 'err', 6000); }
  }
  exportDialog() {
    const doc = this.store.doc; const stem = safeName(doc.name);
    const K = { fab: true, kicad: true, dxf: true, svg: true, pdf: true, png: true, jpeg: false, threed: true, gcode: false, bom: true, project: true };
    const list = h('div', { class: 'list' });
    const items = [
      ['fab', 'JLCPCB / FlatCAM fabrication', 'Gerber RS-274X (Protel names) + Excellon PTH/NPTH, one folder per board. Zip a folder → upload to JLCPCB.'],
      ['kicad', 'KiCad board (.kicad_pcb)', 'Embedded footprints, nets, zones, native text. Also the route into DipTrace (Import → KiCAD board).'],
      ['dxf', 'DXF (DipTrace / CAD)', 'AutoCAD DXF, mm, layered (BoardOutline, TopSilk, Drill_*…). DipTrace: File → Import → DXF.'],
      ['svg', 'SVG (true scale)', 'Top/bottom renders, per-layer files, outline-only. Inkscape/laser/vinyl.'],
      ['pdf', 'PDF (1:1)', 'Printable pages: renders + each layer, with scale bar.'],
      ['png', 'PNG renders', 'Top & bottom at the chosen DPI.'], ['jpeg', 'JPEG renders', 'Same as PNG, smaller files.'],
      ['threed', '3D: STL / OBJ / GLB', 'Boards with holes, parts, standoffs. GLB is textured for Blender.'],
      ['gcode', 'G-code (GRBL)', 'Drill, outline-with-tabs, silk engraving. Isolation routing → FlatCAM.'],
      ['bom', 'BOM / CPL / hardware', 'JLCPCB BOM+CPL CSVs, standoff/screw/connector list.'],
      ['project', 'LAMINA project (.lamina.json)', 'The editable source.'],
    ];
    for (const [k, label, desc] of items) list.append(h('label', { class: 'item' }, checkbox(K[k], v => { K[k] = v; }), h('div', {}, label, h('small', {}, desc))));
    const dpi = numInput(600, () => {}, { step: 100, min: 72 }); const paper = select([['A4', 'A4'], ['Letter', 'Letter']], 'A4', () => {}); const which = select([['all', 'all boards'], ...doc.boards.map((b, i) => [String(i), b.name])], 'all', () => {}); const transp = checkbox(false, () => {}, 'transparent PNG');
    const gc = { toolD: 1.0, passDepth: 0.5, safeZ: 5, feedXY: 200, feedZ: 60, engraveDepth: 0.1 };
    const gcRow = h('div', { class: 'cfg' }, h('label', {}, 'G-code: end mill Ø'), numInput(gc.toolD, v => { gc.toolD = v; }, { step: 0.1 }), h('label', {}, 'pass'), numInput(gc.passDepth, v => { gc.passDepth = v; }, { step: 0.1 }), h('label', {}, 'feed XY'), numInput(gc.feedXY, v => { gc.feedXY = v; }, { step: 10 }), h('label', {}, 'engrave depth'), numInput(gc.engraveDepth, v => { gc.engraveDepth = v; }, { step: 0.05 }));
    const drcF = runDRC(doc); const ds = drcSummary(drcF); this.drcFindings = drcF; this.editor.drcMarkers = drcF.filter(f => f.level !== 'info'); this.refreshPanels();
    const drcLine = h('div', { class: 'hint', style: { color: ds.errors ? 'var(--danger)' : ds.warnings ? 'var(--warn)' : 'var(--ok)' } }, `DRC: ${ds.errors} errors, ${ds.warnings} warnings, ${ds.infos} notes (${DRC_PRESETS[doc.drcPreset]?.name}). ${ds.errors ? 'Fix errors before ordering — see the Checks panel.' : ''}`);
    const body = h('div', { class: 'exp' }, drcLine, list, h('div', { class: 'cfg' }, h('label', {}, 'Boards'), which, h('label', {}, 'Raster DPI'), dpi, transp, h('label', {}, 'PDF paper'), paper), gcRow, h('div', { class: 'hint' }, 'Tip: run DRC before exporting. Everything is generated locally; big images make the gerber/DXF files large.'));
    const optsOf = () => ({ boards: which.value === 'all' ? undefined : [parseInt(which.value)], dpi: parseFloat(dpi.value) || 600, paper: paper.value, transparent: transp.querySelector('input').checked, gcode: gc });
    const m = modal({ title: 'Export', body, width: 'min(860px, 96vw)', buttons: [
      { label: 'Close' },
      { label: 'Save individually…', onClick: async () => { await this.exportIndividually(K, optsOf()); return false; } },
      { label: '⇩ Export bundle (zip)', primary: true, onClick: async () => { try { toast('Building bundle…'); const files = await this.collect(K, optsOf()); downloadBytes(`${stem}-lamina-export.zip`, makeZip(files), 'application/zip'); toast(`Bundle: ${files.length} files`); } catch (err) { console.error(err); toast('Export failed: ' + err.message, 'err', 8000); return false; } } },
    ] });
  }
  async exportIndividually(K, opts) {
    const doc = this.store.doc; const stem = safeName(doc.name);
    try {
      for (const k of Object.keys(K)) {
        if (!K[k]) continue;
        const files = await this.collect({ [k]: true, readme: false }, opts);
        if (!files.length) continue;
        if (k === 'fab') { const byBoard = {}; for (const f of files) { const m = /^gerber\/([^/]+)\/(.+)$/.exec(f.name); if (m) (byBoard[m[1]] ||= []).push({ name: m[2], data: f.data }); } for (const [b, fl] of Object.entries(byBoard)) { const readme = files.find(f => f.name === 'README-fab.txt'); if (readme) fl.push(readme); downloadBytes(`${stem}-${b}-jlcpcb.zip`, makeZip(fl), 'application/zip'); await sleep(300); } continue; }
        if (files.length === 1) { downloadBytes(files[0].name.split('/').pop(), files[0].data); }
        else downloadBytes(`${stem}-${k}.zip`, makeZip(files), 'application/zip');
        await sleep(300);
      }
      toast('Done');
    } catch (err) { console.error(err); toast('Export failed: ' + err.message, 'err', 8000); }
  }
  arrayDialog() {
    const st = this.store, ed = this.editor;
    const items = st.selectedItems(); if (!items.length) { toast('Select something first'); return; }
    const doc = st.doc; let bb = null; for (const it of items) bb = unionBBox(bb, itemBBox(it, doc));
    const [W, H] = boardSize(st.board);
    const S = { mode: 'grid', cols: 3, rows: 1, dx: Math.max(5, Math.round((bb[2] - bb[0]) + 5)), dy: Math.max(5, Math.round((bb[3] - bb[1]) + 5)), count: 6, cx: +(W / 2).toFixed(2), cy: +(H / 2).toFixed(2), span: 360, rotateItems: true, radius: null };
    const body = h('div', { class: 'props' });
    const render = () => {
      clear(body);
      body.append(h('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } },
        h('button', { class: S.mode === 'grid' ? 'primary' : '', onclick: () => { S.mode = 'grid'; render(); } }, 'Grid'),
        h('button', { class: S.mode === 'radial' ? 'primary' : '', onclick: () => { S.mode = 'radial'; render(); } }, 'Circular')));
      if (S.mode === 'grid') {
        body.append(field('Columns × rows', h('div', { class: 'pair' }, numInput(S.cols, v => S.cols = Math.max(1, Math.round(v)), { step: 1, min: 1 }), numInput(S.rows, v => S.rows = Math.max(1, Math.round(v)), { step: 1, min: 1 }))),
          field('Spacing X / Y (mm)', h('div', { class: 'pair' }, numInput(S.dx, v => S.dx = v, { step: 1 }), numInput(S.dy, v => S.dy = v, { step: 1 }))),
          h('div', { class: 'hint' }, `Spacing is centre-to-centre; the selection is ${(bb[2] - bb[0]).toFixed(1)} × ${(bb[3] - bb[1]).toFixed(1)} mm. Negative spacing goes left/down.`),
          h('div', { class: 'actions' },
            h('button', { class: 'mini', onclick: () => { S.dx = +((W - (bb[2] - bb[0])) / Math.max(1, S.cols - 1)).toFixed(2); render(); } }, 'Spread across the board width'),
            h('button', { class: 'mini', onclick: () => { S.dy = +((H - (bb[3] - bb[1])) / Math.max(1, S.rows - 1)).toFixed(2); render(); } }, 'Spread down the height')));
      } else {
        body.append(field('Count', numInput(S.count, v => S.count = Math.max(2, Math.round(v)), { step: 1, min: 2 })),
          field('Centre X / Y', h('div', { class: 'pair' }, numInput(S.cx, v => S.cx = v, { step: 1 }), numInput(S.cy, v => S.cy = v, { step: 1 }))),
          field('Total angle', numInput(S.span, v => S.span = v, { step: 15 })),
          field('Rotate copies', checkbox(S.rotateItems, v => S.rotateItems = v, 'turn each copy with the circle')),
          h('div', { class: 'actions' },
            h('button', { class: 'mini', onclick: () => { S.cx = +(W / 2).toFixed(2); S.cy = +(H / 2).toFixed(2); render(); } }, 'Board centre'),
            h('button', { class: 'mini', onclick: () => { S.cx = +((bb[0] + bb[2]) / 2).toFixed(2); S.cy = +((bb[1] + bb[3]) / 2).toFixed(2); render(); } }, 'Selection centre'),
            h('button', { class: 'mini', title: 'Use the last right-click / cursor position', onclick: () => { const p = ed.ctxPos || ed.mouseBoard; S.cx = +p[0].toFixed(2); S.cy = +p[1].toFixed(2); render(); } }, 'Cursor')),
          h('div', { class: 'hint' }, '360° spreads evenly all the way round; anything less spreads from the original to that angle.'));
      }
    };
    render();
    modal({ title: 'Repeat / array', width: 'min(520px, 96vw)', body, buttons: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: () => { const n = ed.arraySelection(S); toast(n ? `${n} copies` : 'nothing to repeat'); } }] });
  }
  exposeCopper(items) {
    const ids = []; const st = this.store;
    st.mutate(d => { const b = d.boards[st.boardIndex]; for (const it of items) { const c = JSON.parse(JSON.stringify(it)); c.id = uid(); c.layer = it.layer.replace('.Cu', '.Mask'); b.items.push(c); ids.push(c.id); } }, 'mask opening');
    st.select(ids); toast('Mask opening added — the copper underneath stays bare (' + (this.store.board.finish === 'ENIG' ? 'gold' : 'silver') + ')');
  }
  // ---------- footprint replacement ----------
  applyReplacement(parts, libId, opts = {}) {
    const ids = new Set(parts.map(p => p.id));
    this.store.mutate(doc => {
      for (const b of doc.boards) for (const it of b.items) if (ids.has(it.id)) {
        it.lib = libId; delete it.fp;
        if (opts.rotDelta) it.rot = (((it.rot || 0) + opts.rotDelta) % 360 + 360) % 360;
      }
    }, 'replace footprint');
    toast(`${parts.length} part${parts.length > 1 ? 's' : ''} → ${(getFootprint(libId) || {}).name || libId}`);
  }
  replaceFootprintDialog(parts) {
    if (!parts || !parts.length) { toast('Select a part first'); return; }
    const cur = parts[0].fp || getFootprint(parts[0].lib) || { pads: [] };
    const curName = cur.name || parts[0].lib || 'imported footprint';
    const st = this.store;
    let chosen = null, chosenRot = 0, applyRot = true;
    const grid = h('div', { class: 'fpgrid' });
    const info = h('div', { class: 'hint' });
    const search = h('input', { type: 'search', placeholder: 'search the library…', style: { width: '220px' } });
    const sameOnly = checkbox(false, () => render(), 'only same pad count');
    const render = () => {
      clear(grid);
      const q = search.value.trim().toLowerCase();
      const srcStats = padStats(cur);
      let list = suggestReplacements(cur, { limit: q ? 60 : 18, exclude: parts[0].fp ? null : parts[0].lib, filter: (c) => (!q || (c.id + ' ' + c.name + ' ' + (c.tags || []).join(' ') + ' ' + (c.desc || '')).toLowerCase().includes(q)) && (!sameOnly.querySelector('input').checked || padStats(c).n === srcStats.n) });
      if (!list.length) { grid.append(h('div', { class: 'hint' }, 'Nothing matches. Clear the search or import a footprint (File → Import KiCad footprint).')); return; }
      for (const s of list) {
        const cv = h('canvas');
        const card = h('div', { class: 'fpcard' + (chosen === s.id ? ' on' : ''), title: `${s.id} · ${s.part.desc || ''}`, onclick: () => { chosen = s.id; chosenRot = s.rot || 0; render(); info.textContent = `${s.name} — score ${(s.score * 100).toFixed(0)}%${s.rms != null ? `, pad fit ${s.rms.toFixed(2)} mm` : ''}${s.rot ? `, needs ${s.rot}° rotation` : ''}`; } },
          cv, h('div', { class: 'nm' }, s.name), h('div', { class: 'sc ' + (s.score > 0.85 ? 'good' : s.score > 0.6 ? 'mid' : '') }, `${(s.score * 100).toFixed(0)}%${s.rot ? ` · ${s.rot}°` : ''}${s.part.verify ? ' ⚠' : ''}`));
        grid.append(card);
        setTimeout(() => drawFootprint(cv, s.part, { lib: s.id }), 0);
      }
    };
    search.addEventListener('input', render);
    const curCanvas = h('canvas', { style: { width: '150px', height: '78px' } });
    const body = h('div', {},
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' } },
        h('div', {}, h('div', { class: 'hint' }, 'Current'), curCanvas, h('div', { style: { fontSize: '11px' } }, curName)),
        h('div', { style: { flex: 1 } }, h('div', { class: 'hint' }, `Replacing ${parts.length} part${parts.length > 1 ? 's' : ''}: ${parts.map(p => p.ref).join(', ').slice(0, 80)}`), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '6px 0' } }, search, sameOnly), info)),
      grid);
    setTimeout(() => drawFootprint(curCanvas, cur, { lib: parts[0].lib }), 0);
    render();
    modal({ title: 'Replace footprint', width: 'min(880px, 96vw)', body, buttons: [
      { label: 'Cancel' },
      { label: 'Replace', primary: true, onClick: () => { if (!chosen) { toast('Pick a footprint first', 'err'); return false; } this.applyReplacement(parts, chosen, { rotDelta: applyRot ? chosenRot : 0 }); } },
    ] });
  }
  matchUnknownDialog() {
    const groups = groupUnmatched(this.store.doc);
    if (!groups.length) { toast('Every part already uses a library footprint'); return; }
    const state = groups.map(g => ({ g, use: g.suggestions[0] && g.suggestions[0].score > 0.7, pick: g.suggestions[0] ? g.suggestions[0].id : '' }));
    const list = h('div', { class: 'replist' });
    for (const s of state) {
      const sel = select([['', '— keep imported —'], ...s.g.suggestions.map(x => [x.id, `${x.name} (${(x.score * 100).toFixed(0)}%${x.rot ? `, ${x.rot}°` : ''})`])], s.pick, v => { s.pick = v; s.use = !!v; cb.querySelector('input').checked = !!v; });
      const cb = checkbox(s.use, v => { s.use = v; });
      const row = h('div', { class: 'row' }, cb, h('span', {}, `${s.g.name}`, h('br'), h('span', { class: 'cur' }, `${s.g.parts.length} × · ${(s.g.fp.pads || []).length} pads`)), sel, h('span', { class: 'cur' }, s.g.parts.map(p => p.item.ref).join(',').slice(0, 24)));
      list.append(row);
    }
    modal({ title: 'Match imported parts to library footprints', width: 'min(880px, 96vw)', body: h('div', {}, h('div', { class: 'hint' }, 'Imported boards carry their own footprints. Swapping them for library parts gives you 3D bodies, heights, through-hole data for panels and BOM info. Pads move to the library part’s geometry — check the result before ordering.'), list), buttons: [
      { label: 'Cancel' },
      { label: 'Apply', primary: true, onClick: () => { let n = 0; for (const s of state) { if (!s.use || !s.pick) continue; const sug = s.g.suggestions.find(x => x.id === s.pick); this.applyReplacement(s.g.parts.map(p => p.item), s.pick, { rotDelta: sug ? sug.rot : 0 }); n += s.g.parts.length; } toast(n ? `${n} parts replaced` : 'Nothing selected'); } },
    ] });
  }
  // ---------- right-click ----------
  contextMenuAt(clientX, clientY, pos, hit) {
    const st = this.store, ed = this.editor, doc = st.doc;
    const items = st.selectedItems(), links = st.selectedLinks();
    const one = items.length === 1 ? items[0] : null;
    const parts = items.filter(i => i.type === 'part');
    const m = [];
    if (items.length || links.length) {
      const fp = one && one.type === 'part' ? (one.fp || getFootprint(one.lib)) : null;
      m.push({ header: one ? (one.type === 'part' ? `${one.ref || 'part'} · ${(fp && fp.name) || one.lib}` : one.type + (one.layer ? ' · ' + one.layer : '')) : `${items.length + links.length} selected` });
      m.push({ label: 'Cut', key: 'Ctrl+X', run: () => ed.cutSelection() }, { label: 'Copy', key: 'Ctrl+C', run: () => ed.copySelection() }, { label: 'Duplicate', key: 'Ctrl+D', run: () => ed.duplicateSelection() }, { label: 'Delete', key: 'Del', danger: true, run: () => st.deleteSelected() }, '-');
      m.push({ label: 'Rotate 90° CCW', key: 'R', run: () => ed.rotateSelection(90) }, { label: 'Rotate 90° CW', key: 'Shift+R', run: () => ed.rotateSelection(-90) },
        { label: 'Rotate by…', run: async () => { const v = parseFloat(await promptDlg('Rotate by (degrees, CCW)', '45')); if (Number.isFinite(v)) ed.rotateSelection(v); } },
        { label: 'Flip side (top ↔ bottom)', key: 'F', run: () => ed.flipSelectionSide() });
      const layered = items.filter(i => i.layer && i.type !== 'trace' && i.type !== 'region');
      if (layered.length) m.push({ label: 'Move to layer', submenu: GRAPHIC_LAYERS.concat(['Edge.Cuts']).map(l => ({ label: l, key: layered.every(i => i.layer === l) ? '•' : '', run: () => st.mutate(d => { for (const it of d.boards[st.boardIndex].items) if (st.selection.has(it.id) && it.layer && it.type !== 'trace' && it.type !== 'region') it.layer = l; }, 'layer') })) });
      if (doc.boards.length > 1) m.push({ label: 'Move to the other board', run: () => this.moveSelectionToOtherBoard() });
      if (parts.length) {
        m.push('-', { label: parts.length > 1 ? `Replace footprint of ${parts.length} parts…` : 'Replace footprint…', run: () => this.replaceFootprintDialog(parts) });
        if (parts.some(p => isUnmatched(p))) m.push({ label: 'Match all imported parts…', run: () => this.matchUnknownDialog() });
        if (doc.stack.enabled && st.boardIndex === 0) { const thr = parts.filter(p => (p.fp || getFootprint(p.lib) || {}).through); if (thr.length) m.push({ label: (thr.every(p => p.through) ? '✓ ' : '') + 'Through the upper board', run: () => { const on = !thr.every(p => p.through); st.mutate(d => { for (const it of d.boards[0].items) if (st.selection.has(it.id) && it.type === 'part') it.through = on; }, 'through'); } }); }
      }
      const cu = items.filter(i => ['rect', 'circle', 'polygon', 'text'].includes(i.type) && (i.layer === 'F.Cu' || i.layer === 'B.Cu'));
      if (cu.length) m.push({ label: 'Expose copper (mask opening)', run: () => this.exposeCopper(cu) });
      if (one && ['polygon', 'rect', 'circle'].includes(one.type)) m.push({ label: 'Use as board outline', run: () => this.useAsOutline() });
      if (one && one.type === 'image') m.push({ label: 'Original size', run: () => this.imageOriginalSize(one) }, { label: 'Replace image…', run: () => this.replaceImage(one) });
      m.push({ label: 'Mirror', submenu: [{ label: 'Horizontally (flip left ↔ right)', run: () => ed.mirrorSelection('h') }, { label: 'Vertically (flip up ↔ down)', run: () => ed.mirrorSelection('v') }] });
      m.push({ label: 'Repeat / array…', run: () => this.arrayDialog() });
      m.push('-', { label: items.length > 1 ? 'Align / distribute…' : 'Align to…', disabled: items.length < 2, run: () => this.alignDialog() }, { label: 'Zoom to selection', run: () => this.zoomToSelection() });
      if (one) m.push({ label: one.locked ? 'Unlock' : 'Lock', run: () => st.mutate(d => { const it = d.boards[st.boardIndex].items.find(i => i.id === one.id); if (it) it.locked = !it.locked; }, 'lock') });
      m.push('-');
    }
    if (ed._clip && ed._clip.length) m.push({ label: `Paste here (${ed._clip.length})`, key: 'Ctrl+V', run: () => { ed.mouse = [1, 1]; ed.mouseBoard = pos; ed.paste(); } });
    const recent = (this.recentParts || []).map(lib => { const f = getFootprint(lib); return f ? { label: f.name, run: () => { ed.setTool('part', { partLib: lib }); this.refreshPanels(); } } : null; }).filter(Boolean);
    m.push({ label: 'Place part', submenu: [...(recent.length ? [{ header: 'Recent' }, ...recent, '-'] : []), { label: 'Mounting hole M3', run: () => { ed.setTool('part', { partLib: 'mount_m3' }); this.refreshPanels(); } }, { label: 'Pin header 1×8', run: () => { ed.setTool('part', { partLib: 'hdr_1x08' }); this.refreshPanels(); } }, { label: 'Browse the parts list…', run: () => { const s = document.getElementById('partsearch'); s.focus(); s.select(); } }] });
    m.push({ label: 'Draw here', submenu: [['line', 'Line'], ['rect', 'Rectangle'], ['circle', 'Circle'], ['arc', 'Arc'], ['polygon', 'Polygon'], ['text', 'Text'], ['image', 'Image…'], ['pad', 'Pad'], ['hole', 'Hole'], ['slot', 'Slot'], ['via', 'Via'], ['trace', 'Trace'], ['region', 'Copper region'], ['measure', 'Measure']].map(([t, l]) => ({ label: l, key: ed.activeLayer && ['line', 'rect', 'circle', 'arc', 'polygon', 'text', 'image'].includes(t) ? ed.activeLayer : '', run: () => ed.setTool(t) })) });
    m.push({ label: 'Active layer', submenu: GRAPHIC_LAYERS.concat(['Edge.Cuts']).map(l => ({ label: l, key: ed.activeLayer === l ? '•' : '', run: () => { ed.activeLayer = l; this.refreshPanels(); this.buildToolbar(); ed.requestRender(); } })) });
    m.push('-');
    m.push({ label: this.editor.view.flip ? 'View from the top' : 'View from the bottom', key: 'Shift+V', run: () => { ed.setFlip(!ed.view.flip); this.refreshBoardTabs(); this.refreshPanels(); } });
    if (doc.boards.length > 1) m.push({ label: `Switch to ${doc.boards[st.boardIndex ? 0 : 1].name}`, key: 'Tab', run: () => st.setBoardIndex(st.boardIndex ? 0 : 1) });
    m.push({ label: ed.mode === 'realistic' ? 'Layer colours view' : 'Realistic view', key: 'M', run: () => { ed.mode = ed.mode === 'realistic' ? 'layers' : 'realistic'; this.refreshPanels(); ed.requestRender(); } },
      { label: ed.grid.snap ? 'Snap off' : 'Snap on', key: 'S', run: () => { ed.grid.snap = !ed.grid.snap; this.updateStatusBar(); this.buildToolbar(); } },
      { label: 'Fit board', key: 'Home', run: () => ed.fitToBoard() });
    m.push({ label: 'Design studio…', key: 'Ctrl+G', submenu: [{ label: 'Open the studio', run: () => openDesignStudio(this) }, '-', ...OPS.filter(o => o.kind === (items.length ? 'fx' : 'gen')).slice(0, 10).map(o => ({ label: o.name, run: () => openDesignStudio(this, o.id) }))] });
    m.push('-', { label: 'Board settings', run: () => st.clearSelection() }, { label: 'Run DRC', key: 'Ctrl+R', run: () => this.runDRC() }, { label: 'Export…', key: 'Ctrl+E', run: () => this.exportDialog() });
    contextMenu(clientX, clientY, m);
  }
  showShortcuts() {
    const rows = [['V', 'select'], ['L / R / C / P', 'line / rect / circle / polygon'], ['T / I', 'text / image'], ['D / H / W', 'pad / hole / trace'], ['K', 'measure'], ['R / Shift+R', 'rotate selection 90° (or the part being placed)'], ['F', 'flip side of selection'], ['Shift+V', 'view from bottom'], ['M', 'realistic ↔ layers'], ['G / S', 'grid / snap'], ['Tab', 'switch board (stack)'], ['Arrows', 'nudge by grid (Shift ×10)'], ['Ctrl+D', 'duplicate'], ['Del', 'delete'], ['Ctrl+Z / Y', 'undo / redo'], ['Ctrl+S / O / N', 'save / open / new'], ['Ctrl+E', 'export'], ['Ctrl+G', 'design studio (generators & effects)'], ['Ctrl+R', 'DRC'], ['Home / + / −', 'fit / zoom'], ['Space + drag, middle-drag, right-drag', 'pan'], ['Wheel', 'zoom at cursor'], ['Alt while drawing', 'ignore snap'], ['Enter / dbl-click / Esc', 'finish / cancel a polygon or trace'], ['Right-click', 'context menu (drag with the right button to pan)'], ['1 / 2', '2D / 3D view']];
    modal({ title: 'Keyboard shortcuts', body: h('table', { class: 'hw' }, rows.map(([k, d]) => h('tr', {}, h('td', {}, h('span', { class: 'kbd' }, k)), h('td', {}, d)))), buttons: [{ label: 'Close', primary: true }] });
  }
  showExportGuide() {
    modal({ title: 'Getting your design into other tools', width: 'min(760px, 96vw)', body: h('div', {}, h('pre', { class: 'mono', style: { maxHeight: '60vh' } }, [
      'JLCPCB (order)     → Export → JLCPCB fabrication → upload the per-board zip. Choose 2 layers, the thickness/colour/finish you set here.',
      '                     Assembly: bom/<board>-BOM.csv + -CPL.csv (fill LCSC part numbers).',
      'KiCad (finish the circuit) → kicad/<board>.kicad_pcb. Footprints are embedded ("LAMINA:*"). Zones need "Refill" (B).',
      '                     Round trip: File → Import KiCad board brings a finished KiCad board back here for artwork/panels.',
      'DipTrace           → File → Import → KiCAD board (best), or Import → DXF (outline/graphics; pick mm; map layers), or Import → Gerber + N/C Drill.',
      'FlatCAM (CNC)      → open gerber/<board>/*.GTL/.GBL for isolation routing, *.DRL for drilling, .GKO for the cutout. Excellon is METRIC, decimal.',
      'GRBL / candle      → gcode/*.nc: origin = board bottom-left, Z0 = board top surface. Check depths in the header before running!',
      'Blender            → 3d/<name>.glb (textured, File → Import → glTF 2.0) or .obj/.stl (set scale 0.001 if your scene is in metres).',
      'Inkscape / laser   → svg/*.svg are true mm scale (1 user unit = 1 mm). outline.svg has only edges + holes.',
      'Print 1:1          → pdf/<board>.pdf at 100% scale — check the 10 mm scale bar with a ruler.',
    ].join('\n'))), buttons: [{ label: 'Close', primary: true }] });
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
window.app = new App();
