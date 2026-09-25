// V6 — Closed room conservation. SCIENCE.md §8.
// No openings, air stirred for 10 s then left alone, initial temperature gradient.
// Pass: max|∇·u| < 1e-4 after every projection; kinetic energy decays monotonically once
// stirring stops; mean T drift < 1% of the initial temperature spread (tightened 2026-09-24,
// see SCIENCE.md §8).
//
// PHASE 3 STAND-IN: fans arrive in Phase 4 (fans.js). Until then the stirring is a simple
// actuator written here that uses the same relaxation rule as SCIENCE.md §6.6.
// Phase 4 will replace it with the real fan model.
import { check, finish } from './lib.js';
import { makeBox } from './_fluid_setup.js';
import { step, computeDt, maxDivergence, kineticEnergy, fluidMean } from '../src/physics/fluid.js';
import { DIVERGENCE_TOL, FAN_TAU } from '../src/constants.js';

// 4 m × 3 m room, 10 cm cells, real air properties, free-slip walls (the production settings).
const FX = 40, FY = 30, h = 0.1;
const T_STIR = 10, T_END = 60;
const s = makeBox(FX, FY, { h });

// Initial temperature: 18 °C on the west wall to 22 °C on the east wall.
for (let j = 1; j <= FY; j++) for (let i = 1; i <= FX; i++) {
  s.T[i + j * s.nx] = 291.15 + (4 * (i - 0.5)) / FX;
}
const T0 = fluidMean(s, s.T);
let tMin = Infinity, tMax = -Infinity;
for (let c = 0; c < s.T.length; c++) if (s.kind[c] === 1) { tMin = Math.min(tMin, s.T[c]); tMax = Math.max(tMax, s.T[c]); }
const SPREAD = tMax - tMin;

// Stand-in stirrer: 0.5 m wide, 2 cells deep, blowing +x at 2 m/s, 1 m from the west wall.
const STIR_I = [11, 12], STIR_J = [13, 14, 15, 16, 17], U_STIR = 2;
function stir(dt) {
  const r = 1 - Math.exp(-dt / FAN_TAU);
  for (const i of STIR_I) for (const j of STIR_J) {
    const f = i + j * (s.nx + 1);
    s.u[f] += (U_STIR - s.u[f]) * r;
  }
}

let maxDiv = 0, steps = 0, keGrowths = 0, worstGrowth = 0, kePrev = Infinity, keAtStop = 0;
while (s.time < T_END) {
  const dt = computeDt(s);
  const stirring = s.time < T_STIR;
  if (stirring) stir(dt);
  step(s, dt);
  steps++;
  maxDiv = Math.max(maxDiv, maxDivergence(s));
  const ke = kineticEnergy(s);
  if (!stirring) {
    if (keAtStop === 0) keAtStop = ke;
    if (ke > kePrev) { keGrowths++; worstGrowth = Math.max(worstGrowth, (ke - kePrev) / kePrev); }
  }
  kePrev = ke;
}

const T1 = fluidMean(s, s.T);
const drift = Math.abs(T1 - T0);
console.log(`  steps: ${steps}, sim time: ${s.time.toFixed(1)} s`);
console.log(`  max|∇·u| over all steps: ${maxDiv.toExponential(2)} 1/s (criterion < ${DIVERGENCE_TOL})`);
console.log(`  kinetic energy: ${keAtStop.toExponential(3)} at stir stop → ${kePrev.toExponential(3)} at end; increases: ${keGrowths}`);
console.log(`  mean T: ${T0.toFixed(6)} K → ${T1.toFixed(6)} K; drift ${drift.toExponential(2)} K = ${(100 * drift / SPREAD).toExponential(2)}% of the ${SPREAD.toFixed(2)} K initial spread (criterion 1%)`);

check('max|∇·u| < 1e-4 after every projection', () => {
  if (!(maxDiv < DIVERGENCE_TOL)) throw new Error(`max div ${maxDiv}`);
});
check('kinetic energy decays monotonically after stirring stops', () => {
  if (keGrowths > 0) throw new Error(`${keGrowths} increases, worst ${worstGrowth.toExponential(2)} relative`);
  if (!(kePrev < keAtStop)) throw new Error('energy did not decay');
});
check('mean temperature drift < 1% of initial spread', () => {
  if (!(drift / SPREAD < 0.01)) throw new Error(`drift ${(100 * drift / SPREAD).toFixed(3)}% of spread`);
});

finish();
