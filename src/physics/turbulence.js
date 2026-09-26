// Turbulence and drag for Layer B. SCIENCE.md §6.5.
//  - Smagorinsky eddy viscosity (Smagorinsky 1963): ν_t = (C_s·Δ)²·|S|, clamped to NU_T_MAX
//  - Floor/ceiling drag for depth-averaged flow: f_drag = (c_f / H_room)·|u|·u
// Operates on a fluid.js state; SI units, no DOM, allocation-free.

import { NU_T_MAX, PR_T, MIXING_FLOOR_SLOPE, MIXING_FLOOR_INTERCEPT } from '../constants.js';
import { CELL, FACE } from './cells.js';

const { FLUID, INLET, OUTLET } = CELL;
const { ACTIVE } = FACE;

// ∂u/∂y + ∂v/∂x at grid corner (a, b), i.e. the point (a·h, b·h). Indices are clamped at the
// domain edge (zero derivative there). Interior walls are handled by the ghost values in u and v.
function shearAtCorner(u, v, nx, ny, h, a, b) {
  const W = nx + 1;
  const bu0 = b > 0 ? b - 1 : 0, bu1 = b < ny ? b : ny - 1;       // u rows below/above the corner
  const av0 = a > 0 ? a - 1 : 0, av1 = a < nx ? a : nx - 1;       // v columns left/right of the corner
  const dudy = (u[a + bu1 * W] - u[a + bu0 * W]) / h;
  const dvdx = (v[av1 + b * nx] - v[av0 + b * nx]) / h;
  return dudy + dvdx;
}

/**
 * SCIENCE.md §6.5: fills s.nuCell = ν + ν_t and s.kappaCell = α + ν_t/Pr_t on FLUID cells.
 * With s.Cs = 0 the molecular values are used everywhere (turbulence off).
 */
export function updateEddyViscosity(s) {
  const { nx, ny, h, kind, u, v, nuCell, kappaCell, nuBase, alphaBase, Cs } = s;
  const W = nx + 1;
  const l2 = (Cs * h) * (Cs * h);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (kind[c] !== FLUID || Cs === 0) { nuCell[c] = nuBase; kappaCell[c] = alphaBase; continue; }
      const S11 = (u[i + 1 + j * W] - u[i + j * W]) / h;
      const S22 = (v[c + nx] - v[c]) / h;
      // S12 at the cell centre: mean of the four corner values of ½(∂u/∂y + ∂v/∂x)
      const S12 = 0.125 * (
        shearAtCorner(u, v, nx, ny, h, i, j) + shearAtCorner(u, v, nx, ny, h, i + 1, j) +
        shearAtCorner(u, v, nx, ny, h, i, j + 1) + shearAtCorner(u, v, nx, ny, h, i + 1, j + 1));
      const Smag = Math.sqrt(2 * (S11 * S11 + S22 * S22 + 2 * S12 * S12)); // |S| = sqrt(2 S_ij S_ij)
      let nuT = l2 * Smag;
      if (nuT > NU_T_MAX) nuT = NU_T_MAX;
      nuCell[c] = nuBase + nuT;
      kappaCell[c] = alphaBase + nuT / PR_T;
    }
  }
}

// Inflow (m²/s per unit depth) through a face whose other side has kind kn; uin > 0 is into the zone.
function inflowThrough(kn, uin, h) {
  return (kn === INLET || kn === OUTLET) && uin > 0 ? uin * h : 0;
}

/**
 * SCIENCE.md §6.5 scalar mixing floor (Cheng et al. 2011), per zone:
 *   ACH = 3600 · (inflow per unit depth) / (floor area),  L = (floor area · H_room)^(1/3)
 *   K_min = (slope · ACH + intercept) · L² / 3600;   κ ← max(κ, K_min) on FLUID cells
 * Uses the zone labels from fluid.js. Call after updateEddyViscosity.
 */
export function applyMixingFloor(s) {
  const { nx, ny, h, kind, u, v, kappaCell, ceilingHeight, _comp: comp } = s;
  const inflow = s._compSum, count = s._compCount; // per-zone scratch, free at this point
  const W = nx + 1;
  inflow.fill(0); count.fill(0);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (kind[c] !== FLUID) continue;
      const z = comp[c];
      count[z] += 1;
      if (i > 0) inflow[z] += inflowThrough(kind[c - 1], u[i + j * W], h);
      if (i < nx - 1) inflow[z] += inflowThrough(kind[c + 1], -u[i + 1 + j * W], h);
      if (j > 0) inflow[z] += inflowThrough(kind[c - nx], v[c], h);
      if (j < ny - 1) inflow[z] += inflowThrough(kind[c + nx], -v[c + nx], h);
    }
  }
  // Convert each zone's inflow into K_min (stored back into `inflow`).
  for (let z = 0; z < inflow.length; z++) {
    if (count[z] === 0) continue;
    const area = count[z] * h * h;
    const ach = (3600 * inflow[z]) / area;
    const L = Math.cbrt(area * ceilingHeight);
    inflow[z] = ((MIXING_FLOOR_SLOPE * ach + MIXING_FLOOR_INTERCEPT) * L * L) / 3600;
  }
  for (let c = 0; c < kind.length; c++) {
    if (kind[c] !== FLUID) continue;
    const kMin = inflow[comp[c]];
    if (kappaCell[c] < kMin) kappaCell[c] = kMin;
  }
}

/**
 * SCIENCE.md §6.5 floor/ceiling drag, applied as step 4 of §6.2.
 * Integrated implicitly (linearised in |u|): u ← u / (1 + Δt·c_f·|u| / H_room), which can only
 * slow the flow and is stable for any Δt. |u| on a face uses the other component averaged from
 * the four surrounding faces. With s.cf = 0 this does nothing.
 */
export function applyDrag(s, dt) {
  const { nx, ny, u, v, faceU, faceV, cf, ceilingHeight } = s;
  if (cf === 0) return;
  const k = (dt * cf) / ceilingHeight;
  const W = nx + 1;
  const uNew = s._uF, vNew = s._vF; // scratch, free at this point in the step
  for (let j = 0; j < ny; j++) {
    for (let i = 1; i < nx; i++) {
      const f = i + j * W;
      if (faceU[f] !== ACTIVE) continue;
      const vb = 0.25 * (v[i - 1 + j * nx] + v[i + j * nx] + v[i - 1 + (j + 1) * nx] + v[i + (j + 1) * nx]);
      uNew[f] = u[f] / (1 + k * Math.sqrt(u[f] * u[f] + vb * vb));
    }
  }
  for (let j = 1; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const f = i + j * nx;
      if (faceV[f] !== ACTIVE) continue;
      const ub = 0.25 * (u[i + (j - 1) * W] + u[i + 1 + (j - 1) * W] + u[i + j * W] + u[i + 1 + j * W]);
      vNew[f] = v[f] / (1 + k * Math.sqrt(v[f] * v[f] + ub * ub));
    }
  }
  for (let f = 0; f < u.length; f++) if (faceU[f] === ACTIVE) u[f] = uNew[f];
  for (let f = 0; f < v.length; f++) if (faceV[f] === ACTIVE) v[f] = vNew[f];
}
