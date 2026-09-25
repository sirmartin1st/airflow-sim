// V3 — Two-opening network. SCIENCE.md §5.5 and §8.
// Opposite walls, Cp1 = 0.6, Cp2 = −0.36, no ΔT.
// Pass: Q = C_d · U_H · sqrt(ΔCp) / sqrt(1/A1² + 1/A2²) to 1e-6 relative.
import { check, nearRel, near, finish } from './lib.js';
import { solveZone, windSpeedAtHeight } from '../src/physics/envelope.js';
import { C_D, TERRAIN, DEFAULT_BUILDING_HEIGHT } from '../src/constants.js';

const CP1 = 0.6, CP2 = -0.36;
const T = 293.15;

const cases = [
  { A1: 0.54, A2: 0.54, Umet: 4 },
  { A1: 1.0,  A2: 0.3,  Umet: 4 },
  { A1: 0.2,  A2: 1.5,  Umet: 10 },
  { A1: 0.54, A2: 0.27, Umet: 0.5 }, // light breeze: ΔP is a small fraction of a pascal
];

console.log('  A1 (m²)  A2 (m²)  U_met   Q model (m³/s)   Q analytic      rel. error');
for (const c of cases) {
  const UH = windSpeedAtHeight(c.Umet, DEFAULT_BUILDING_HEIGHT, TERRAIN.suburban);
  const openings = [
    { id: 'w1', area: c.A1, zCenter: 1.5, height: 1.2, cp: CP1 },
    { id: 'w2', area: c.A2, zCenter: 1.5, height: 1.2, cp: CP2 },
  ];
  const r = solveZone(openings, { Tout: T, Tin: T, UH, Umet: c.Umet });
  const Qa = (C_D * UH * Math.sqrt(CP1 - CP2)) / Math.sqrt(1 / c.A1 ** 2 + 1 / c.A2 ** 2);
  const [q1, q2] = r.openings.map((o) => o.Q);
  const err = Math.abs(q1 - Qa) / Qa;
  console.log(`  ${c.A1.toFixed(2).padStart(7)}  ${c.A2.toFixed(2).padStart(7)}  ${c.Umet.toFixed(1).padStart(5)}   ${q1.toExponential(8)}   ${Qa.toExponential(8)}   ${err.toExponential(2)}`);

  const label = `A1=${c.A1}, A2=${c.A2}, U_met=${c.Umet}`;
  check(`${label}: inflow Q matches analytic to 1e-6`, () => nearRel(q1, Qa, 1e-6));
  check(`${label}: outflow Q matches analytic to 1e-6`, () => nearRel(-q2, Qa, 1e-6));
  check(`${label}: inflow at Cp=0.6, outflow at Cp=−0.36, balanced`, () => {
    if (!(q1 > 0 && q2 < 0 && r.balanced)) throw new Error(`q1=${q1}, q2=${q2}, balanced=${r.balanced}`);
    near(r.massResidual, 0, 1e-9, 'mass residual');
  });
}

finish();
