// 3D exports: STL (binary), OBJ+MTL (per-mesh colours), GLB (textured, for Blender). Works from a built three.js scene group.
import * as THREE from '../../vendor/three.module.js';
import { STLExporter } from '../../vendor/STLExporter.js';
import { GLTFExporter } from '../../vendor/GLTFExporter.js';
import { buildScene } from '../view3d.js';
import { safeName, fmt } from './common.js';

export function exportSTL(root) { const ex = new STLExporter(); const res = ex.parse(root, { binary: true }); return new Uint8Array(res.buffer || res); }
export function exportOBJ(root, stem = 'lamina') {
  const v = [], vn = [], f = []; const mtl = new Map(); let vOff = 0;
  const lines = ['# LAMINA OBJ export', `mtllib ${stem}.mtl`, 'o lamina'];
  root.updateMatrixWorld(true);
  const nm = new THREE.Matrix3(); const p = new THREE.Vector3(), n = new THREE.Vector3();
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return; if (obj.material && obj.material.visible === false) return;
    const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry;
    const pos = geo.attributes.position; if (!pos) return;
    const norm = geo.attributes.normal;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    nm.getNormalMatrix(obj.matrixWorld);
    lines.push(`g ${obj.name || 'mesh'}`);
    for (const g of groups) {
      const m = mats[g.materialIndex] || mats[0]; if (!m || m.visible === false) continue;
      const col = m.color ? m.color : new THREE.Color(0x888888); const key = m.map ? 'board_' + col.getHexString() : 'c_' + col.getHexString();
      if (!mtl.has(key)) mtl.set(key, col);
      lines.push(`usemtl ${key}`);
      const end = Math.min(pos.count, g.start + g.count);
      for (let i = g.start; i < end; i += 3) {
        const idx = [];
        for (let k = 0; k < 3; k++) { p.fromBufferAttribute(pos, i + k).applyMatrix4(obj.matrixWorld); v.push(`v ${fmt(p.x, 4)} ${fmt(p.y, 4)} ${fmt(p.z, 4)}`); if (norm) { n.fromBufferAttribute(norm, i + k).applyMatrix3(nm).normalize(); vn.push(`vn ${fmt(n.x, 4)} ${fmt(n.y, 4)} ${fmt(n.z, 4)}`); } vOff++; idx.push(vOff); }
        lines.push(norm ? `f ${idx[0]}//${idx[0]} ${idx[1]}//${idx[1]} ${idx[2]}//${idx[2]}` : `f ${idx.join(' ')}`);
      }
    }
  });
  const obj = [lines[0], lines[1], lines[2], ...v, ...vn, ...lines.slice(3)].join('\n') + '\n';
  const mtlLines = ['# LAMINA materials'];
  for (const [k, c] of mtl) mtlLines.push(`newmtl ${k}`, `Kd ${fmt(c.r, 4)} ${fmt(c.g, 4)} ${fmt(c.b, 4)}`, 'Ka 0 0 0', 'Ks 0.1 0.1 0.1', 'Ns 20', 'd 1', 'illum 2', '');
  return { obj, mtl: mtlLines.join('\n') };
}
export function exportGLB(root) {
  return new Promise((res, rej) => { const ex = new GLTFExporter(); ex.parse(root, (r) => res(new Uint8Array(r)), (e) => rej(e), { binary: true, onlyVisible: true }); });
}
// Convenience: build a fresh scene from the doc and export all 3D formats → files (browser: with textures for GLB)
export async function export3D(doc, opts = {}) {
  const stem = safeName(doc.name); const files = [];
  const root = buildScene(doc, { explode: 1, parts: opts.parts !== false, imageProviderFor: opts.imageProviderFor, textures: opts.textures });
  // three's scene is Z-up (board plane XY). Blender is Z-up too; glTF is Y-up: GLTFExporter does not convert axes, so rotate a wrapper for GLB.
  files.push({ name: `3d/${stem}.stl`, data: exportSTL(root) });
  const { obj, mtl } = exportOBJ(root, stem); files.push({ name: `3d/${stem}.obj`, data: obj }, { name: `3d/${stem}.mtl`, data: mtl });
  if (opts.glb !== false && typeof document !== 'undefined') {
    const wrap = new THREE.Group(); wrap.add(root); wrap.rotation.x = -Math.PI / 2; wrap.updateMatrixWorld(true); // Z-up → glTF Y-up
    try { files.push({ name: `3d/${stem}.glb`, data: await exportGLB(wrap) }); } catch (e) { files.push({ name: `3d/README-glb-failed.txt`, data: 'GLB export failed: ' + (e && e.message) }); }
  }
  files.push({ name: '3d/README-3d.txt', data: `LAMINA 3D export\n\nUnits: millimetres. Board plane = XY, Z up (STL/OBJ). GLB is rotated to glTF's Y-up convention (Blender's glTF importer converts back to Z-up automatically).\n\n${stem}.stl  — single binary mesh (boards with holes + parts + standoffs). Good for slicers / enclosure fit checks.\n${stem}.obj + .mtl — meshes grouped per object with flat colours (Blender: File → Import → Wavefront).\n${stem}.glb  — textured (silkscreen/mask/copper baked to the board faces), best for Blender renders (File → Import → glTF 2.0).\n\nIn Blender the STL/OBJ importers default to metres — set the import scale to 0.001 or use "Scene Unit: mm".\n` });
  return files;
}
