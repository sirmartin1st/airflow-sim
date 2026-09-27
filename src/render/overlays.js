// Canvas overlays for the simulation view. Phase 6: wind arrows around the building and a north compass.
// (Speed, age-of-air and stagnant-zone overlays arrive in Phase 7, SCIENCE.md §7.)
//
// Screen up is the compass bearing `orientation`, so bearing b is drawn at screen angle
// (b − orientation), measured clockwise from up.

import { mpsToMph } from '../units.js';

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
