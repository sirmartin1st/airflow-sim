// Preconditioned conjugate gradient for the pressure Poisson equation. SCIENCE.md §6.2 step 5.
// The matrix is the standard 5-point Laplacian on the fluid cells of an nx × ny grid,
// stored the way Bridson (2015, ch. 5) does it:
//   Adiag[c] — diagonal entry of cell c
//   Ax[c]    — coupling between c and its +x neighbour (c + 1)
//   Ay[c]    — coupling between c and its +y neighbour (c + nx)
// Cells with mask[c] = 0 are not unknowns. Preconditioner: modified incomplete Cholesky, MIC(0).
// Everything is Float64 and allocated once; solve() allocates nothing.

import { MIC_TAU, MIC_SIGMA } from '../constants.js';

export function createPCG(nx, ny) {
  const n = nx * ny;
  return {
    nx, ny,
    mask: new Uint8Array(n),
    Adiag: new Float64Array(n),
    Ax: new Float64Array(n),
    Ay: new Float64Array(n),
    precon: new Float64Array(n),
    r: new Float64Array(n),
    z: new Float64Array(n),
    s: new Float64Array(n),
    q: new Float64Array(n),
  };
}

/** Builds the MIC(0) preconditioner. Call after the matrix changes. Bridson (2015) §5.2. */
export function buildPreconditioner(ws) {
  const { nx, ny, mask, Adiag, Ax, Ay, precon } = ws;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (!mask[c]) { precon[c] = 0; continue; }
      let e = Adiag[c];
      if (i > 0 && mask[c - 1]) {
        const a = Ax[c - 1] * precon[c - 1];
        e -= a * a + MIC_TAU * Ax[c - 1] * Ay[c - 1] * precon[c - 1] * precon[c - 1];
      }
      if (j > 0 && mask[c - nx]) {
        const a = Ay[c - nx] * precon[c - nx];
        e -= a * a + MIC_TAU * Ay[c - nx] * Ax[c - nx] * precon[c - nx] * precon[c - nx];
      }
      if (e < MIC_SIGMA * Adiag[c]) e = Adiag[c]; // safety for (near-)singular pivots
      precon[c] = 1 / Math.sqrt(e);
    }
  }
}

function applyA(ws, x, out) {
  const { nx, ny, mask, Adiag, Ax, Ay } = ws;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (!mask[c]) { out[c] = 0; continue; }
      let v = Adiag[c] * x[c];
      if (Ax[c] !== 0) v += Ax[c] * x[c + 1];
      if (i > 0 && Ax[c - 1] !== 0) v += Ax[c - 1] * x[c - 1];
      if (Ay[c] !== 0) v += Ay[c] * x[c + nx];
      if (j > 0 && Ay[c - nx] !== 0) v += Ay[c - nx] * x[c - nx];
      out[c] = v;
    }
  }
}

function applyPreconditioner(ws, r, z) {
  const { nx, ny, mask, Ax, Ay, precon, q } = ws;
  // Solve L q = r
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i + j * nx;
      if (!mask[c]) { q[c] = 0; continue; }
      let t = r[c];
      if (i > 0 && mask[c - 1]) t -= Ax[c - 1] * precon[c - 1] * q[c - 1];
      if (j > 0 && mask[c - nx]) t -= Ay[c - nx] * precon[c - nx] * q[c - nx];
      q[c] = t * precon[c];
    }
  }
  // Solve Lᵀ z = q
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const c = i + j * nx;
      if (!mask[c]) { z[c] = 0; continue; }
      let t = q[c];
      if (i < nx - 1 && mask[c + 1]) t -= Ax[c] * precon[c] * z[c + 1];
      if (j < ny - 1 && mask[c + nx]) t -= Ay[c] * precon[c] * z[c + nx];
      z[c] = t * precon[c];
    }
  }
}

function dot(mask, a, b) {
  let s = 0;
  for (let c = 0; c < a.length; c++) if (mask[c]) s += a[c] * b[c];
  return s;
}

function maxAbs(mask, a) {
  let m = 0;
  for (let c = 0; c < a.length; c++) if (mask[c]) { const v = Math.abs(a[c]); if (v > m) m = v; }
  return m;
}

/**
 * Solves A x = b in place (x holds the initial guess on entry, the solution on exit).
 * Stops when max|b − A x| ≤ tol.
 * @returns { iterations, residual (max-norm), converged }
 */
export function solvePCG(ws, x, b, tol, maxIter) {
  const { mask, r, z, s, q } = ws;
  applyA(ws, x, q);
  for (let c = 0; c < r.length; c++) r[c] = mask[c] ? b[c] - q[c] : 0;
  let res = maxAbs(mask, r);
  if (res <= tol) return { iterations: 0, residual: res, converged: true };

  applyPreconditioner(ws, r, z);
  s.set(z);
  let sigma = dot(mask, z, r);
  for (let it = 1; it <= maxIter; it++) {
    applyA(ws, s, z); // z temporarily holds A s
    const alpha = sigma / dot(mask, s, z);
    for (let c = 0; c < x.length; c++) {
      if (!mask[c]) continue;
      x[c] += alpha * s[c];
      r[c] -= alpha * z[c];
    }
    res = maxAbs(mask, r);
    if (res <= tol) return { iterations: it, residual: res, converged: true };
    applyPreconditioner(ws, r, z);
    const sigmaNew = dot(mask, z, r);
    const beta = sigmaNew / sigma;
    for (let c = 0; c < s.length; c++) if (mask[c]) s[c] = z[c] + beta * s[c];
    sigma = sigmaNew;
  }
  return { iterations: maxIter, residual: res, converged: false };
}
