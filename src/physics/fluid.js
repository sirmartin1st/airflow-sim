// Layer B: interior flow. 2D incompressible Navier-Stokes on a MAC grid. SCIENCE.md §6.
//
// Grid layout (SCIENCE.md §4.1, Harlow & Welch 1965; Bridson 2015 ch. 2):
//   cell (i, j), 0 ≤ i < nx, 0 ≤ j < ny, centre at ((i + ½)h, (j + ½)h): pressure, T, age
//   u-face (i, j), 0 ≤ i ≤ nx: x-velocity at (i·h, (j + ½)h), between cells (i−1, j) and (i, j)
//   v-face (i, j), 0 ≤ j ≤ ny: y-velocity at ((i + ½)h, j·h), between cells (i, j−1) and (i, j)
//
// Cell kinds:
//   FLUID  — simulated indoor air
//   SOLID  — wall or anything not simulated; may carry a velocity (bu, bv) for moving walls
//   INLET  — envelope opening with inflow: fixed velocity (bu, bv) into the room, T = TBC, age = 0
//   OUTLET — envelope opening with outflow: pressure outlet, p = pBC (Dirichlet), zero-gradient T and age
//
// Face states, derived from the cells on each side:
//   ACTIVE   — FLUID|FLUID or FLUID|OUTLET: solved (advected, diffused, projected)
//   FIXED    — FLUID|SOLID or FLUID|INLET: velocity prescribed by the non-fluid cell;
//              also faces held by a fan (fixed-flow actuator, §6.6)
//   INACTIVE — everything else; holds ghost values used for interpolation and wall stencils
//
// Everything here is SI and DOM-free (CLAUDE.md rules 3 and 4). All working arrays are
// allocated in createFluid/setCells; step() allocates nothing.
// Arrays are Float64 throughout (the pressure solve needs it; velocities use it so that
// round-off stays far below the V6 divergence tolerance).

import {
  NU_AIR, ALPHA_AIR, REFERENCE_TEMPERATURE, DEFAULT_CEILING_HEIGHT, C_SMAGORINSKY, C_F_DRAG,
  CFL, DT_MAX, DIVERGENCE_TOL,
  PCG_TOL_FRACTION, PCG_MAX_ITER, DIFFUSION_REL_TOL, DIFFUSION_MAX_ITER,
} from '../constants.js';
import { airDensity } from './envelope.js';
import { createPCG, buildPreconditioner, solvePCG } from './pcg.js';

import { CELL, FACE } from './cells.js';
import { updateEddyViscosity, applyMixingFloor, applyDrag } from './turbulence.js';
import { markFanFaces, updateFanSpeeds } from './fans.js';

export { CELL, FACE };

const { SOLID, FLUID, INLET, OUTLET } = CELL;
const { INACTIVE, ACTIVE, FIXED } = FACE;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Creates a solver state. All cells start SOLID; set s.kind, then call setCells(s).
 * @param opts.nx, opts.ny   grid size in cells
 * @param opts.h             cell size, m
 * @param opts.nu            molecular kinematic viscosity, m²/s (default: air, SCIENCE.md §3)
 * @param opts.alpha         molecular thermal diffusivity, m²/s (default: air)
 * @param opts.rho           density used to convert the projection pressure to Pa
 * @param opts.noSlip        tangential wall condition: false = free-slip (default, SCIENCE.md §6.4),
 *                           true = no-slip (validation tests V1 and V2 only)
 * @param opts.smagorinsky   Smagorinsky constant C_s (default §6.5 value; 0 turns turbulence off)
 * @param opts.cf            floor/ceiling drag coefficient c_f (default constants.js; 0 turns drag off)
 * @param opts.mixingFloor   apply the scalar mixing floor of §6.5 (default true)
 * @param opts.ceilingHeight m: drag depth H_room (§6.5) and exchange band volume (§6.4)
 * @param opts.T0            initial temperature, K
 */
