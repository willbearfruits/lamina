// LAMINA document model + store (undo/redo, selection, events). See docs/FORMAT.md.
import { getFootprint, partRefPrefix } from './library.js';

export const FORMAT = 'lamina/1';
let _uid = 0;
export function uid(prefix = 'i') { _uid++; return prefix + Date.now().toString(36).slice(-4) + (_uid).toString(36); }

export const BOARD_COLORS = {
  green: { mask: '#0d5c2e', maskLight: '#1e8a4a', name: 'Green' },
  red: { mask: '#8f1717', maskLight: '#c62828', name: 'Red' },
  blue: { mask: '#0d2f6e', maskLight: '#1e4fa8', name: 'Blue' },
  black: { mask: '#141414', maskLight: '#333', name: 'Black' },
  white: { mask: '#e9e9e2', maskLight: '#fff', name: 'White' },
  yellow: { mask: '#c9a800', maskLight: '#e5c400', name: 'Yellow' },
  purple: { mask: '#4a1a6e', maskLight: '#6a2a9e', name: 'Purple' },
};
export const SILK_COLORS = { white: '#f4f4f4', black: '#111' };
export const FINISHES = ['HASL', 'LeadFreeHASL', 'ENIG'];
export const THICKNESSES = [0.6, 0.8, 1.0, 1.2, 1.6, 2.0];

// Board size presets (mm)
export const SIZE_PRESETS = [
  { id: 'jlc100', name: '100 × 100 (JLCPCB cheap tier)', w: 100, h: 100 },
  { id: 'jlc50', name: '50 × 50', w: 50, h: 50 },
  { id: 'jlc100x50', name: '100 × 50', w: 100, h: 50 },
  { id: 'jlc80', name: '80 × 80', w: 80, h: 80 },
  { id: 'jlc100x80', name: '100 × 80', w: 100, h: 80 },
  { id: '1590b', name: 'Hammond 1590B pedal (inside 107 × 55)', w: 107, h: 55, note: 'inside floor of a 1590B is ~107×55 mm; usable board ~100×50' },
  { id: '1590bb', name: 'Hammond 1590BB pedal (inside 113 × 88)', w: 113, h: 88 },
  { id: '125b', name: 'Hammond 125B pedal (inside 116 × 60)', w: 116, h: 60 },
  { id: '1590a', name: 'Hammond 1590A (inside 87 × 35)', w: 87, h: 35 },
  { id: 'euro4', name: 'Eurorack 4HP panel (20.0 × 128.5)', w: 20.0, h: 128.5 },
  { id: 'euro8', name: 'Eurorack 8HP panel (40.3 × 128.5)', w: 40.3, h: 128.5 },
  { id: 'euro12', name: 'Eurorack 12HP panel (60.6 × 128.5)', w: 60.6, h: 128.5 },
  { id: 'euro16', name: 'Eurorack 16HP panel (80.9 × 128.5)', w: 80.9, h: 128.5 },
  { id: 'euro20', name: 'Eurorack 20HP panel (101.3 × 128.5)', w: 101.3, h: 128.5 },
  { id: 'card', name: 'Business card 85 × 55', w: 85, h: 55 },
  { id: 'a6', name: 'A6 148 × 105', w: 148, h: 105 },
  { id: 'circle60', name: 'Circle Ø60', circle: 60 },
  { id: 'circle100', name: 'Circle Ø100', circle: 100 },
  { id: 'custom', name: 'Custom…', w: 100, h: 100 },
];

