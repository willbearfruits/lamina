// node test/models3d.test.mjs — 3D part models: every footprint builds a sane, finite mesh,
// the whole-scene triangle budget stays reasonable, and STL/OBJ still export from buildScene().
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { allParts, getFootprint } from '../js/library.js';
import { primMesh, mat3d, mergeMeshes, segFor, MATERIAL_PRESETS, models3dStats } from '../js/lib/models3d.js';
import { partBodyGroup, buildScene, triangleCount } from '../js/view3d.js';
import { exportSTL, exportOBJ, export3D } from '../js/export/three.js';
import { twoBoardDoc } from './fixtures.mjs';
import { newDocument, makeItem } from '../js/model.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };

// ---------------------------------------------------------------- 1. the primitive vocabulary
const VOCAB = [
  ['box', { t: 'box', w: 5, d: 3, h: 2, color: '#333' }, [5, 3, 2]],
  ['rbox', { t: 'rbox', w: 5, d: 3, h: 2, r: 0.6, color: '#333' }, [5, 3, 2]],
  ['rbox+bevel', { t: 'rbox', w: 5, d: 3, h: 2, r: 0.6, bevel: 0.3, color: '#333' }, [5, 3, 2]],
  ['cyl', { t: 'cyl', d: 6, h: 4, color: '#b8b8b8' }, [null, null, 4]],
  ['cone', { t: 'cyl', d: 6, d2: 2, h: 4, seg: 10, color: '#b8b8b8' }, [null, null, 4]],
  ['cyl axis x', { t: 'cyl', d: 6, h: 4, axis: 'x', color: '#b8b8b8' }, [4, null, null]],
  ['cyl axis y', { t: 'cyl', d: 6, h: 4, axis: 'y', color: '#b8b8b8' }, [null, 4, null]],
  ['cyl bore', { t: 'cyl', d: 6, h: 4, bore: 3, color: '#b5a642' }, [null, null, 4]],
  ['hex', { t: 'hex', af: 5.5, h: 3, color: '#b5a642' }, [null, 5.5, 3]],
  ['hex bore', { t: 'hex', af: 5.5, h: 3, bore: 3.2, color: '#b5a642' }, [null, 5.5, 3]],
  ['sphere', { t: 'sphere', d: 5, color: '#f00' }, [null, 5, null]],
  ['dome', { t: 'sphere', d: 5, cut: 'bottom', color: '#f00' }, [null, 5, 2.5]],
  ['bowl', { t: 'sphere', d: 5, cut: 'top', color: '#f00' }, [null, 5, 2.5]],
  ['torus', { t: 'torus', d: 7, thickness: 0.5, color: '#b8b8b8' }, [7, null, 0.5]],
  ['prism', { t: 'prism', pts: [[0, 0], [3, 0], [3, 2], [1, 3]], h: 2, color: '#222' }, [3, 3, 2]],
  ['pin round', { t: 'pin', d: 0.6, len: 3, below: 2, color: '#c8ccd0' }, [0.6, 0.6, 5]],
  ['pin square', { t: 'pin', shape: 'square', w: 0.64, len: 6, below: 3, color: '#c9a227' }, [0.64, 0.64, 9]],
];
const bboxOf = (obj) => { obj.updateMatrixWorld(true); return new THREE.Box3().setFromObject(obj); };
const vocabMeshes = [];
for (const [name, prim, size] of VOCAB) {
  const m = primMesh(prim);
  ok(m && m.isMesh, `prim ${name} builds a mesh`);
  const bb = bboxOf(m);
  ok(['x', 'y', 'z'].every(k => Number.isFinite(bb.min[k]) && Number.isFinite(bb.max[k])), `prim ${name} bbox finite`);
  const got = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
  size.forEach((want, i) => { if (want != null) ok(Math.abs(got[i] - want) < 0.12, `prim ${name} extent[${i}] ≈ ${want} (got ${got[i].toFixed(3)})`); });
  vocabMeshes.push(m);
}
// z = bottom of the bounding box for the z-axis prims
for (const [name, prim] of VOCAB) {
  if (prim.axis && prim.axis !== 'z') continue;
  if (prim.t === 'torus' || prim.t === 'pin') continue;
  const bb = bboxOf(primMesh({ ...prim, z: 4 }));
  ok(Math.abs(bb.min.z - 4) < 0.12, `prim ${name}: z is the bottom of the shape (${bb.min.z.toFixed(3)})`);
}
// per-prim rotation happens about the prim's own centre
{
  const a = bboxOf(primMesh({ t: 'box', w: 4, d: 4, h: 2, color: '#333' }));
  const b = bboxOf(primMesh({ t: 'box', w: 4, d: 4, h: 2, color: '#333', rot: [0, 0, 90] }));
  ok(Math.abs(a.getCenter(new THREE.Vector3()).z - b.getCenter(new THREE.Vector3()).z) < 1e-6, 'rot keeps the prim centred');
  const c = bboxOf(primMesh({ t: 'box', w: 6, d: 1, h: 1, color: '#333', rot: [0, 0, 90] }));
  ok(Math.abs((c.max.y - c.min.y) - 6) < 1e-6, 'rot [0,0,90] swaps X and Y extents');
}
// degenerate prims are dropped rather than producing NaN geometry
for (const bad of [null, {}, { t: 'box', w: 0, d: 1, h: 1 }, { t: 'cyl', d: NaN, h: 2 }, { t: 'prism', pts: [[0, 0]], h: 1 }, { t: 'nope', w: 1, d: 1, h: 1 }]) {
  eq(primMesh(bad), null, `degenerate prim rejected: ${JSON.stringify(bad)}`);
}
// materials
for (const name of Object.keys(MATERIAL_PRESETS)) {
  const m = mat3d({ color: '#888', material: name });
  ok(m.isMeshStandardMaterial, `material ${name} is a MeshStandardMaterial`);
  ok(Number.isFinite(m.roughness) && Number.isFinite(m.metalness), `material ${name} has finite roughness/metalness`);
  ok(m.userData.shared === true, `material ${name} is tagged shared (must survive scene teardown)`);
}
ok(mat3d({ color: '#888', material: 'metal' }) === mat3d({ color: '#888', material: 'metal' }), 'materials are cached/shared');
ok(mat3d({ color: '#c9a227' }).name === 'gold', 'gold colour infers the gold material');
ok(mat3d({ color: '#ff3b30', material: 'led' }).emissive.getHex() !== 0, 'led material is emissive');
ok(segFor(0.5) < segFor(30), 'segFor scales with size');
// merging keeps every triangle and produces one multi-material mesh
{
  const before = vocabMeshes.reduce((a, m) => a + triangleCount(m), 0);
  const merged = mergeMeshes(vocabMeshes.map(m => m.clone()), 'vocab');
  eq(merged.length, 1, 'mergeMeshes collapses to one mesh');
  eq(triangleCount(merged[0]), before, 'mergeMeshes preserves the triangle count');
  const mats = Array.isArray(merged[0].material) ? merged[0].material : [merged[0].material];
  eq(merged[0].geometry.groups.length || 1, mats.length, 'one geometry group per material (OBJ exporter walks these)');
}