export function createFluid(opts) {
  const {
    nx, ny, h,
    nu = NU_AIR,
    alpha = ALPHA_AIR,
    rho = airDensity(REFERENCE_TEMPERATURE),
    noSlip = false,
    ceilingHeight = DEFAULT_CEILING_HEIGHT,
    smagorinsky = C_SMAGORINSKY,
    cf = C_F_DRAG,
    mixingFloor = true,
    T0 = REFERENCE_TEMPERATURE,
  } = opts;
  if (nx < 2 || ny < 2) throw new Error('grid must be at least 2 × 2 cells');
  const nc = nx * ny, nuF = (nx + 1) * ny, nvF = nx * (ny + 1);
  const s = {
    nx, ny, h, rho, noSlip, ceilingHeight,
    Cs: smagorinsky, cf, mixingFloor, nuBase: nu, alphaBase: alpha,
    time: 0,

    // Free-standing fans (fans.js format). Change with setFans() (§6.6).
    fans: [],
    fanU: new Uint16Array(nuF),            // fan index + 1 holding each u-face (0 = none)
    fanV: new Uint16Array(nvF),

    kind: new Uint8Array(nc),
    bu: new Float64Array(nc),              // velocity of SOLID / INLET cells, m/s
    bv: new Float64Array(nc),
    pBC: new Float64Array(nc),             // OUTLET pressure, Pa
    TBC: new Float64Array(nc).fill(T0),    // INLET temperature, K

    faceU: new Uint8Array(nuF),
    faceV: new Uint8Array(nvF),

    u: new Float64Array(nuF),
    v: new Float64Array(nvF),
    p: new Float64Array(nc),               // pressure, Pa (relative)
    T: new Float64Array(nc).fill(T0),      // temperature, K
    A: new Float64Array(nc),               // age of air, s

    // Effective diffusivities per cell: ν + ν_t and α + ν_t/Pr_t, updated each step (§6.5).
    nuCell: new Float64Array(nc).fill(nu),
    kappaCell: new Float64Array(nc).fill(alpha),

    // Two-way exchange bands (§6.4): [{ cells: Int32Array, rate: 1/s, T: K }]
    exchange: [],

    // Per-zone coupling inputs (§6.7), indexed by zone (componentOf). Sized in setCells.
    zoneTargetT: new Float64Array(0),     // NaN = conserve heat (§6.2); otherwise hold zone mean T here
    ageRate: new Float64Array(0),         // age source rate, 1 = plain clock; r_z when coupled

    stats: { pcgIterations: 0, pcgResidualDiv: 0, pcgConverged: true, diffusionSweeps: 0 },

    // --- scratch (private) ---
    _u0: new Float64Array(nuF), _uF: new Float64Array(nuF), _uB: new Float64Array(nuF),
    _uMin: new Float64Array(nuF), _uMax: new Float64Array(nuF),
    _v0: new Float64Array(nvF), _vF: new Float64Array(nvF), _vB: new Float64Array(nvF),
    _vMin: new Float64Array(nvF), _vMax: new Float64Array(nvF),
    _cF: new Float64Array(nc), _cB: new Float64Array(nc),
    _cMin: new Float64Array(nc), _cMax: new Float64Array(nc),
    _rhs: new Float64Array(Math.max(nuF, nvF, nc)),
    _pHat: new Float64Array(nc),
    _b: new Float64Array(nc),
    _pcg: createPCG(nx, ny),
    _comp: new Int32Array(nc),
    _compDirichlet: new Uint8Array(0),
    _compSum: new Float64Array(0),
    _compCount: new Float64Array(0),
    _heat: new Float64Array(0),
    _heatS: new Float64Array(0),
    _queue: new Int32Array(nc),
  };
  // Ghost-fill closures, created once so step() doesn't allocate.
  s._ghostU = (a) => fillGhostU(s, a);
  s._ghostV = (a) => fillGhostV(s, a);
  s._ghostT = (a) => fillGhostScalar(s, a, s.TBC);
  s._ghostA = (a) => fillGhostScalar(s, a, null);
  return s;
}

/** Recomputes face states, fluid components and the pressure matrix. Call after changing s.kind. */
export function setCells(s) {
  const { nx, ny, kind, faceU, faceV } = s;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const kL = i > 0 ? kind[i - 1 + j * nx] : SOLID;
      const kR = i < nx ? kind[i + j * nx] : SOLID;
      faceU[i + j * (nx + 1)] = faceState(kL, kR);
    }
  }
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      const kB = j > 0 ? kind[i + (j - 1) * nx] : SOLID;
      const kT = j < ny ? kind[i + j * nx] : SOLID;
      faceV[i + j * nx] = faceState(kB, kT);
    }
  }

  // Fan-held faces become FIXED (fixed-flow actuator, §6.6).
  markFanFaces(s);
  for (let f = 0; f < faceU.length; f++) if (s.fanU[f] && faceU[f] === ACTIVE) faceU[f] = FIXED;
  for (let f = 0; f < faceV.length; f++) if (s.fanV[f] && faceV[f] === ACTIVE) faceV[f] = FIXED;

  labelComponents(s);
  buildPressureMatrix(s);
  applyBoundaryConditions(s);
}

/**
 * Replaces the fans (fans.js format) and rebuilds the face states and pressure matrix.
 * Only needed when fans are added, removed, moved or rotated. To change a fan's speed setting,
 * just set fan.flow; it spins up with τ (§6.6).
 */
export function setFans(s, fans) {
  for (const fan of fans) if (fan.speed === undefined) fan.speed = 0;
  s.fans = fans;
  setCells(s);
}

function faceState(ka, kb) {
  if ((ka === FLUID && (kb === FLUID || kb === OUTLET)) || (kb === FLUID && ka === OUTLET)) return ACTIVE;
  if (ka === FLUID || kb === FLUID) return FIXED;
  return INACTIVE;
}

// Connected regions of FLUID cells (through ACTIVE faces). A region with no OUTLET is a closed
// room: its pressure equation is pure-Neumann, so its right-hand side must sum to zero.
function labelComponents(s) {
  const { nx, ny, kind, faceU, faceV, _comp: comp, _queue: queue } = s;
  comp.fill(-1);
  const hasD = [];
  let n = 0;
  for (let start = 0; start < nx * ny; start++) {
    if (kind[start] !== FLUID || comp[start] !== -1) continue;
    let head = 0, tail = 0, dirichlet = 0;
    queue[tail++] = start; comp[start] = n;
    while (head < tail) {
      const c = queue[head++];
      const i = c % nx, j = (c - i) / nx;
      // four neighbours: [neighbour cell, face state]
      const nb = [
        [i > 0 ? c - 1 : -1, faceU[i + j * (nx + 1)]],
        [i < nx - 1 ? c + 1 : -1, faceU[i + 1 + j * (nx + 1)]],
        [j > 0 ? c - nx : -1, faceV[i + j * nx]],
        [j < ny - 1 ? c + nx : -1, faceV[i + (j + 1) * nx]],
      ];
      for (const [d, st] of nb) {
        if (d < 0 || st !== ACTIVE) continue;
        if (kind[d] === OUTLET) { dirichlet = 1; continue; }
        if (comp[d] === -1) { comp[d] = n; queue[tail++] = d; }
      }
    }
    hasD.push(dirichlet);
    n++;
  }
  s._compDirichlet = Uint8Array.from(hasD);
  s._compSum = new Float64Array(n);
  s._compCount = new Float64Array(n);
  s._heat = new Float64Array(n);
  s._heatS = new Float64Array(n);
  s.zoneTargetT = new Float64Array(n).fill(NaN);
  s.ageRate = new Float64Array(n).fill(1);
}

