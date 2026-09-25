// Unit tests for Layer B building blocks: PCG, projection, boundary conditions, scalars. SCIENCE.md §6.
import { check, near, nearRel, finish } from './lib.js';
import { makeBox } from './_fluid_setup.js';
import { createPCG, buildPreconditioner, solvePCG } from '../src/physics/pcg.js';
import {
  CELL, step, computeDt, maxDivergence, fluidMean, setExchangeBands, kineticEnergy,
} from '../src/physics/fluid.js';
import { CFL, DT_MAX, DIVERGENCE_TOL } from '../src/constants.js';

// Small deterministic pseudo-random generator so failures are reproducible.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

check('PCG: recovers a manufactured solution (5-point Laplacian with Dirichlet edges)', () => {
  const nx = 20, ny = 15, ws = createPCG(nx, ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = i + j * nx;
    ws.mask[c] = 1; ws.Adiag[c] = 4; // edges couple to Dirichlet p = 0 outside
    if (i < nx - 1) ws.Ax[c] = -1;
    if (j < ny - 1) ws.Ay[c] = -1;
  }
  buildPreconditioner(ws);
  const xTrue = new Float64Array(nx * ny).map(() => rand() - 0.5);
  const b = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = i + j * nx;
    let v = 4 * xTrue[c];
    if (i > 0) v -= xTrue[c - 1]; if (i < nx - 1) v -= xTrue[c + 1];
    if (j > 0) v -= xTrue[c - nx]; if (j < ny - 1) v -= xTrue[c + nx];
    b[c] = v;
  }
  const x = new Float64Array(nx * ny);
  const r = solvePCG(ws, x, b, 1e-12, 500);
  if (!r.converged) throw new Error('did not converge');
  for (let c = 0; c < x.length; c++) near(x[c], xTrue[c], 1e-10, `cell ${c}`);
});

check('projection: random velocity in a closed room becomes divergence-free', () => {
  const s = makeBox(30, 20, { h: 0.1 });
  for (let f = 0; f < s.u.length; f++) if (s.faceU[f] === 1) s.u[f] = rand() - 0.5;
  for (let f = 0; f < s.v.length; f++) if (s.faceV[f] === 1) s.v[f] = rand() - 0.5;
  step(s, 0.01);
  const d = maxDivergence(s);
  if (!(d < DIVERGENCE_TOL)) throw new Error(`max div ${d}`);
  if (!s.stats.pcgConverged) throw new Error('PCG did not converge');
});

// Channel: inlet column on the left (0.5 m/s in), outlet column on the right (p = 0).
function channel(fx = 40, fy = 10) {
  return makeBox(fx, fy, { h: 0.1, T0: 300 }, (s) => {
    const nx = s.nx;
    for (let j = 1; j <= fy; j++) {
      const inlet = 0 + j * nx, outlet = fx + 1 + j * nx;
      s.kind[inlet] = CELL.INLET; s.bu[inlet] = 0.5; s.TBC[inlet] = 290;
      s.kind[outlet] = CELL.OUTLET; s.pBC[outlet] = 0;
    }
  });
}

check('inlet/outlet channel: outflow equals inflow, air reaches inlet temperature, age stays finite', () => {
  const fx = 40, fy = 10, s = channel(fx, fy);
  const nx = s.nx, W = nx + 1;
  while (s.time < 30) step(s, computeDt(s));
  let qIn = 0, qOut = 0;
  for (let j = 1; j <= fy; j++) { qIn += s.u[1 + j * W] * s.h; qOut += s.u[fx + 1 + j * W] * s.h; }
  nearRel(qOut, qIn, 1e-6, 'outflow vs inflow');
  near(qIn, 0.5 * fy * s.h, 1e-12, 'inflow');
  near(fluidMean(s, s.T), 290, 0.05, 'mean T');
  // Plug flow: transit time = 4 m / 0.5 m/s = 8 s, so the mean age should be about 4 s.
  const age = fluidMean(s, s.A);
  if (!(age > 2 && age < 8)) throw new Error(`mean age ${age}`);
});