// ---------- factories ----------
export function newBoard(opts = {}) {
  const outline = opts.outline || (opts.circle ? { type: 'circle', d: opts.circle } : { type: 'rect', w: opts.w ?? 100, h: opts.h ?? 100, r: opts.r ?? 2 });
  return {
    id: opts.id || uid('b'), name: opts.name || 'BOARD', role: opts.role || 'lower', outline,
    thickness: opts.thickness ?? 1.6, color: opts.color || 'green', silkColor: opts.silkColor || 'white', finish: opts.finish || 'HASL', copperOz: opts.copperOz ?? 1,
    offset: { x: 0, y: 0 }, items: [],
  };
}
export function newDocument(opts = {}) {
  const now = new Date().toISOString();
  const doc = { format: FORMAT, name: opts.name || 'untitled', created: now, modified: now, units: 'mm', drcPreset: opts.drcPreset || 'jlcpcb-2layer', drc: { maskMargin: 0.05 }, boards: [], stack: { enabled: false, gap: 11, gapSource: 'connector', links: [] }, meta: { author: '', notes: '' } };
  doc.boards.push(newBoard({ ...opts, name: opts.name1 || (opts.two ? 'MAIN' : 'BOARD'), role: 'lower' }));
  if (opts.two) {
    doc.boards.push(newBoard({ ...opts, name: opts.name2 || 'PANEL', role: 'upper', color: opts.color2 || opts.color }));
    doc.stack.enabled = true;
    doc.stack.gap = opts.gap ?? 11;
  }
  return doc;
}
export function addMountingHoles(board, opts = {}) {
  const inset = opts.inset ?? 4, lib = opts.lib || 'mount_m3';
  const [W, H] = boardSize(board);
  const pts = [[inset, inset], [W - inset, inset], [W - inset, H - inset], [inset, H - inset]];
  const out = [];
  for (const [x, y] of pts) { const it = { id: uid('p'), type: 'part', lib, ref: nextRef(board, lib), value: '', x, y, rot: 0, side: 'top', through: false }; board.items.push(it); out.push(it); }
  return out;
}
export function addStackStandoffs(doc, opts = {}) {
  const inset = opts.inset ?? 4, lib = opts.lib || 'standoff_m3';
  const [W, H] = boardSize(doc.boards[0]);
  const pts = [[inset, inset], [W - inset, inset], [W - inset, H - inset], [inset, H - inset]];
  for (const [x, y] of pts) doc.stack.links.push({ id: uid('L'), kind: 'standoff', lib, x, y, rot: 0, opts: {} });
}
export function boardSize(board) {
  const o = board.outline;
  if (o.type === 'circle') return [o.d, o.d];
  if (o.type === 'polygon') { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of o.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x1 - x0, y1 - y0]; }
  return [o.w, o.h];
}
export function nextRef(board, lib, doc) {
  const prefix = partRefPrefix(lib);
  const used = new Set();
  const boards = doc ? doc.boards : [board];
  for (const b of boards) for (const it of b.items) if (it.type === 'part' && it.ref) used.add(it.ref);
  if (doc) for (const l of doc.stack.links || []) if (l.ref) used.add(l.ref);
  let n = 1; while (used.has(prefix + n)) n++;
  return prefix + n;
}
export function makeItem(type, props = {}) {
  const base = { id: uid(), type };
  const defaults = {
    line: { layer: 'F.Silk', x1: 0, y1: 0, x2: 10, y2: 0, width: 0.2 },
    arc: { layer: 'F.Silk', cx: 0, cy: 0, r: 5, a0: 0, a1: 90, width: 0.2 },
    circle: { layer: 'F.Silk', cx: 0, cy: 0, r: 5, width: 0.2, filled: false },
    rect: { layer: 'F.Silk', x: 0, y: 0, w: 10, h: 10, rot: 0, rx: 0, width: 0.2, filled: false },
    polygon: { layer: 'F.Silk', points: [], width: 0.2, filled: true },
    text: { layer: 'F.Silk', x: 0, y: 0, text: 'TEXT', size: 2, thickness: 0.25, rot: 0, mirror: false, align: 'left', font: 'sans', arc: 0 },
    image: { layer: 'F.Silk', x: 0, y: 0, w: 20, h: 20, rot: 0, src: '', threshold: 128, invert: false },
    pad: { x: 0, y: 0, shape: 'circle', w: 1.8, h: 1.8, rot: 0, drill: 1.0, slot: 0, layer: 'both', plated: true, name: '', net: '' },
    hole: { x: 0, y: 0, d: 3.2 },
    slot: { x: 0, y: 0, len: 6, w: 2, rot: 0 },
    via: { x: 0, y: 0, d: 0.8, drill: 0.4, net: '' },
    trace: { layer: 'F.Cu', points: [], width: 0.3, net: '' },
    path: { layer: 'F.Silk', points: [], width: 0.2, closed: false },
    region: { layer: 'F.Cu', points: [], net: '' },
    part: { lib: '', ref: '', value: '', x: 0, y: 0, rot: 0, side: 'top', through: false },
  }[type] || {};
  return { ...base, ...defaults, ...props };
}
export function cloneDeep(o) { return JSON.parse(JSON.stringify(o)); }

