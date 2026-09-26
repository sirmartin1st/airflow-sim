// Free-standing fans (box, pedestal, tower) as fixed-flow actuator regions. SCIENCE.md §6.6.
// Each fan is a rectangle w_fan wide by 2 cells deep facing direction n̂. The faces inside it are
// held at the fan's current velocity U_cur·n̂ and treated like inlet faces in the pressure solve,
// so the fan always moves its rated flow. U_cur spins up toward U_fan = Q_fan / A_fan with time
// constant τ. Intake and entrainment come from the incompressibility constraint.
//
// A fan object (grid coordinates, SI):
//   { x, y       centre of the actuator, m
//     angle      blowing direction, radians (0 = +x, π/2 = +y)
//     width      w_fan, m (across the jet)
//     faceArea   A_fan, m² (w_fan × h_fan)
//     flow       Q_fan at the current speed setting, m³/s
//     speed      current outlet velocity U_cur, m/s (state; starts at 0) }

import { FAN_TAU, FAN_ACTUATOR_DEPTH_CELLS } from '../constants.js';

/** SCIENCE.md §6.6 target outlet velocity U_fan = Q_fan / A_fan, m/s. */
export function fanOutletVelocity(fan) {
  return fan.flow / fan.faceArea;
}

/** Builds a fan object from a FAN_PRESETS entry and a speed fraction (FAN_SPEED_FRACTIONS). */
export function fanFromPreset(preset, speedFraction, x, y, angle) {
  return {
    x, y, angle,
    width: preset.faceWidth,
    faceArea: preset.faceWidth * preset.faceHeight,
    flow: preset.flowHigh * speedFraction,
    speed: 0,
  };
}

// Is point (px, py) inside the fan's actuator rectangle? Half-open bounds [−half, +half) so the
// region covers exactly 2 cells deep and ≈ w_fan wide whatever the alignment.
function insideFan(fan, px, py, h) {
  const n0 = Math.cos(fan.angle), n1 = Math.sin(fan.angle);
  const hw = 0.5 * fan.width, hd = 0.5 * FAN_ACTUATOR_DEPTH_CELLS * h, eps = 1e-9 * h;
  const dx = px - fan.x, dy = py - fan.y;
  const along = dx * n0 + dy * n1, across = -dx * n1 + dy * n0;
  return along >= -hd - eps && along < hd - eps && across >= -hw - eps && across < hw - eps;
}

/**
 * Marks the faces each fan holds: s.fanU[f] / s.fanV[f] = fan index + 1 (0 = no fan).
 * A face gets the fan's x- (or y-) component only if that component is non-negligible.
 * Called from setCells when the layout or fans change; not per step.
 */
export function markFanFaces(s) {
  const { nx, ny, h, fanU, fanV } = s;
  fanU.fill(0); fanV.fill(0);
  s.fans.forEach((fan, k) => {
    const n0 = Math.cos(fan.angle), n1 = Math.sin(fan.angle);
    const R = Math.hypot(0.5 * fan.width, 0.5 * FAN_ACTUATOR_DEPTH_CELLS * h) + h;
    const i0 = Math.max(0, Math.floor((fan.x - R) / h)), i1 = Math.min(nx, Math.ceil((fan.x + R) / h));
    const j0 = Math.max(0, Math.floor((fan.y - R) / h)), j1 = Math.min(ny, Math.ceil((fan.y + R) / h));
    if (Math.abs(n0) > 1e-9) {
      for (let j = j0; j < Math.min(j1 + 1, ny); j++)
        for (let i = i0; i <= i1; i++)
          if (insideFan(fan, i * h, (j + 0.5) * h, h)) fanU[i + j * (nx + 1)] = k + 1;
    }
    if (Math.abs(n1) > 1e-9) {
      for (let j = j0; j <= Math.min(j1, ny); j++)
        for (let i = i0; i < Math.min(i1 + 1, nx); i++)
          if (insideFan(fan, (i + 0.5) * h, j * h, h)) fanV[i + j * nx] = k + 1;
    }
  });
}

/** SCIENCE.md §6.6 spin-up: U_cur ← U_cur + (U_fan − U_cur)·(1 − e^(−Δt/τ)). */
export function updateFanSpeeds(s, dt) {
  const r = 1 - Math.exp(-dt / FAN_TAU);
  for (const fan of s.fans) fan.speed += (fanOutletVelocity(fan) - fan.speed) * r;
}
