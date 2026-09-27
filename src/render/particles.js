// Wispy particle trails (pathlines), coloured by local temperature. SCIENCE.md §7.1.
//  - Particles seeded uniformly over fluid cells, each living 3–8 s of sim time, then respawned at
//    a random fluid cell, or (in proportion to Q_j) just inside an inlet opening.
//  - Moved with RK2 (midpoint) through the bilinear staggered velocity, in sub-steps of at most
//    half a cell so they don't jump walls.
//  - Drawn as fading trails: each frame the trail layer fades a little and every particle adds a
//    short segment. This gives the same look as drawing each particle's last ~20 positions, far cheaper.
// Positions are in solver coordinates (metres from the grid origin).

import { sampleU, sampleV, CELL } from '../physics/fluid.js';

const LIFE_MIN = 3, LIFE_MAX = 8;   // s of sim time (SCIENCE.md §7.1)
const INLET_SHARE = 0.3;            // share of respawns placed at inlets when there is inflow
const FADE = 0.1;                   // fraction of the trail layer's opacity removed per frame
const COLOR_STEPS = 21;             // temperature colour buckets (odd, so the midpoint is exact)

export function createParticles(count) {
  const p = {
    count,
    x: new Float32Array(count), y: new Float32Array(count),
    px: new Float32Array(count), py: new Float32Array(count),   // position at the last draw
    age: new Float32Array(count), life: new Float32Array(count),
    fresh: new Uint8Array(count),                               // 1 = just respawned, don't draw a segment
    fluidCells: null, sim: null,
    layer: document.createElement('canvas'),
    buckets: Array.from({ length: COLOR_STEPS }, () => []),
  };
  return p;
}

function randomFluidPoint(p, k) {
  const { grid } = p.sim;
  const c = p.fluidCells[(Math.random() * p.fluidCells.length) | 0];
  const i = c % grid.nx, j = (c - i) / grid.nx;
  p.x[k] = (i + Math.random()) * grid.h;
  p.y[k] = (j + Math.random()) * grid.h;
}

const INWARD = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };

// Respawn particle k: at an inlet (weighted by flow) with probability INLET_SHARE, else anywhere.
function respawn(p, k, inlets, inletTotal) {
  const { grid } = p.sim;
  if (inletTotal > 0 && Math.random() < INLET_SHARE) {
    let r = Math.random() * inletTotal, o = inlets[0];
    for (const it of inlets) { r -= it.q; if (r <= 0) { o = it; break; } }
    const c = o.cells[(Math.random() * o.cells.length) | 0];
    const [di, dj] = INWARD[o.normal];
    const i = c % grid.nx + di, j = (c - (c % grid.nx)) / grid.nx + dj;   // first indoor cell
    p.x[k] = (i + Math.random()) * grid.h;
    p.y[k] = (j + Math.random()) * grid.h;
  } else {
    randomFluidPoint(p, k);
  }
  p.age[k] = 0;
  p.life[k] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
  p.fresh[k] = 1;
}

/** Seeds all particles for a (new) simulation and clears the trails. */
export function resetParticles(p, sim) {
  p.sim = sim;
  const cells = [];
  for (let c = 0; c < sim.fluid.kind.length; c++) if (sim.fluid.kind[c] === CELL.FLUID) cells.push(c);
  p.fluidCells = Int32Array.from(cells);
  for (let k = 0; k < p.count; k++) {
    randomFluidPoint(p, k);
    p.age[k] = Math.random() * LIFE_MAX;       // stagger lifetimes so they don't all respawn together
    p.life[k] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    p.fresh[k] = 1;
  }
  clearTrails(p);
}

export function clearTrails(p) {
  const ctx = p.layer.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, p.layer.width, p.layer.height);
}

/** Advances every particle by simDt seconds of sim time through the current velocity field. */
export function updateParticles(p, simDt) {
  const sim = p.sim;
  if (!sim || simDt <= 0 || p.fluidCells.length === 0) return;
  const s = sim.fluid, { nx, ny, h } = sim.grid;
  const inlets = sim.openings.filter((o) => o.role === 'inlet').map((o) => ({ ...o, q: o.result.Q }));
  const inletTotal = inlets.reduce((a, o) => a + o.q, 0);
  // Sub-steps: at most half a cell per step at the fastest face speed.
  let vmax = 1e-6;
  for (let f = 0; f < s.u.length; f++) { const a = Math.abs(s.u[f]); if (a > vmax) vmax = a; }
  for (let f = 0; f < s.v.length; f++) { const a = Math.abs(s.v[f]); if (a > vmax) vmax = a; }
  const n = Math.min(20, Math.max(1, Math.ceil((vmax * simDt) / (0.5 * h))));
  const dt = simDt / n;
  for (let k = 0; k < p.count; k++) {
    let x = p.x[k], y = p.y[k], alive = true;
    for (let m = 0; m < n && alive; m++) {
      const u1 = sampleU(s, x, y), v1 = sampleV(s, x, y);
      const xm = x + 0.5 * dt * u1, ym = y + 0.5 * dt * v1;
      x += dt * sampleU(s, xm, ym);
      y += dt * sampleV(s, xm, ym);
      const i = Math.floor(x / h), j = Math.floor(y / h);
      if (i < 0 || j < 0 || i >= nx || j >= ny || s.kind[i + j * nx] !== CELL.FLUID) alive = false; // left the room
    }
    p.age[k] += simDt;
    if (!alive || p.age[k] > p.life[k]) respawn(p, k, inlets, inletTotal);
    else { p.x[k] = x; p.y[k] = y; }
  }
}

/**
 * Fades the trail layer and draws this frame's segments into it.
 * @param view        { toScreen(x, y) in layout coordinates, scale }
 * @param palette     COLOR_STEPS CSS colours
 * @param tempBucket  (T in K) → palette index 0..COLOR_STEPS−1
 * @param width, height  canvas size in CSS pixels; dpr = device pixel ratio
 */
export function drawTrails(p, view, palette, tempBucket, width, height, dpr) {
  const layer = p.layer, sim = p.sim;
  if (layer.width !== Math.round(width * dpr) || layer.height !== Math.round(height * dpr)) {
    layer.width = Math.round(width * dpr); layer.height = Math.round(height * dpr);
    for (let k = 0; k < p.count; k++) p.fresh[k] = 1;
  }
  const ctx = layer.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0,0,0,${FADE})`;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  if (!sim) return;

  const { h, nx, x0, y0 } = sim.grid, T = sim.fluid.T;
  for (const b of p.buckets) b.length = 0;
  for (let k = 0; k < p.count; k++) {
    const [sx, sy] = view.toScreen(x0 + p.x[k], y0 + p.y[k]);
    if (!p.fresh[k]) {
      const c = Math.floor(p.x[k] / h) + Math.floor(p.y[k] / h) * nx;
      p.buckets[tempBucket(T[c])].push(p.px[k], p.py[k], sx, sy);
    }
    p.px[k] = sx; p.py[k] = sy; p.fresh[k] = 0;
  }
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  p.buckets.forEach((seg, b) => {
    if (!seg.length) return;
    ctx.strokeStyle = palette[b];
    ctx.beginPath();
    for (let q = 0; q < seg.length; q += 4) { ctx.moveTo(seg[q], seg[q + 1]); ctx.lineTo(seg[q + 2], seg[q + 3]); }
    ctx.stroke();
  });
}

/** Composites the trail layer onto the main canvas (CSS-pixel transform in place). */
export function compositeTrails(p, ctx, width, height) {
  if (p.layer.width) ctx.drawImage(p.layer, 0, 0, width, height);
}

export { COLOR_STEPS };
