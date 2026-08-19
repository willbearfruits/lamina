// In-browser self test: ?selftest — builds a doc, exercises the store/editor/renderers/3D/exports, prints ALL PASS.
import { newDocument, makeItem, addStackStandoffs, uid, serializeDoc, parseDoc } from './model.js';
import { resolveBoard } from './geom.js';
import { runDRC } from './drc.js';
import { makeZip } from './export/common.js';

export async function runSelfTest(app) {
  const out = []; let fails = 0; const t0 = performance.now();
  const ok = (cond, msg) => { out.push((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
  const log = (m) => out.push('     ' + m);
  try {
    // 1. document + store
    const doc = newDocument({ name: 'selftest', two: true, w: 100, h: 60, r: 3, color: 'black', color2: 'red', gap: 11 });
    addStackStandoffs(doc, { inset: 4 });
    doc.stack.links.push({ id: uid('L'), kind: 'connector', lib: 'b2b_hdr_1x08', ref: 'J1', x: 50, y: 8, rot: 90, opts: {} });
    const [main, panel] = doc.boards;
    main.items.push(makeItem('part', { lib: 'dip_8', ref: 'U1', value: 'TL072', x: 30, y: 30, side: 'top' }));
    main.items.push(makeItem('part', { lib: 'r_0805', ref: 'R1', value: '10k', x: 45, y: 30, rot: 90, side: 'bottom' }));
    main.items.push(makeItem('text', { layer: 'F.Silk', x: 50, y: 52, text: 'SELFTEST', size: 2.5, thickness: 0.3, align: 'center' }));
    main.items.push(makeItem('trace', { layer: 'F.Cu', points: [[30, 40], [45, 40], [45, 33]], width: 0.4, net: 'SIG' }));
    main.items.push(makeItem('rect', { layer: 'Edge.Cuts', x: 70, y: 30, w: 8, h: 6 }));
    main.items.push(makeItem('hole', { x: 90, y: 50, d: 6 }));
    // image item with a generated PNG (2-colour) so the bitmap path is exercised
    const c = document.createElement('canvas'); c.width = 64; c.height = 32; const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 64, 32); cx.fillStyle = '#000'; cx.fillRect(4, 4, 24, 24); cx.beginPath(); cx.arc(46, 16, 10, 0, Math.PI * 2); cx.fill();
    main.items.push(makeItem('image', { layer: 'F.Silk', x: 60, y: 15, w: 20, h: 10, src: c.toDataURL('image/png'), threshold: 128 }));
    panel.items.push(makeItem('text', { layer: 'F.Silk', x: 50, y: 30, text: 'PANEL', size: 5, thickness: 0.6, align: 'center' }));
    panel.items.push(makeItem('rect', { layer: 'F.Cu', x: 80, y: 30, w: 20, h: 12, rx: 2, filled: true }));
    panel.items.push(makeItem('rect', { layer: 'F.Mask', x: 80, y: 30, w: 20, h: 12, rx: 2, filled: true }));
    app.loadDoc(doc);
    ok(app.store.doc.boards.length === 2, 'two-board doc loaded');
    // hardware parts present?
    const { allParts, getFootprint } = await import('./library.js');
    const hw = allParts().filter(p => ['Controls', 'Jacks & Power', 'Switches'].includes(p.cat));
    log(`library: ${allParts().length} parts (${hw.length} hardware)`);
    if (getFootprint('pot_alpha_9mm')) { app.store.mutate(d => { d.boards[0].items.push(makeItem('part', { lib: 'pot_alpha_9mm', ref: 'RV1', value: 'B100k', x: 20, y: 45, side: 'top', through: true })); }, 'add pot'); ok(resolveBoard(app.store.doc.boards[1], app.store.doc).drills.some(d => d.src && d.src.endsWith(':thr')), 'through-part creates a hole in the upper board'); }
    // 2. undo/redo + selection
    const n0 = app.store.board.items.length;
    app.store.addItem(makeItem('circle', { layer: 'F.Silk', cx: 10, cy: 10, r: 3, width: 0.2 }));
    ok(app.store.board.items.length === n0 + 1, 'addItem'); app.store.undo(); ok(app.store.board.items.length === n0, 'undo'); app.store.redo(); ok(app.store.board.items.length === n0 + 1, 'redo');
    const last = app.store.board.items[app.store.board.items.length - 1]; app.store.select(last.id); app.editor.rotateSelection(90); app.editor.nudge(1, 0); ok(app.store.board.items.at(-1).cx === 11, 'nudge moves selection'); app.editor.duplicateSelection(); ok(app.store.board.items.length === n0 + 2, 'duplicate'); app.store.deleteSelected(); ok(app.store.board.items.length === n0 + 1, 'delete');
    // 3. resolver / renderer
    for (const b of app.store.doc.boards) { const R = resolveBoard(b, app.store.doc, { textAsStrokes: true }); ok(R.outline.length > 4 && R.drills.length > 0, `resolve ${b.name}: ${R.drills.length} drills, ${R.pads.length} pads, ${R.parts.length} parts`); }
    app.editor.render(); ok(true, '2D render ok');
    app.editor.mode = 'layers'; app.editor.render(); app.editor.mode = 'realistic'; app.editor.setFlip(true); app.editor.render(); app.editor.setFlip(false); ok(true, 'layers mode + bottom view render ok');
    // 4. serialisation round trip
    const txt = serializeDoc(app.store.doc); const d2 = parseDoc(txt); ok(d2.boards[0].items.length === app.store.doc.boards[0].items.length, 'JSON round trip');
    // 5. DRC
    const f = runDRC(app.store.doc); ok(Array.isArray(f), `DRC ran: ${f.length} findings (${f.filter(x => x.level === 'error').length} errors)`);
    for (const x of f.filter(x => x.level === 'error').slice(0, 5)) log('  DRC error: ' + x.msg);
    // 6. exports (browser paths)
    await app.ensureImagesLoaded();
    const kinds = { fab: true, kicad: true, dxf: true, svg: true, pdf: true, png: true, threed: true, gcode: true, bom: true, project: true };
    for (const k of Object.keys(kinds)) {
      try { const files = await app.collect({ [k]: true, readme: false }, { dpi: 150 }); ok(files.length > 0, `export ${k}: ${files.length} files, ${(files.reduce((a, x) => a + (x.data.length || x.data.byteLength || 0), 0) / 1024).toFixed(0)} kB`); }
      catch (e) { ok(false, `export ${k} threw: ${e.message}`); console.error(e); }
    }
    const zip = makeZip([{ name: 'a.txt', data: 'hello' }, { name: 'd/b.bin', data: new Uint8Array([1, 2, 3]) }]); ok(zip[0] === 0x50 && zip[1] === 0x4b, 'zip writer');
    // 6b. new design features
    const { FONT_LIST, fontStrokes } = await import('./lib/fonts.js');
    ok(FONT_LIST.length >= 10, `fonts: ${FONT_LIST.length} families`);
    const fs1 = fontStrokes('gothic-eng', 'ABC', 3), fs2 = fontStrokes('sans', 'ABC', 3);
    ok(fs1.strokes.length > 0 && fs1.strokes.length !== fs2.strokes.length, 'font pack renders different faces');
    app.store.mutate(d => { d.boards[0].items.push(makeItem('text', { layer: 'F.Silk', x: 20, y: 20, text: 'ARC', size: 3, thickness: 0.3, align: 'center', font: 'script', arc: 12 })); }, 'arc text');
    ok(resolveBoard(app.store.doc.boards[0], app.store.doc, { textAsStrokes: true }).layers['F.Silk'].length > 0, 'arc text + script font resolve');
    // snapping (incl. the other board of the stack)
    const tg = app.editor.snapTargets();
    ok(tg.length > 10 && tg.some(t => t.other), `snap targets: ${tg.length} (${tg.filter(t => t.other).length} on the other board)`);
    const target0 = tg.find(t => t.kind === 'hole');
    ok(!!app.editor.nearestSnapTarget(target0.x + 0.2, target0.y - 0.1, 1), 'snaps to a hole');
    // array + mirror
    const before = app.store.board.items.length;
    app.store.select(app.store.board.items.filter(i => i.type === 'text').slice(0, 1).map(i => i.id));
    const made = app.editor.arraySelection({ mode: 'grid', cols: 3, rows: 2, dx: 6, dy: -6 });
    ok(made === 5 && app.store.board.items.length === before + 5, `array made ${made} copies`);
    app.editor.mirrorSelection('h'); ok(true, 'mirror ran');
    const made2 = app.editor.arraySelection({ mode: 'radial', count: 6, cx: 50, cy: 30, span: 360, rotateItems: true });
    ok(made2 === 5, `radial array made ${made2} copies`);
    // footprint matching
    const { suggestReplacements, isUnmatched, groupUnmatched } = await import('./match.js');
    const { getFootprint: gf } = await import('./library.js');
    const sug = suggestReplacements(gf('hdr_1x08'), { exclude: 'hdr_1x08', limit: 3 });
    ok(sug.length === 3 && sug[0].score > 0.9, `footprint suggestions: ${sug.map(x => x.id + ' ' + x.score.toFixed(2)).join(', ')}`);
    app.store.mutate(d => { d.boards[0].items.push({ id: 'fakeimp', type: 'part', lib: 'kicad:Weird_Thing', ref: 'X9', value: '', x: 70, y: 50, rot: 0, side: 'top', fp: { name: 'Weird_Thing', pads: [{ name: '1', x: -1.27, y: 0, shape: 'rect', w: 1.8, h: 1.8, drill: 1, layer: 'both' }, { name: '2', x: 1.27, y: 0, shape: 'oval', w: 1.8, h: 1.8, drill: 1, layer: 'both' }], graphics: [], courtyard: { w: 6, h: 4 }, height: 3, body3d: [] } }); }, 'fake import');
    const fake = app.store.board.items.find(i => i.id === 'fakeimp');
    ok(isUnmatched(fake), 'imported part detected as unmatched');
    ok(groupUnmatched(app.store.doc).length >= 1 && groupUnmatched(app.store.doc)[0].suggestions.length > 0, 'unmatched parts get suggestions');
    app.applyReplacement([fake], 'hdr_1x02');
    ok(app.store.board.items.find(i => i.id === 'fakeimp').lib === 'hdr_1x02' && !app.store.board.items.find(i => i.id === 'fakeimp').fp, 'replacement applied');
    // image natural size
    const ic = document.createElement('canvas'); ic.width = 240; ic.height = 120; const ix = ic.getContext('2d'); ix.fillStyle = '#000'; ix.fillRect(0, 0, 240, 120);
    const { imagePlacement } = await import('./import/image.js');
    const pl = await imagePlacement(ic.toDataURL('image/png'));
    ok(Math.abs(pl.w - 240 / 96 * 25.4) < 0.01 && Math.abs(pl.h - 120 / 96 * 25.4) < 0.01, `image natural size ${pl.w}×${pl.h} mm @ ${pl.dpi} dpi`);
    // context menu
    app.store.select(app.store.board.items.filter(i => i.type === 'part').slice(0, 1).map(i => i.id));
    app.contextMenuAt(300, 300, [20, 20], null);
    const cm = document.querySelector('.ctxmenu');
    ok(cm && cm.querySelectorAll(':scope > .it').length > 10, `context menu: ${cm ? cm.querySelectorAll(':scope > .it').length : 0} entries`);
    const { closeContextMenu } = await import('./ui.js'); closeContextMenu();
    ok(!document.querySelector('.ctxmenu'), 'context menu closes');
    // design studio
    const { openDesignStudio, OPS, computeOp } = await import('./effects.js');
    ok(OPS.length >= 15, `design studio: ${OPS.length} operations`);
    const dm = openDesignStudio(app, 'hatch');
    ok(!!document.querySelector('.studio'), 'design studio opens');
    await new Promise(r => setTimeout(r, 900));
    let hatch = null;
    try { hatch = computeOp(app, OPS.find(o => o.id === 'hatch'), { spacing: 3, angle: 45, crosshatch: false, width: 0.25 }, { region: 'board', layer: 'F.Silk', edgeMargin: 1, holeMargin: 0.6, padMargin: 0.5, partMargin: 0.5, quality: 'fast' }); } catch (e) { ok(false, 'hatch generator threw: ' + e.message); }
    if (hatch) ok(hatch.items.length > 0, `hatch generator: ${hatch.items.length} items ${hatch.warn.join(' ') || ''}`);
    let dots = null;
    try { dots = computeOp(app, OPS.find(o => o.id === 'dots'), { spacing: 4, d: 1.2, grid: 'hex', jitter: 0, seed: 1 }, { region: 'board', layer: 'F.Silk', edgeMargin: 1, holeMargin: 0.8, padMargin: 0.6, partMargin: 0.6, quality: 'fast' }); } catch (e) { ok(false, 'dot generator threw: ' + e.message); }
    if (dots) { ok(dots.items.length > 0, `dot generator: ${dots.items.length} items`);
      const R2 = resolveBoard(app.store.doc.boards[0], app.store.doc); const { pointInPolygon } = await import('./geom.js');
      const bad = dots.items.filter(it => it.points && R2.drills.some(dr => it.points.some(([x, y]) => Math.hypot(x - dr.x, y - dr.y) < dr.d / 2)));
      ok(bad.length === 0, 'generated art avoids the drills'); }
    dm.close();
    ok(!document.querySelector('.studio'), 'design studio closes');
    // 7. 3D
    app.showView('3d'); await new Promise(r => setTimeout(r, 300)); ok(app.view3d && app.view3d.root && app.view3d.root.children.length >= 2, `3D scene built (${app.view3d?.root?.children.length} objects)`); app.view3d.viewFrom('top'); app.showView('2d');
    // 8. wizard modal opens/closes
    const { runWizard } = await import('./wizard.js'); const m = runWizard(() => {}); ok(!!document.querySelector('.modal'), 'wizard opens'); m.close(); ok(!document.querySelector('.modal'), 'wizard closes');
  } catch (e) { ok(false, 'exception: ' + e.message); console.error(e); }
  out.push(`${fails ? fails + ' FAILED' : 'ALL PASS'} in ${(performance.now() - t0).toFixed(0)} ms`);
  const text = out.join('\n'); console.log('[SELFTEST]\n' + text);
  if (location.search.includes('stay3d')) { app.showView('3d'); setTimeout(() => app.view3d.viewFrom('iso'), 200); }
  const pre = document.createElement('pre'); pre.id = 'selftest'; pre.style.cssText = 'position:fixed;right:310px;top:80px;max-height:70vh;overflow:auto;background:#000c;color:#0f0;padding:8px;font:11px monospace;z-index:999;white-space:pre-wrap;max-width:600px'; pre.textContent = text; document.body.append(pre);
  return fails === 0;
}
