// Layer A: envelope airflow model. SCIENCE.md §5.
// Decides how much air enters and leaves through each exterior opening of a zone,
// from wind, indoor/outdoor temperature difference and window fans.
// Pure functions, SI units only, no DOM (CLAUDE.md rules 3 and 4).

import {
  G, R_AIR, P_ATM, C_D, CP_0,
  H_MET, A_MET, DELTA_MET,
  DGP_C1, DGP_C2, DGP_C3,
  ZONE_P_BRACKET, ZONE_P_MAX_ITER,
} from '../constants.js';

const DEG_TO_RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Air properties
// ---------------------------------------------------------------------------

/** SCIENCE.md §3 ideal gas law: ρ = P_atm / (R · T_K), kg/m³. */
export function airDensity(T_K, P = P_ATM) {
  return P / (R_AIR * T_K);
}

// ---------------------------------------------------------------------------
// Wind — SCIENCE.md §5.1–5.3
// ---------------------------------------------------------------------------

/**
 * SCIENCE.md §5.2 ASHRAE power-law wind profile.
 * Converts met-station wind (10 m, open terrain) to wind at building height H.
 * @param Umet    met-station wind speed, m/s
 * @param H       building height, m
 * @param terrain { a, delta } from TERRAIN in constants.js
 */
export function windSpeedAtHeight(Umet, H, terrain) {
  return Umet * Math.pow(DELTA_MET / H_MET, A_MET) * Math.pow(H / terrain.delta, terrain.a);
}

