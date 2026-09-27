// Arrow glyphs for the simulation view. SCIENCE.md §7.2.
//  - velocity arrows on a coarse lattice (every ~0.5 m); direction = local velocity, length ∝ speed
//    (capped), hidden below ARROW_MIN_SPEED
//  - per-opening flow arrows and CFM labels from Layer A (the authoritative flows, §6.4)

import { ARROW_MIN_SPEED } from '../constants.js';
import { sampleU, sampleV, CELL } from '../physics/fluid.js';
import { m3sToCfm } from '../units.js';

const LATTICE = 0.5;          // m between arrows
const FULL_LENGTH_SPEED = 0.5; // m/s at which an arrow reaches the full lattice spacing (display only)

/**
 * @param ctx      canvas 2D context (CSS-pixel transform already applied)
 * @param sim      simulation (physics/coupling.js)
 * @param view     { toScreen(x, y) → [px, py] in layout coordinates, scale px/m }
 * @param color    CSS colour
 */
export function drawVelocityArrows(ctx, sim, view, color) {
  const { fluid: s, grid } = sim;
  const step = Math.max(1, Math.round(LATTICE / grid.h));
  const maxLen = LATTICE * view.scale * 0.9;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.25;
  for (let j = Math.floor(step / 2); j < grid.ny; j += step) {
    for (let i = Math.floor(step / 2); i < grid.nx; i += step) {
      if (s.kind[i + j * grid.nx] !== CELL.FLUID) continue;
      const x = (i + 0.5) * grid.h, y = (j + 0.5) * grid.h;       // solver coordinates
      const u = sampleU(s, x, y), v = sampleV(s, x, y);
      const speed = Math.hypot(u, v);
      if (speed < ARROW_MIN_SPEED) continue;
      const len = Math.min(1, speed / FULL_LENGTH_SPEED) * maxLen;
      const [px, py] = view.toScreen(grid.x0 + x, grid.y0 + y);
      const dx = u / speed, dy = v / speed;
      arrow(ctx, px - (dx * len) / 2, py - (dy * len) / 2, dx, dy, len, Math.min(5, 2 + len / 6));
    }
  }
}

/** In/out arrows with CFM labels on every open exterior opening (Layer A results). */
export function drawOpeningFlows(ctx, sim, view, colors) {
  const OUT = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  ctx.font = '600 11px system-ui';
  ctx.textBaseline = 'middle';
  for (const o of sim.openings) {
    const r = o.result;
    if (!r) continue;
    const L = o.layout;
    const [mx, my] = view.toScreen(L.x, L.y);
    const out = OUT[o.normal];
    const net = Math.abs(r.Q) > 0 && o.role !== 'closed';
    let label, color, dir;
    if (net) {
      const inlet = o.role === 'inlet';
      color = inlet ? colors.inlet : colors.outlet;
      dir = inlet ? [-out[0], -out[1]] : out;
      label = `${inlet ? 'in' : 'out'} ${Math.round(m3sToCfm(Math.abs(r.Q)))} CFM`;
      arrow(ctx, mx - dir[0] * 14, my - dir[1] * 14, dir[0], dir[1], 28, 7, color, 3);
    } else if (r.Qexchange > 0) {
      color = colors.exchange;
      label = `↔ ${Math.round(m3sToCfm(r.Qexchange))} CFM`;
    } else continue;
    // Label on the outdoor side of the wall, pushed clear of the arrow.
    const lx = mx + out[0] * 30, ly = my + out[1] * 18;
    ctx.textAlign = out[0] > 0 ? 'left' : out[0] < 0 ? 'right' : 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = colors.halo; ctx.strokeText(label, lx, ly);
    ctx.fillStyle = color; ctx.fillText(label, lx, ly);
  }
}

function arrow(ctx, x, y, dx, dy, len, head, color, width) {
  if (color) { ctx.strokeStyle = color; ctx.fillStyle = color; }
  if (width) ctx.lineWidth = width;
  const ex = x + dx * len, ey = y + dy * len;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex + dx * head * 0.6, ey + dy * head * 0.6);
  ctx.lineTo(ex - dy * head * 0.6 - dx * head * 0.4, ey + dx * head * 0.6 - dy * head * 0.4);
  ctx.lineTo(ex + dy * head * 0.6 - dx * head * 0.4, ey - dx * head * 0.6 - dy * head * 0.4);
  ctx.closePath(); ctx.fill();
}
