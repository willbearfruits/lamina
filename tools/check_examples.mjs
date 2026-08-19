// Every example must resolve on every board and produce no DRC ERRORS.
// Run: node tools/check_examples.mjs
//
// Examples are the first thing a new user opens, so a broken one is worse
// than a missing feature. They are generated (tools/make_examples.mjs) from
// hand-placed coordinates, and hand-placed coordinates collide — this is
// what caught a header hanging 1.3 mm off the board edge and two rows of
// Eurorack jacks overlapping by 0.2 mm.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoc } from '../js/model.js';
import { resolveBoard } from '../js/geom.js';
import { runDRC, drcSummary } from '../js/drc.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const EX = path.join(ROOT, 'examples');
const index = JSON.parse(fs.readFileSync(path.join(EX, 'index.json'), 'utf8'));

let failed = 0;
for (const e of index) {
  const file = path.join(EX, `${e.file}.lamina.json`);
  if (!fs.existsSync(file)) { console.error(`FAIL ${e.file}: listed in index.json but the file is missing`); failed++; continue; }
  let doc;
  try { doc = parseDoc(fs.readFileSync(file, 'utf8')); }
  catch (err) { console.error(`FAIL ${e.file}: will not parse — ${err.message}`); failed++; continue; }

  const parts = [];
  try {
    for (const b of doc.boards) {
      const r = resolveBoard(b, doc, {});
      parts.push(`${b.name} ${r.drills.length}d/${r.pads.length}p/${r.parts.length}fp`);
    }
  } catch (err) { console.error(`FAIL ${e.file}: resolveBoard threw — ${err.message}`); failed++; continue; }

  const findings = runDRC(doc, {});
  const s = drcSummary(findings);
  if (s.errors > 0) {
    console.error(`FAIL ${e.file}: ${s.errors} DRC error(s)`);
    for (const f of findings.filter(f => f.level === 'error')) console.error(`       ${f.msg ?? f.message ?? JSON.stringify(f)}`);
    failed++;
    continue;
  }
  console.log(`PASS ${e.file.padEnd(22)} ${parts.join(' | ')}  (${s.warnings} warning${s.warnings === 1 ? '' : 's'})`);
}

// Anything on disk that the index forgot is invisible in the app.
const onDisk = fs.readdirSync(EX).filter(f => f.endsWith('.lamina.json')).map(f => f.replace(/\.lamina\.json$/, ''));
const listed = new Set(index.map(e => e.file));
for (const f of onDisk) if (!listed.has(f)) { console.error(`FAIL ${f}: on disk but not in index.json — it will not appear in the app`); failed++; }

console.log('');
if (failed) { console.error(`[examples] FAILED — ${failed} problem(s)`); process.exit(1); }
console.log(`[examples] PASS — ${index.length} examples, no DRC errors`);
