// V7 — Stack sign. SCIENCE.md §5.4 and §8.
// Warm inside, cool outside, one low and one high opening, no wind.
// Pass: inflow at the low opening, outflow at the high one.
import { check, near, finish } from './lib.js';
import { solveZone } from '../src/physics/envelope.js';
import { fToK, m3sToCfm } from '../src/units.js';

const low  = { id: 'low',  area: 0.3, zCenter: 0.5, height: 0.6, cp: 0 };
const high = { id: 'high', area: 0.3, zCenter: 2.0, height: 0.6, cp: 0 };

function run(ToutF, TinF) {
  return solveZone([low, high], { Tout: fToK(ToutF), Tin: fToK(TinF), UH: 0, Umet: 0 });
}

// Main V7 case: 80 °F inside, 60 °F outside.
const warm = run(60, 80);
const [qLow, qHigh] = warm.openings.map((o) => o.Q);
console.log(`  Warm inside (80 °F in, 60 °F out): low ${m3sToCfm(qLow).toFixed(1)} CFM, high ${m3sToCfm(qHigh).toFixed(1)} CFM, P_in ${warm.Pin.toFixed(4)} Pa`);
check('warm inside: inflow at LOW opening', () => { if (!(qLow > 0)) throw new Error(`Q_low = ${qLow}`); });
check('warm inside: outflow at HIGH opening', () => { if (!(qHigh < 0)) throw new Error(`Q_high = ${qHigh}`); });
check('warm inside: mass balances', () => {
  if (!warm.balanced) throw new Error('unbalanced');
  near(warm.massResidual, 0, 1e-9);
});

// Supporting check: the sign reverses when it's colder inside.
const cold = run(80, 60);
const [cLow, cHigh] = cold.openings.map((o) => o.Q);
console.log(`  Cold inside (60 °F in, 80 °F out): low ${m3sToCfm(cLow).toFixed(1)} CFM, high ${m3sToCfm(cHigh).toFixed(1)} CFM`);
check('cold inside: flow reverses (out low, in high)', () => {
  if (!(cLow < 0 && cHigh > 0)) throw new Error(`Q_low=${cLow}, Q_high=${cHigh}`);
});

// Supporting check: equal temperatures and no wind → no net flow.
const still = run(70, 70);
check('equal temperatures, no wind: zero flow', () => {
  for (const o of still.openings) near(o.Q, 0, 1e-12, o.id);
});

finish();
