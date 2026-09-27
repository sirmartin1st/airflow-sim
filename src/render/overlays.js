// Canvas overlays for the simulation view. Phase 6: wind arrows around the building and a north compass.
// (Speed, age-of-air and stagnant-zone overlays arrive in Phase 7, SCIENCE.md §7.)
//
// Screen up is the compass bearing `orientation`, so bearing b is drawn at screen angle
// (b − orientation), measured clockwise from up.

import { mpsToMph, mpsToFpm } from '../units.js';
import { STAGNANT_SPEED, STAGNANT_AVERAGING_TIME, STILL_AIR_SPEED } from '../constants.js';
import { CELL } from '../physics/fluid.js';

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compassName = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

function screenDir(bearing, orientation) {
  const a = ((bearing - orientation) * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

/**
 * Wind: a row of large arrows blowing toward the building from its upwind side, with a label
 * such as "Wind from NW · 10 mph" at the upwind end.
 * @param bbox  building bounding box in screen pixels { x0, y0, x1, y1 } (or the plan area)
 */
export function drawWind(ctx, bbox, conditions, colors) {
  if (!(conditions.windSpeed > 0)) return;
  const [dx, dy] = screenDir(conditions.windFrom + 180, conditions.orientation); // blowing toward
  const px = -dy, py = dx;                                                        // across the wind
  const cx = (bbox.x0 + bbox.x1) / 2, cy = (bbox.y0 + bbox.y1) / 2;
  const halfW = (bbox.x1 - bbox.x0) / 2, halfH = (bbox.y1 - bbox.y0) / 2;
  const reach = Math.abs(dx) * halfW + Math.abs(dy) * halfH;       // building half-size along the wind
  const span = Math.abs(px) * halfW + Math.abs(py) * halfH;        // building half-size across it
  const len = 46, gap = 14;
  const tipX = cx - dx * (reach + gap), tipY = cy - dy * (reach + gap); // arrow tips stop just short of the walls
  const count = Math.max(3, Math.min(7, Math.round((2 * span) / 55) + 1));

  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = colors.wind; ctx.fillStyle = colors.wind; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0 : (k / (count - 1) - 0.5) * 2 * span;
    const ex = tipX + px * t, ey = tipY + py * t;
    const sx = ex - dx * len, sy = ey - dy * len;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex - dx * 8, ey - dy * 8); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - dx * 14 + px * 9, ey - dy * 14 + py * 9);
    ctx.lineTo(ex - dx * 14 - px * 9, ey - dy * 14 - py * 9);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Label beyond the arrow tails, on the upwind side.
  const text = `Wind from ${compassName(conditions.windFrom)} · ${Math.round(mpsToMph(conditions.windSpeed))} mph`;
  const lx = tipX - dx * (len + 18), ly = tipY - dy * (len + 18);
  ctx.font = '700 13px system-ui';
  ctx.textAlign = Math.abs(dx) < 0.3 ? 'center' : dx > 0 ? 'right' : 'left';
  ctx.textBaseline = Math.abs(dy) < 0.3 ? 'middle' : dy > 0 ? 'bottom' : 'top';
  ctx.lineWidth = 4; ctx.strokeStyle = colors.halo; ctx.strokeText(text, lx, ly);
  ctx.fillStyle = colors.wind; ctx.fillText(text, lx, ly);
  ctx.restore();
}

/** North arrow in the top-right corner of the canvas. */
export function drawCompass(ctx, width, conditions, colors) {
  const r = 20, cx = width - r - 14, cy = r + 14;
  ctx.save();
  ctx.fillStyle = colors.halo; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, 2 * Math.PI); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.muted; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
  const [nx, ny] = screenDir(0, conditions.orientation);
  ctx.strokeStyle = colors.text; ctx.fillStyle = colors.text; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - nx * (r - 6), cy - ny * (r - 6)); ctx.lineTo(cx + nx * (r - 9), cy + ny * (r - 9)); ctx.stroke();
  ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', cx + nx * (r - 2), cy + ny * (r - 2));
  if (!(conditions.windSpeed > 0)) {
    ctx.fillStyle = colors.muted; ctx.font = '10px system-ui';
    ctx.fillText('no wind', cx, cy + r + 14);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Field overlays (SCIENCE.md §7.3): air speed, age of air, stagnant areas
// ---------------------------------------------------------------------------


const SPEED_FULL = 1.0;        // m/s (≈200 ft/min) at full colour strength, display scale
const MAX_ALPHA = 0.8;

/** Running time-average of cell speed for the stagnant-area overlay and metric. */
export function createFieldStats() {
  return { sim: null, avgSpeed: null, speed: null, img: document.createElement('canvas'), mode: null, max: 1 };
}

// Cell-centre speed from the face velocities.
function cellSpeeds(sim, out) {
  const s = sim.fluid, { nx, ny } = sim.grid, W = nx + 1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = i + j * nx;
    if (s.kind[c] !== CELL.FLUID) { out[c] = 0; continue; }
    const u = 0.5 * (s.u[i + j * W] + s.u[i + 1 + j * W]), v = 0.5 * (s.v[c] + s.v[c + nx]);
    out[c] = Math.hypot(u, v);
  }
}

