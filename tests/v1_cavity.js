// V1 — Lid-driven cavity. SCIENCE.md §8.
// Unit square, no-slip walls, top lid moving at U = 1; turbulence and drag off.
// Runs Re = 100 and 400 on 64 × 64 and 128 × 128 grids.
// Pass (Re = 100): centreline u and v within 5% of Ghia, Ghia & Shin (1982), normalised by lid
// speed, i.e. max |model − Ghia| ≤ 0.05 · U at the tabulated points.
// Re = 400 is reported for information (SCIENCE.md sets the criterion at Re = 100).
//
// Usage: node tests/v1_cavity.js            (all four cases)
//        node tests/v1_cavity.js 64 100     (one case)
import { check, finish } from './lib.js';
import { makeBox } from './_fluid_setup.js';
import { step, computeDt, sampleU, sampleV } from '../src/physics/fluid.js';

// Ghia et al. (1982) Tables I and II, copied from the paper via
// https://gist.github.com/ivan-pi/3e9326d18a366ffe6a8e5bfda6353219 (u) and
// https://gist.github.com/ivan-pi/caa6c6737d36a9140fbcf2ea59c78b3c (v).
const GHIA_Y = [1.0, 0.9766, 0.9688, 0.9609, 0.9531, 0.8516, 0.7344, 0.6172, 0.5, 0.4531, 0.2813, 0.1719, 0.1016, 0.0703, 0.0625, 0.0547, 0.0];
const GHIA_U = {
  100: [1, 0.84123, 0.78871, 0.73722, 0.68717, 0.23151, 0.00332, -0.13641, -0.20581, -0.21090, -0.15662, -0.10150, -0.06434, -0.04775, -0.04192, -0.03717, 0],
  400: [1, 0.75837, 0.68439, 0.61756, 0.55892, 0.29093, 0.16256, 0.02135, -0.11477, -0.17119, -0.32726, -0.24299, -0.14612, -0.10338, -0.09266, -0.08186, 0],
};
const GHIA_X = [1.0, 0.9688, 0.9609, 0.9531, 0.9453, 0.9063, 0.8594, 0.8047, 0.5, 0.2344, 0.2266, 0.1563, 0.0938, 0.0781, 0.0703, 0.0625, 0.0];
const GHIA_V = {
  100: [0, -0.05906, -0.07391, -0.08864, -0.10313, -0.16914, -0.22445, -0.24533, 0.05454, 0.17527, 0.17507, 0.16077, 0.12317, 0.10890, 0.10091, 0.09233, 0],
  // Re 400 at x = 0.9063 (−0.23827) is widely considered a typo in the paper; it is skipped below.
  400: [0, -0.12146, -0.15663, -0.19254, -0.22847, -0.23827, -0.44993, -0.38598, 0.05186, 0.30174, 0.30203, 0.28124, 0.22965, 0.20920, 0.19713, 0.18360, 0],
};

const U_LID = 1, L = 1;
const STEADY_TOL = 1e-4;   // steady when no velocity changes by more than this per unit time
const T_MAX = 100;         // give up after this many lid-crossing times

function runCavity(N, Re) {
  const h = L / N;
  const s = makeBox(N, N, { h, nu: (U_LID * L) / Re, rho: 1, noSlip: true }, (st) => {
    for (let i = 1; i <= N; i++) st.bu[i + (N + 1) * st.nx] = U_LID; // top row of the solid ring moves
  });
  const prevU = new Float64Array(s.u.length);
  let nextCheck = 1, change = Infinity;
  const t0 = performance.now();
  while (s.time < T_MAX) {
    step(s, computeDt(s));
    if (s.time >= nextCheck) {
      change = 0;
      for (let f = 0; f < s.u.length; f++) change = Math.max(change, Math.abs(s.u[f] - prevU[f]));
      prevU.set(s.u);
      nextCheck += 1;
      if (change < STEADY_TOL) break;
    }
  }
  const seconds = (performance.now() - t0) / 1000;

  // The fluid occupies [h, h + L] in grid coordinates (one ring cell of wall).
  const uErr = GHIA_Y.map((y, k) => Math.abs(sampleU(s, h + 0.5 * L, h + y * L) - GHIA_U[Re][k]));
  const vErr = GHIA_X.map((x, k) => (Re === 400 && k === 5) ? 0 : Math.abs(sampleV(s, h + x * L, h + 0.5 * L) - GHIA_V[Re][k]));
  return { N, Re, s, uMax: Math.max(...uErr), vMax: Math.max(...vErr), time: s.time, change, seconds };
}

const args = process.argv.slice(2).map(Number);
const cases = args.length === 2 ? [[args[0], args[1]]] : [[64, 100], [128, 100], [64, 400], [128, 400]];

console.log('  grid      Re    max|Δu|   max|Δv|   sim time  steady?   wall clock');
const results = cases.map(([N, Re]) => {
  const r = runCavity(N, Re);
  console.log(`  ${String(N).padStart(3)}×${String(N).padEnd(3)}  ${String(Re).padStart(4)}   ${r.uMax.toFixed(4)}    ${r.vMax.toFixed(4)}    ${r.time.toFixed(1).padStart(6)}    ${r.change < STEADY_TOL ? 'yes' : 'NO '}      ${r.seconds.toFixed(1)} s`);
  return r;
});

for (const r of results) {
  const label = `${r.N}×${r.N}, Re ${r.Re}`;
  check(`${label}: reached steady state`, () => { if (!(r.change < STEADY_TOL)) throw new Error(`still changing by ${r.change}`); });
  if (r.Re === 100) {
    check(`${label}: centreline u within 0.05·U of Ghia`, () => { if (!(r.uMax <= 0.05)) throw new Error(`max error ${r.uMax.toFixed(4)}`); });
    check(`${label}: centreline v within 0.05·U of Ghia`, () => { if (!(r.vMax <= 0.05)) throw new Error(`max error ${r.vMax.toFixed(4)}`); });
  }
}

finish();