/** Zone (connected fluid region) index of FLUID cell c, or −1. Valid until the next setCells. */
export function componentOf(s, c) {
  return s._comp[c];
}

// Pressure matrix for the scaled pressure p̂ = p·Δt/ρ (SCIENCE.md §6.2 step 5):
//   Σ_{active faces} (p̂_c − p̂_n) = −h · (net outward face flux of cell c)
function buildPressureMatrix(s) {
  const { nx, ny, kind, faceU, faceV, _pcg: ws } = s;
  ws.mask.fill(0); ws.Adiag.fill(0); ws.Ax.fill(0); ws.Ay.fill(0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (kind[c] !== FLUID) continue;
      ws.mask[c] = 1;
      const fW = faceU[i + j * (nx + 1)], fE = faceU[i + 1 + j * (nx + 1)];
      const fS = faceV[i + j * nx], fN = faceV[i + (j + 1) * nx];
      ws.Adiag[c] = (fW === ACTIVE) + (fE === ACTIVE) + (fS === ACTIVE) + (fN === ACTIVE);
      if (fE === ACTIVE && kind[c + 1] === FLUID) ws.Ax[c] = -1;
      if (fN === ACTIVE && kind[c + nx] === FLUID) ws.Ay[c] = -1;
    }
  }
  buildPreconditioner(ws);
}

// ---------------------------------------------------------------------------
// Boundary conditions — SCIENCE.md §6.4
// ---------------------------------------------------------------------------

/** Writes prescribed velocities into FIXED faces (walls, inlets, fans) and fills ghost values. */
export function applyBoundaryConditions(s) {
  const { nx, ny, kind, faceU, faceV, bu, bv, u, v, fanU, fanV, fans } = s;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const f = i + j * (nx + 1);
      if (faceU[f] !== FIXED) continue;
      if (fanU[f]) { const fan = fans[fanU[f] - 1]; u[f] = fan.speed * Math.cos(fan.angle); continue; }
      const left = i > 0 ? i - 1 + j * nx : -1, right = i < nx ? i + j * nx : -1;
      const wall = left >= 0 && kind[left] !== FLUID ? left : right;
      u[f] = wall >= 0 && kind[wall] !== FLUID ? bu[wall] : 0;
    }
  }
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      const f = i + j * nx;
      if (faceV[f] !== FIXED) continue;
      if (fanV[f]) { const fan = fans[fanV[f] - 1]; v[f] = fan.speed * Math.sin(fan.angle); continue; }
      const below = j > 0 ? i + (j - 1) * nx : -1, above = j < ny ? i + j * nx : -1;
      const wall = below >= 0 && kind[below] !== FLUID ? below : above;
      v[f] = wall >= 0 && kind[wall] !== FLUID ? bv[wall] : 0;
    }
  }
  fillGhostU(s, u);
  fillGhostV(s, v);
}

// Ghost values on INACTIVE u-faces:
//  - inside a wall next to a row of active faces: tangential wall condition
//      free-slip: ghost = neighbour (zero shear)   no-slip: ghost = 2·u_wall − neighbour
//    (at an OUTLET the ghost is always zero-gradient: ghost = neighbour)
//  - otherwise next to an active face in the normal direction (outlet interior): zero-gradient copy
function fillGhostU(s, u) {
  const { nx, ny, kind, faceU, bu, noSlip } = s;
  const W = nx + 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const f = i + j * W;
      if (faceU[f] !== INACTIVE) continue;
      const kL = i > 0 ? kind[i - 1 + j * nx] : SOLID, kR = i < nx ? kind[i + j * nx] : SOLID;
      const slip = !noSlip || kL === OUTLET || kR === OUTLET;
      const uw = 0.5 * ((i > 0 ? bu[i - 1 + j * nx] : 0) + (i < nx ? bu[i + j * nx] : 0));
      let sum = 0, n = 0;
      if (j > 0 && faceU[f - W] === ACTIVE) { sum += slip ? u[f - W] : 2 * uw - u[f - W]; n++; }
      if (j < ny - 1 && faceU[f + W] === ACTIVE) { sum += slip ? u[f + W] : 2 * uw - u[f + W]; n++; }
      if (n === 0) {
        if (i > 0 && faceU[f - 1] === ACTIVE) { sum += u[f - 1]; n++; }
        if (i < nx && faceU[f + 1] === ACTIVE) { sum += u[f + 1]; n++; }
      }
      u[f] = n > 0 ? sum / n : 0;
    }
  }
}

function fillGhostV(s, v) {
  const { nx, ny, kind, faceV, bv, noSlip } = s;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      const f = i + j * nx;
      if (faceV[f] !== INACTIVE) continue;
      const kB = j > 0 ? kind[i + (j - 1) * nx] : SOLID, kT = j < ny ? kind[i + j * nx] : SOLID;
      const slip = !noSlip || kB === OUTLET || kT === OUTLET;
      const vw = 0.5 * ((j > 0 ? bv[i + (j - 1) * nx] : 0) + (j < ny ? bv[i + j * nx] : 0));
      let sum = 0, n = 0;
      if (i > 0 && faceV[f - 1] === ACTIVE) { sum += slip ? v[f - 1] : 2 * vw - v[f - 1]; n++; }
      if (i < nx - 1 && faceV[f + 1] === ACTIVE) { sum += slip ? v[f + 1] : 2 * vw - v[f + 1]; n++; }
      if (n === 0) {
        if (j > 0 && faceV[f - nx] === ACTIVE) { sum += v[f - nx]; n++; }
        if (j < ny && faceV[f + nx] === ACTIVE) { sum += v[f + nx]; n++; }
      }
      v[f] = n > 0 ? sum / n : 0;
    }
  }
}