/** Wraps an angle in degrees to [−180, 180). */
export function wrap180(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** Wraps an angle in degrees to [0, 360). */
export function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

/** Compass bearing of each grid direction when the grid's "up" faces north. */
export const GRID_DIR_BEARING = Object.freeze({ up: 0, right: 90, down: 180, left: 270 });

/**
 * SCIENCE.md §5.1 outward-normal compass bearing of a wall.
 * @param gridDir        'up' | 'right' | 'down' | 'left' (outward normal on the grid)
 * @param orientationDeg compass bearing that grid "up" faces (0 = north up)
 */
export function wallNormalBearing(gridDir, orientationDeg) {
  return wrap360(GRID_DIR_BEARING[gridDir] + orientationDeg);
}

/**
 * SCIENCE.md §5.1 wind incidence angle β on a wall, degrees in [0, 180].
 * 0 = wind hits the wall head-on, 180 = wall directly downwind.
 * @param windFromDeg   direction the wind comes FROM (meteorological), degrees
 * @param wallNormalDeg outward-normal bearing of the wall, degrees
 */
export function incidenceAngle(windFromDeg, wallNormalDeg) {
  return Math.abs(wrap180(windFromDeg - wallNormalDeg));
}

/**
 * SCIENCE.md §5.3 Swami & Chandra (1988) wall-averaged Cp for low-rise buildings.
 * The 0.131 term is sin cubed, per EnergyPlus AirflowNetwork (decision recorded in §5.3).
 * @param betaDeg incidence angle, degrees (converted to radians for the trig)
 * @param S       side ratio = this wall's length / adjacent wall's length
 */
export function cpSwamiChandra(betaDeg, S = 1) {
  const b = betaDeg * DEG_TO_RAD;
  const Gs = Math.log(S);
  const sHalf = Math.sin(b / 2);
  const cHalf = Math.cos(b / 2);
  const sB = Math.sin(b);
  const NCp = Math.log(
    1.248
    - 0.703 * sHalf
    - 1.175 * sB * sB
    + 0.131 * Math.pow(Math.sin(2 * b * Gs), 3)
    + 0.769 * cHalf
    + 0.07 * Gs * Gs * sHalf * sHalf
    + 0.717 * cHalf * cHalf
  );
  return CP_0 * NCp;
}

/** SCIENCE.md §5.3 wind pressure on the outside of an opening: ½ · ρ_out · Cp · U_H², Pa. */
export function windPressure(rhoOut, cp, UH) {
  return 0.5 * rhoOut * cp * UH * UH;
}

// ---------------------------------------------------------------------------
// Stack and orifice — SCIENCE.md §5.4–5.5
// ---------------------------------------------------------------------------

/**
 * SCIENCE.md §5.4 stack pressure, added to the outside-minus-inside difference, Pa.
 * z is height above the floor, where P_in is referenced.
 * Warm inside (ρ_in < ρ_out) gives a negative value that grows with height,
 * so air leaves high and enters low. Checked by V7.
 */
export function stackPressure(rhoOut, rhoIn, z) {
  return -(rhoOut - rhoIn) * G * z;
}

/**
 * SCIENCE.md §5.5 orifice equation. Returns Q in m³/s, positive = inflow.
 * Uses the upstream density: ρ_out for inflow, ρ_in for outflow.
 * @param dP outside minus inside pressure difference, Pa
 */
export function orificeFlow(dP, area, rhoOut, rhoIn, cd = C_D) {
  if (dP === 0 || area <= 0) return 0;
  const rho = dP > 0 ? rhoOut : rhoIn;
  return Math.sign(dP) * cd * area * Math.sqrt((2 * Math.abs(dP)) / rho);
}

/** SCIENCE.md §4.3 effective area: w · (z_t − z_b) · open_fraction, m². */
export function openingArea(opening) {
  return opening.width * (opening.zTop - opening.zBottom) * opening.openFraction;
}

/**
 * SCIENCE.md §5.7 de Gids & Phaff (1982) single-opening exchange flow, m³/s.
 * @param area   orifice area, m²
 * @param height opening height, m
 * @param Umet   met-station wind speed, m/s
 * @param dT     |T_out − T_in|, K
 */
export function deGidsPhaffFlow(area, height, Umet, dT) {
  const Ueff = Math.sqrt(DGP_C1 * Umet * Umet + DGP_C2 * G * height * Math.abs(dT) + DGP_C3);
  return (area / 2) * Ueff;
}

/** SCIENCE.md §5.8 air changes per hour: 3600 · Q_in / V. */
export function airChangesPerHour(Qin, volume) {
  return (3600 * Qin) / volume;
}

// ---------------------------------------------------------------------------
// Zone solve — SCIENCE.md §5.5–5.8
// ---------------------------------------------------------------------------

/**
 * Converts a layout opening into the form solveZone needs, computing Cp from the wind.
 * @param o   { id, width, zBottom, zTop, openFraction, wallNormalDeg, sideRatio,
 *              fan?: { flow (m³/s, + = blowing in), faceArea (m²) } }
 * @param windFromDeg direction the wind comes from, degrees
 */
export function prepareOpening(o, windFromDeg) {
  const beta = incidenceAngle(windFromDeg, o.wallNormalDeg);
  return {
    id: o.id,
    area: openingArea(o),
    zCenter: (o.zBottom + o.zTop) / 2,
    height: o.zTop - o.zBottom,
    beta,
    cp: cpSwamiChandra(beta, o.sideRatio ?? 1),
    fanFlow: o.fan ? o.fan.flow : 0,
    fanArea: o.fan ? o.fan.faceArea : 0,
  };
}

/**
 * Solves the pressure balance of one well-mixed zone. SCIENCE.md §5.5.
 *
 * @param openings array of { id, area, zCenter, height, cp, fanFlow?, fanArea? }
 *                 (build with prepareOpening, or set cp directly as in V3)
 * @param cond     { Tout, Tin (K), UH (wind at building height, m/s), Umet (met wind, m/s) }
 * @param volume   zone volume, m³ (optional; needed for ACH)
 * @returns { Pin, balanced, massResidual, Qin, Qout, QexchangeTotal, ach, openings: [...] }
 *          Per opening: { id, Q, Qorifice, Qfan, dP, direction, Qexchange }; Q positive = inflow.
 */
export function solveZone(openings, cond, volume) {
  const rhoOut = airDensity(cond.Tout);
  const rhoIn = airDensity(cond.Tin);

  // Fixed part of each opening's pressure difference: P_w + ΔP_stack (everything except −P_in).
  const n = openings.length;
  const pExt = new Float64Array(n);
  const orificeArea = new Float64Array(n);
  let fanMass = 0;
  let anyOrifice = false;
  for (let j = 0; j < n; j++) {
    const o = openings[j];
    pExt[j] = windPressure(rhoOut, o.cp, cond.UH) + stackPressure(rhoOut, rhoIn, o.zCenter);
    // SCIENCE.md §5.6: the fan face blocks part of the window; the rest is an orifice.
    orificeArea[j] = Math.max(0, o.area - (o.fanArea || 0));
    if (orificeArea[j] > 0) anyOrifice = true;
    const qf = o.fanFlow || 0;
    fanMass += qf * (qf > 0 ? rhoOut : rhoIn);
  }

  // Net mass inflow (kg/s) as a function of P_in. Decreasing in P_in.
  const residual = (Pin) => {
    let m = fanMass;
    for (let j = 0; j < n; j++) {
      const q = orificeFlow(pExt[j] - Pin, orificeArea[j], rhoOut, rhoIn);
      m += q * (q > 0 ? rhoOut : rhoIn);
    }
    return m;
  };

  let Pin = 0;
  let balanced = true;
  if (!anyOrifice) {
    // No orifice: the balance holds only if the fans cancel exactly.
    balanced = fanMass === 0;
  } else {
    let lo = -ZONE_P_BRACKET, hi = ZONE_P_BRACKET;
    const fLo = residual(lo), fHi = residual(hi);
    if (fLo < 0) {
      balanced = false; Pin = lo; // net outflow even at the lowest indoor pressure
    } else if (fHi > 0) {
      balanced = false; Pin = hi; // net inflow even at the highest indoor pressure
    } else {
      // Bisection to floating-point precision (SCIENCE.md §5.5). Q ∝ sqrt(|ΔP|), so a
      // loose pressure tolerance would leave spurious flow near ΔP = 0.
      for (let it = 0; it < ZONE_P_MAX_ITER; it++) {
        const mid = 0.5 * (lo + hi);
        if (mid === lo || mid === hi) break;
        if (residual(mid) > 0) lo = mid; else hi = mid;
      }
      Pin = 0.5 * (lo + hi);
    }
  }

  // Per-opening outputs (SCIENCE.md §5.8).
  const dT = Math.abs(cond.Tout - cond.Tin);
  const results = [];
  let Qin = 0, Qout = 0, QexchangeTotal = 0;
  for (let j = 0; j < n; j++) {
    const o = openings[j];
    const dP = pExt[j] - Pin;
    const Qorifice = orificeFlow(dP, orificeArea[j], rhoOut, rhoIn);
    const Qfan = o.fanFlow || 0;
    const Q = Qorifice + Qfan;
    // SCIENCE.md §5.7 — documented HEURISTIC for combining de Gids-Phaff with the orifice model:
    // exchange only makes up the part of single-sided "breathing" the net flow doesn't cover.
    const Qdgp = orificeArea[j] > 0 ? deGidsPhaffFlow(orificeArea[j], o.height, cond.Umet, dT) : 0;
    const Qexchange = Math.max(0, Qdgp - Math.abs(Q));
    if (Q > 0) Qin += Q; else Qout -= Q;
    QexchangeTotal += Qexchange;
    results.push({
      id: o.id, Q, Qorifice, Qfan, dP, Qexchange,
      direction: Q > 0 ? 'in' : Q < 0 ? 'out' : 'none',
    });
  }

  return {
    Pin,
    balanced,
    massResidual: residual(Pin),
    Qin,
    Qout,
    QexchangeTotal,
    ach: volume ? airChangesPerHour(Qin, volume) : undefined,
    openings: results,
  };
}
