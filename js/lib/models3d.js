// LAMINA 3D primitive library — turns `body3d` prims (docs/LIBRARY.md) into three.js meshes.
//
// Everything is built in the PART-LOCAL frame: X right, Y up (top view), Z up out of the board
// surface, millimetres. `z` on a prim is the BOTTOM of its bounding box unless stated otherwise.
//
// Geometries and materials are cached and SHARED between meshes (keyed by their parameters) so a
// 100-part board stays cheap. Shared resources carry `userData.shared = true`; scene teardown
// (View3D.rebuild) must not dispose those.
import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';

const D2R = Math.PI / 180;
const HALF_PI = Math.PI / 2;
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------- materials
// Tuned MeshStandardMaterial presets — no exotic passes, so STL/OBJ/GLB stay happy.
export const MATERIAL_PRESETS = {
  plastic: { roughness: 0.55, metalness: 0.03 },
  ceramic: { roughness: 0.38, metalness: 0.0 },
  rubber: { roughness: 0.95, metalness: 0.0 },
  pcb: { roughness: 0.58, metalness: 0.1 },
  metal: { roughness: 0.42, metalness: 0.82 },
  gold: { roughness: 0.3, metalness: 0.92 },
  chrome: { roughness: 0.26, metalness: 0.9 },
  solder: { roughness: 0.45, metalness: 0.72 },
  glass: { roughness: 0.06, metalness: 0.0, opacity: 0.42 },
  led: { roughness: 0.16, metalness: 0.0, opacity: 0.93, emissiveIntensity: 0.85 },
};
export const MATERIAL_NAMES = Object.keys(MATERIAL_PRESETS);

// Legacy body3d prims only carry a colour — infer a sensible material from the palette.
const COLOR_MATERIAL = {
  '#c9a227': 'gold', '#b5a642': 'gold',
  '#b8b8b8': 'metal', '#9a9a9a': 'metal', '#aeb4ba': 'metal', '#b9bfc6': 'metal',
  '#c8ccd0': 'solder',
  '#0f6b3a': 'pcb', '#123a7a': 'pcb', '#1c1c1c': 'pcb',
  '#dfe': 'glass',
};
export function materialFor(color, explicit) {
  if (explicit && MATERIAL_PRESETS[explicit]) return explicit;
  return COLOR_MATERIAL[String(color || '').toLowerCase()] || 'plastic';
}

const matCache = new Map();
export function mat3d(spec = {}) {
  const color = spec.color || '#333';
  const name = materialFor(color, spec.material);
  const key = `${name}|${color}|${spec.emissive || ''}|${spec.emissiveIntensity ?? ''}|${spec.opacity ?? ''}`;
  let m = matCache.get(key);
  if (m) return m;
  const p = MATERIAL_PRESETS[name];
  const o = { color: new THREE.Color(color), roughness: p.roughness, metalness: p.metalness };
  const op = spec.opacity ?? p.opacity;
  if (op != null && op < 1) { o.opacity = op; o.transparent = true; o.depthWrite = op > 0.6; }
  const em = spec.emissive || (name === 'led' ? color : null);
  if (em) { o.emissive = new THREE.Color(em); o.emissiveIntensity = spec.emissiveIntensity ?? p.emissiveIntensity ?? 0.7; }
  m = new THREE.MeshStandardMaterial(o);
  m.name = name; m.userData.shared = true;
  matCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------- geometry cache
const geoCache = new Map();
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); g.userData.shared = true; geoCache.set(key, g); }
  return g;
}
export function models3dStats() { return { geometries: geoCache.size, materials: matCache.size, parts: partCache.size }; }
export function clearModelCaches() { geoCache.clear(); matCache.clear(); partCache.clear(); }

// radial segments: small things get few, big things get more (keeps a 100-part board cheap)
export function segFor(d, hint) {
  if (hint) return Math.max(3, Math.min(64, Math.round(hint)));
  const a = Math.abs(num(d, 1));
  return a < 1.2 ? 8 : a < 3 ? 12 : a < 8 ? 18 : a < 20 ? 24 : 32;
}

