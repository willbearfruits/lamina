// LAMINA SVG importer — brings logos / graphics onto one layer as native items.
//   importSvg(text, opts) → { items, width, height, warnings }
// opts: layer (default 'F.Silk'), targetWidth (mm, rescale whole drawing), tolerance (mm, curve flattening, default 0.05),
//       useDOMParser (default true when DOMParser exists; node always uses the built-in parser).
// Supported: <path d> (M L H V C S Q T A Z, abs+rel), <rect> (rx/ry), <circle>, <ellipse>, <line>, <polyline>, <polygon>,
// <g>/<svg>/<a> nesting with transform (matrix/translate/scale/rotate/skewX/skewY, composed), style/class/presentation
// attributes for fill/stroke/stroke-width/opacity/display/visibility, root width/height/viewBox → mm scale.
// Skipped with a warning: <use>, <text>, <image>, gradients/patterns as paint (treated as plain fill), clip/mask.
// Output items: filled shapes → polygon{filled:true} (one per closed subpath — holes render filled, warned),
// stroked shapes → polygon{filled:false,width} when closed, line items per segment when open; circles/rects that
// survive a similarity transform become native circle/rect items. Y is flipped (SVG Y down → LAMINA Y up) and the
// result is translated so its bbox min = (0,0).
import { makeItem } from '../model.js';
import { itemBBox, unionBBox } from '../geom.js';

const PX_MM = 25.4 / 96;
const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: PX_MM, '': PX_MM };
const K = 0.5522847498;

// ---------- tiny XML parser (no DOM) ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(cp) ? String.fromCodePoint(cp) : m; }
    return ENT[e] ?? m;
  });
}
function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s=\/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m; while ((m = re.exec(s))) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}
export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const n = text.length; let i = 0;
  if (text.charCodeAt(0) === 0xFEFF) i = 1;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { top().text += text.slice(i); break; }
    if (lt > i) top().text += text.slice(i, lt);
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); top().text += text.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (text.startsWith('<!', lt)) { // DOCTYPE, possibly with an internal subset [...]
      let j = lt + 2, depth = 0;
      for (; j < n; j++) { const ch = text[j]; if (ch === '[') depth++; else if (ch === ']') depth--; else if (ch === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    // find the end of the tag, honouring quotes
    let j = lt + 1, q = null;
    for (; j < n; j++) { const ch = text[j]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; }
    const raw = text.slice(lt + 1, j); i = j + 1;
    if (raw[0] === '/') { const name = raw.slice(1).trim(); for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break; } continue; }
    const selfClose = /\/\s*$/.test(raw);
    const body = selfClose ? raw.replace(/\/\s*$/, '') : raw;
    const nm = /^([^\s\/>]+)/.exec(body); if (!nm) continue;
    const node = { name: nm[1], attrs: parseAttrs(body.slice(nm[1].length)), children: [], text: '' };
    top().children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}
function domToTree(el) {
  const attrs = {}; for (const a of el.attributes) attrs[a.name] = a.value;
  return { name: el.localName || el.tagName, attrs, children: Array.from(el.children).map(domToTree), text: el.children.length ? '' : (el.textContent || '') };
}
const local = name => { const i = name.indexOf(':'); return i >= 0 ? name.slice(i + 1) : name; };
function findSvg(node) { if (local(node.name) === 'svg') return node; for (const c of node.children) { const r = findSvg(c); if (r) return r; } return null; }

// ---------- matrices [a b c d e f] : x' = a x + c y + e ; y' = b x + d y + f ----------
export const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
export function parseTransform(s) {
  let m = [1, 0, 0, 1, 0, 0];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(s || ''))) {
    const a = t[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    let k;
    switch (t[1]) {
      case 'matrix': k = a.length >= 6 ? a.slice(0, 6) : null; break;
      case 'translate': k = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': k = [a[0] ?? 1, 0, 0, a.length > 1 ? a[1] : (a[0] ?? 1), 0, 0]; break;
      case 'rotate': { const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r); k = [c, sn, -sn, c, 0, 0]; if (a.length > 2) k = mul(mul([1, 0, 0, 1, a[1], a[2]], k), [1, 0, 0, 1, -a[1], -a[2]]); break; }
      case 'skewX': k = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': k = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
    }
    if (k) m = mul(m, k);
  }
  return m;
}