// ---------------------------------------------------------------- 2. every part builds a sane body
const cbox = (fp) => {
  const c = fp && fp.courtyard; if (!c) return null;
  if (c.pts && c.pts.length) { const xs = c.pts.map(p => p[0]), ys = c.pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  return [(c.x || 0) - c.w / 2, (c.y || 0) - c.h / 2, (c.x || 0) + c.w / 2, (c.y || 0) + c.h / 2];
};
const parts = allParts();
ok(parts.length >= 100, `library has parts to model (${parts.length})`);
let modelled = 0, bodiless = 0, totalTris = 0;
const _v = new THREE.Vector3();
for (const fp of parts) {
  const tag = `[${fp.id}]`;
  const part = { fp, body3d: (fp.body3d || []).map(b => ({ ...b })), height: fp.height || 0, bbox: null, x: 0, y: 0, rot: 0, side: 'top', ref: 'X1', lib: fp.id };
  const g = partBodyGroup(part, { cache: false });
  ok(g && g.isObject3D, `${tag} partBodyGroup returns a group`);
  const meshes = []; g.traverse(o => { if (o.isMesh) meshes.push(o); });
  if (!meshes.length) {                                   // legitimate: mounting holes / pad-only footprints
    ok((fp.height || 0) === 0, `${tag} empty body only allowed for height:0 footprints`);
    bodiless++; continue;
  }
  modelled++;
  totalTris += triangleCount(g);
  // no NaN anywhere
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    ok(!!pos && pos.count >= 3, `${tag} mesh has a position attribute`);
    for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 64))) {
      _v.fromBufferAttribute(pos, i);
      if (!Number.isFinite(_v.x) || !Number.isFinite(_v.y) || !Number.isFinite(_v.z)) assert.fail(`${tag} NaN vertex at ${i}`);
    }
  }
  const bb = bboxOf(g);
  ok(['x', 'y', 'z'].every(k => Number.isFinite(bb.min[k]) && Number.isFinite(bb.max[k])), `${tag} bounding box is finite`);
  const size = bb.getSize(new THREE.Vector3());
  ok(size.x > 0.05 && size.y > 0.05 && size.z > 0.05, `${tag} body is not degenerate (${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)})`);
  ok(size.length() < 200, `${tag} body is not absurdly large`);
  // XY envelope: courtyard + 8 mm. Right-angle / horizontal parts point their shaft sideways,
  // so they may reach as far out as their own declared height.
  const cb = cbox(fp);
  if (cb) {
    const sideways = (fp.tags || []).some(t => /right|horizontal/.test(t));
    const allow = sideways ? Math.max(8, (fp.height || 0) + 2) : 8;
    const over = Math.max(cb[0] - bb.min.x, cb[1] - bb.min.y, bb.max.x - cb[2], bb.max.y - cb[3]);
    ok(over <= allow, `${tag} stays inside courtyard + ${allow} mm in XY (over by ${over.toFixed(2)})`);
  }
  // Z envelope: leads go DOWN through the board; the body goes up to the declared height.
  ok(bb.min.z >= -12, `${tag} nothing reaches more than 12 mm below the board (${bb.min.z.toFixed(2)})`);
  ok(bb.max.z <= (fp.height || 2) + 2.5, `${tag} body top ≤ height + 2.5 (${bb.max.z.toFixed(2)} vs ${fp.height})`);
  ok(bb.max.z > 0, `${tag} something is above the board surface`);
}
ok(modelled > 140, `most parts have a 3D body (${modelled} modelled, ${bodiless} bodiless)`);
ok(totalTris < 400000, `whole library fits the budget (${totalTris} triangles for ${modelled} parts)`);

