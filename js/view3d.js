// LAMINA 3D view — builds a three.js scene from the document (boards with realistic textures, parts, standoffs).
import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { resolveBoard, D2R } from './geom.js';
import { renderRealistic, applyView } from './render.js';
import { boardSize, SILK_COLORS } from './model.js';
import { getFootprint } from './library.js';
import { primMesh, mergeMeshes, cachedBody, triangleCount, models3dStats } from './lib/models3d.js';

const FR4_SIDE = 0xb8a373;
export const TEX_PX_PER_MM = 12;

function shapeFromResolved(R) {
  const shape = new THREE.Shape(R.outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const addHolePath = (pts) => { const p = new THREE.Path(pts.map(([x, y]) => new THREE.Vector2(x, y))); shape.holes.push(p); };
  for (const c of R.cutouts) addHolePath(c);
  for (const d of R.drills) {
    if (d.slotLen > d.d) { const h = (d.slotLen - d.d) / 2, r = d.d / 2, rot = (d.rot || 0) * D2R; const p = new THREE.Path(); const T = (lx, ly) => [d.x + lx * Math.cos(rot) - ly * Math.sin(rot), d.y + lx * Math.sin(rot) + ly * Math.cos(rot)]; const pts = []; for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + Math.PI * i / 12; pts.push(T(h + r * Math.cos(a), r * Math.sin(a))); } for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 + Math.PI * i / 12; pts.push(T(-h + r * Math.cos(a), r * Math.sin(a))); } p.setFromPoints(pts.map(([x, y]) => new THREE.Vector2(x, y))); shape.holes.push(p); }
    else { const p = new THREE.Path(); p.absarc(d.x, d.y, d.d / 2, 0, Math.PI * 2, true); shape.holes.push(p); }
  }
  return shape;
}
function flipWinding(geom) { const idx = geom.index; if (idx) { const a = idx.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } idx.needsUpdate = true; } else { const pos = geom.attributes.position.array; for (let i = 0; i < pos.length; i += 9) { for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; } } } geom.computeVertexNormals(); return geom; }