// Ghost values in non-fluid cells bordering fluid: INLET → inlet value (T_out or age 0);
// SOLID / OUTLET → mean of neighbouring fluid cells (zero-gradient: adiabatic wall / carried out).
// Cells touching fluid only diagonally (corners) take the mean of their diagonal fluid neighbours,
// so bilinear interpolation near a corner never reads a stale value.
function fillGhostScalar(s, a, inletValues) {
  const { nx, ny, kind } = s;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      const k = kind[c];
      if (k === FLUID) continue;
      if (k === INLET) { a[c] = inletValues ? inletValues[c] : 0; continue; }
      let sum = 0, n = 0;
      if (i > 0 && kind[c - 1] === FLUID) { sum += a[c - 1]; n++; }
      if (i < nx - 1 && kind[c + 1] === FLUID) { sum += a[c + 1]; n++; }
      if (j > 0 && kind[c - nx] === FLUID) { sum += a[c - nx]; n++; }
      if (j < ny - 1 && kind[c + nx] === FLUID) { sum += a[c + nx]; n++; }
      if (n === 0) {
        if (i > 0 && j > 0 && kind[c - 1 - nx] === FLUID) { sum += a[c - 1 - nx]; n++; }
        if (i < nx - 1 && j > 0 && kind[c + 1 - nx] === FLUID) { sum += a[c + 1 - nx]; n++; }
        if (i > 0 && j < ny - 1 && kind[c - 1 + nx] === FLUID) { sum += a[c - 1 + nx]; n++; }
        if (i < nx - 1 && j < ny - 1 && kind[c + 1 + nx] === FLUID) { sum += a[c + 1 + nx]; n++; }
      }
      if (n > 0) a[c] = sum / n;
    }
  }
}

// ---------------------------------------------------------------------------
// Interpolation and back-tracing
// ---------------------------------------------------------------------------

// Bilinear interpolation of a field on a W × H lattice at lattice coordinates (gx, gy), clamped.
function lerp2(f, W, H, gx, gy) {
  if (gx < 0) gx = 0; else if (gx > W - 1) gx = W - 1;
  if (gy < 0) gy = 0; else if (gy > H - 1) gy = H - 1;
  let i = gx | 0, j = gy | 0;
  if (i > W - 2) i = W - 2;
  if (j > H - 2) j = H - 2;
  const fx = gx - i, fy = gy - j, k = i + j * W;
  return (1 - fx) * ((1 - fy) * f[k] + fy * f[k + W]) + fx * ((1 - fy) * f[k + 1] + fy * f[k + W + 1]);
}

// Same, and also records the min/max of the four stencil values in MM (for BFECC clamping).
const MM = new Float64Array(2);
function lerp2mm(f, W, H, gx, gy) {
  if (gx < 0) gx = 0; else if (gx > W - 1) gx = W - 1;
  if (gy < 0) gy = 0; else if (gy > H - 1) gy = H - 1;
  let i = gx | 0, j = gy | 0;
  if (i > W - 2) i = W - 2;
  if (j > H - 2) j = H - 2;
  const fx = gx - i, fy = gy - j, k = i + j * W;
  const a = f[k], b = f[k + 1], c = f[k + W], d = f[k + W + 1];
  MM[0] = Math.min(a, b, c, d);
  MM[1] = Math.max(a, b, c, d);
  return (1 - fx) * ((1 - fy) * a + fy * c) + fx * ((1 - fy) * b + fy * d);
}

/** x-velocity at a point (m, m), bilinear on the staggered grid. */
export function sampleU(s, x, y, u = s.u) {
  return lerp2(u, s.nx + 1, s.ny, x / s.h, y / s.h - 0.5);
}

/** y-velocity at a point (m, m), bilinear on the staggered grid. */
export function sampleV(s, x, y, v = s.v) {
  return lerp2(v, s.nx, s.ny + 1, x / s.h - 0.5, y / s.h);
}

// RK2 (midpoint) trace from (x, y) over time dt through velocity (uVel, vVel); result in BT.
// dt > 0 traces backward in time (semi-Lagrangian); dt < 0 traces forward (BFECC reverse step).
const BT = new Float64Array(2);
function trace(s, x, y, dt, uVel, vVel) {
  const u1 = sampleU(s, x, y, uVel), v1 = sampleV(s, x, y, vVel);
  const xm = x - 0.5 * dt * u1, ym = y - 0.5 * dt * v1;
  const u2 = sampleU(s, xm, ym, uVel), v2 = sampleV(s, xm, ym, vVel);
  const Lx = s.nx * s.h, Ly = s.ny * s.h;
  let xb = x - dt * u2, yb = y - dt * v2;
  if (xb < 0) xb = 0; else if (xb > Lx) xb = Lx;
  if (yb < 0) yb = 0; else if (yb > Ly) yb = Ly;
  BT[0] = xb; BT[1] = yb;
}

// ---------------------------------------------------------------------------
// Advection — SCIENCE.md §6.2 step 2: BFECC / MacCormack with min-max clamping (Selle et al. 2008)
// ---------------------------------------------------------------------------