// bottom-side and rotated instances are handled by the group transform, not the body
{
  const fp = getFootprint('dip_8');
  const a = bboxOf(partBodyGroup({ fp, body3d: fp.body3d, height: fp.height, x: 0, y: 0, rot: 0, side: 'top' }, { cache: false }));
  const b = bboxOf(partBodyGroup({ fp, body3d: fp.body3d, height: fp.height, x: 10, y: 5, rot: 90, side: 'bottom' }, { cache: false }));
  ok(Math.abs((a.max.z - a.min.z) - (b.max.z - b.min.z)) < 1e-6, 'the same footprint builds the same body regardless of placement');
}
// the cache hands out independent clones that share geometry
{
  const fp = getFootprint('hdr_1x08');
  const part = { fp, body3d: fp.body3d, height: fp.height, x: 0, y: 0, rot: 0, side: 'top' };
  const a = partBodyGroup(part), b = partBodyGroup(part);
  ok(a !== b, 'cached bodies are cloned per instance');
  ok(a.children[0].geometry === b.children[0].geometry, 'cached bodies share their geometry');
  ok(a.children[0].geometry.userData.shared === true, 'shared geometry is tagged (scene teardown must skip it)');
}
// auto-detail: a footprint with only pads and no body3d still gets leads
{
  const bare = { id: 'test_bare', name: 'bare', cat: 'ICs', ref: 'U', pads: [{ name: '1', x: -2.54, y: 0, shape: 'circle', w: 1.6, h: 1.6, drill: 0.9, layer: 'both' }, { name: '2', x: 2.54, y: 0, shape: 'circle', w: 1.6, h: 1.6, drill: 0.9, layer: 'both' }], graphics: [], courtyard: { w: 8, h: 4 }, height: 3, body3d: [] };
  const g = partBodyGroup({ fp: bare, body3d: [], height: 3, x: 0, y: 0, rot: 0, side: 'top' }, { cache: false });
  const bb = bboxOf(g);
  ok(triangleCount(g) > 0, 'bare through-hole footprint still gets a body');
  ok(bb.min.z < -0.5, 'auto leads go down through the board');
  ok(bb.max.z > 2.5, 'the courtyard fallback body reaches the declared height');
  const smd = { ...bare, id: 'test_smd', pads: [{ name: '1', x: -1, y: 0, shape: 'roundrect', w: 1, h: 0.6, drill: 0, layer: 'F' }, { name: '2', x: 1, y: 0, shape: 'roundrect', w: 1, h: 0.6, drill: 0, layer: 'F' }], body3d: [{ t: 'box', x: 0, y: 0, z: 0, w: 2, d: 1.2, h: 0.6, color: '#222' }] };
  const gs = partBodyGroup({ fp: smd, body3d: smd.body3d, height: 1, x: 0, y: 0, rot: 0, side: 'top' }, { cache: false });
  ok(bboxOf(gs).min.z >= -0.001, 'SMD parts get solder slivers, not leads through the board');
}