// Render a board side to a canvas texture (browser only)
export function boardTexture(R, board, side, imageProvider) {
  const [W, H] = R.size; const px = TEX_PX_PER_MM;
  const c = document.createElement('canvas'); c.width = Math.max(4, Math.round(W * px)); c.height = Math.max(4, Math.round(H * px));
  const ctx = c.getContext('2d');
  const view = { scale: px, ox: 0, oy: c.height, flip: false, W };
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  applyView(ctx, view);
  renderRealistic(ctx, R, board, { side, imageProvider, background: '#000', minLine: 1 / px });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.repeat.set(1 / W, 1 / H); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---------------------------------------------------------------- part bodies
const LEAD = '#b9bfc6', SOLDER = '#c8ccd0', FALLBACK_BODY = '#2c3035';

function courtyardBox(fp) {
  const c = fp && fp.courtyard; if (!c) return null;
  if (c.pts && c.pts.length) {
    const xs = c.pts.map(p => p[0]), ys = c.pts.map(p => p[1]);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (!(c.w > 0) || !(c.h > 0)) return null;
  return { x: c.x || 0, y: c.y || 0, w: c.w, h: c.h };
}
// XY spots already covered by a hand-modelled pin/lead, so we do not double up on them
function pinnedXY(prims) {
  const out = [];
  for (const b of prims || []) {
    if (!b || !b.t) continue;
    if (b.t === 'pin') { out.push([b.x || 0, b.y || 0, 1.4]); continue; }
    if ((b.axis || 'z') !== 'z') continue;
    const w = b.t === 'cyl' || b.t === 'hex' ? (b.d ?? b.af ?? 0) : Math.max(b.w || 0, b.d || 0);
    if ((b.t === 'box' || b.t === 'rbox' || b.t === 'cyl') && w > 0 && w <= 2.4 && (b.h || 0) >= 1.2) out.push([b.x || 0, b.y || 0, Math.max(0.8, w * 0.8)]);
  }
  return out;
}
// Every footprint gets leads for its through-hole pads and a solder sliver under its SMD pads,
// so even a part with no hand-authored body3d reads as a component. `fp.autoLeads = false` opts out.
export function autoLeadPrims(part, prims) {
  const fp = part && part.fp; const out = [];
  if (!fp || fp.autoLeads === false || !Array.isArray(fp.pads)) return out;
  const pins = pinnedXY(prims);
  const covered = (x, y) => pins.some(p => Math.abs(p[0] - x) <= p[2] && Math.abs(p[1] - y) <= p[2]);
  for (const p of fp.pads) {
    const x = p.x || 0, y = p.y || 0, drill = p.drill || 0, rot = p.rot ? [0, 0, p.rot] : null;
    if (drill > 0) {
      if (drill > 3.0 || covered(x, y)) continue;                       // shell posts / already modelled
      if ((p.slotLen || 0) > drill + 0.4) {                             // mounting-lug slot → flat solder tab
        out.push({ t: 'box', x, y, z: 0, w: Math.max(0.6, (p.w || 1.2) - 0.4), d: Math.max(0.6, (p.h || 1.2) - 0.4), h: 0.3, color: SOLDER, material: 'solder', rot });
        continue;
      }
      out.push({ t: 'pin', x, y, d: Math.max(0.32, Math.min(1.0, drill * 0.78)), len: 1.0, below: 1.9, color: LEAD, material: 'metal' });
    } else if ((p.layer || 'F') !== 'B') {
      out.push({ t: 'box', x, y, z: 0.02, w: Math.max(0.18, (p.w || 0.6) - 0.06), d: Math.max(0.18, (p.h || 0.6) - 0.06), h: 0.08, color: SOLDER, material: 'solder', rot });
    }
  }
  return out;
}
// Rounded, slightly inset dark body for parts with no body3d at all.
function fallbackPrims(part) {
  const fp = part.fp;
  if (fp && fp.height === 0) return [];              // mounting holes / pad-only footprints have no body
  const h = Math.max(0.8, part.height || (fp && fp.height) || 2);
  let cb = courtyardBox(fp), fromBBox = false;
  if (!cb && part.bbox) {
    cb = { x: (part.bbox[0] + part.bbox[2]) / 2 - part.x, y: (part.bbox[1] + part.bbox[3]) / 2 - part.y, w: part.bbox[2] - part.bbox[0], h: part.bbox[3] - part.bbox[1] };
    fromBBox = true;
  }
  if (!cb || !(cb.w > 0.2) || !(cb.h > 0.2)) return [];
  let x = cb.x, y = cb.y;
  if (fromBBox) {                                    // bbox is board-frame; the part group is already rotated
    const a = -(part.rot || 0) * D2R, c = Math.cos(a), s = Math.sin(a);
    const nx = x * c - y * s; y = x * s + y * c; x = part.side === 'bottom' ? -nx : nx;
  }
  const w = Math.max(0.8, cb.w - 0.7), d = Math.max(0.8, cb.h - 0.7);
  return [{ t: 'rbox', x, y, z: 0.04, w, d, h, r: Math.min(0.7, w / 5, d / 5), bevel: Math.min(0.25, h / 6, w / 8, d / 8), color: FALLBACK_BODY, material: 'plastic' }];
}
// Build the 3D body of one resolved part (part-local frame: origin at the part, z = board surface).
export function partBodyGroup(part, opts = {}) {
  const fp = part.fp || null;
  const prims = (part.body3d && part.body3d.length ? part.body3d : (fp && fp.body3d) || []);
  const usesBBox = !prims.length && !courtyardBox(fp);          // instance-dependent → not cacheable
  const key = fp && fp.id && !usesBBox && opts.cache !== false
    ? `${fp.id}|${prims.length}|${(fp.pads || []).length}|${part.height ?? fp.height ?? 0}` : null;
  const build = () => {
    const g = new THREE.Group();
    const meshes = [];
    const all = prims.length ? prims : fallbackPrims(part);   // no hand-authored body3d → courtyard body
    for (const b of all) { const m = primMesh(b); if (m) meshes.push(m); }
    for (const b of autoLeadPrims(part, all)) { const m = primMesh(b); if (m) meshes.push(m); }
    for (const m of (meshes.length >= 4 ? mergeMeshes(meshes, 'body') : meshes)) g.add(m);
    return g;
  };
  return key ? cachedBody(key, build) : build();
}

// Build a group for one board (local frame: board origin at 0,0, bottom surface at z=0)
export function buildBoardGroup(board, doc, opts = {}) {
  const R = opts.resolved || resolveBoard(board, doc, { textAsStrokes: true, imagesAsPolys: false });
  const t = board.thickness; const [W, H] = R.size;
  const g = new THREE.Group(); g.name = 'board:' + board.name;
  const shape = shapeFromResolved(R);
  const sideMat = new THREE.MeshStandardMaterial({ color: FR4_SIDE, roughness: 0.8 });
  const invisible = new THREE.MeshBasicMaterial({ visible: false });
  const ext = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 12 });
  const sides = new THREE.Mesh(ext, [invisible, sideMat]); sides.name = 'sides'; g.add(sides);
  const capGeoTop = new THREE.ShapeGeometry(shape, 12); capGeoTop.translate(0, 0, t);
  const capGeoBot = flipWinding(new THREE.ShapeGeometry(shape, 12));
  let topMat, botMat;
  if (opts.textures !== false && typeof document !== 'undefined') {
    const ip = opts.imageProviderFor ? opts.imageProviderFor(SILK_COLORS[board.silkColor] || '#f4f4f4') : opts.imageProvider;
    topMat = new THREE.MeshStandardMaterial({ map: boardTexture(R, board, 'top', ip), roughness: 0.6, metalness: 0.1 });
    botMat = new THREE.MeshStandardMaterial({ map: boardTexture(R, board, 'bottom', ip), roughness: 0.6, metalness: 0.1 });
  } else { topMat = botMat = new THREE.MeshStandardMaterial({ color: 0x0d5c2e, roughness: 0.6 }); }
  const top = new THREE.Mesh(capGeoTop, topMat); top.name = 'top'; g.add(top);
  const bot = new THREE.Mesh(capGeoBot, botMat); bot.name = 'bottom'; g.add(bot);
  // parts
  if (opts.parts !== false) for (const p of R.parts) {
    const pg = partBodyGroup(p); pg.name = 'part:' + p.ref;
    pg.position.set(p.x, p.y, p.side === 'bottom' ? 0 : t);
    if (p.side === 'bottom') pg.rotation.set(0, Math.PI, -(p.rot || 0) * D2R, 'XYZ'); else pg.rotation.z = (p.rot || 0) * D2R;
    g.add(pg);
  }
  g.userData = { W, H, t, R };
  return g;
}
export function buildScene(doc, opts = {}) {
  const root = new THREE.Group(); root.name = 'lamina';
  const st = doc.stack; const gap = st.enabled ? st.gap * (opts.explode ?? 1) : 0;
  let z = 0;
  doc.boards.forEach((b, i) => {
    if (opts.showBoard && opts.showBoard[i] === false) { z += b.thickness + gap; return; }
    const g = buildBoardGroup(b, doc, { ...opts, resolved: opts.resolvedFor ? opts.resolvedFor(b) : undefined });
    g.position.set(b.offset?.x || 0, b.offset?.y || 0, z);
    root.add(g);
    if (i === 0 && st.enabled && doc.boards.length > 1) {
      // standoffs: brass hex spacer with a bore, plus the screws at both ends
      const upper = doc.boards[1];
      for (const l of st.links || []) {
        if (l.kind !== 'standoff' && l.kind !== 'screw') continue;
        const fp = getFootprint(l.lib) || {}; const af = fp.hexAF || 5.5; const bore = Math.min(fp.holeD || 3.2, af - 1.4);
        const x = l.x + (b.offset?.x || 0), y = l.y + (b.offset?.y || 0), z0 = z + b.thickness;
        const so = primMesh({ t: 'hex', x, y, z: z0, af, h: Math.max(0.2, gap), bore, color: '#b5a642', material: 'gold' });
        if (so) { so.name = 'standoff'; root.add(so); }
        const headD = Math.min(af * 0.95, bore + 2.6);
        const s1 = primMesh({ t: 'cyl', x, y, z: z0 - b.thickness - 1.3, d: headD, h: 1.3, seg: 14, color: '#c8ccd0', material: 'chrome' });
        if (s1) { s1.name = 'screw'; root.add(s1); }
        const s2 = primMesh({ t: 'cyl', x, y, z: z0 + gap + (upper ? upper.thickness : 1.6), d: headD, h: 1.3, seg: 14, color: '#c8ccd0', material: 'chrome' });
        if (s2) { s2.name = 'screw'; root.add(s2); }
      }
    }
    z += b.thickness + gap;
  });
  return root;
}
export { triangleCount, models3dStats };

