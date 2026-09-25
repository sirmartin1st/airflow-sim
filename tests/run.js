// Runs every test file in tests/ (anything ending in .js except run.js and lib.js)
// in its own Node process, then prints a pass/fail table.
// Exit code is 1 if any test fails, so this can gate commits.
//
// Usage: node tests/run.js

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(['run.js', 'lib.js']);

const files = readdirSync(here)
  .filter((f) => f.endsWith('.js') && !SKIP.has(f))
  .sort();

const rows = [];
for (const file of files) {
  console.log(`\n▶ ${file}`);
  const t0 = performance.now();
  const res = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  const seconds = (performance.now() - t0) / 1000;
  rows.push({ file, ok: res.status === 0, seconds });
}

console.log('\n──────────── Summary ────────────');
if (rows.length === 0) console.log('  (no tests found)');
for (const r of rows) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.file.padEnd(28)} ${r.seconds.toFixed(2)} s`);
}
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} test files passed`);
process.exitCode = failed ? 1 : 0;