// ---------------------------------------------------------------- shape helpers
function roundedRectShape(w, d, r) {
  const s = new THREE.Shape();
  r = Math.max(0, Math.min(r, w / 2 - 1e-3, d / 2 - 1e-3));
  const x = -w / 2, y = -d / 2;
  if (!(r > 1e-3)) { s.moveTo(x, y); s.lineTo(x + w, y); s.lineTo(x + w, y + d); s.lineTo(x, y + d); s.closePath(); return s; }
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -HALF_PI, 0, false);
  s.lineTo(x + w, y + d - r); s.absarc(x + w - r, y + d - r, r, 0, HALF_PI, false);
  s.lineTo(x + r, y + d); s.absarc(x + r, y + d - r, r, HALF_PI, Math.PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function polyShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}
function circlePath(r) {
  const p = new THREE.Path();
  p.absarc(0, 0, r, 0, Math.PI * 2, true);
  return p;
}
function circleShape(r, seg, theta = 0) {
  const pts = [];
  for (let i = 0; i < seg; i++) { const a = theta + i * Math.PI * 2 / seg; pts.push([r * Math.sin(a), -r * Math.cos(a)]); }
  return polyShape(pts);
}
function ngonPts(r, n, theta = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = theta + i * Math.PI * 2 / n; pts.push([r * Math.sin(a), -r * Math.cos(a)]); }
  return pts;
}
// Extrude a shape along +Z, then centre it on Z (all prim geometries are centred, so per-prim
// `rot` rotates about the prim's own centre).
function extrudeCentred(shape, h, curveSeg = 8, bevel = 0) {
  let g;
  const bt = bevel > 0 ? Math.min(bevel, h / 3) : 0;
  if (bt > 1e-4) {
    g = new THREE.ExtrudeGeometry(shape, { depth: h - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 1, curveSegments: curveSeg });
    g.translate(0, 0, bt - h / 2);
  } else {
    g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: curveSeg });
    g.translate(0, 0, -h / 2);
  }
  g.computeVertexNormals();
  return g;
}
// Closed hemisphere (dome or bowl) built as a lathe so it has a flat cap — STL-friendly.
function domeGeometry(r, seg, cut) {
  const n = Math.max(4, Math.round(seg / 3));
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r, 0)];
  for (let i = 1; i <= n; i++) { const a = (i / n) * HALF_PI; pts.push(new THREE.Vector2(r * Math.cos(a), r * Math.sin(a))); }
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(HALF_PI);            // lathe axis Y → world Z (flat cap at z=0, dome up to z=r)
  if (cut === 'top') g.rotateX(Math.PI);   // bowl: flat cap on top, dome down to z=-r
  g.computeVertexNormals();
  return g;
}
function zCylinder(dTop, dBottom, h, seg, theta = 0) {
  const g = new THREE.CylinderGeometry(Math.max(1e-4, dTop / 2), Math.max(1e-4, dBottom / 2), h, seg, 1, false, theta);
  g.rotateX(HALF_PI);            // three's +Y axis → world +Z
  return g;
}

// ---------------------------------------------------------------- prim → mesh
const AXIS_EULER = {
  z: null,
  y: new THREE.Euler(-HALF_PI, 0, 0, 'XYZ'),   // local +Z → world +Y
  x: new THREE.Euler(0, HALF_PI, 0, 'XYZ'),    // local +Z → world +X
};
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

function orient(mesh, prim, axis) {
  const ae = AXIS_EULER[axis] || null;
  const rot = prim.rot;
  if (!ae && !rot) return;
  _q.identity();
  if (ae) _q.setFromEuler(ae);
  if (Array.isArray(rot) && rot.length) {
    _e.set(num(rot[0]) * D2R, num(rot[1]) * D2R, num(rot[2]) * D2R, 'XYZ');
    _q2.setFromEuler(_e);
    _q.premultiply(_q2);
  }
  mesh.quaternion.copy(_q);
}

/**
 * Build one body3d primitive. Returns a THREE.Mesh or null for a degenerate prim.
 * See docs/LIBRARY.md for the vocabulary.
 */
