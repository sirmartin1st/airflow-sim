// Shared setup for Layer B tests: builds rectangular rooms on the solver grid.
import { createFluid, setCells, CELL } from '../src/physics/fluid.js';

/**
 * A rectangle of FLUID cells (fx × fy) surrounded by a one-cell SOLID ring.
 * Returns the solver state; fluid cell (a, b) is grid cell (a + 1, b + 1).
 * `edit(s)` may change s.kind / s.bu / s.pBC etc. before setCells runs.
 */
export function makeBox(fx, fy, opts = {}, edit = null) {
  const nx = fx + 2, ny = fy + 2;
  const s = createFluid({ nx, ny, ...opts });
  for (let j = 1; j <= fy; j++) for (let i = 1; i <= fx; i++) s.kind[i + j * nx] = CELL.FLUID;
  if (edit) edit(s);
  setCells(s);
  return s;
}