// ---------- lengths / styles ----------
function parseLength(v) { // → {n, unit} ; null when unusable (%, em, auto)
  if (v == null) return null;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(String(v));
  if (!m) return null;
  const unit = m[2].toLowerCase();
  if (unit === '%' || unit === 'em' || unit === 'ex') return null;
  return { n: parseFloat(m[1]), unit };
}
const lengthMm = v => { const l = parseLength(v); return l && UNIT_MM[l.unit] != null ? l.n * UNIT_MM[l.unit] : null; };
function parseDecls(s, into = {}) {
  for (const part of String(s || '').split(';')) { const i = part.indexOf(':'); if (i < 0) continue; const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).trim(); if (k) into[k] = v.replace(/\s*!important\s*$/i, ''); }
  return into;
}
function collectStyles(node, rules) { // simple selectors only: .class, #id, tag, tag.class
  if (local(node.name) === 'style' && node.text) {
    const css = node.text.replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^{}]*)\}/g; let m;
    while ((m = re.exec(css))) { const decls = parseDecls(m[2]); for (const sel of m[1].split(',')) { const s = sel.trim(); if (s) rules.push({ sel: s, decls }); } }
  }
  for (const c of node.children) collectStyles(c, rules);
}
function matchRules(node, rules) {
  const tag = local(node.name), id = node.attrs.id, classes = (node.attrs.class || '').split(/\s+/).filter(Boolean);
  const out = {};
  for (const r of rules) {
    const s = r.sel; let hit = false;
    if (s[0] === '.') hit = classes.includes(s.slice(1));
    else if (s[0] === '#') hit = id === s.slice(1);
    else if (s === tag || s === '*') hit = true;
    else { const m = /^([a-zA-Z]+)\.([\w-]+)$/.exec(s); if (m) hit = m[1] === tag && classes.includes(m[2]); }
    if (hit) Object.assign(out, r.decls);
  }
  return out;
}
const PAINT_PROPS = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'opacity', 'display', 'visibility'];
function computeStyle(node, inh, rules) {
  const st = { ...inh, opacity: 1, display: 'inline' };
  const decls = {};
  for (const p of PAINT_PROPS) if (node.attrs[p] != null) decls[p] = node.attrs[p];
  Object.assign(decls, matchRules(node, rules));
  parseDecls(node.attrs.style, decls);
  for (const [k, v] of Object.entries(decls)) {
    if (v === 'inherit') continue;
    switch (k) {
      case 'fill': st.fill = v; break;
      case 'stroke': st.stroke = v; break;
      case 'stroke-width': st.strokeWidth = v; break;
      case 'fill-opacity': st.fillOpacity = parseFloat(v); break;
      case 'stroke-opacity': st.strokeOpacity = parseFloat(v); break;
      case 'opacity': st.opacity = parseFloat(v); break;
      case 'display': st.display = v; break;
      case 'visibility': st.visibility = v; break;
    }
  }
  return st;
}
const isNone = v => { const s = String(v ?? '').trim().toLowerCase(); return s === 'none' || s === 'transparent' || s === 'rgba(0,0,0,0)'; };

