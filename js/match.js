// Footprint matching: find library replacements for imported / unrecognised parts.
// Pure functions over footprint definitions (docs/LIBRARY.md schema).
import { allParts, getFootprint } from './library.js';

export function padStats(fp) {
  const pads = (fp && fp.pads) || [];
  const th = pads.filter(p => (p.drill || 0) > 0);
  const xs = pads.map(p => p.x), ys = pads.map(p => p.y);
  const bbox = pads.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0];
  const nn = [];
  for (let i = 0; i < pads.length; i++) { let best = Infinity; for (let j = 0; j < pads.length; j++) { if (i === j) continue; const d = Math.hypot(pads[i].x - pads[j].x, pads[i].y - pads[j].y); if (d < best) best = d; } if (best < Infinity) nn.push(best); }
  nn.sort((a, b) => a - b);
  const drills = th.map(p => +(p.drill || 0).toFixed(2)).sort((a, b) => a - b);
  return {
    n: pads.length, th: th.length, smd: pads.length - th.length,
    pitch: nn.length ? nn[Math.floor(nn.length / 2)] : 0,
    w: bbox[2] - bbox[0], h: bbox[3] - bbox[1],
    cx: (bbox[0] + bbox[2]) / 2, cy: (bbox[1] + bbox[3]) / 2,
    drill: drills.length ? drills[Math.floor(drills.length / 2)] : 0,
    padW: median(pads.map(p => p.w)), padH: median(pads.map(p => p.h)),
    holes: (fp && fp.holes || []).length,
    pads,
  };
}
function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
const near = (a, b, tol) => Math.exp(-Math.abs(a - b) / tol);

// RMS distance between two pad sets after centring, for a given rotation of b (deg) — greedy nearest matching.
function padRMS(A, B, rot) {
  if (!A.pads.length || A.pads.length !== B.pads.length) return Infinity;
  const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
  const a = A.pads.map(p => [p.x - A.cx, p.y - A.cy]);
  const b = B.pads.map(p => { const x = p.x - B.cx, y = p.y - B.cy; return [x * c - y * s, x * s + y * c]; });
  const used = new Array(b.length).fill(false);
  let sum = 0;
  for (const p of a) {
    let best = Infinity, bi = -1;
    for (let i = 0; i < b.length; i++) { if (used[i]) continue; const d = (p[0] - b[i][0]) ** 2 + (p[1] - b[i][1]) ** 2; if (d < best) { best = d; bi = i; } }
    if (bi < 0) return Infinity; used[bi] = true; sum += best;
  }
  return Math.sqrt(sum / a.length);
}

// score 0..1 plus the rotation (deg, CCW) that best aligns the candidate to the source
export function scoreMatch(src, cand) {
  const A = src.stats || padStats(src), B = cand.stats || padStats(cand);
  if (!A.n && !B.n) return { score: A.holes && B.holes ? near(A.holes, B.holes, 1) * 0.6 : 0.1, rot: 0, rms: null };
  let rot = 0, rms = Infinity;
  if (A.n === B.n && A.n <= 200) for (const r of [0, 90, 180, 270]) { const v = padRMS(A, B, r); if (v < rms) { rms = v; rot = r; } }
  let s = 0;
  // pad count dominates
  if (A.n === B.n) s += 0.34; else s += 0.34 * Math.max(0, 1 - Math.abs(A.n - B.n) / Math.max(2, A.n));
  // technology
  s += 0.08 * ((A.th > 0) === (B.th > 0) ? 1 : 0) + 0.04 * ((A.smd > 0) === (B.smd > 0) ? 1 : 0);
  // pitch + size
  if (A.pitch && B.pitch) s += 0.14 * near(A.pitch, B.pitch, 0.4);
  const swap = (A.n === B.n && (rot === 90 || rot === 270));
  const bw = swap ? B.h : B.w, bh = swap ? B.w : B.h;
  s += 0.10 * near(A.w, bw, 2) + 0.10 * near(A.h, bh, 2);
  if (A.drill || B.drill) s += 0.06 * near(A.drill, B.drill, 0.3);
  s += 0.04 * near(A.padW, B.padW, 0.6) + 0.04 * near(A.padH, B.padH, 0.6);
  // exact geometry bonus
  if (rms < Infinity) s += 0.16 * Math.exp(-rms / 0.25);
  return { score: Math.max(0, Math.min(1, s)), rot, rms: rms === Infinity ? null : rms };
}

export function suggestReplacements(fp, opts = {}) {
  const src = { stats: padStats(fp) };
  const skip = new Set([opts.exclude].filter(Boolean));
  const out = [];
  for (const cand of allParts()) {
    if (skip.has(cand.id)) continue;
    if (cand.isStackConnector) continue;
    if (opts.cat && cand.cat !== opts.cat) continue;
    if (opts.filter && !opts.filter(cand)) continue;
    const m = scoreMatch(src, cand);
    out.push({ part: cand, id: cand.id, name: cand.name, cat: cand.cat, ...m });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.limit ?? 12);
}

// A part item is "unmatched" when its footprint is inline (imported) or its lib id is not in the library.
export function isUnmatched(item) {
  if (!item || item.type !== 'part') return false;
  if (item.fp) return true;
  const lib = item.lib || '';
  if (/^(kicad|diptrace|imported):/i.test(lib)) return true;
  return !getFootprint(lib);
}
export function unmatchedParts(doc) {
  const out = [];
  doc.boards.forEach((b, bi) => { for (const it of b.items) if (isUnmatched(it)) out.push({ board: bi, item: it }); });
  return out;
}
// group unmatched parts by their footprint identity so one choice fixes them all
export function groupUnmatched(doc) {
  const groups = new Map();
  for (const u of unmatchedParts(doc)) {
    const fp = u.item.fp || getFootprint(u.item.lib) || { pads: [] };
    const key = u.item.fp ? (fp.name || u.item.lib || 'inline') + ':' + (fp.pads || []).length + ':' + (fp.pads || []).map(p => `${p.x},${p.y}`).join(';').slice(0, 120) : u.item.lib;
    if (!groups.has(key)) groups.set(key, { key, fp, name: fp.name || u.item.lib || 'unnamed', parts: [], suggestions: null });
    groups.get(key).parts.push(u);
  }
  for (const g of groups.values()) g.suggestions = suggestReplacements(g.fp, { limit: 6 });
  return Array.from(groups.values()).sort((a, b) => b.parts.length - a.parts.length);
}