export class View3D {
  constructor(canvas, store, hooks = {}) {
    this.canvas = canvas; this.store = store; this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1); this.renderer.setClearColor(0x0e0f12);
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000); this.camera.up.set(0, 0, 1); this.camera.position.set(80, -120, 110);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.requestRender());
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.6); this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4); dir.position.set(60, -80, 140); this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.5); dir2.position.set(-80, 60, -100); this.scene.add(dir2);
    this.root = null; this.explode = 1; this.showParts = true; this.showBoard = [true, true]; this.dirty = true; this.active = false;
    this._loop = () => { if (!this.active) return; this.controls.update(); if (this.dirty) { this.renderer.render(this.scene, this.camera); this.dirty = false; } requestAnimationFrame(this._loop); };
  }
  start() { this.active = true; this.resize(); this.rebuild(); requestAnimationFrame(this._loop); }
  stop() { this.active = false; }
  requestRender() { this.dirty = true; }
  resize() { const r = this.canvas.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return; this.renderer.setSize(r.width, r.height, false); this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix(); this.requestRender(); }
  rebuild() {
    // NB: models3d hands out SHARED geometries/materials (userData.shared) — never dispose those.
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse(o => {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) { if (m.map && m.map.dispose) m.map.dispose(); if (!m.userData.shared && m.dispose) m.dispose(); }
      });
    }
    const doc = this.store.doc;
    this.root = buildScene(doc, { explode: this.explode, parts: this.showParts, showBoard: this.showBoard, imageProviderFor: this.hooks.imageProviderFor });
    this.scene.add(this.root);
    this.tris = triangleCount(this.root);
    if (!this._framed) { this.frame(); this._framed = true; }
    this.requestRender();
  }
  frame() { const box = new THREE.Box3().setFromObject(this.root); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3()).length(); this.controls.target.copy(c); this.camera.position.set(c.x + s * 0.5, c.y - s * 0.9, c.z + s * 0.75); this.camera.near = s / 100; this.camera.far = s * 20; this.camera.updateProjectionMatrix(); this.controls.update(); this.requestRender(); }
  viewFrom(where) { const box = new THREE.Box3().setFromObject(this.root); const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3()).length(); const d = s * 1.2; const pos = { top: [0, 0.0001, d], bottom: [0, 0.0001, -d], front: [0, -d, 0.0001], side: [d, 0, 0.0001], iso: [d * 0.5, -d * 0.8, d * 0.6] }[where] || [d, -d, d]; this.camera.position.set(c.x + pos[0], c.y + pos[1], c.z + pos[2]); this.controls.target.copy(c); this.controls.update(); this.requestRender(); }
  snapshotPNG() { this.renderer.render(this.scene, this.camera); return this.canvas.toDataURL('image/png'); }
}
export { THREE };
