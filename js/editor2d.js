// LAMINA 2D board editor — canvas, view, tools, hit-testing, handles.
import { resolveBoard, resolvePart, itemBBox, hitItem, translateItem, rotateItem, itemCenter, outlinePoints, rotPt, dist, unionBBox, stackLinkItems, padPoints, GRAPHIC_LAYERS, layerSide, bboxOfPoints, textBBox, R2D } from './geom.js';
import { applyView, screenToBoard, boardToScreen, renderRealistic, renderLayers, drawGrid, drawBBox, drawPrims, LAYER_COLORS, pathOutline, drawDrill } from './render.js';
import { makeItem, nextRef, uid, boardSize, SILK_COLORS } from './model.js';
import { getFootprint } from './library.js';

const TOOL_LAYER_DEFAULT = { trace: 'F.Cu', region: 'F.Cu', pad: null, via: null, hole: null, slot: null, part: null };

export class Editor2D {
  constructor(canvas, store, hooks = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.store = store; this.hooks = hooks;
    this.view = { scale: 6, ox: 60, oy: 500, flip: false, W: 100 };
    this.tool = 'select'; this.toolParams = { width: 0.2, traceWidth: 0.3, padShape: 'circle', padW: 1.8, padH: 1.8, padDrill: 1.0, holeD: 3.2, viaD: 0.8, viaDrill: 0.4, slotLen: 6, slotW: 2, textSize: 2, textThick: 0.25, textFont: 'sans', partLib: null, partRot: 0, partSide: 'top', imageSrc: null, imageAspect: 1, imageW: 0, imageH: 0, imageDpi: 96, filled: false };
    this.ts = null; // tool state
    this.hover = null; this.hoverLink = null; this.mouse = null; this.mouseBoard = [0, 0];
    this.grid = { size: 1, snap: true, show: true, objects: true };
    this._snapHit = null; this._snapTargets = null;
    this.mode = 'realistic'; this.visible = {}; for (const l of GRAPHIC_LAYERS) this.visible[l] = true; this.visible['Edge.Cuts'] = true;
    this.activeLayer = 'F.Silk'; this.showFar = false; this.ghostOther = true; this.dimOthers = true;
    this.drcMarkers = []; this.measure = null;
    this._resolvedCache = new Map(); this._imgCache = hooks.imageCache;
    this.dpr = window.devicePixelRatio || 1;
    this._bind();
    store.on('change', () => { this._resolvedCache.clear(); this._snapTargets = null; this.requestRender(); });
    store.on('selection', () => this.requestRender());
    store.on('board', () => { this._resolvedCache.clear(); this._snapTargets = null; this.fitToBoard(); });
    store.on('doc', () => { this._resolvedCache.clear(); this._snapTargets = null; this.fitToBoard(); });
    this.requestRender();
  }
  // ---------- view ----------
  resize() { const r = this.canvas.getBoundingClientRect(); this.dpr = window.devicePixelRatio || 1; this.canvas.width = Math.max(1, Math.round(r.width * this.dpr)); this.canvas.height = Math.max(1, Math.round(r.height * this.dpr)); this.requestRender(); }
  fitToBoard() {
    const [W, H] = boardSize(this.store.board); const cw = this.canvas.width, ch = this.canvas.height;
    const scale = Math.min((cw - 80 * this.dpr) / W, (ch - 80 * this.dpr) / H);
    this.view.scale = Math.max(0.5, scale); this.view.W = W;
    this.view.ox = (cw - W * this.view.scale) / 2; this.view.oy = (ch + H * this.view.scale) / 2;
    this.requestRender();
  }
  zoomAt(sx, sy, factor) { const [bx, by] = screenToBoard(this.view, sx, sy); this.view.scale = Math.max(0.2, Math.min(400 * this.dpr, this.view.scale * factor)); const [nx, ny] = boardToScreen(this.view, bx, by); this.view.ox += sx - nx; this.view.oy += sy - ny; this.requestRender(); }
  setFlip(f) { this.view.flip = f; this.requestRender(); }
  requestRender() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = null; this.render(); }); }
  resolved() { const b = this.store.board; let R = this._resolvedCache.get(b.id); if (!R) { R = resolveBoard(b, this.store.doc, { textAsStrokes: true, imagesAsPolys: false }); this._resolvedCache.set(b.id, R); } return R; }
  resolvedFor(board) { let R = this._resolvedCache.get(board.id); if (!R) { R = resolveBoard(board, this.store.doc, { textAsStrokes: true, imagesAsPolys: false }); this._resolvedCache.set(board.id, R); } return R; }
  imageProvider(color) { return (p) => { const it = this.store.itemById(p.id); if (!it || !this._imgCache) return null; const e = this._imgCache.ensure(it, () => this.requestRender()); if (!e) return null; return this._imgCache.canvasFor(it, color); }; }
  snap(x, y, force) {
    if (this._altHeld) { this._snapHit = null; return [x, y]; }
    if (this.grid.objects) {
      const tol = 9 * this.dpr / this.view.scale;
      const t = this.nearestSnapTarget(x, y, tol);
      if (t) { this._snapHit = t; return [t.x, t.y]; }
    }
    this._snapHit = null;
    if (!this.grid.snap && !force) return [x, y];
    const g = this.grid.size; return [Math.round(x / g) * g, Math.round(y / g) * g];
  }
  // points worth snapping to: pads, drills, part origins, board corners/centre/edge midpoints — on BOTH boards of a stack
  snapTargets() {
    if (this._snapTargets) return this._snapTargets;
    const doc = this.store.doc, out = [];
    const push = (x, y, kind, label, other) => out.push({ x, y, kind, label, other });
    const addBoard = (bi, other) => {
      const board = doc.boards[bi]; if (!board) return;
      const R = this.resolvedFor(board);
      const [W, H] = R.size;
      for (const d of R.drills) push(d.x, d.y, 'hole', other ? 'hole (other board)' : 'hole', other);
      for (const p of R.pads) push(p.x, p.y, 'pad', (other ? 'pad (other board) ' : 'pad ') + (p.partRef ? p.partRef + '.' + p.name : p.name || ''), other);
      for (const p of R.parts) push(p.x, p.y, 'part', (other ? 'origin (other board) ' : 'origin ') + p.ref, other);
      if (!other) {
        push(W / 2, H / 2, 'board', 'board centre');
        for (const [x, y, l] of [[0, 0, 'corner'], [W, 0, 'corner'], [0, H, 'corner'], [W, H, 'corner'], [W / 2, 0, 'edge mid'], [W / 2, H, 'edge mid'], [0, H / 2, 'edge mid'], [W, H / 2, 'edge mid']]) push(x, y, 'board', l);
      }
    };
    addBoard(this.boardIndexSafe(), false);
    if (doc.stack && doc.stack.enabled && doc.boards.length > 1) addBoard(this.boardIndexSafe() ? 0 : 1, true);
    // item anchors on this board
    for (const it of this.store.board.items) {
      const bb = itemBBox(it, doc); if (!bb) continue;
      if (it.type === 'text' || it.type === 'image' || it.type === 'rect') { push((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, 'item', it.type + ' centre'); push(bb[0], bb[1], 'item', 'corner'); push(bb[2], bb[3], 'item', 'corner'); push(bb[0], bb[3], 'item', 'corner'); push(bb[2], bb[1], 'item', 'corner'); }
      if (it.type === 'circle' || it.type === 'arc') push(it.cx, it.cy, 'item', 'centre');
      if (it.type === 'line') { push(it.x1, it.y1, 'item', 'end'); push(it.x2, it.y2, 'item', 'end'); push((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2, 'item', 'midpoint'); }
      if (it.points) for (const [x, y] of it.points) push(x, y, 'item', 'vertex');
    }
    this._snapTargets = out; return out;
  }
  boardIndexSafe() { return Math.max(0, Math.min(this.store.boardIndex, this.store.doc.boards.length - 1)); }
  nearestSnapTarget(x, y, tol) {
    const sel = this.store.selection;
    let best = null, bd = tol;
    for (const t of this.snapTargets()) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  status(msg) { this.hooks.status && this.hooks.status(msg); }
  // ---------- tools ----------
  setTool(name, params = {}) { this.finishTool(true); this.tool = name; Object.assign(this.toolParams, params); this.ts = null; if (name === 'part' && params.partLib && this.hooks.partPicked) this.hooks.partPicked(params.partLib); this.hooks.toolChanged && this.hooks.toolChanged(name); this.requestRender(); this.status(TOOL_HINTS[name] || ''); }
  cancelTool() { if (this.ts && this.tool === 'polygon' && this.ts.pts && this.ts.pts.length >= 3) { this._commitPolygon(); return; } if (this.ts && (this.tool === 'trace' || this.tool === 'region') && this.ts.pts && this.ts.pts.length >= 2) { this._commitPath(); return; } this.ts = null; if (this.tool !== 'select' && this.tool !== 'part') { this.setTool('select'); } else { this.requestRender(); } }
  finishTool(silent) { if (this.tool === 'polygon' && this.ts?.pts?.length >= 3) this._commitPolygon(); else if ((this.tool === 'trace' || this.tool === 'region') && this.ts?.pts?.length >= 2) this._commitPath(); this.ts = null; if (!silent) this.requestRender(); }
  currentLayerFor(type) { if (type === 'trace' || type === 'region') return this.activeLayer === 'B.Cu' ? 'B.Cu' : 'F.Cu'; return this.activeLayer; }
  // ---------- events ----------
  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this._down(e));
    c.addEventListener('pointermove', e => this._move(e));
    c.addEventListener('pointerup', e => this._up(e));
    c.addEventListener('pointerleave', () => { this.mouse = null; this.hover = null; this.requestRender(); });
    c.addEventListener('dblclick', e => this._dbl(e));
    c.addEventListener('contextmenu', e => { e.preventDefault(); if (this.ts && this.ts.pts) this.cancelTool(); });
    c.addEventListener('wheel', e => { e.preventDefault(); const p = this._pt(e); this.zoomAt(p[0], p[1], e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    window.addEventListener('keydown', e => { if (e.key === 'Alt') this._altHeld = true; if (e.key === ' ' && !isTyping()) { this._space = true; c.style.cursor = 'grab'; } });
    window.addEventListener('keyup', e => { if (e.key === 'Alt') this._altHeld = false; if (e.key === ' ') { this._space = false; c.style.cursor = 'crosshair'; } });
  }
  _pt(e) { const r = this.canvas.getBoundingClientRect(); return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr]; }
  _hitTest(bx, by) {
    const tol = 4 * this.dpr / this.view.scale; const doc = this.store.doc, board = this.store.board;
    let best = null, bestArea = Infinity;
    const consider = (item, id) => {
      if (item.type !== 'part' && item.layer && this.visible[item.layer] === false) return;
      if (item.type === 'part' && !this._partVisible(item)) return;
      if (!hitItem(item, bx, by, tol, doc)) return;
      const bb = itemBBox(item, doc); const area = bb ? (bb[2] - bb[0]) * (bb[3] - bb[1]) : 0;
      if (area < bestArea) { best = { item, id }; bestArea = area; }
    };
    for (const it of board.items) consider(it, it.id);
    for (const it of stackLinkItems(doc, board)) { if (it.fromLink) consider(it, it.fromLink); else if (it.fromPart) consider(it, null); }
    return best;
  }
  _partVisible(part) { const s = part.side === 'bottom' ? 'B' : 'F'; return this.visible[s + '.Silk'] !== false || this.visible[s + '.Cu'] !== false; }
  _down(e) {
    const p = this._pt(e); this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || this._space || (e.button === 2 && !this.ts)) { this.ts = { kind: 'pan', start: p, ox: this.view.ox, oy: this.view.oy, button: e.button, moved: false }; this._panning = true; return; }
    if (e.button !== 0) return;
    let [bx, by] = screenToBoard(this.view, p[0], p[1]);
    const raw = [bx, by]; [bx, by] = this.snap(bx, by);
    const st = this.store;
    switch (this.tool) {
      case 'select': {
        // handles first
        const h = this._hitHandle(raw);
        if (h) { st.beginTransaction('edit vertex'); this.ts = { kind: 'handle', h, start: raw }; return; }
        const hit = this._hitTest(raw[0], raw[1]);
        if (hit) {
          if (hit.id == null) { this.status('Through-hole comes from a part on the lower board — edit that part.'); return; }
          if (e.shiftKey) st.toggleSelect(hit.id); else if (!st.selection.has(hit.id)) st.select(hit.id);
          st.beginTransaction('move'); this.ts = { kind: 'move', start: raw, last: raw, moved: false, snapDelta: null };
        } else { if (!e.shiftKey) st.clearSelection(); this.ts = { kind: 'marquee', start: raw, cur: raw, additive: e.shiftKey }; }
        break;
      }
      case 'line': if (!this.ts) this.ts = { pts: [[bx, by]] }; else { const a = this.ts.pts[0]; const b = this._constrain(a, [bx, by], e.shiftKey); if (dist(a[0], a[1], b[0], b[1]) > 1e-6) { st.addItem(makeItem('line', { layer: this.activeLayer, x1: a[0], y1: a[1], x2: b[0], y2: b[1], width: this.toolParams.width })); } this.ts = { pts: [b] }; } break;
      case 'rect': if (!this.ts) this.ts = { pts: [[bx, by]] }; else { const a = this.ts.pts[0]; const w = Math.abs(bx - a[0]), h = Math.abs(by - a[1]); if (w > 1e-6 && h > 1e-6) { const item = makeItem('rect', { layer: this.activeLayer, x: (a[0] + bx) / 2, y: (a[1] + by) / 2, w, h, rot: 0, rx: 0, width: this.toolParams.width, filled: this.activeLayer === 'Edge.Cuts' ? false : this.toolParams.filled }); st.addItem(item); st.select(item.id); } this.ts = null; } break;
      case 'arc': {
        if (!this.ts) this.ts = { pts: [[bx, by]] };
        else if (this.ts.pts.length === 1) this.ts.pts.push([bx, by]);
        else { const [c, s0] = this.ts.pts; const r = dist(c[0], c[1], s0[0], s0[1]); if (r > 1e-6) { const a0 = Math.atan2(s0[1] - c[1], s0[0] - c[0]) * R2D, a1 = Math.atan2(by - c[1], bx - c[0]) * R2D; const item = makeItem('arc', { layer: this.activeLayer, cx: c[0], cy: c[1], r, a0, a1, width: this.toolParams.width }); st.addItem(item); st.select(item.id); } this.ts = null; }
        break;
      }
      case 'circle': if (!this.ts) this.ts = { pts: [[bx, by]] }; else { const a = this.ts.pts[0]; const r = dist(a[0], a[1], bx, by); if (r > 1e-6) { const item = makeItem('circle', { layer: this.activeLayer, cx: a[0], cy: a[1], r, width: this.toolParams.width, filled: this.activeLayer === 'Edge.Cuts' ? false : this.toolParams.filled }); st.addItem(item); st.select(item.id); } this.ts = null; } break;
      case 'polygon': case 'trace': case 'region': {
        if (!this.ts) this.ts = { pts: [[bx, by]] };
        else { const first = this.ts.pts[0]; if (this.tool === 'polygon' && this.ts.pts.length >= 3 && dist(first[0], first[1], raw[0], raw[1]) < 6 * this.dpr / this.view.scale) { this._commitPolygon(); break; } const last = this.ts.pts[this.ts.pts.length - 1]; const np = this._constrain(last, [bx, by], e.shiftKey || this.tool === 'trace'); if (dist(last[0], last[1], np[0], np[1]) > 1e-6) this.ts.pts.push(np); }
        break;
      }
      case 'text': { const item = makeItem('text', { layer: this.activeLayer, x: bx, y: by, text: 'TEXT', size: this.toolParams.textSize, thickness: this.toolParams.textThick, align: 'left', font: this.toolParams.textFont || 'sans' }); st.addItem(item); st.select(item.id); this.setTool('select'); this.hooks.focusProp && this.hooks.focusProp('text'); break; }
      case 'pad': { const tp = this.toolParams; const item = makeItem('pad', { x: bx, y: by, shape: tp.padShape, w: tp.padW, h: tp.padH, drill: tp.padDrill, layer: tp.padDrill > 0 ? 'both' : (this.activeLayer === 'B.Cu' ? 'B' : 'F'), rot: 0, name: '', net: '' }); st.addItem(item); st.select(item.id); break; }
      case 'hole': { const item = makeItem('hole', { x: bx, y: by, d: this.toolParams.holeD }); st.addItem(item); st.select(item.id); break; }
      case 'slot': { const item = makeItem('slot', { x: bx, y: by, len: this.toolParams.slotLen, w: this.toolParams.slotW, rot: 0 }); st.addItem(item); st.select(item.id); break; }
      case 'via': { const item = makeItem('via', { x: bx, y: by, d: this.toolParams.viaD, drill: this.toolParams.viaDrill }); st.addItem(item); st.select(item.id); break; }
      case 'image': { if (!this.toolParams.imageSrc) { this.hooks.pickImage && this.hooks.pickImage(); break; } const w = this.toolParams.imageW || 20, h = this.toolParams.imageH || (w / (this.toolParams.imageAspect || 1)); const item = makeItem('image', { layer: this.activeLayer, x: bx, y: by, w, h, rot: 0, src: this.toolParams.imageSrc, threshold: 128, invert: false, dpi: this.toolParams.imageDpi || 96 }); st.addItem(item); st.select(item.id); this.toolParams.imageSrc = null; this.setTool('select'); break; }
      case 'part': {
        const lib = this.toolParams.partLib; if (!lib) { this.status('Pick a part in the Parts panel first'); break; }
        const fp = getFootprint(lib); if (!fp) break;
        if (fp.isStackConnector || fp.isStandoff) { this._placeLink(fp, bx, by); break; }
        const item = makeItem('part', { lib, ref: nextRef(this.store.board, lib, this.store.doc), value: fp.defaultValue || '', x: bx, y: by, rot: this.toolParams.partRot, side: this.view.flip ? 'bottom' : this.toolParams.partSide, through: false });
        st.addItem(item); st.select(item.id); break;
      }
      case 'measure': if (!this.ts) { this.ts = { pts: [[bx, by]] }; this.measure = null; } else { this.measure = { a: this.ts.pts[0], b: [bx, by] }; this.ts = null; } break;
    }
    this.requestRender();
  }
  _placeLink(fp, x, y) {
    const st = this.store; const doc = st.doc;
    if (!doc.stack.enabled) { this.status('Stack items need a two-board document (Board → Add second board)'); return; }
    const link = { id: uid('L'), kind: fp.isStandoff ? 'standoff' : 'connector', lib: fp.id, x, y, rot: this.toolParams.partRot, opts: {} };
    if (link.kind === 'connector') link.ref = nextRef(st.board, 'hdr_1x02', doc);
    st.mutate(d => { d.stack.links.push(link); }, 'add ' + link.kind); st.select(link.id);
  }
  _constrain(a, b, on) { if (!on) return b; const dx = b[0] - a[0], dy = b[1] - a[1]; const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); const L = Math.hypot(dx, dy); if (Math.abs(Math.cos(ang)) < 1e-6 || Math.abs(Math.sin(ang)) < 1e-6) return [a[0] + Math.round(Math.cos(ang)) * L, a[1] + Math.round(Math.sin(ang)) * L]; const m = Math.max(Math.abs(dx), Math.abs(dy)); return [a[0] + Math.sign(dx) * m, a[1] + Math.sign(dy) * m]; }
  _commitPolygon() { const pts = this.ts.pts; this.ts = null; if (pts.length < 3) return; const item = makeItem('polygon', { layer: this.activeLayer, points: pts, width: this.toolParams.width, filled: this.activeLayer === 'Edge.Cuts' ? false : this.toolParams.filled !== false }); this.store.addItem(item); this.store.select(item.id); }
  _commitPath() { const pts = this.ts.pts; const tool = this.tool; this.ts = null; if (pts.length < 2) return; const layer = this.currentLayerFor(tool); const item = tool === 'trace' ? makeItem('trace', { layer, points: pts, width: this.toolParams.traceWidth, net: '' }) : makeItem('region', { layer, points: pts, net: '' }); this.store.addItem(item); this.store.select(item.id); }
  _move(e) {
    const p = this._pt(e); this.mouse = p; const raw = screenToBoard(this.view, p[0], p[1]); this.mouseBoard = raw;
    const [bx, by] = this.snap(raw[0], raw[1]);
    this.hooks.coords && this.hooks.coords(raw[0], raw[1]);
    const ts = this.ts;
    if (ts && ts.kind === 'pan') { if (Math.hypot(p[0] - ts.start[0], p[1] - ts.start[1]) > 4 * this.dpr) ts.moved = true; this.view.ox = ts.ox + (p[0] - ts.start[0]); this.view.oy = ts.oy + (p[1] - ts.start[1]); this.requestRender(); return; }
    if (ts && ts.kind === 'move') {
      const [sx, sy] = this.snap(ts.start[0], ts.start[1]);
      let dx = bx - sx, dy = by - sy;
      if (!ts.moved && Math.hypot(raw[0] - ts.start[0], raw[1] - ts.start[1]) < 3 * this.dpr / this.view.scale) return;
      if (!this.grid.snap) { dx = raw[0] - ts.start[0]; dy = raw[1] - ts.start[1]; }
      const prev = ts.applied || [0, 0]; const ddx = dx - prev[0], ddy = dy - prev[1];
      if (ddx || ddy) { this._translateSelected(ddx, ddy); ts.applied = [dx, dy]; ts.moved = true; }
      this.requestRender(); return;
    }
    if (ts && ts.kind === 'handle') { this._dragHandle(ts.h, raw, e.shiftKey); this.requestRender(); return; }
    if (ts && ts.kind === 'marquee') { ts.cur = raw; this.requestRender(); return; }
    if (this.tool === 'select') { const h = this._hitTest(raw[0], raw[1]); this.hover = h ? h.id : null; }
    this.requestRender();
  }
  _translateSelected(dx, dy) {
    const st = this.store; const sel = st.selection;
    st.mutate(doc => { const b = doc.boards[st.boardIndex]; for (const it of b.items) if (sel.has(it.id) && !it.locked) translateItem(it, dx, dy); for (const l of doc.stack.links) if (sel.has(l.id)) { l.x += dx; l.y += dy; } }, 'move');
  }
  _up(e) {
    const ts = this.ts; if (!ts) return;
    if (ts.kind === 'pan') { this.ts = null; if (ts.button === 2 && !ts.moved) this.openContextMenu(e); return; }
    if (ts.kind === 'move') { this.ts = null; if (ts.moved) this.store.endTransaction(); else this.store.cancelTransaction(); this.requestRender(); return; }
    if (ts.kind === 'handle') { this.ts = null; this.store.endTransaction(); this.requestRender(); return; }
    if (ts.kind === 'marquee') {
      this.ts = null; const [x0, y0] = ts.start, [x1, y1] = ts.cur; const bb = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
      if (bb[2] - bb[0] > 0.2 || bb[3] - bb[1] > 0.2) {
        const ids = []; const doc = this.store.doc;
        for (const it of this.store.board.items) { if (it.layer && this.visible[it.layer] === false) continue; const ib = itemBBox(it, doc); if (ib && ib[0] >= bb[0] && ib[2] <= bb[2] && ib[1] >= bb[1] && ib[3] <= bb[3]) ids.push(it.id); }
        for (const it of stackLinkItems(doc, this.store.board)) { if (!it.fromLink) continue; const ib = itemBBox(it, doc); if (ib && ib[0] >= bb[0] && ib[2] <= bb[2] && ib[1] >= bb[1] && ib[3] <= bb[3]) ids.push(it.fromLink); }
        this.store.select(ids, ts.additive);
      }
      this.requestRender();
    }
  }
  openContextMenu(e) {
    const p = this._pt(e); const raw = screenToBoard(this.view, p[0], p[1]);
    const hit = this._hitTest(raw[0], raw[1]);
    if (hit && hit.id && !this.store.selection.has(hit.id)) this.store.select(hit.id);
    this.ctxPos = raw;
    this.hooks.contextMenu && this.hooks.contextMenu(e.clientX, e.clientY, raw, hit);
  }
  _dbl(e) {
    if (this.tool === 'polygon' && this.ts?.pts?.length >= 3) { this._commitPolygon(); this.requestRender(); return; }
    if ((this.tool === 'trace' || this.tool === 'region') && this.ts?.pts?.length >= 2) { this._commitPath(); this.requestRender(); return; }
    if (this.tool === 'select') { const items = this.store.selectedItems(); if (items.length === 1 && items[0].type === 'text') this.hooks.focusProp && this.hooks.focusProp('text'); }
  }
  // ---------- handles (vertex editing) ----------
  _handles() {
    const items = this.store.selectedItems(); if (items.length !== 1) return [];
    const it = items[0]; const H = [];
    switch (it.type) {
      case 'line': H.push({ it, k: 'p1', x: it.x1, y: it.y1 }, { it, k: 'p2', x: it.x2, y: it.y2 }); break;
      case 'polygon': case 'trace': case 'region': case 'path': it.points.forEach((p, i) => H.push({ it, k: 'v', i, x: p[0], y: p[1] })); break;
      case 'circle': H.push({ it, k: 'r', x: it.cx + it.r, y: it.cy }); break;
      case 'arc': { const a0 = it.a0 * Math.PI / 180, a1 = it.a1 * Math.PI / 180; H.push({ it, k: 'a0', x: it.cx + it.r * Math.cos(a0), y: it.cy + it.r * Math.sin(a0) }, { it, k: 'a1', x: it.cx + it.r * Math.cos(a1), y: it.cy + it.r * Math.sin(a1) }); break; }
      case 'rect': case 'image': { const hw = it.w / 2, hh = it.h / 2; for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) { const [x, y] = rotPt(it.x + sx * hw, it.y + sy * hh, it.rot || 0, it.x, it.y); H.push({ it, k: 'corner', sx, sy, x, y }); } break; }
      case 'slot': { const [x, y] = rotPt(it.x + it.len / 2, it.y, it.rot || 0, it.x, it.y); H.push({ it, k: 'slotend', x, y }); break; }
    }
    return H;
  }
  _hitHandle(raw) { const tol = 6 * this.dpr / this.view.scale; for (const h of this._handles()) if (Math.abs(h.x - raw[0]) <= tol && Math.abs(h.y - raw[1]) <= tol) return h; return null; }
  _dragHandle(h, raw, shift) {
    const [x, y] = this.snap(raw[0], raw[1]);
    this.store.mutate(doc => {
      const it = this.store.board.items.find(i => i.id === h.it.id); if (!it) return;
      switch (h.k) {
        case 'p1': { const b = this._constrain([it.x2, it.y2], [x, y], shift); it.x1 = b[0]; it.y1 = b[1]; break; }
        case 'p2': { const b = this._constrain([it.x1, it.y1], [x, y], shift); it.x2 = b[0]; it.y2 = b[1]; break; }
        case 'v': it.points[h.i] = [x, y]; break;
        case 'r': it.r = Math.max(0.05, dist(it.cx, it.cy, x, y)); break;
        case 'a0': it.a0 = Math.atan2(y - it.cy, x - it.cx) * 180 / Math.PI; break;
        case 'a1': it.a1 = Math.atan2(y - it.cy, x - it.cx) * 180 / Math.PI; break;
        case 'corner': { // resize keeping opposite corner fixed (in the item's rotated frame)
          const [lx, ly] = rotPt(x, y, -(it.rot || 0), it.x, it.y); const ox = it.x - h.sx * it.w / 2, oy = it.y - h.sy * it.h / 2; // opposite corner (unrotated frame)
          const nw = Math.max(0.1, Math.abs(lx - ox)), nh = Math.max(0.1, Math.abs(ly - oy)); const ncx = (lx + ox) / 2, ncy = (ly + oy) / 2;
          const [wx, wy] = rotPt(ncx, ncy, it.rot || 0, it.x, it.y); it.w = nw; it.h = nh; it.x = wx; it.y = wy; break; }
        case 'slotend': { it.len = Math.max(it.w, dist(it.x, it.y, x, y) * 2); it.rot = Math.atan2(y - it.y, x - it.x) * 180 / Math.PI; break; }
      }
    }, 'edit vertex');
  }
  // ---------- selection ops ----------
  rotateSelection(deg) {
    const st = this.store; const items = st.selectedItems(); const links = st.selectedLinks();
    if (this.tool === 'part' && !items.length && !links.length) { this.toolParams.partRot = (this.toolParams.partRot + deg + 360) % 360; this.requestRender(); return; }
    if (!items.length && !links.length) return;
    let bb = null; const doc = st.doc; for (const it of items) bb = unionBBox(bb, itemBBox(it, doc)); for (const l of links) bb = unionBBox(bb, [l.x, l.y, l.x, l.y]);
    const single = items.length + links.length === 1;
    const [cx, cy] = single ? (items.length ? this._anchor(items[0]) : [links[0].x, links[0].y]) : [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
    st.mutate(doc => { const b = doc.boards[st.boardIndex]; for (const it of b.items) if (st.selection.has(it.id)) rotateItem(it, deg, cx, cy); for (const l of doc.stack.links) if (st.selection.has(l.id)) { [l.x, l.y] = rotPt(l.x, l.y, deg, cx, cy); l.rot = ((l.rot || 0) + deg) % 360; } }, 'rotate');
  }
  _anchor(it) { if ('x' in it && 'y' in it && it.type !== 'line') return [it.x, it.y]; if (it.type === 'circle' || it.type === 'arc') return [it.cx, it.cy]; return itemCenter(it, this.store.doc); }
  flipSelectionSide() {
    const st = this.store; const items = st.selectedItems(); if (!items.length) { if (this.tool === 'part') { this.toolParams.partSide = this.toolParams.partSide === 'top' ? 'bottom' : 'top'; this.requestRender(); } return; }
    st.mutate(doc => { const b = doc.boards[st.boardIndex]; for (const it of b.items) { if (!st.selection.has(it.id)) continue; if (it.type === 'part') it.side = it.side === 'bottom' ? 'top' : 'bottom'; else if (it.layer && (it.layer.startsWith('F.') || it.layer.startsWith('B.'))) { it.layer = (it.layer.startsWith('F.') ? 'B.' : 'F.') + it.layer.slice(2); } else if (it.type === 'pad' && it.layer !== 'both') it.layer = it.layer === 'F' ? 'B' : 'F'; } }, 'flip side');
  }
  mirrorSelection(axis = 'h') {
    const st = this.store; const items = st.selectedItems(); const links = st.selectedLinks();
    if (!items.length && !links.length) return;
    let bb = null; const doc = st.doc;
    for (const it of items) bb = unionBBox(bb, itemBBox(it, doc));
    for (const l of links) bb = unionBBox(bb, [l.x, l.y, l.x, l.y]);
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const MX = (x) => axis === 'h' ? 2 * cx - x : x;
    const MY = (y) => axis === 'v' ? 2 * cy - y : y;
    const MP = ([x, y]) => [MX(x), MY(y)];
    st.mutate(doc => {
      const b = doc.boards[st.boardIndex];
      for (const it of b.items) {
        if (!st.selection.has(it.id) || it.locked) continue;
        switch (it.type) {
          case 'line': { const a = MP([it.x1, it.y1]), c = MP([it.x2, it.y2]); it.x1 = a[0]; it.y1 = a[1]; it.x2 = c[0]; it.y2 = c[1]; break; }
          case 'circle': { it.cx = MX(it.cx); it.cy = MY(it.cy); break; }
          case 'arc': { it.cx = MX(it.cx); it.cy = MY(it.cy); const a0 = it.a0, a1 = it.a1; if (axis === 'h') { it.a0 = 180 - a1; it.a1 = 180 - a0; } else { it.a0 = -a1; it.a1 = -a0; } break; }
          case 'polygon': case 'region': case 'trace': case 'path': it.points = it.points.map(MP); break;
          default: {
            if ('x' in it) { it.x = MX(it.x); it.y = MY(it.y); }
            if ('rot' in it) it.rot = (((axis === 'h' ? 180 - (it.rot || 0) : -(it.rot || 0)) % 360) + 360) % 360;
            if (it.type === 'text') it.mirror = !it.mirror;
          }
        }
      }
      for (const l of doc.stack.links) if (st.selection.has(l.id)) { l.x = MX(l.x); l.y = MY(l.y); }
    }, 'mirror');
  }
  // grid / radial step-and-repeat of the current selection
  arraySelection(opts) {
    const st = this.store; const items = st.selectedItems(); if (!items.length) return 0;
    const doc = st.doc; let bb = null; for (const it of items) bb = unionBBox(bb, itemBBox(it, doc));
    const src = JSON.parse(JSON.stringify(items));
    const ids = []; let made = 0;
    st.mutate(doc => {
      const b = doc.boards[st.boardIndex];
      const place = (dx, dy, rot, ax, ay) => {
        for (const s of src) {
          const c = JSON.parse(JSON.stringify(s)); c.id = uid();
          if (rot) rotateItem(c, rot, ax, ay);
          translateItem(c, dx, dy);
          if (c.type === 'part') c.ref = nextRef(b, c.lib, doc);
          b.items.push(c); ids.push(c.id);
        }
        made++;
      };
      if (opts.mode === 'grid') {
        for (let r = 0; r < opts.rows; r++) for (let c = 0; c < opts.cols; c++) {
          if (!r && !c) continue;
          place(c * opts.dx, r * opts.dy, 0, 0, 0);
        }
      } else {
        const cx = opts.cx, cy = opts.cy, n = opts.count, span = opts.span ?? 360;
        const step = span === 360 ? span / n : (n > 1 ? span / (n - 1) : 0);
        for (let i = 1; i < n; i++) {
          const a = step * i;
          for (const s of src) {
            const c = JSON.parse(JSON.stringify(s)); c.id = uid();
            rotateItem(c, a, cx, cy);
            if (!opts.rotateItems) { const ctr = itemCenter(c, doc); rotateItem(c, -a, ctr[0], ctr[1]); }
            if (c.type === 'part') c.ref = nextRef(b, c.lib, doc);
            b.items.push(c); ids.push(c.id);
          }
          made++;
        }
      }
    }, 'array');
    st.select(ids.length ? ids : Array.from(st.selection));
    return made;
  }
  nudge(dx, dy) { if (!this.store.selection.size) return; this._translateSelected(dx, dy); }
  duplicateSelection() {
    const st = this.store; const items = st.selectedItems(); const links = st.selectedLinks(); if (!items.length && !links.length) return;
    const ids = [];
    st.mutate(doc => {
      const b = doc.boards[st.boardIndex];
      for (const it of items) { const c = JSON.parse(JSON.stringify(it)); c.id = uid(); translateItem(c, this.grid.size * 2, -this.grid.size * 2); if (c.type === 'part') c.ref = nextRef(b, c.lib, doc); b.items.push(c); ids.push(c.id); }
      for (const l of links) { const c = JSON.parse(JSON.stringify(l)); c.id = uid('L'); c.x += this.grid.size * 2; c.y -= this.grid.size * 2; if (c.ref) c.ref = nextRef(b, 'hdr_1x02', doc); doc.stack.links.push(c); ids.push(c.id); }
    }, 'duplicate');
    st.select(ids);
  }
  selectAll() { this.store.select(this.store.board.items.map(i => i.id)); }
  copySelection() { const items = this.store.selectedItems(); if (!items.length) return false; this._clip = JSON.parse(JSON.stringify(items)); this.status(`Copied ${items.length} item(s)`); return true; }
  cutSelection() { if (this.copySelection()) this.store.deleteSelected(); }
  paste() {
    if (!this._clip || !this._clip.length) return; const st = this.store; const ids = [];
    let bb = null; for (const it of this._clip) bb = unionBBox(bb, itemBBox(it, st.doc));
    const [tx, ty] = this.mouse ? this.snap(this.mouseBoard[0], this.mouseBoard[1]) : [(bb[0] + bb[2]) / 2 + 2, (bb[1] + bb[3]) / 2 - 2];
    const dx = tx - (bb[0] + bb[2]) / 2, dy = ty - (bb[1] + bb[3]) / 2;
    st.mutate(doc => { const b = doc.boards[st.boardIndex]; for (const src of this._clip) { const c = JSON.parse(JSON.stringify(src)); c.id = uid(); translateItem(c, dx, dy); if (c.type === 'part') c.ref = nextRef(b, c.lib, doc); b.items.push(c); ids.push(c.id); } }, 'paste');
    st.select(ids);
  }
  zoomToBBox(bb) { if (!bb) return; const W = bb[2] - bb[0] || 5, H = bb[3] - bb[1] || 5; const cw = this.canvas.width, ch = this.canvas.height; this.view.scale = Math.min(cw / (W + 10), ch / (H + 10)); const [cx, cy] = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]; const [sx, sy] = boardToScreen(this.view, cx, cy); this.view.ox += cw / 2 - sx; this.view.oy += ch / 2 - sy; this.requestRender(); }
  // ---------- render ----------
  render() {
    const ctx = this.ctx, c = this.canvas; const st = this.store; const board = st.board; const doc = st.doc;
    const [W, H] = boardSize(board); this.view.W = W;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#1b1d22'; ctx.fillRect(0, 0, c.width, c.height);
    applyView(ctx, this.view);
    if (this.grid.show) drawGrid(ctx, this.view, W, H, this.grid.size);
    const R = this.resolved();
    const side = this.view.flip ? 'bottom' : 'top';
    const silk = SILK_COLORS[board.silkColor] || '#f4f4f4';
    const minLine = 1 * this.dpr / this.view.scale;
    if (this.mode === 'realistic') renderRealistic(ctx, R, board, { side, visible: this.visible, showFar: this.showFar, imageProvider: this.imageProvider(this.mode === 'realistic' ? silk : '#fff'), minLine, background: '#1b1d22' });
    else renderLayers(ctx, R, board, { side, visible: this.visible, activeLayer: this.activeLayer, dimOthers: this.dimOthers, imageProvider: this.imageProvider('#fff'), minLine, background: '#1b1d22' });
    // ghost of the other board (stack) — drawn over the board, faint
    if (this.ghostOther && doc.stack.enabled && doc.boards.length > 1) this._drawGhostOther(ctx);
    // stack links overlay (standoffs)
    this._drawLinks(ctx, R);
    // selection + hover
    for (const it of board.items) if (st.selection.has(it.id)) drawBBox(ctx, itemBBox(it, doc), '#ffd54a', this.view);
    for (const l of doc.stack.links) if (st.selection.has(l.id)) { const its = stackLinkItems(doc, board).filter(i => i.fromLink === l.id); let bb = null; for (const i of its) bb = unionBBox(bb, itemBBox(i, doc)); drawBBox(ctx, bb || [l.x - 3, l.y - 3, l.x + 3, l.y + 3], '#ffd54a', this.view); }
    if (this.hover && !st.selection.has(this.hover)) { const it = board.items.find(i => i.id === this.hover); if (it) drawBBox(ctx, itemBBox(it, doc), 'rgba(255,255,255,0.5)', this.view, false); else { const l = doc.stack.links.find(x => x.id === this.hover); if (l) drawBBox(ctx, [l.x - 3, l.y - 3, l.x + 3, l.y + 3], 'rgba(255,255,255,0.5)', this.view, false); } }
    // handles
    const hs = this._handles(); if (hs.length) { const s = 4 * this.dpr / this.view.scale; ctx.fillStyle = '#ffd54a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / this.view.scale; for (const h of hs) { ctx.beginPath(); ctx.rect(h.x - s, h.y - s, 2 * s, 2 * s); ctx.fill(); ctx.stroke(); } }
    // DRC markers
    if (this.drcMarkers.length) { for (const m of this.drcMarkers) { if (m.board !== st.boardIndex) continue; ctx.beginPath(); ctx.arc(m.x, m.y, 6 * this.dpr / this.view.scale, 0, Math.PI * 2); ctx.strokeStyle = m.level === 'error' ? '#ff5c5c' : m.level === 'warn' ? '#ffb648' : '#8ac'; ctx.lineWidth = 2 * this.dpr / this.view.scale; ctx.stroke(); } }
    // tool preview
    this._drawToolPreview(ctx);
    // design-studio preview
    if (this.previewItems && this.previewItems.length) {
      ctx.save(); ctx.globalAlpha = 0.95; ctx.strokeStyle = '#4ccf7a'; ctx.fillStyle = 'rgba(76,207,122,0.55)'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const it of this.previewItems) {
        if (it.type === 'path' || it.type === 'polygon' || it.type === 'region' || it.type === 'trace') {
          const pts = it.points; if (!pts || pts.length < 2) continue;
          ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          if (it.type === 'polygon' || it.closed || it.type === 'region') ctx.closePath();
          if (it.filled === true || it.type === 'region') ctx.fill(); else { ctx.lineWidth = Math.max(it.width || 0.2, 1 * this.dpr / this.view.scale); ctx.stroke(); }
        } else if (it.type === 'line') { ctx.beginPath(); ctx.lineWidth = Math.max(it.width || 0.2, 1 * this.dpr / this.view.scale); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke(); }
        else if (it.type === 'circle') { ctx.beginPath(); ctx.arc(it.cx, it.cy, it.r, 0, Math.PI * 2); if (it.filled) ctx.fill(); else { ctx.lineWidth = Math.max(it.width || 0.2, 1 * this.dpr / this.view.scale); ctx.stroke(); } }
      }
      ctx.restore();
    }
    // snap marker
    if (this._snapHit && this.mouse) {
      const t = this._snapHit; const r = 5 * this.dpr / this.view.scale;
      ctx.strokeStyle = t.other ? '#8ab4ff' : '#4ccf7a'; ctx.lineWidth = 1.6 * this.dpr / this.view.scale; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(t.x - r, t.y); ctx.lineTo(t.x + r, t.y); ctx.moveTo(t.x, t.y - r); ctx.lineTo(t.x, t.y + r); ctx.stroke();
      ctx.beginPath(); ctx.arc(t.x, t.y, r * 0.75, 0, Math.PI * 2); ctx.stroke();
    }
    // measure
    if (this.measure) { const { a, b } = this.measure; ctx.strokeStyle = '#3fa7ff'; ctx.lineWidth = 1.5 * this.dpr / this.view.scale; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    // marquee
    if (this.ts?.kind === 'marquee') { const [x0, y0] = this.ts.start, [x1, y1] = this.ts.cur; ctx.strokeStyle = '#3fa7ff'; ctx.fillStyle = 'rgba(63,167,255,0.12)'; ctx.lineWidth = 1 / this.view.scale; ctx.setLineDash([]); ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
    // HUD text (screen space)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.hooks.hud && this.hooks.hud(this._hudText());
  }
  _hudText() {
    const st = this.store; const parts = [];
    if (this.view.flip) parts.push('VIEW FROM BOTTOM (mirrored)');
    if (this.measure) { const { a, b } = this.measure; parts.push(`Δx ${(b[0] - a[0]).toFixed(2)}  Δy ${(b[1] - a[1]).toFixed(2)}  d ${dist(a[0], a[1], b[0], b[1]).toFixed(2)} mm`); }
    if (this._snapHit) parts.push('snap: ' + this._snapHit.label);
    if (this.tool === 'part' && this.toolParams.partLib) parts.push(`placing ${this.toolParams.partLib}  rot ${this.toolParams.partRot}°  ${this.toolParams.partSide}  (R rotate, F side, Esc)`);
    if (this.ts?.pts && (this.tool === 'polygon' || this.tool === 'trace' || this.tool === 'region')) parts.push(`${this.ts.pts.length} pts — dbl-click / Enter to finish, Esc cancels`);
    return parts.join('\n');
  }
  _drawGhostOther(ctx) {
    const doc = this.store.doc; const other = doc.boards[this.store.boardIndex === 0 ? 1 : 0]; if (!other) return;
    const R = this.resolvedFor(other);
    ctx.save(); ctx.globalAlpha = 0.45;
    pathOutline(ctx, R); ctx.strokeStyle = '#8ab4ff'; ctx.lineWidth = 2 * this.dpr / this.view.scale; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
    for (const p of R.parts) { if (p.fromLink) continue; if (p.bbox) { ctx.strokeStyle = '#8ab4ff'; ctx.lineWidth = 1 * this.dpr / this.view.scale; ctx.strokeRect(p.bbox[0], p.bbox[1], p.bbox[2] - p.bbox[0], p.bbox[3] - p.bbox[1]); } }
    for (const d of R.drills) { ctx.beginPath(); ctx.arc(d.x, d.y, d.d / 2, 0, Math.PI * 2); ctx.strokeStyle = '#8ab4ff'; ctx.lineWidth = 1 * this.dpr / this.view.scale; ctx.stroke(); }
    ctx.restore();
  }
  _drawLinks(ctx, R) {
    const doc = this.store.doc; if (!doc.stack.enabled) return;
    for (const l of doc.stack.links) {
      if (l.kind !== 'standoff' && l.kind !== 'screw') continue;
      const fp = getFootprint(l.lib); const af = fp?.hexAF || 5.5;
      ctx.save(); ctx.translate(l.x, l.y); ctx.strokeStyle = 'rgba(201,162,39,0.9)'; ctx.lineWidth = 1.5 * this.dpr / this.view.scale; ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; const r = af / 2 / Math.cos(Math.PI / 6); const x = r * Math.cos(a), y = r * Math.sin(a); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.closePath(); ctx.stroke(); ctx.restore();
    }
  }
  _drawToolPreview(ctx) {
    if (!this.mouse) return;
    const [bx, by] = this.snap(this.mouseBoard[0], this.mouseBoard[1]);
    const col = 'rgba(255,255,255,0.75)'; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const lw = Math.max(this.toolParams.width, 1.5 * this.dpr / this.view.scale);
    const t = this.tool, ts = this.ts;
    const cross = () => { const s = 6 * this.dpr / this.view.scale; ctx.lineWidth = 1 * this.dpr / this.view.scale; ctx.beginPath(); ctx.moveTo(bx - s, by); ctx.lineTo(bx + s, by); ctx.moveTo(bx, by - s); ctx.lineTo(bx, by + s); ctx.stroke(); };
    switch (t) {
      case 'line': if (ts?.pts) { const a = ts.pts[0]; const b = this._constrain(a, [bx, by], false); ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } cross(); break;
      case 'rect': if (ts?.pts) { const a = ts.pts[0]; ctx.lineWidth = lw; ctx.strokeRect(Math.min(a[0], bx), Math.min(a[1], by), Math.abs(bx - a[0]), Math.abs(by - a[1])); } cross(); break;
      case 'circle': if (ts?.pts) { const a = ts.pts[0]; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(a[0], a[1], dist(a[0], a[1], bx, by), 0, Math.PI * 2); ctx.stroke(); } cross(); break;
      case 'arc': if (ts?.pts) { const c0 = ts.pts[0]; ctx.lineWidth = lw; if (ts.pts.length === 1) { ctx.beginPath(); ctx.arc(c0[0], c0[1], dist(c0[0], c0[1], bx, by), 0, Math.PI * 2); ctx.setLineDash([1, 1]); ctx.stroke(); ctx.setLineDash([]); } else { const s0 = ts.pts[1]; const r = dist(c0[0], c0[1], s0[0], s0[1]); let a0 = Math.atan2(s0[1] - c0[1], s0[0] - c0[0]), a1 = Math.atan2(by - c0[1], bx - c0[0]); while (a1 <= a0) a1 += Math.PI * 2; ctx.beginPath(); ctx.arc(c0[0], c0[1], r, a0, a1); ctx.stroke(); } } cross(); break;
      case 'polygon': case 'trace': case 'region': if (ts?.pts) { ctx.lineWidth = t === 'trace' ? Math.max(this.toolParams.traceWidth, lw) : lw; ctx.beginPath(); ctx.moveTo(ts.pts[0][0], ts.pts[0][1]); for (const p of ts.pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.lineTo(bx, by); if (t !== 'trace') { ctx.lineTo(ts.pts[0][0], ts.pts[0][1]); } ctx.stroke(); } cross(); break;
      case 'pad': { const tp = this.toolParams; const pts = padPoints({ shape: tp.padShape, w: tp.padW, h: tp.padH, x: bx, y: by, rot: 0 }); ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fill(); if (tp.padDrill > 0) { ctx.globalAlpha = 1; ctx.fillStyle = '#1b1d22'; ctx.beginPath(); ctx.arc(bx, by, tp.padDrill / 2, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; break; }
      case 'hole': ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(bx, by, this.toolParams.holeD / 2, 0, Math.PI * 2); ctx.stroke(); cross(); break;
      case 'via': ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(bx, by, this.toolParams.viaD / 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; break;
      case 'slot': drawDrill(ctx, { x: bx, y: by, d: this.toolParams.slotW, slotLen: this.toolParams.slotLen, rot: 0 }, 'rgba(255,255,255,0.4)', null); break;
      case 'text': cross(); break;
      case 'image': { const iw = this.toolParams.imageW || 20, ih = this.toolParams.imageH || (iw / (this.toolParams.imageAspect || 1)); ctx.lineWidth = lw; ctx.strokeRect(bx - iw / 2, by - ih / 2, iw, ih); const c = this._imgCache && this.toolParams.imageSrc ? null : null; break; }
      case 'measure': if (ts?.pts) { const a = ts.pts[0]; ctx.strokeStyle = '#3fa7ff'; ctx.lineWidth = 1.5 * this.dpr / this.view.scale; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bx, by); ctx.stroke(); } cross(); break;
      case 'part': {
        const lib = this.toolParams.partLib; if (!lib) { cross(); break; }
        const fp = getFootprint(lib); if (!fp) break;
        if (fp.isStandoff) { ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(bx, by, (fp.holeD || 3.2) / 2, 0, Math.PI * 2); ctx.stroke(); cross(); break; }
        const half = fp.isStackConnector ? getFootprint(this.store.boardIndex === 0 ? fp.pair.lower : fp.pair.upper) : fp;
        const side = fp.isStackConnector ? (this.store.boardIndex === 0 ? 'top' : 'bottom') : (this.view.flip ? 'bottom' : this.toolParams.partSide);
        const rp = resolvePart({ lib: half.id, ref: '?', x: bx, y: by, rot: this.toolParams.partRot, side }, this.store.doc); if (!rp) break;
        ctx.globalAlpha = 0.7;
        for (const p of rp.pads) { ctx.beginPath(); ctx.moveTo(p.poly[0][0], p.poly[0][1]); for (const q of p.poly) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fillStyle = 'rgba(217,67,47,0.8)'; ctx.fill(); }
        for (const h of rp.holes) { ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = lw; ctx.stroke(); }
        drawPrims(ctx, rp.prims.filter(p => p.layer.endsWith('Silk')).map(p => p.prim).flatMap(p => p.t === 'text' ? [] : [p]), '#fff', { minLine: lw });
        if (rp.bbox) { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1 * this.dpr / this.view.scale; ctx.strokeRect(rp.bbox[0], rp.bbox[1], rp.bbox[2] - rp.bbox[0], rp.bbox[3] - rp.bbox[1]); }
        ctx.globalAlpha = 1; break;
      }
      default: break;
    }
  }
}
export const TOOL_HINTS = {
  select: 'Select: click / drag-marquee · drag to move · R rotate · F flip side · Del delete · Ctrl+D duplicate · handles edit vertices',
  line: 'Line: click start, click end (Shift = 45°). Right-click / Esc to stop.',
  rect: 'Rectangle: click two corners. Fill toggle in the toolbar. On Edge.Cuts = cutout.',
  circle: 'Circle: click centre, click radius. On Edge.Cuts = round cutout.',
  arc: 'Arc: click centre, click start point, click end point (counter-clockwise).',
  polygon: 'Polygon: click points, double-click / Enter / click first point to close.',
  text: 'Text: click to place, then type in Properties.',
  image: 'Image: choose a PNG/JPG/SVG, then click to place. Threshold/invert in Properties.',
  pad: 'Pad: click to place a copper pad (shape/size/drill in the toolbar).',
  hole: 'Hole: click to place a non-plated hole (Ø in the toolbar).',
  slot: 'Slot: click to place a routed slot; drag its handle to set length/angle.',
  via: 'Via: click to place.',
  trace: 'Trace: click points on the active copper layer, double-click to finish.',
  region: 'Copper region: click polygon points on the active copper layer, double-click to finish.',
  part: 'Part: click to place · R rotate · F flip side · Esc to stop.',
  measure: 'Measure: click two points.',
};
function isTyping() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); }
export { isTyping };