// One semi-Lagrangian pass over a field on a W × H lattice whose points sit at ((i+offX)h, (j+offY)h).
// Only points with mask[k] === activeVal are updated; the rest are copied. If mn/mx are given,
// the stencil min/max at each departure point is stored for clamping.
function semiLagrangian(s, src, dst, W, H, offX, offY, mask, activeVal, dt, uVel, vVel, mn, mx) {
  const h = s.h;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = i + j * W;
      if (mask[k] !== activeVal) { dst[k] = src[k]; continue; }
      trace(s, (i + offX) * h, (j + offY) * h, dt, uVel, vVel);
      const gx = BT[0] / h - offX, gy = BT[1] / h - offY;
      if (mn) {
        dst[k] = lerp2mm(src, W, H, gx, gy);
        mn[k] = MM[0]; mx[k] = MM[1];
      } else {
        dst[k] = lerp2(src, W, H, gx, gy);
      }
    }
  }
}

// BFECC: forward step, backward step, error-compensated result clamped to the forward stencil.
// `field` must have its ghost values filled on entry.
function advectBFECC(s, field, W, H, offX, offY, mask, activeVal, dt, uVel, vVel, fillGhost, fwd, back, mn, mx) {
  semiLagrangian(s, field, fwd, W, H, offX, offY, mask, activeVal, dt, uVel, vVel, mn, mx);
  fillGhost(fwd);
  semiLagrangian(s, fwd, back, W, H, offX, offY, mask, activeVal, -dt, uVel, vVel, null, null);
  for (let k = 0; k < W * H; k++) {
    if (mask[k] !== activeVal) continue;
    let val = fwd[k] + 0.5 * (field[k] - back[k]);
    if (val < mn[k]) val = mn[k]; else if (val > mx[k]) val = mx[k];
    field[k] = val;
  }
  fillGhost(field);
}

function advectVelocity(s, dt) {
  const { nx, ny } = s;
  s._u0.set(s.u); s._v0.set(s.v); // velocity at time n, used for all back-traces this step
  advectBFECC(s, s.u, nx + 1, ny, 0, 0.5, s.faceU, ACTIVE, dt, s._u0, s._v0, s._ghostU, s._uF, s._uB, s._uMin, s._uMax);
  advectBFECC(s, s.v, nx, ny + 1, 0.5, 0, s.faceV, ACTIVE, dt, s._u0, s._v0, s._ghostV, s._vF, s._vB, s._vMin, s._vMax);
}

function advectScalar(s, a, fillGhost, dt) {
  fillGhost(a);
  advectBFECC(s, a, s.nx, s.ny, 0.5, 0.5, s.kind, FLUID, dt, s.u, s.v, fillGhost, s._cF, s._cB, s._cMin, s._cMax);
}

// Heat-conservation correction for T — SCIENCE.md §6.2 step 6 (approved 2026-09-24).
// Semi-Lagrangian advection isn't exactly conservative, and the iterative diffusion solve is only
// conservative to its tolerance. Before advecting, record each zone's required total:
// Σ T_c + (Δt/Δ) · Σ_boundary faces u_in · T_upwind. After diffusing, add the heat conducted across
// inlet faces and shift the zone uniformly by δ so its total matches. The conducted heat uses the
// final temperatures (T_c + δ), so δ is solved for exactly:
//   Σ T_c + N·δ = H + Σ_inlet k·κ·(T_in − T_c − δ)  ⇒  δ = (H + Σ k·κ·(T_in − T_c) − Σ T_c) / (N + Σ k·κ)

// Inflow (m/s, positive into the fluid cell) times upwind temperature, for a face whose other
// side has kind kn. Only INLET/OUTLET faces carry heat across the zone boundary.
function boundaryHeatFlux(kn, Tinlet, Tcell, uin) {
  if (kn !== INLET && kn !== OUTLET) return 0;
  return uin * (uin > 0 && kn === INLET ? Tinlet : Tcell);
}

function recordHeatTargets(s, dt) {
  const { nx, ny, h, kind, u, v, T, TBC, _comp: comp, _heat: heat } = s;
  const W = nx + 1, k = dt / h;
  heat.fill(0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (kind[c] !== FLUID) continue;
      let flux = 0;
      if (i > 0) flux += boundaryHeatFlux(kind[c - 1], TBC[c - 1], T[c], u[i + j * W]);
      if (i < nx - 1) flux += boundaryHeatFlux(kind[c + 1], TBC[c + 1], T[c], -u[i + 1 + j * W]);
      if (j > 0) flux += boundaryHeatFlux(kind[c - nx], TBC[c - nx], T[c], v[c]);
      if (j < ny - 1) flux += boundaryHeatFlux(kind[c + nx], TBC[c + nx], T[c], -v[c + nx]);
      heat[comp[c]] += T[c] + k * flux;
    }
  }
}

function correctHeat(s, dt) {
  const { nx, ny, h, kind, T, TBC, kappaCell, _comp: comp, _heat: heat, _heatS: S, _compSum: actual, _compCount: count } = s;
  const k = dt / (h * h);
  actual.fill(0); count.fill(0); S.fill(0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (kind[c] !== FLUID) continue;
      const z = comp[c];
      actual[z] += T[c]; count[z] += 1;
      // heat conducted in from INLET neighbours during the implicit diffusion step
      for (let q = 0; q < 4; q++) {
        let n;
        if (q === 0) { if (i === 0) continue; n = c - 1; }
        else if (q === 1) { if (i === nx - 1) continue; n = c + 1; }
        else if (q === 2) { if (j === 0) continue; n = c - nx; }
        else { if (j === ny - 1) continue; n = c + nx; }
        if (kind[n] !== INLET) continue;
        const kk = k * 0.5 * (kappaCell[c] + kappaCell[n]);
        heat[z] += kk * (TBC[n] - T[c]);
        S[z] += kk;
      }
    }
  }
  for (let c = 0; c < T.length; c++) {
    if (kind[c] !== FLUID) continue;
    const z = comp[c];
    T[c] += (heat[z] - actual[z]) / (count[z] + S[z]);
  }
}