export function primMesh(b) {
  if (!b || typeof b !== 'object' || !b.t) return null;
  const x = num(b.x), y = num(b.y), z = num(b.z);
  let g = null, pz = z, axis = b.axis || 'z';
  const ok = (...v) => v.every(n => Number.isFinite(n) && n > 1e-4);

  switch (b.t) {
    case 'box': {
      const w = num(b.w), d = num(b.d), h = num(b.h);
      if (!ok(w, d, h)) return null;
      if (num(b.r) > 1e-3) return primMesh({ ...b, t: 'rbox' });
      g = geo(`box|${r3(w)}|${r3(d)}|${r3(h)}`, () => new THREE.BoxGeometry(w, d, h));
      pz = z + h / 2; axis = 'z';
      break;
    }
    case 'rbox': {
      const w = num(b.w), d = num(b.d), h = num(b.h);
      if (!ok(w, d, h)) return null;
      const r = Math.min(num(b.r, Math.min(0.35, w / 6, d / 6)), w / 2 - 1e-3, d / 2 - 1e-3);
      const bev = Math.max(0, Math.min(num(b.bevel), h / 3, w / 4, d / 4));
      // bevelSize grows the outline outward, so shrink the base shape to keep w/d/h exact
      g = geo(`rbox|${r3(w)}|${r3(d)}|${r3(h)}|${r3(r)}|${r3(bev)}`, () => extrudeCentred(roundedRectShape(w - 2 * bev, d - 2 * bev, Math.max(0, r - bev)), h, 4, bev));
      pz = z + h / 2; axis = 'z';
      break;
    }
    case 'cyl': {
      const d1 = num(b.d), d2 = num(b.d2, d1), h = num(b.h);
      if (!ok(Math.max(d1, d2), h)) return null;
      const hexish = !!b.hex;
      const seg = hexish ? 6 : segFor(Math.max(d1, d2), b.seg);
      const theta = hexish ? Math.PI / 6 : 0;
      const bore = num(b.bore);
      if (bore > 1e-3 && bore < Math.min(d1, d2)) {
        g = geo(`cylb|${r3(d1)}|${r3(h)}|${r3(bore)}|${seg}|${r3(theta)}`, () => {
          const s = circleShape(d1 / 2, seg, theta); s.holes.push(circlePath(bore / 2));
          return extrudeCentred(s, h, Math.max(8, seg));
        });
      } else {
        g = geo(`cyl|${r3(d1)}|${r3(d2)}|${r3(h)}|${seg}|${r3(theta)}`, () => zCylinder(d2, d1, h, seg, theta));
      }
      pz = axis === 'z' ? z + h / 2 : z;   // axis x/y: z is the centre line height (legacy)
      break;
    }
    case 'hex': {
      const af = num(b.af, num(b.w)), h = num(b.h);
      if (!ok(af, h)) return null;
      const r = af / 2 / Math.cos(Math.PI / 6);
      const bore = num(b.bore);
      if (bore > 1e-3 && bore < af) {
        g = geo(`hexb|${r3(af)}|${r3(h)}|${r3(bore)}`, () => {
          const s = polyShape(ngonPts(r, 6, Math.PI / 6)); s.holes.push(circlePath(bore / 2));
          return extrudeCentred(s, h, 16);
        });
      } else {
        g = geo(`hex|${r3(af)}|${r3(h)}`, () => zCylinder(af / Math.cos(Math.PI / 6), af / Math.cos(Math.PI / 6), h, 6, Math.PI / 6));
      }
      pz = axis === 'z' ? z + h / 2 : z;
      break;
    }
    case 'sphere': {
      const d = num(b.d);
      if (!ok(d)) return null;
      const r = d / 2, cut = b.cut === 'top' || b.cut === 'bottom' ? b.cut : null;
      const seg = Math.max(8, Math.min(32, segFor(d, b.seg)));
      if (!cut) { g = geo(`sph|${r3(d)}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1))); pz = z + r; }
      else { g = geo(`dome|${r3(d)}|${seg}|${cut}`, () => domeGeometry(r, seg, cut)); pz = cut === 'top' ? z + r : z; }
      break;
    }
    case 'torus': {
      const d = num(b.d), th = num(b.thickness, 0.4);
      if (!ok(d, th)) return null;
      const tseg = Math.max(10, Math.min(36, segFor(d, b.seg)));
      g = geo(`tor|${r3(d)}|${r3(th)}|${tseg}`, () => new THREE.TorusGeometry(Math.max(1e-3, (d - th) / 2), th / 2, 6, tseg));
      pz = z;                                    // z = the ring's centre plane
      break;
    }
    case 'prism': {
      const pts = Array.isArray(b.pts) ? b.pts.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) : null;
      const h = num(b.h);
      if (!pts || pts.length < 3 || !ok(h)) return null;
      const key = `pri|${r3(h)}|${r3(num(b.bevel))}|${pts.map(p => r3(p[0]) + ',' + r3(p[1])).join(';')}`;
      g = geo(key, () => extrudeCentred(polyShape(pts), h, 1, num(b.bevel)));
      pz = z + h / 2;
      break;
    }
    case 'pin': {
      const square = b.shape === 'square' || (b.w != null && b.d != null && b.shape !== 'round');
      const len = num(b.len, 2.0);                       // above the board surface
      const below = num(b.below, num(b.h, 2.2));         // below it (through the board)
      const total = len + below;
      if (!(total > 1e-3)) return null;
      if (square) {
        const w = num(b.w, num(b.d, 0.64)), dd = num(b.d2, num(b.d, w));
        if (!ok(w, dd)) return null;
        g = geo(`pinq|${r3(w)}|${r3(dd)}|${r3(total)}`, () => new THREE.BoxGeometry(w, dd, total));
      } else {
        const d = num(b.d, num(b.w, 0.6));
        if (!ok(d)) return null;
        g = geo(`pinr|${r3(d)}|${r3(total)}`, () => zCylinder(d, d, total, 8));
      }
      pz = z + (len - below) / 2;
      axis = 'z';
      break;
    }
    default: return null;
  }
  if (!g) return null;
  const mesh = new THREE.Mesh(g, mat3d(b));
  mesh.position.set(x, y, pz);
  orient(mesh, b, axis);
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- grouping / merging
export function triangleCount(obj) {
  let n = 0;
  obj.traverse(o => { if (o.isMesh && o.geometry) { const g = o.geometry; n += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3; } });
  return Math.round(n);
}

// Collapse a pile of small meshes into ONE multi-material mesh (one object, one group per
// material). js/export/three.js walks geometry.groups + material arrays, so OBJ still gets
// per-material faces; STL/GLB do not care.
export function mergeMeshes(meshes, name = 'body') {
  if (meshes.length < 2) return meshes;
  const byMat = new Map();
  for (const m of meshes) {
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    m.updateMatrix();
    g.applyMatrix4(m.matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) { const n = g.attributes.position.count; g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); }
    let e = byMat.get(m.material);
    if (!e) { e = []; byMat.set(m.material, e); }
    e.push(g);
  }
  const mats = [], geos = [];
  for (const [mat, list] of byMat) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) return meshes;                       // bail out: keep the un-merged meshes
    if (list.length > 1) for (const g of list) g.dispose();
    mats.push(mat); geos.push(merged);
  }
  const all = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
  if (!all) return meshes;
  if (geos.length > 1) for (const g of geos) g.dispose();
  const mesh = new THREE.Mesh(all, mats.length === 1 ? mats[0] : mats);
  mesh.name = name; mesh.castShadow = true;
  return [mesh];
}

// ---------------------------------------------------------------- per-footprint cache
const partCache = new Map();
export function cachedBody(key, build) {
  if (!key) return build();
  let g = partCache.get(key);
  if (!g) { g = build(); g.traverse(o => { if (o.geometry) o.geometry.userData.shared = true; }); partCache.set(key, g); }
  return g.clone();                                    // Object3D.clone() shares geometry + material
}
export { THREE };
