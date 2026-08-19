// Runs every test/*.test.mjs in a child process; prints a summary; exits non-zero on failure.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort();
let failed = 0;
for (const t of tests) {
  const r = spawnSync(process.execPath, [path.join(dir, t)], { encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = r.status === 0 && /ALL PASS/.test(out);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${t}${pass ? '' : '\n' + out.split('\n').slice(-25).join('\n')}`);
  if (!pass) failed++;
}
console.log(failed ? `\n${failed}/${tests.length} test files FAILED` : `\nALL PASS (${tests.length} test files)`);
process.exit(failed ? 1 : 0);
