// Tiny test helper: check(name, fn) records pass/fail; finish() prints results
// and sets the exit code so tests/run.js can tell whether the file passed.

const results = [];

export function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, msg: err.message });
  }
}

/** Throws unless |actual − expected| ≤ tol. */
export function near(actual, expected, tol, label = '') {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${label} expected ${expected} ± ${tol}, got ${actual}`);
  }
}

/** Throws unless |actual − expected| / |expected| ≤ relTol. */
export function nearRel(actual, expected, relTol, label = '') {
  if (!(Math.abs(actual - expected) <= relTol * Math.abs(expected))) {
    throw new Error(`${label} expected ${expected} (rel ${relTol}), got ${actual}`);
  }
}

export function finish() {
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  — ${r.msg}`}`);
  }
  console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