// ---------------------------------------------------------------------------
// Diffusion — SCIENCE.md §6.2 step 3: implicit (backward Euler), Gauss-Seidel to tolerance
// ---------------------------------------------------------------------------

// Solves (1 − Δt ∇·ν∇) u_new = u for ACTIVE u-faces.
// Normal-direction neighbours: FIXED faces are Dirichlet values, INACTIVE (outlet) are zero-gradient.
// Tangential neighbours in a wall: free-slip → zero flux; no-slip → ghost 2·u_wall − u.
function diffuseU(s, dt) {
  const { nx, ny, h, kind, faceU, nuCell, bu, noSlip, u } = s;
  const W = nx + 1, rhs = s._rhs, c0 = dt / (h * h);
  let maxAbs = 0;
  for (let f = 0; f < u.length; f++) { rhs[f] = u[f]; if (faceU[f] === ACTIVE) maxAbs = Math.max(maxAbs, Math.abs(u[f])); }
  const tol = DIFFUSION_REL_TOL * Math.max(maxAbs, 1e-12);
  let it = 0;
  for (; it < DIFFUSION_MAX_ITER; it++) {
    let maxDelta = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const f = i + j * W;
        if (faceU[f] !== ACTIVE) continue;
        const cL = i - 1 + j * nx, cR = i + j * nx;
        let diag = 1, acc = rhs[f];
        // x-neighbours: flux through the cell centres on either side
        let k = c0 * nuCell[cL];
        if (faceU[f - 1] !== INACTIVE) { diag += k; acc += k * u[f - 1]; }
        k = c0 * nuCell[cR];
        if (faceU[f + 1] !== INACTIVE) { diag += k; acc += k * u[f + 1]; }
        // y-neighbours: flux through the cell corners
        for (let d = -1; d <= 1; d += 2) {
          const jn = j + d;
          if (jn >= 0 && jn < ny) {
            const g = f + d * W;
            k = c0 * 0.25 * (nuCell[cL] + nuCell[cR] + nuCell[cL + d * nx] + nuCell[cR + d * nx]);
            if (faceU[g] !== INACTIVE) { diag += k; acc += k * u[g]; continue; }
            const kgL = kind[cL + d * nx], kgR = kind[cR + d * nx];
            if (noSlip && kgL !== OUTLET && kgR !== OUTLET) {
              const uw = 0.5 * (bu[cL + d * nx] + bu[cR + d * nx]);
              diag += 2 * k; acc += 2 * k * uw;
            }
          } else if (noSlip) {
            k = c0 * 0.5 * (nuCell[cL] + nuCell[cR]);
            diag += 2 * k; // domain edge: stationary wall
          }
        }
        const nw = acc / diag;
        const delta = Math.abs(nw - u[f]);
        if (delta > maxDelta) maxDelta = delta;
        u[f] = nw;
      }
    }
    if (maxDelta <= tol) break;
  }
  return it + 1;
}

function diffuseV(s, dt) {
  const { nx, ny, h, kind, faceV, nuCell, bv, noSlip, v } = s;
  const rhs = s._rhs, c0 = dt / (h * h);
  let maxAbs = 0;
  for (let f = 0; f < v.length; f++) { rhs[f] = v[f]; if (faceV[f] === ACTIVE) maxAbs = Math.max(maxAbs, Math.abs(v[f])); }
  const tol = DIFFUSION_REL_TOL * Math.max(maxAbs, 1e-12);
  let it = 0;
  for (; it < DIFFUSION_MAX_ITER; it++) {
    let maxDelta = 0;
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const f = i + j * nx;
        if (faceV[f] !== ACTIVE) continue;
        const cB = i + (j - 1) * nx, cT = i + j * nx;
        let diag = 1, acc = rhs[f];
        // y-neighbours: flux through the cell centres below and above
        let k = c0 * nuCell[cB];
        if (faceV[f - nx] !== INACTIVE) { diag += k; acc += k * v[f - nx]; }
        k = c0 * nuCell[cT];
        if (faceV[f + nx] !== INACTIVE) { diag += k; acc += k * v[f + nx]; }
        // x-neighbours: flux through the cell corners
        for (let d = -1; d <= 1; d += 2) {
          const inb = i + d;
          if (inb >= 0 && inb < nx) {
            const g = f + d;
            k = c0 * 0.25 * (nuCell[cB] + nuCell[cT] + nuCell[cB + d] + nuCell[cT + d]);
            if (faceV[g] !== INACTIVE) { diag += k; acc += k * v[g]; continue; }
            const kgB = kind[cB + d], kgT = kind[cT + d];
            if (noSlip && kgB !== OUTLET && kgT !== OUTLET) {
              const vw = 0.5 * (bv[cB + d] + bv[cT + d]);
              diag += 2 * k; acc += 2 * k * vw;
            }
          } else if (noSlip) {
            k = c0 * 0.5 * (nuCell[cB] + nuCell[cT]);
            diag += 2 * k;
          }
        }
        const nw = acc / diag;
        const delta = Math.abs(nw - v[f]);
        if (delta > maxDelta) maxDelta = delta;
        v[f] = nw;
      }
    }
    if (maxDelta <= tol) break;
  }
  return it + 1;
}

