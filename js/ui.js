// tiny DOM helpers + modal + toast
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; else if (k === 'value') el.value = v; else if (k === 'checked') el.checked = !!v; else if (k === 'disabled') el.disabled = !!v; else if (k === 'selected') el.selected = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function toast(msg, kind = '', ms = 2600) { const t = h('div', { class: 'toast ' + kind }, msg); document.body.append(t); setTimeout(() => t.remove(), ms); }
export function modal({ title, body, buttons = [], width, onClose, cls = '', dock = null }) {
  const root = document.getElementById('modal-root');
  if (dock) root.classList.add('docked', 'dock-' + dock); else root.classList.remove('docked', 'dock-left', 'dock-right');
  const box = h('div', { class: 'modal ' + cls, style: width ? { width } : {} });
  const head = h('header', {}, title);
  const bodyEl = h('div', { class: 'body' }); if (body) bodyEl.append(body);
  const foot = h('footer', {});
  const close = () => { box.remove(); if (dock) document.getElementById('modal-root').classList.remove('docked', 'dock-left', 'dock-right'); onClose && onClose(); };
  for (const b of buttons) { const btn = h('button', { class: b.primary ? 'primary' : '', onclick: () => { const r = b.onClick ? b.onClick(api) : true; if (r !== false) close(); } }, b.label); if (b.left) { let l = foot.querySelector('.left'); if (!l) { l = h('div', { class: 'left' }); foot.prepend(l); } l.append(btn); } else foot.append(btn); }
  if (dock) {
    head.style.cursor = 'move';
    head.addEventListener('pointerdown', (e) => {
      if (e.target !== head) return;
      const r0 = box.getBoundingClientRect(); const sx = e.clientX, sy = e.clientY;
      box.style.position = 'fixed'; box.style.left = r0.left + 'px'; box.style.top = r0.top + 'px'; box.style.margin = '0';
      const mv = (ev) => { box.style.left = Math.max(0, Math.min(window.innerWidth - 120, r0.left + ev.clientX - sx)) + 'px'; box.style.top = Math.max(0, Math.min(window.innerHeight - 60, r0.top + ev.clientY - sy)) + 'px'; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
  }
  box.append(head, bodyEl, foot); root.append(box);
  const api = { close, box, body: bodyEl, head, foot, setTitle: (t) => { clear(head); head.append(t); } };
  return api;
}
export function confirmDlg(msg, okLabel = 'OK') { return new Promise(res => modal({ title: 'Confirm', body: h('div', {}, msg), buttons: [{ label: 'Cancel', onClick: () => { res(false); } }, { label: okLabel, primary: true, onClick: () => { res(true); } }] })); }
export function promptDlg(title, value = '', label = '') { return new Promise(res => { const inp = h('input', { type: 'text', value }); const m = modal({ title, body: h('div', {}, label ? h('label', {}, label) : null, inp), buttons: [{ label: 'Cancel', onClick: () => res(null) }, { label: 'OK', primary: true, onClick: () => res(inp.value) }] }); setTimeout(() => { inp.focus(); inp.select(); }, 20); inp.addEventListener('keydown', e => { if (e.key === 'Enter') { res(inp.value); m.close(); } }); }); }
export function num(v, d = 2) { return Number.isFinite(v) ? +v.toFixed(d) : v; }
export function field(label, input, opts = {}) { return h('div', { class: 'row' + (opts.full ? ' full' : '') }, h('label', {}, label), input); }
export function numInput(value, onChange, opts = {}) { const i = h('input', { type: 'number', value: num(value, opts.digits ?? 3), step: opts.step ?? 0.1, min: opts.min, max: opts.max, title: opts.title }); const fire = () => { const v = parseFloat(i.value); if (Number.isFinite(v)) onChange(v); }; i.addEventListener('change', fire); if (opts.live) i.addEventListener('input', fire); return i; }
export function textInput(value, onChange, opts = {}) { const i = h('input', { type: 'text', value: value ?? '', placeholder: opts.placeholder }); i.addEventListener('change', () => onChange(i.value)); if (opts.live) i.addEventListener('input', () => onChange(i.value)); return i; }
export function select(options, value, onChange) { const s = h('select', {}, options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); })); s.addEventListener('change', () => onChange(s.value)); return s; }
export function checkbox(value, onChange, label) { const c = h('input', { type: 'checkbox', checked: !!value }); c.addEventListener('change', () => onChange(c.checked)); return label ? h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, c, label) : c; }

// ---------- context menu ----------
let _ctx = null;
export function closeContextMenu() { if (_ctx) { _ctx.remove(); _ctx = null; document.removeEventListener('pointerdown', _ctxAway, true); document.removeEventListener('keydown', _ctxKey, true); window.removeEventListener('blur', closeContextMenu); } }
function _ctxAway(e) { if (_ctx && !_ctx.contains(e.target)) closeContextMenu(); }
function _ctxKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeContextMenu(); } }
// items: [{label, key, run, disabled, danger, submenu:[...]}, {header:'…'}, '-']
export function contextMenu(x, y, items) {
  closeContextMenu();
  const build = (list, el) => {
    for (const it of list) {
      if (!it) continue;
      if (it === '-') { if (el.lastChild && !el.lastChild.classList?.contains('sep')) el.append(h('div', { class: 'sep' })); continue; }
      if (it.header) { el.append(h('div', { class: 'hdr' }, it.header)); continue; }
      const row = h('div', { class: 'it' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '') + (it.submenu ? ' sub' : '') },
        h('span', { class: 'lb' }, it.label), h('span', { class: 'k' }, it.submenu ? '▸' : (it.key || '')));
      if (it.submenu && it.submenu.length) { const sm = h('div', { class: 'ctxmenu submenu' }); build(it.submenu, sm); row.append(sm); }
      else if (!it.disabled && it.run) row.addEventListener('click', (e) => { e.stopPropagation(); closeContextMenu(); it.run(); });
      el.append(row);
    }
    while (el.lastChild && el.lastChild.classList?.contains('sep')) el.lastChild.remove();
  };
  const menu = h('div', { class: 'ctxmenu' });
  build(items, menu);
  if (!menu.children.length) return null;
  menu.style.visibility = 'hidden'; document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 6)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
  menu.style.visibility = '';
  _ctx = menu;
  setTimeout(() => { document.addEventListener('pointerdown', _ctxAway, true); document.addEventListener('keydown', _ctxKey, true); window.addEventListener('blur', closeContextMenu); }, 0);
  return menu;
}