// ---------- path data → subpaths of segments (local user units) ----------
// subpath: { pts: [[x,y]...] with cubic segments expanded later, segs: [ ['L',x,y] | ['C',x1,y1,x2,y2,x,y] ], start:[x,y], closed }
class Scanner {
  constructor(s) { this.s = s; this.i = 0; this.n = s.length; }
  ws() { while (this.i < this.n && /[\s,]/.test(this.s[this.i])) this.i++; }
  cmd() { this.ws(); const ch = this.s[this.i]; if (ch && /[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) { this.i++; return ch; } return null; }
  hasNumber() { this.ws(); const ch = this.s[this.i]; return ch != null && /[-+.\d]/.test(ch); }
  num() {
    this.ws();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.s.slice(this.i, this.i + 40));
    if (!m) throw new Error('bad path number at ' + this.i);
    this.i += m[0].length; return parseFloat(m[0]);
  }
  flag() { this.ws(); const ch = this.s[this.i]; if (ch === '0' || ch === '1') { this.i++; return ch === '1'; } throw new Error('bad arc flag at ' + this.i); }
}
export function parsePathData(d) {
  const subs = []; let cur = null;
  let x = 0, y = 0, sx = 0, sy = 0, cpx = null, cpy = null, qx = null, qy = null, prev = '';
  const sc = new Scanner(d || '');
  const begin = (px, py) => { cur = { start: [px, py], segs: [], closed: false }; subs.push(cur); sx = px; sy = py; };
  const seg = s => { if (!cur) begin(x, y); cur.segs.push(s); };
  let cmd;
  for (;;) {
    let c = sc.cmd();
    if (!c) { if (!sc.hasNumber()) break; c = prev === 'M' ? 'L' : prev === 'm' ? 'l' : prev; if (!c) break; if (c === 'Z' || c === 'z') throw new Error('number after Z at ' + sc.i); } // (was an infinite loop)
    cmd = c;
    const rel = c === c.toLowerCase();
    switch (c.toUpperCase()) {
      case 'M': { let px = sc.num(), py = sc.num(); if (rel) { px += x; py += y; } x = px; y = py; begin(x, y); cpx = qx = null; break; }
      case 'L': { let px = sc.num(), py = sc.num(); if (rel) { px += x; py += y; } x = px; y = py; seg(['L', x, y]); cpx = qx = null; break; }
      case 'H': { let px = sc.num(); if (rel) px += x; x = px; seg(['L', x, y]); cpx = qx = null; break; }
      case 'V': { let py = sc.num(); if (rel) py += y; y = py; seg(['L', x, y]); cpx = qx = null; break; }
      case 'C': { let x1 = sc.num(), y1 = sc.num(), x2 = sc.num(), y2 = sc.num(), px = sc.num(), py = sc.num(); if (rel) { x1 += x; y1 += y; x2 += x; y2 += y; px += x; py += y; } seg(['C', x1, y1, x2, y2, px, py]); cpx = x2; cpy = y2; x = px; y = py; qx = null; break; }
      case 'S': { let x2 = sc.num(), y2 = sc.num(), px = sc.num(), py = sc.num(); if (rel) { x2 += x; y2 += y; px += x; py += y; } const x1 = cpx != null ? 2 * x - cpx : x, y1 = cpx != null ? 2 * y - cpy : y; seg(['C', x1, y1, x2, y2, px, py]); cpx = x2; cpy = y2; x = px; y = py; qx = null; break; }
      case 'Q': { let x1 = sc.num(), y1 = sc.num(), px = sc.num(), py = sc.num(); if (rel) { x1 += x; y1 += y; px += x; py += y; } seg(['C', x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y), px + 2 / 3 * (x1 - px), py + 2 / 3 * (y1 - py), px, py]); qx = x1; qy = y1; x = px; y = py; cpx = null; break; }
      case 'T': { let px = sc.num(), py = sc.num(); if (rel) { px += x; py += y; } const x1 = qx != null ? 2 * x - qx : x, y1 = qx != null ? 2 * y - qy : y; seg(['C', x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y), px + 2 / 3 * (x1 - px), py + 2 / 3 * (y1 - py), px, py]); qx = x1; qy = y1; x = px; y = py; cpx = null; break; }
      case 'A': {
        const rx = sc.num(), ry = sc.num(), rot = sc.num(), large = sc.flag(), sweep = sc.flag(); let px = sc.num(), py = sc.num();
        if (rel) { px += x; py += y; }
        for (const s of arcToCubics(x, y, rx, ry, rot, large, sweep, px, py)) seg(s);
        x = px; y = py; cpx = qx = null; break;
      }
      case 'Z': { if (cur) { cur.closed = true; } x = sx; y = sy; cur = null; cpx = qx = null; break; }
    }
    prev = cmd;
  }
  return subs;
}
// SVG endpoint arc → cubic Béziers (spec F.6.5); returns ['C',...] segments (or a line for degenerate radii)
export function arcToCubics(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-12 || ry < 1e-12) return [['L', x2, y2]];
  const phi = phiDeg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den > 0 ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (large === sweep) coef = -coef;
  const cxp = coef * (rx * y1p / ry), cyp = coef * -(ry * x1p / rx);
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const d = ux * vx + uy * vy, l = Math.hypot(ux, uy) * Math.hypot(vx, vy); let a = Math.acos(Math.max(-1, Math.min(1, d / l))); if (ux * vy - uy * vx < 0) a = -a; return a; };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const nseg = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const out = [];
  const pt = t => [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp];
  const dpt = t => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp];
  for (let i = 0; i < nseg; i++) {
    const a = t1 + dt * i / nseg, b = t1 + dt * (i + 1) / nseg, h = b - a;
    const alpha = Math.sin(h) * (Math.sqrt(4 + 3 * Math.tan(h / 2) ** 2) - 1) / 3;
    const p0 = pt(a), p3 = pt(b), d0 = dpt(a), d3 = dpt(b);
    out.push(['C', p0[0] + alpha * d0[0], p0[1] + alpha * d0[1], p3[0] - alpha * d3[0], p3[1] - alpha * d3[1], i === nseg - 1 ? x2 : p3[0], i === nseg - 1 ? y2 : p3[1]]);
  }
  return out;
}
// transform a subpath's control points by m and flatten to points (mm), tolerance tol (mm)
function flattenSub(sub, m, tol) {
  const pts = [apply(m, sub.start[0], sub.start[1])];
  let [x, y] = pts[0];
  for (const s of sub.segs) {
    if (s[0] === 'L') { const p = apply(m, s[1], s[2]); if (Math.abs(p[0] - x) > 1e-9 || Math.abs(p[1] - y) > 1e-9) pts.push(p); [x, y] = p; }
    else {
      const p1 = apply(m, s[1], s[2]), p2 = apply(m, s[3], s[4]), p3 = apply(m, s[5], s[6]);
      const dd = Math.max(Math.hypot(x - 2 * p1[0] + p2[0], y - 2 * p1[1] + p2[1]), Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1]));
      const n = Math.max(1, Math.min(120, Math.ceil(Math.sqrt(0.75 * dd / tol))));
      for (let i = 1; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        pts.push([mt * mt * mt * x + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0], mt * mt * mt * y + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1]]);
      }
      [x, y] = p3;
    }
  }
  // drop a duplicated closing point
  if (pts.length > 2 && sub.closed) { const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pts.pop(); }
  return pts;
}
// element geometry → subpaths (local coords)
const rectSubs = (x, y, w, h, rx, ry) => {
  if (!(w > 0) || !(h > 0)) return [];
  rx = Math.min(rx || 0, w / 2); ry = Math.min(ry || 0, h / 2);
  if (rx <= 0 || ry <= 0) return [{ start: [x, y], segs: [['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h]], closed: true }];
  const kx = K * rx, ky = K * ry;
  return [{ start: [x + rx, y], closed: true, segs: [
    ['L', x + w - rx, y], ['C', x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry],
    ['L', x + w, y + h - ry], ['C', x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h],
    ['L', x + rx, y + h], ['C', x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry],
    ['L', x, y + ry], ['C', x, y + ry - ky, x + rx - kx, y, x + rx, y]] }];
};
const ellipseSubs = (cx, cy, rx, ry) => {
  if (!(rx > 0) || !(ry > 0)) return [];
  const kx = K * rx, ky = K * ry;
  return [{ start: [cx + rx, cy], closed: true, segs: [
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry], ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry], ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy]] }];
};
const pointList = s => { const a = String(s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number); const pts = []; for (let i = 0; i + 1 < a.length; i += 2) if (isFinite(a[i]) && isFinite(a[i + 1])) pts.push([a[i], a[i + 1]]); return pts; };
const isSimilarity = m => Math.abs((m[0] * m[0] + m[1] * m[1]) - (m[2] * m[2] + m[3] * m[3])) < 1e-6 * Math.max(1, m[0] * m[0] + m[1] * m[1]) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 * Math.max(1, m[0] * m[0] + m[1] * m[1]);

// ---------- main ----------
export function importSvg(text, opts = {}) {
  const warnings = [], warned = new Set();
  const warn = (key, msg) => { if (!warned.has(key)) { warned.add(key); warnings.push(msg); } };
  const layer = opts.layer || 'F.Silk';
  const tol = opts.tolerance || 0.05;
  const src = typeof text === 'string' ? text : new TextDecoder().decode(text);
  let tree = null;
  if (opts.useDOMParser !== false && typeof DOMParser !== 'undefined') {
    try { const dom = new DOMParser().parseFromString(src, 'image/svg+xml'); if (dom.documentElement && dom.documentElement.localName === 'svg') tree = { name: '#root', attrs: {}, children: [domToTree(dom.documentElement)], text: '' }; } catch { tree = null; }
  }
  if (!tree) tree = parseXml(src);
  const svg = findSvg(tree);
  if (!svg) throw new Error('importSvg: no <svg> element found');
  const rules = []; collectStyles(svg, rules);

  // root user-unit → mm
  const vb = (svg.attrs.viewBox || svg.attrs.viewbox || '').trim().split(/[\s,]+/).map(Number).filter(v => isFinite(v));
  const wmm = lengthMm(svg.attrs.width), hmm = lengthMm(svg.attrs.height);
  const wl = parseLength(svg.attrs.width), hl = parseLength(svg.attrs.height);
  let s = PX_MM, tx = 0, ty = 0;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (wmm != null && hmm != null) { const sxr = wmm / vb[2], syr = hmm / vb[3]; s = Math.min(sxr, syr); if (Math.abs(sxr - syr) > 0.01 * Math.max(sxr, syr)) warn('aspect', `viewBox aspect differs from width/height — using uniform scale ${s.toFixed(4)} mm/unit (preserveAspectRatio meet)`); }
    else if (wmm != null) s = wmm / vb[2]; else if (hmm != null) s = hmm / vb[3];
    else if (wl && wl.unit === '' && hl) s = PX_MM; // px viewport, viewBox in px-equivalent units
    tx = -vb[0] * s; ty = -vb[1] * s;
  } else if (wmm != null && wl && wl.unit && wl.unit !== 'px') {
    // no viewBox: user unit = px regardless of viewport unit (SVG spec); mention it
    warn('noviewbox', `no viewBox — 1 user unit = 1 px = ${PX_MM.toFixed(5)} mm (viewport ${svg.attrs.width} × ${svg.attrs.height})`);
  }
  const rootM = [s, 0, 0, s, tx, ty];
  const items = [];
  const baseStyle = { fill: '#000', stroke: 'none', strokeWidth: '1', fillOpacity: 1, strokeOpacity: 1, visibility: 'visible' };
  let compoundWarned = false;

  const emitShape = (subs, m, st, tag) => {
    if (!subs.length) return;
    const doFill = !isNone(st.fill) && !(st.fillOpacity <= 0);
    const doStroke = !isNone(st.stroke) && !(st.strokeOpacity <= 0);
    if (!doFill && !doStroke) return;
    let swMm = 0;
    if (doStroke) {
      const l = parseLength(st.strokeWidth) || { n: 1, unit: '' };
      const userUnits = l.unit && UNIT_MM[l.unit] != null && l.unit !== 'px' ? l.n * UNIT_MM[l.unit] / PX_MM : l.n;
      swMm = Math.abs(userUnits) * scaleOf(m);
    }
    const flat = subs.map(sub => ({ pts: flattenSub(sub, m, tol), closed: sub.closed }));
    if (doFill) {
      const rings = flat.filter(f => f.pts.length >= 3);
      if (rings.length > 1 && !compoundWarned) { compoundWarned = true; warn('holes', `compound <${tag}> paths were split into separate filled polygons — LAMINA has no holes in filled polygons, inner rings render filled (use stroke-only art or cut the holes manually)`); }
      for (const f of rings) items.push(makeItem('polygon', { layer, points: f.pts, width: 0, filled: true }));
    }
    if (doStroke && swMm > 0) {
      for (const f of flat) {
        if (f.pts.length < 2) continue;
        if (f.closed && f.pts.length >= 3) items.push(makeItem('polygon', { layer, points: f.pts, width: swMm, filled: false }));
        else for (let i = 0; i + 1 < f.pts.length; i++) items.push(makeItem('line', { layer, x1: f.pts[i][0], y1: f.pts[i][1], x2: f.pts[i + 1][0], y2: f.pts[i + 1][1], width: swMm }));
      }
    }
  };
  const num = (v, dflt = 0) => { const l = parseLength(v); return l ? l.n : dflt; };

  const walk = (node, ctm, inh) => {
    const tag = local(node.name);
    if (['defs', 'symbol', 'clipPath', 'mask', 'marker', 'pattern', 'linearGradient', 'radialGradient', 'style', 'title', 'desc', 'metadata', 'filter', 'script', 'font', 'font-face', 'foreignObject'].includes(tag)) return;
    const st = computeStyle(node, inh, rules);
    if (st.display === 'none' || st.opacity <= 0) return;
    const hidden = st.visibility === 'hidden' || st.visibility === 'collapse';
    let m = node.attrs.transform ? mul(ctm, parseTransform(node.attrs.transform)) : ctm;
    switch (tag) {
      case 'svg': {
        if (node !== svg) { // nested svg: translate by x/y (+ viewBox scale when sized)
          const x = num(node.attrs.x), y = num(node.attrs.y);
          m = mul(m, [1, 0, 0, 1, x, y]);
          const nvb = (node.attrs.viewBox || '').trim().split(/[\s,]+/).map(Number);
          const nw = num(node.attrs.width, NaN), nh = num(node.attrs.height, NaN);
          if (nvb.length === 4 && nvb[2] > 0 && nvb[3] > 0 && isFinite(nw) && isFinite(nh)) { const k = Math.min(nw / nvb[2], nh / nvb[3]); m = mul(m, [k, 0, 0, k, -nvb[0] * k, -nvb[1] * k]); }
        }
        for (const c of node.children) walk(c, m, st); return;
      }
      case 'g': case 'a': case 'switch': for (const c of node.children) walk(c, m, st); return;
      case 'use': warn('use', '<use> elements are not supported and were skipped — expand clones / symbols before importing'); return;
      case 'text': case 'tspan': warn('text', '<text> is not supported and was skipped — convert text to outlines (Path → Object to Path) before importing'); return;
      case 'image': warn('image', '<image> elements were skipped — use LAMINA image items for bitmaps'); return;
    }
    if (hidden) return;
    switch (tag) {
      case 'path': { let subs; try { subs = parsePathData(node.attrs.d); } catch (e) { warn('path:' + e.message, `unparseable <path d> skipped (${e.message})`); return; } emitShape(subs, m, st, 'path'); return; }
      case 'rect': {
        const x = num(node.attrs.x), y = num(node.attrs.y), w = num(node.attrs.width), h = num(node.attrs.height);
        let rx = node.attrs.rx != null ? num(node.attrs.rx) : null, ry = node.attrs.ry != null ? num(node.attrs.ry) : null;
        if (rx == null && ry == null) rx = ry = 0; else if (rx == null) rx = ry; else if (ry == null) ry = rx;
        if (isSimilarity(m) && Math.abs(rx - ry) < 1e-9 && w > 0 && h > 0) { // native rect item
          const k = scaleOf(m), c = apply(m, x + w / 2, y + h / 2), rot = Math.atan2(m[1], m[0]) * 180 / Math.PI;
          const doFill = !isNone(st.fill) && !(st.fillOpacity <= 0), doStroke = !isNone(st.stroke) && !(st.strokeOpacity <= 0);
          const l = parseLength(st.strokeWidth) || { n: 1, unit: '' };
          const swMm = (l.unit && UNIT_MM[l.unit] != null && l.unit !== 'px' ? l.n * UNIT_MM[l.unit] / PX_MM : l.n) * k;
          if (doFill) items.push(makeItem('rect', { layer, x: c[0], y: c[1], w: w * k, h: h * k, rot, rx: Math.min(rx, w / 2, h / 2) * k, width: 0, filled: true }));
          if (doStroke && swMm > 0) items.push(makeItem('rect', { layer, x: c[0], y: c[1], w: w * k, h: h * k, rot, rx: Math.min(rx, w / 2, h / 2) * k, width: swMm, filled: false }));
          return;
        }
        emitShape(rectSubs(x, y, w, h, rx, ry), m, st, 'rect'); return;
      }
      case 'circle': case 'ellipse': {
        const cx = num(node.attrs.cx), cy = num(node.attrs.cy);
        const rx = tag === 'circle' ? num(node.attrs.r) : num(node.attrs.rx), ry = tag === 'circle' ? rx : num(node.attrs.ry);
        if (Math.abs(rx - ry) < 1e-9 && rx > 0 && isSimilarity(m)) { // native circle item
          const k = scaleOf(m), c = apply(m, cx, cy);
          const doFill = !isNone(st.fill) && !(st.fillOpacity <= 0), doStroke = !isNone(st.stroke) && !(st.strokeOpacity <= 0);
          const l = parseLength(st.strokeWidth) || { n: 1, unit: '' };
          const swMm = (l.unit && UNIT_MM[l.unit] != null && l.unit !== 'px' ? l.n * UNIT_MM[l.unit] / PX_MM : l.n) * k;
          if (doFill) items.push(makeItem('circle', { layer, cx: c[0], cy: c[1], r: rx * k, width: 0, filled: true }));
          if (doStroke && swMm > 0) items.push(makeItem('circle', { layer, cx: c[0], cy: c[1], r: rx * k, width: swMm, filled: false }));
          return;
        }
        emitShape(ellipseSubs(cx, cy, rx, ry), m, st, tag); return;
      }
      case 'line': {
        const sub = { start: [num(node.attrs.x1), num(node.attrs.y1)], segs: [['L', num(node.attrs.x2), num(node.attrs.y2)]], closed: false };
        emitShape([sub], m, { ...st, fill: 'none' }, 'line'); return;
      }
      case 'polyline': case 'polygon': {
        const pts = pointList(node.attrs.points); if (pts.length < 2) return;
        const sub = { start: pts[0], segs: pts.slice(1).map(p => ['L', p[0], p[1]]), closed: tag === 'polygon' };
        emitShape([sub], m, st, tag); return;
      }
      default: return; // unknown / non-rendering
    }
  };
  walk(svg, rootM, baseStyle);

  // Y flip (SVG down → LAMINA up), optional rescale, translate so bbox min = (0,0)
  const flip = it => {
    switch (it.type) {
      case 'line': it.y1 = -it.y1; it.y2 = -it.y2; break;
      case 'circle': it.cy = -it.cy; break;
      case 'rect': it.y = -it.y; it.rot = -it.rot; break;
      case 'polygon': it.points = it.points.map(([x, y]) => [x, -y]); break;
    }
  };
  const scaleItem = (it, k) => {
    switch (it.type) {
      case 'line': it.x1 *= k; it.y1 *= k; it.x2 *= k; it.y2 *= k; it.width *= k; break;
      case 'circle': it.cx *= k; it.cy *= k; it.r *= k; it.width *= k; break;
      case 'rect': it.x *= k; it.y *= k; it.w *= k; it.h *= k; it.rx *= k; it.width *= k; break;
      case 'polygon': it.points = it.points.map(([x, y]) => [x * k, y * k]); it.width *= k; break;
    }
  };
  const bboxAll = () => { let bb = null; for (const it of items) bb = unionBBox(bb, itemBBox(it)); return bb || [0, 0, 0, 0]; };
  for (const it of items) flip(it);
  let bb = bboxAll();
  if (opts.targetWidth > 0 && bb[2] - bb[0] > 1e-9) { const k = opts.targetWidth / (bb[2] - bb[0]); for (const it of items) scaleItem(it, k); bb = bboxAll(); }
  const dx = -bb[0], dy = -bb[1];
  const R = v => Math.round(v * 1e4) / 1e4;
  for (const it of items) {
    switch (it.type) {
      case 'line': it.x1 = R(it.x1 + dx); it.y1 = R(it.y1 + dy); it.x2 = R(it.x2 + dx); it.y2 = R(it.y2 + dy); it.width = R(it.width); break;
      case 'circle': it.cx = R(it.cx + dx); it.cy = R(it.cy + dy); it.r = R(it.r); it.width = R(it.width); break;
      case 'rect': it.x = R(it.x + dx); it.y = R(it.y + dy); it.w = R(it.w); it.h = R(it.h); it.rx = R(it.rx); it.rot = R(it.rot); it.width = R(it.width); break;
      case 'polygon': it.points = it.points.map(([x, y]) => [R(x + dx), R(y + dy)]); it.width = R(it.width); break;
    }
  }
  bb = items.length ? bboxAll() : [0, 0, 0, 0];
  if (!items.length) warn('empty', 'no drawable geometry found in the SVG');
  return { items, width: R(bb[2] - bb[0]), height: R(bb[3] - bb[1]), warnings };
}
