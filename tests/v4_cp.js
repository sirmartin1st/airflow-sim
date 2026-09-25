// V4 — Cp(β) table. SCIENCE.md §5.3 and §8.
// Pass: Swami & Chandra correlation matches the reference table (S = 1) to ±0.002.
import { check, near, finish } from './lib.js';
import { cpSwamiChandra } from '../src/physics/envelope.js';

const TABLE = [
  [0, 0.603], [30, 0.469], [45, 0.323], [60, 0.119], [90, -0.443],
  [120, -0.681], [135, -0.535], [150, -0.390], [180, -0.364],
];

console.log('  β (deg)   Cp model   Cp table   diff');
for (const [beta, expected] of TABLE) {
  const cp = cpSwamiChandra(beta, 1);
  console.log(`  ${String(beta).padStart(6)}   ${cp.toFixed(4).padStart(8)}   ${expected.toFixed(3).padStart(8)}   ${(cp - expected).toFixed(4)}`);
  check(`Cp(${beta}°) = ${expected} ± 0.002`, () => near(cp, expected, 0.002));
}

finish();