/** Updates the running averages by simDt seconds of sim time (exponential moving average). */
export function updateFieldStats(st, sim, simDt) {
  const n = sim.grid.nx * sim.grid.ny;
  if (st.sim !== sim || !st.avgSpeed || st.avgSpeed.length !== n) {
    st.sim = sim; st.speed = new Float32Array(n); st.avgSpeed = new Float32Array(n);
    cellSpeeds(sim, st.speed); st.avgSpeed.set(st.speed);
    return;
  }
  cellSpeeds(sim, st.speed);
  const r = 1 - Math.exp(-simDt / STAGNANT_AVERAGING_TIME);
  for (let c = 0; c < n; c++) st.avgSpeed[c] += (st.speed[c] - st.avgSpeed[c]) * r;
}

/** Share of fluid cells whose time-averaged speed is below STAGNANT_SPEED (SCIENCE.md §7.3). */
export function stagnantFraction(st, sim) {
  if (!st.avgSpeed || st.sim !== sim) return null;
  let n = 0, stag = 0;
  for (let c = 0; c < st.avgSpeed.length; c++) {
    if (sim.fluid.kind[c] !== CELL.FLUID) continue;
    n++; if (st.avgSpeed[c] < STAGNANT_SPEED) stag++;
  }
  return n ? stag / n : null;
}

/**
 * Rebuilds the overlay image for mode 'speed' | 'age' | 'stagnant' (call a few times a second).
 * Sequential overlays are one hue fading from transparent (low) to strong (high).
 * Stores st.mode and st.max (the value at full strength, for the legend).
 */
export function updateFieldImage(st, sim, mode, colors) {
  if (!st.avgSpeed || st.sim !== sim) return;
  const { nx, ny } = sim.grid, s = sim.fluid;
  const img = st.img;
  if (img.width !== nx || img.height !== ny) { img.width = nx; img.height = ny; }
  const ictx = img.getContext('2d');
  const data = ictx.createImageData(nx, ny);
  const rgb = hexRgb(mode === 'speed' ? colors['ov-speed'] : mode === 'age' ? colors['ov-age'] : colors['ov-stagnant']);
  let max = SPEED_FULL;
  if (mode === 'age') {
    // Full strength at the 95th percentile of age (at least 1 minute) so the pattern stays visible.
    const ages = [];
    for (let c = 0; c < s.A.length; c++) if (s.kind[c] === CELL.FLUID) ages.push(s.A[c]);
    ages.sort((a, b) => a - b);
    max = Math.max(60, ages[Math.floor(0.95 * (ages.length - 1))] || 0);
  }
  for (let c = 0; c < nx * ny; c++) {
    if (s.kind[c] !== CELL.FLUID) continue;
    let f;
    if (mode === 'speed') f = Math.min(1, st.speed[c] / max);
    else if (mode === 'age') f = Math.min(1, s.A[c] / max);
    else f = st.avgSpeed[c] < STAGNANT_SPEED ? 0.7 : 0;
    data.data[4 * c] = rgb[0]; data.data[4 * c + 1] = rgb[1]; data.data[4 * c + 2] = rgb[2];
    data.data[4 * c + 3] = Math.round(255 * MAX_ALPHA * f);
  }
  ictx.putImageData(data, 0, 0);
  st.mode = mode; st.max = max;
}

