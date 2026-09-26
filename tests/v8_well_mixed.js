// V8 — Well-mixed sanity. SCIENCE.md §8.
// One inlet, one outlet, steady flow. Pass: room-average age of air between 0.5·τ_n and 1.5·τ_n,
// where τ_n = V / Q_in is the nominal time constant (§7.3).
// In the 2D plan-view solver V and Q are per unit depth: V = floor area, Q = u_in · w_inlet.
// Production settings: turbulence and drag on, free-slip walls.
import { check, finish } from './lib.js';
import { makeBox } from './_fluid_setup.js';
import { CELL, step, computeDt, fluidMean } from '../src/physics/fluid.js';

// 4 m × 4 m room. Inlet: 0.9 m on the west wall, centred. Outlet: 0.9 m on the east wall, near
// the north corner (offset, so the flow has to turn and part of the room is off the direct path).
const FX = 40, FY = 40, h = 0.1, U_IN = 0.5;
const INLET_J = [16, 17, 18, 19, 20, 21, 22, 23, 24], OUTLET_J = [31, 32, 33, 34, 35, 36, 37, 38, 39];
const s = makeBox(FX, FY, { h }, (st) => {
  for (const j of INLET_J) { const c = 0 + j * st.nx; st.kind[c] = CELL.INLET; st.bu[c] = U_IN; }
  for (const j of OUTLET_J) { const c = FX + 1 + j * st.nx; st.kind[c] = CELL.OUTLET; st.pBC[c] = 0; }
});

const tauN = (FX * FY * h * h) / (U_IN * INLET_J.length * h);
const T_END = 10 * tauN, T_AVG = 8 * tauN;
let sum = 0, n = 0;
while (s.time < T_END) {
  step(s, computeDt(s));
  if (s.time > T_AVG) { sum += fluidMean(s, s.A); n++; }
}
const age = sum / n;
console.log(`  τ_n = ${tauN.toFixed(1)} s; room-average age (mean over ${T_AVG.toFixed(0)}–${T_END.toFixed(0)} s) = ${age.toFixed(1)} s = ${(age / tauN).toFixed(2)} τ_n (criterion 0.5–1.5)`);

check('room-average age between 0.5·τ_n and 1.5·τ_n', () => {
  if (!(age >= 0.5 * tauN && age <= 1.5 * tauN)) throw new Error(`age/τ_n = ${(age / tauN).toFixed(3)}`);
});

finish();