// ---------------------------------------------------------------- 3. a 40-part scene stays cheap
{
  const doc = newDocument({ name: 'budget', w: 120, h: 100, r: 2, color: 'green' });
  const b = doc.boards[0];
  const libs = ['pot_alpha_9mm', 'pot_alpha_16mm', 'enc_ec11', 'jack_35_pj301m', 'jack_635_pcb', 'jack_dc_55x21', 'sw_toggle_mts102', 'sw_footswitch_3pdt', 'sw_tact_6x6', 'led_5mm', 'led_3mm', 'oled_096_i2c', 'mod_pi_pico', 'mod_daisy_seed', 'mod_esp32_c3_supermini', 'usb_c_16p', 'term_2p_508', 'jst_xh_3', 'dip_8', 'soic_8', 'r_axial_10', 'cp_r_5x11', 'c_th_5', 'to92', 'hdr_1x08', 'fhdr_1x08', 'sot23', 'r_0805', 'c_0603', 'sw_slide_ss12d00'];
  for (let i = 0; i < 40; i++) b.items.push(makeItem('part', { lib: libs[i % libs.length], ref: 'X' + i, x: 8 + (i % 8) * 14, y: 8 + Math.floor(i / 8) * 18, rot: (i % 4) * 90, side: 'top' }));
  const root = buildScene(doc, { textures: false });
  const tris = triangleCount(root);
  ok(tris > 5000, `40-part scene actually has geometry (${tris} triangles)`);
  ok(tris < 400000, `40-part scene stays under 400k triangles (${tris})`);
  let objects = 0; root.traverse(o => { if (o.isMesh) objects++; });
  ok(objects < 600, `40-part scene stays under 600 meshes (${objects}) — bodies are merged per part`);
  const bb = bboxOf(root);
  ok(Number.isFinite(bb.min.x) && Number.isFinite(bb.max.z), '40-part scene bounding box is finite');
}

// ---------------------------------------------------------------- 4. STL / OBJ still export
const doc = twoBoardDoc();
const root = buildScene(doc, { textures: false });
ok(root.children.length >= 2, `two-board scene built (${root.children.length} top-level objects)`);
ok(triangleCount(root) > 1000, 'two-board scene has geometry');

const stl = exportSTL(root);
ok(stl instanceof Uint8Array && stl.byteLength > 84, `STL is non-empty (${stl.byteLength} bytes)`);
{
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = dv.getUint32(80, true);
  ok(count > 500, `STL header declares triangles (${count})`);
  eq(stl.byteLength, 84 + 50 * count, 'STL byte length matches its triangle count');
  // first facet normal + vertices must be finite
  for (let i = 0; i < 12; i++) ok(Number.isFinite(dv.getFloat32(84 + i * 4, true)), `STL facet float ${i} finite`);
}
const { obj, mtl } = exportOBJ(root, 'lamina');
ok(typeof obj === 'string' && obj.length > 1000, `OBJ is non-empty (${obj.length} chars)`);
const vLines = obj.split('\n').filter(l => l.startsWith('v '));
const fLines = obj.split('\n').filter(l => l.startsWith('f '));
const uLines = obj.split('\n').filter(l => l.startsWith('usemtl '));
ok(vLines.length > 1000, `OBJ has vertices (${vLines.length})`);
ok(fLines.length > 300, `OBJ has faces (${fLines.length})`);
ok(uLines.length > 3, `OBJ references materials (${uLines.length} usemtl, multi-material meshes exported)`);
ok(!/NaN|Infinity/.test(obj), 'OBJ has no NaN/Infinity coordinates');
for (const l of vLines.slice(0, 200)) { const p = l.split(/\s+/); eq(p.length, 4, 'OBJ v line has 3 coords'); ok(p.slice(1).every(x => Number.isFinite(parseFloat(x))), 'OBJ v coords are numbers'); }
for (const l of fLines.slice(0, 200)) { const p = l.split(/\s+/); eq(p.length, 4, 'OBJ f line is a triangle'); ok(p.slice(1).every(x => parseInt(x, 10) >= 1 && parseInt(x, 10) <= vLines.length), 'OBJ face indices in range'); }
ok(/newmtl /.test(mtl) && /Kd /.test(mtl), 'MTL has materials with diffuse colours');
for (const u of new Set(uLines.map(l => l.slice(7).trim()))) ok(mtl.includes('newmtl ' + u), `MTL defines ${u}`);

const files = await export3D(doc, { textures: false, glb: false });
ok(files.length >= 4, `export3D produced files (${files.map(f => f.name).join(', ')})`);
for (const f of files) ok((f.data.length || f.data.byteLength || 0) > 0, `export3D ${f.name} is non-empty`);
ok(files.some(f => f.name.endsWith('.stl')) && files.some(f => f.name.endsWith('.obj')) && files.some(f => f.name.endsWith('.mtl')), 'export3D emits stl + obj + mtl');

const st = models3dStats();
ok(st.geometries > 20 && st.materials > 5, `caches populated (${st.geometries} geometries, ${st.materials} materials, ${st.parts} part bodies)`);

console.log(`models3d: ${n} assertions, ${modelled} modelled parts (${bodiless} bodiless), ${totalTris} library triangles`);
console.log('ALL PASS');