/** Draws the last overlay image over the indoor air. */
export function drawFieldImage(ctx, st, sim, view) {
  if (!st.mode || st.sim !== sim || !st.img.width) return;
  const { nx, ny, h, x0, y0 } = sim.grid;
  const [px, py] = view.toScreen(x0, y0);
  ctx.save();
  ctx.imageSmoothingEnabled = st.mode !== 'stagnant';
  ctx.drawImage(st.img, px, py, nx * h * view.scale, ny * h * view.scale);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Legends (bottom-left of the canvas). Text uses text colours; the colour bar carries the encoding.
// ---------------------------------------------------------------------------

/** Temperature legend for the trails: blue (cooler) → gray → red (warmer), labelled in °F. */
export function drawTempLegend(ctx, x, y, loF, hiF, colors) {
  const w = 160, hgt = 8;
  panel(ctx, x - 8, y - 30, w + 16, 52, colors);
  ctx.fillStyle = colors.text; ctx.font = '600 11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Trails: air temperature', x, y - 14);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, colors['t-cold']); g.addColorStop(0.5, colors['t-mid']); g.addColorStop(1, colors['t-hot']);
  ctx.fillStyle = g; roundRect(ctx, x, y - 6, w, hgt, 3); ctx.fill();
  ctx.fillStyle = colors.muted; ctx.font = '10px system-ui'; ctx.textBaseline = 'top';
  ctx.textAlign = 'left'; ctx.fillText(`${loF.toFixed(0)} °F`, x, y + 5);
  ctx.textAlign = 'center'; ctx.fillText(`${((loF + hiF) / 2).toFixed(0)}`, x + w / 2, y + 5);
  ctx.textAlign = 'right'; ctx.fillText(`${hiF.toFixed(0)} °F`, x + w, y + 5);
}

/** Legend for the active field overlay. */
export function drawFieldLegend(ctx, x, y, mode, info, colors, stagnantShare) {
  const w = 160;
  panel(ctx, x - 8, y - 30, w + 16, 52, colors);
  ctx.fillStyle = colors.text; ctx.font = '600 11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  if (mode === 'stagnant') {
    ctx.fillText('Stagnant: avg speed < ' + Math.round(mpsToFpm(STAGNANT_SPEED)) + ' ft/min', x, y - 14);
    ctx.fillStyle = colors['ov-stagnant']; ctx.globalAlpha = 0.7; roundRect(ctx, x, y - 6, 14, 10, 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = colors.muted; ctx.font = '10px system-ui'; ctx.textBaseline = 'middle';
    ctx.fillText(stagnantShare === null ? 'averaging…' : `${Math.round(100 * stagnantShare)}% of the floor`, x + 20, y - 1);
    return;
  }
  const title = mode === 'speed' ? 'Air speed (ft/min)' : 'Age of air (minutes)';
  ctx.fillText(title, x, y - 14);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  const rgb = hexRgb(mode === 'speed' ? colors['ov-speed'] : colors['ov-age']).join(',');
  g.addColorStop(0, `rgba(${rgb},0.05)`); g.addColorStop(1, `rgba(${rgb},${MAX_ALPHA})`);
  ctx.fillStyle = g; roundRect(ctx, x, y - 6, w, 8, 3); ctx.fill();
  ctx.fillStyle = colors.muted; ctx.font = '10px system-ui'; ctx.textBaseline = 'top';
  const maxLabel = mode === 'speed' ? `${Math.round(mpsToFpm(info.max))}+` : `${(info.max / 60).toFixed(1)}+`;
  ctx.textAlign = 'left'; ctx.fillText('0', x, y + 5);
  ctx.textAlign = 'right'; ctx.fillText(maxLabel, x + w, y + 5);
  if (mode === 'speed') {
    // Mark the ASHRAE 55 "still air" threshold (≈40 ft/min) on the bar.
    const sx = x + (w * STILL_AIR_SPEED) / info.max;
    ctx.strokeStyle = colors.text; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, y - 8); ctx.lineTo(sx, y + 3); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = colors.muted; ctx.fillText('still air', sx, y + 5);
  }
}

function panel(ctx, x, y, w, h, colors) {
  ctx.save(); ctx.globalAlpha = 0.88; ctx.fillStyle = colors.halo;
  roundRect(ctx, x, y, w, h, 6); ctx.fill(); ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function hexRgb(color) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((color || '').trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
}

/** COLOR_STEPS colours from cold → mid → hot for the trails (interpolated in sRGB). */
export function temperaturePalette(colors, steps) {
  const a = hexRgb(colors['t-cold']), m = hexRgb(colors['t-mid']), b = hexRgb(colors['t-hot']);
  return Array.from({ length: steps }, (_, k) => {
    const t = k / (steps - 1);
    const [p, q, f] = t < 0.5 ? [a, m, t * 2] : [m, b, (t - 0.5) * 2];
    return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * f)).join(',')})`;
  });
}