// Known side effect (SCIENCE.md §6.2): while a sharp cool front enters, BFECC admits slightly less
// cold air at the inlet than the face flux, and the uniform correction removes the difference
// room-wide. Cells briefly dip ~0.3 K below T_in, then the dip washes out completely.
check('heat correction: warm room flushed by cool inlet air balances heat, dips < 0.5 K, ends at T_in', () => {
  const fx = 40, fy = 10, s = channel(fx, fy); // room starts at 300 K, inlet air 290 K
  const nx = s.nx, W = nx + 1;
  let heat = s.T.reduce((a, t, c) => a + (s.kind[c] === CELL.FLUID ? t : 0), 0), expected = heat;
  let lo = Infinity, hi = -Infinity;
  for (let n = 0; n < 800; n++) {
    const dt = computeDt(s);
    // Boundary heat flux this step: inlet faces carry T_in, outlet faces the cell's pre-step T,
    // both with the projected face velocity (which the scalar update leaves unchanged).
    const Tout = [];
    for (let j = 1; j <= fy; j++) Tout.push(s.T[fx + j * nx]);
    step(s, dt);
    for (let j = 1; j <= fy; j++) {
      expected += (dt / s.h) * (s.u[1 + j * W] * 290 - s.u[fx + 1 + j * W] * Tout[j - 1]);
      // plus heat conducted across the inlet face (implicit diffusion, Dirichlet T_in)
      const c = 1 + j * nx;
      expected += (dt / (s.h * s.h)) * 0.5 * (s.kappaCell[c] + s.kappaCell[c - 1]) * (290 - s.T[c]);
    }
    for (let c = 0; c < s.T.length; c++) if (s.kind[c] === CELL.FLUID) { lo = Math.min(lo, s.T[c]); hi = Math.max(hi, s.T[c]); }
  }
  heat = s.T.reduce((a, t, c) => a + (s.kind[c] === CELL.FLUID ? t : 0), 0);
  nearRel(heat, expected, 1e-9, 'total heat vs boundary fluxes');
  if (lo < 290 - 0.5 || hi > 300 + 1e-6) throw new Error(`transient T range [${lo}, ${hi}]`);
  for (let c = 0; c < s.T.length; c++) if (s.kind[c] === CELL.FLUID) near(s.T[c], 290, 1e-4, 'final T');
});

check('heat correction: stirred closed room keeps its mean temperature to round-off', () => {
  const s = makeBox(20, 20, { h: 0.1 });
  for (let c = 0; c < s.T.length; c++) s.T[c] = 290 + 5 * rand();
  const T0 = fluidMean(s, s.T);
  for (let f = 0; f < s.u.length; f++) if (s.faceU[f] === 1) s.u[f] = rand() - 0.5;
  for (let n = 0; n < 100; n++) step(s, computeDt(s));
  near(fluidMean(s, s.T), T0, 1e-9);
});

check('uniform temperature stays uniform in a stirred room (advection/diffusion add no extrema)', () => {
  const s = makeBox(20, 20, { h: 0.1, T0: 295 });
  for (let f = 0; f < s.u.length; f++) if (s.faceU[f] === 1) s.u[f] = 0.8 * (rand() - 0.5);
  for (let n = 0; n < 50; n++) step(s, computeDt(s));
  for (let c = 0; c < s.T.length; c++) if (s.kind[c] === CELL.FLUID) near(s.T[c], 295, 1e-9);
});

check('age of air: still, closed room ages exactly 1 s per second', () => {
  const s = makeBox(10, 10, { h: 0.1 });
  for (let n = 0; n < 40; n++) step(s, 0.05);
  for (let c = 0; c < s.A.length; c++) if (s.kind[c] === CELL.FLUID) near(s.A[c], 2.0, 1e-9);
});

check('two-way exchange: band relaxes to outdoor temperature at rate Q/V (exact exponential)', () => {
  // Every fluid cell is in the band, so diffusion between cells does nothing.
  const s = makeBox(4, 2, { h: 0.1, T0: 300, ceilingHeight: 2.5 });
  const cells = Int32Array.from([...s.kind.keys()].filter((c) => s.kind[c] === CELL.FLUID));
  const Q = 0.01; // m³/s
  setExchangeBands(s, [{ cells, Qexchange: Q, T: 290 }]);
  const rate = Q / (cells.length * 0.01 * 2.5);
  for (let n = 0; n < 100; n++) step(s, 0.05);
  near(fluidMean(s, s.T), 290 + 10 * Math.exp(-rate * 5), 1e-9);
});

check('time step: CFL rule and cap', () => {
  const s = makeBox(10, 10, { h: 0.1 });
  near(computeDt(s), DT_MAX, 0, 'still air → Δt_max');
  s.u[5 + 5 * (s.nx + 1)] = 4;
  near(computeDt(s), (CFL * 0.1) / 4, 1e-15, 'CFL');
});

check('closed room: kinetic energy never grows (free-slip, no forcing)', () => {
  const s = makeBox(24, 16, { h: 0.1 });
  for (let f = 0; f < s.u.length; f++) if (s.faceU[f] === 1) s.u[f] = rand() - 0.5;
  step(s, 0.01); // project the random field first
  let e = kineticEnergy(s);
  for (let n = 0; n < 100; n++) {
    step(s, computeDt(s));
    const e2 = kineticEnergy(s);
    if (e2 > e * (1 + 1e-12)) throw new Error(`KE grew at step ${n}: ${e} → ${e2}`);
    e = e2;
  }
});

finish();