// ---------- store ----------
export class Store {
  constructor(doc) {
    this.doc = doc || newDocument();
    this.undoStack = []; this.redoStack = []; this.maxUndo = 100;
    this.selection = new Set(); this.boardIndex = 0;
    this.listeners = {}; this._tx = null; this.dirty = false;
    this.imageCache = new Map(); // item.id -> {img, bitmap}
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return () => { this.listeners[ev] = this.listeners[ev].filter(f => f !== fn); }; }
  emit(ev, data) { for (const fn of this.listeners[ev] || []) fn(data); }
  get board() { return this.doc.boards[this.boardIndex] || this.doc.boards[0]; }
  setBoardIndex(i) { if (i !== this.boardIndex) { this.boardIndex = Math.max(0, Math.min(i, this.doc.boards.length - 1)); this.selection.clear(); this.emit('board', this.boardIndex); this.emit('selection'); this.emit('change', { kind: 'view' }); } }
  snapshot() { return JSON.stringify(this.doc); }
  // mutate(fn, label): wraps a change in an undo entry (or joins the open transaction)
  mutate(fn, label = 'edit') {
    if (this._tx) { const r = fn(this.doc); this._afterChange(label); return r; }
    const before = this.snapshot();
    const r = fn(this.doc);
    const after = this.snapshot();
    if (before !== after) { this.undoStack.push({ label, state: before }); if (this.undoStack.length > this.maxUndo) this.undoStack.shift(); this.redoStack.length = 0; }
    this._afterChange(label);
    return r;
  }
  beginTransaction(label = 'edit') { if (this._tx) return; this._tx = { label, before: this.snapshot() }; }
  endTransaction() { if (!this._tx) return; const tx = this._tx; this._tx = null; const after = this.snapshot(); if (after !== tx.before) { this.undoStack.push({ label: tx.label, state: tx.before }); if (this.undoStack.length > this.maxUndo) this.undoStack.shift(); this.redoStack.length = 0; } this._afterChange(tx.label); }
  cancelTransaction() { if (!this._tx) return; const tx = this._tx; this._tx = null; this.doc = JSON.parse(tx.before); this._afterChange('cancel'); }
  _afterChange(label) { this.doc.modified = new Date().toISOString(); this.dirty = true; this.pruneSelection(); this.emit('change', { kind: label }); }
  undo() { const e = this.undoStack.pop(); if (!e) return false; this.redoStack.push({ label: e.label, state: this.snapshot() }); this.doc = JSON.parse(e.state); this.selection.clear(); this._afterChange('undo'); this.emit('selection'); return true; }
  redo() { const e = this.redoStack.pop(); if (!e) return false; this.undoStack.push({ label: e.label, state: this.snapshot() }); this.doc = JSON.parse(e.state); this.selection.clear(); this._afterChange('redo'); this.emit('selection'); return true; }
  replaceDoc(doc) { this.doc = doc; this.undoStack.length = 0; this.redoStack.length = 0; this.selection.clear(); this.boardIndex = 0; this.dirty = false; this.imageCache.clear(); this.emit('doc'); this.emit('board', 0); this.emit('selection'); this.emit('change', { kind: 'load' }); }
  // selection
  select(ids, additive = false) { if (!additive) this.selection.clear(); for (const id of (Array.isArray(ids) ? ids : [ids])) this.selection.add(id); this.emit('selection'); }
  toggleSelect(id) { if (this.selection.has(id)) this.selection.delete(id); else this.selection.add(id); this.emit('selection'); }
  clearSelection() { if (this.selection.size) { this.selection.clear(); this.emit('selection'); } }
  pruneSelection() { const ids = new Set(this.board.items.map(i => i.id)); for (const l of this.doc.stack.links) ids.add(l.id); let changed = false; for (const s of Array.from(this.selection)) if (!ids.has(s)) { this.selection.delete(s); changed = true; } if (changed) this.emit('selection'); }
  selectedItems() { const out = []; for (const it of this.board.items) if (this.selection.has(it.id)) out.push(it); return out; }
  selectedLinks() { return (this.doc.stack.links || []).filter(l => this.selection.has(l.id)); }
  itemById(id) { for (const b of this.doc.boards) for (const it of b.items) if (it.id === id) return it; return null; }
  addItem(item, boardIdx = this.boardIndex) { return this.mutate(doc => { doc.boards[boardIdx].items.push(item); return item; }, 'add ' + item.type); }
  deleteSelected() {
    const ids = new Set(this.selection);
    if (!ids.size) return;
    this.mutate(doc => { const b = doc.boards[this.boardIndex]; b.items = b.items.filter(i => !ids.has(i.id)); doc.stack.links = doc.stack.links.filter(l => !ids.has(l.id)); }, 'delete');
    this.selection.clear(); this.emit('selection');
  }
}

// ---------- serialisation ----------
export function serializeDoc(doc) { return JSON.stringify(doc, null, 1); }
export function parseDoc(text) {
  const d = typeof text === 'string' ? JSON.parse(text) : text;
  if (!d || d.format !== FORMAT) throw new Error('Not a LAMINA document (format ' + (d && d.format) + ')');
  return upgradeDoc(d);
}
export function upgradeDoc(d) {
  d.stack ||= { enabled: false, gap: 11, gapSource: 'connector', links: [] };
  d.stack.links ||= [];
  d.drc ||= { maskMargin: 0.05 };
  d.meta ||= {};
  for (const b of d.boards) { b.items ||= []; b.offset ||= { x: 0, y: 0 }; b.silkColor ||= 'white'; }
  return d;
}
export function validateDoc(doc) {
  const errs = [];
  if (!doc.boards || !doc.boards.length) errs.push('no boards');
  for (const b of doc.boards || []) {
    if (!b.outline) errs.push(`board ${b.name}: no outline`);
    for (const it of b.items || []) {
      if (!it.id || !it.type) errs.push(`board ${b.name}: item without id/type`);
      if (it.type === 'part' && !it.fp && !getFootprint(it.lib)) errs.push(`board ${b.name}: unknown part lib "${it.lib}" (${it.ref})`);
    }
  }
  return errs;
}
