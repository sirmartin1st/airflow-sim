// V2 — Plane Poiseuille channel. SCIENCE.md §8.
// Pressure-driven flow between two no-slip plates (no-slip used for this test only, per §8).
// Driven by Dirichlet pressures at the two ends (the solver's pressure-outlet boundary condition).
// Pass: mid-channel velocity profile within 2% of the analytic parabola u(y) = G/(2ρν) · y(H − y).
import { check, finish } from './lib.js';
import { makeBox } from './_fluid_setup.js';
import { CELL, step, computeDt, maxDivergence } from '../src/physics/fluid.js';

// Nondimensional test fluid: H = 1, ν = 0.05, ρ = 1, u_max = 1 (Re = u_max·H/ν = 20, laminar).
const NY = 32, NX = 64;
const H = 1, h = H / NY, NU = 0.05, RHO = 1, UMAX = 1;
const G = (8 * RHO * NU * UMAX) / (H * H);          // pressure gradient for u_max = 1
const LP = (NX + 1) * h;                             // distance between the two Dirichlet cell centres
const T_END = 60;                                    // 3 viscous times H²/ν; slowest mode decays by e^−30

const s = makeBox(NX, NY, { h, nu: NU, rho: RHO, noSlip: true }, (st) => {
  const nx = st.nx;
  for (let j = 1; j <= NY; j++) {
    st.kind[0 + j * nx] = CELL.OUTLET; st.pBC[0 + j * nx] = G * LP;   // high pressure end
    st.kind[NX + 1 + j * nx] = CELL.OUTLET; st.pBC[NX + 1 + j * nx] = 0;
  }
});

while (s.time < T_END) step(s, computeDt(s));

const W = s.nx + 1, iMid = 1 + NX / 2;
let maxErr = 0;
console.log('  y/H      u model    u analytic   error/u_max');
for (let j = 1; j <= NY; j++) {
  const y = (j - 0.5) * h;
  const ua = (G / (2 * RHO * NU)) * y * (H - y);
  const um = s.u[iMid + j * W];
  const err = Math.abs(um - ua) / UMAX;
  maxErr = Math.max(maxErr, err);
  if (j % 4 === 1 || j === NY / 2) console.log(`  ${y.toFixed(4)}   ${um.toFixed(5)}    ${ua.toFixed(5)}     ${(100 * err).toFixed(3)}%`);
}
console.log(`  max error: ${(100 * maxErr).toFixed(3)}% of u_max (criterion 2%)  ·  t = ${s.time.toFixed(1)}  ·  max|∇·u| = ${maxDivergence(s).toExponential(2)}`);

check('profile within 2% of analytic parabola', () => {
  if (!(maxErr <= 0.02)) throw new Error(`max error ${(100 * maxErr).toFixed(3)}%`);
});

finish();