// Solves (1 − Δt ∇·κ∇) a_new = a on FLUID cells. INLET neighbours are Dirichlet (inlet value);
// SOLID and OUTLET neighbours are zero-flux (adiabatic wall / zero-gradient outlet).
function diffuseScalar(s, a, inletValues, dt) {
  const { nx, ny, h, kind, kappaCell } = s;
  const rhs = s._rhs, c0 = dt / (h * h);
  let maxAbs = 0;
  for (let c = 0; c < a.length; c++) { rhs[c] = a[c]; if (kind[c] === FLUID) maxAbs = Math.max(maxAbs, Math.abs(a[c])); }
  const tol = DIFFUSION_REL_TOL * Math.max(maxAbs, 1e-12);
  let it = 0;
  for (; it < DIFFUSION_MAX_ITER; it++) {
    let maxDelta = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = i + j * nx;
        if (kind[c] !== FLUID) continue;
        let diag = 1, acc = rhs[c];
        for (let q = 0; q < 4; q++) {
          let n;
          if (q === 0) { if (i === 0) continue; n = c - 1; }
          else if (q === 1) { if (i === nx - 1) continue; n = c + 1; }
          else if (q === 2) { if (j === 0) continue; n = c - nx; }
          else { if (j === ny - 1) continue; n = c + nx; }
          const kn = kind[n];
          if (kn !== FLUID && kn !== INLET) continue;
          const k = c0 * 0.5 * (kappaCell[c] + kappaCell[n]);
          diag += k;
          acc += k * (kn === FLUID ? a[n] : (inletValues ? inletValues[n] : 0));
        }
        const nw = acc / diag;
        const delta = Math.abs(nw - a[c]);
        if (delta > maxDelta) maxDelta = delta;
        a[c] = nw;
      }
    }
    if (maxDelta <= tol) break;
  }
  return it + 1;
}

// ---------------------------------------------------------------------------
// Projection — SCIENCE.md §6.2 step 5
// Solve ∇²p = (ρ/Δt) ∇·u*, then u = u* − (Δt/ρ) ∇p, with PCG.
// Works with p̂ = p·Δt/ρ so the matrix is the plain Laplacian.
// ---------------------------------------------------------------------------

function project(s, dt) {
  const { nx, ny, h, kind, faceU, faceV, u, v, p, pBC, _pHat: pHat, _b: b, _pcg: ws } = s;
  const scale = dt / s.rho;
  const W = nx + 1;
  const comp = s._comp, compSum = s._compSum, compCount = s._compCount, compD = s._compDirichlet;
  compSum.fill(0); compCount.fill(0);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (kind[c] !== FLUID) { pHat[c] = 0; b[c] = 0; continue; }
      pHat[c] = p[c] * scale; // warm start from the last step's pressure
      const fW = i + j * W, fE = fW + 1, fS = i + j * nx, fN = fS + nx;
      let rhs = -h * (u[fE] - u[fW] + v[fN] - v[fS]);
      // Dirichlet (OUTLET) neighbours move to the right-hand side
      if (faceU[fW] === ACTIVE && kind[c - 1] === OUTLET) rhs += pBC[c - 1] * scale;
      if (faceU[fE] === ACTIVE && kind[c + 1] === OUTLET) rhs += pBC[c + 1] * scale;
      if (faceV[fS] === ACTIVE && kind[c - nx] === OUTLET) rhs += pBC[c - nx] * scale;
      if (faceV[fN] === ACTIVE && kind[c + nx] === OUTLET) rhs += pBC[c + nx] * scale;
      b[c] = rhs;
      compSum[comp[c]] += rhs; compCount[comp[c]] += 1;
    }
  }
  // Closed regions: remove the mean so the pure-Neumann system is consistent.
  for (let c = 0; c < nx * ny; c++) {
    if (kind[c] !== FLUID) continue;
    const k = comp[c];
    if (!compD[k]) b[c] -= compSum[k] / compCount[k];
  }

  // After the update, max|∇·u| = max|residual| / h². PCG_TOL_FRACTION leaves margin below the target.
  const tol = PCG_TOL_FRACTION * DIVERGENCE_TOL * h * h;
  const res = solvePCG(ws, pHat, b, tol, PCG_MAX_ITER);
  s.stats.pcgIterations = res.iterations;
  s.stats.pcgResidualDiv = res.residual / (h * h);
  s.stats.pcgConverged = res.converged;

  // Pressure on an active face's two sides: unknown p̂ for FLUID, Dirichlet value for OUTLET.
  for (let j = 0; j < ny; j++) {
    for (let i = 1; i < nx; i++) {
      const f = i + j * W;
      if (faceU[f] !== ACTIVE) continue;
      const cL = i - 1 + j * nx, cR = cL + 1;
      const pL = kind[cL] === FLUID ? pHat[cL] : pBC[cL] * scale;
      const pR = kind[cR] === FLUID ? pHat[cR] : pBC[cR] * scale;
      u[f] -= (pR - pL) / h;
    }
  }
  for (let j = 1; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const f = i + j * nx;
      if (faceV[f] !== ACTIVE) continue;
      const cB = i + (j - 1) * nx, cT = cB + nx;
      const pB = kind[cB] === FLUID ? pHat[cB] : pBC[cB] * scale;
      const pT = kind[cT] === FLUID ? pHat[cT] : pBC[cT] * scale;
      v[f] -= (pT - pB) / h;
    }
  }
  for (let c = 0; c < nx * ny; c++) p[c] = kind[c] === FLUID ? pHat[c] / scale : 0;
  fillGhostU(s, u);
  fillGhostV(s, v);
}

// ---------------------------------------------------------------------------
// Scalars: age source and two-way exchange — SCIENCE.md §6.1, §6.4, §5.7
// ---------------------------------------------------------------------------

/**
 * Sets the two-way exchange bands (SCIENCE.md §6.4).
 * @param bands [{ cells: Int32Array (FLUID cell indices, 2-cell band inside the opening),
 *                 Qexchange: m³/s, T: outdoor temperature K }]
 * Rate = Q_exchange / V_band with V_band = (band cells) · h² · ceiling height.
 */
export function setExchangeBands(s, bands) {
  s.exchange = bands.map((b) => ({
    cells: b.cells,
    rate: b.Qexchange / (b.cells.length * s.h * s.h * s.ceilingHeight),
    T: b.T,
  }));
}

function applyScalarSources(s, dt) {
  const { kind, T, A, ageRate, _comp: comp } = s;
  // SCIENCE.md §6.2 step 6: age source, +Δt in every fluid cell (+r_z·Δt when coupled, §6.7)
  for (let c = 0; c < A.length; c++) if (kind[c] === FLUID) A[c] += ageRate[comp[c]] * dt;
  // SCIENCE.md §6.4 / §5.7 two-way exchange (documented heuristic): relax toward outdoor air
  for (const band of s.exchange) {
    const f = 1 - Math.exp(-band.rate * dt);
    for (let n = 0; n < band.cells.length; n++) {
      const c = band.cells[n];
      T[c] += (band.T - T[c]) * f;
      A[c] -= A[c] * f;
    }
  }
}

// SCIENCE.md §6.7: zones with a target mean temperature are shifted uniformly to it.
function anchorZoneTemperatures(s) {
  const { kind, T, zoneTargetT: target, _comp: comp, _compSum: sum, _compCount: count } = s;
  let any = false;
  for (let z = 0; z < target.length; z++) if (!Number.isNaN(target[z])) { any = true; break; }
  if (!any) return;
  sum.fill(0); count.fill(0);
  for (let c = 0; c < T.length; c++) if (kind[c] === FLUID) { sum[comp[c]] += T[c]; count[comp[c]] += 1; }
  for (let c = 0; c < T.length; c++) {
    if (kind[c] !== FLUID) continue;
    const z = comp[c];
    if (!Number.isNaN(target[z])) T[c] += target[z] - sum[z] / count[z];
  }
}

// ---------------------------------------------------------------------------
// Time step — SCIENCE.md §6.2
// ---------------------------------------------------------------------------

/** SCIENCE.md §6.2: Δt = min(CFL · Δ / max|u|, Δt_max). */
export function computeDt(s) {
  let m = 0;
  const { u, v, faceU, faceV, bu, bv, kind } = s;
  for (let f = 0; f < u.length; f++) if (faceU[f] !== INACTIVE) m = Math.max(m, Math.abs(u[f]));
  for (let f = 0; f < v.length; f++) if (faceV[f] !== INACTIVE) m = Math.max(m, Math.abs(v[f]));
  for (let c = 0; c < kind.length; c++) if (kind[c] !== FLUID) m = Math.max(m, Math.abs(bu[c]), Math.abs(bv[c]));
  return m > 0 ? Math.min((CFL * s.h) / m, DT_MAX) : DT_MAX;
}

/** Advances the flow by dt seconds. SCIENCE.md §6.2. */
export function step(s, dt) {
  updateFanSpeeds(s, dt);                     // 1. fan spin-up (§6.6) and boundary conditions
  applyBoundaryConditions(s);
  updateEddyViscosity(s);                     //    ν_t from the current velocity (§6.5)
  if (s.mixingFloor) applyMixingFloor(s);     //    scalar mixing floor (§6.5)
  advectVelocity(s, dt);                      // 2. BFECC advection of u
  const d1 = diffuseU(s, dt);                 // 3. implicit diffusion with ν + ν_t
  const d2 = diffuseV(s, dt);
  applyDrag(s, dt);                           // 4. floor/ceiling drag (§6.5)
  project(s, dt);                             // 5. pressure projection (PCG)
  recordHeatTargets(s, dt);                   // 6. scalars with the projected velocity
  advectScalar(s, s.T, s._ghostT, dt);
  advectScalar(s, s.A, s._ghostA, dt);
  const d3 = diffuseScalar(s, s.T, s.TBC, dt);
  const d4 = diffuseScalar(s, s.A, null, dt);
  correctHeat(s, dt);                         //    heat-conservation correction (§6.2)
  applyScalarSources(s, dt);
  anchorZoneTemperatures(s);                  //    zone-mean T from Layer A's heat balance (§6.7)
  s.stats.diffusionSweeps = Math.max(d1, d2, d3, d4);
  s.time += dt;
}

// ---------------------------------------------------------------------------
// Diagnostics (used by tests and, later, the metrics panel)
// ---------------------------------------------------------------------------

/** max |∇·u| over FLUID cells, 1/s. */
export function maxDivergence(s) {
  const { nx, ny, h, kind, u, v } = s;
  let m = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (kind[c] !== FLUID) continue;
      const d = Math.abs(u[i + 1 + j * (nx + 1)] - u[i + j * (nx + 1)] + v[c + nx] - v[c]) / h;
      if (d > m) m = d;
    }
  }
  return m;
}

/** Kinetic energy per unit depth and density, ½ Σ |u|² h² over non-inactive faces, m⁴/s². */
export function kineticEnergy(s) {
  const { u, v, faceU, faceV, h } = s;
  let e = 0;
  for (let f = 0; f < u.length; f++) if (faceU[f] !== INACTIVE) e += u[f] * u[f];
  for (let f = 0; f < v.length; f++) if (faceV[f] !== INACTIVE) e += v[f] * v[f];
  return 0.5 * e * h * h;
}

/** Mean of a cell field over FLUID cells. */
export function fluidMean(s, a) {
  let sum = 0, n = 0;
  for (let c = 0; c < a.length; c++) if (s.kind[c] === FLUID) { sum += a[c]; n++; }
  return n ? sum / n : 0;
}
