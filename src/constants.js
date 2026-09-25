// Every physical constant used by the simulator lives here, in SI units.
// Each value names its source. See SCIENCE.md §3 for the master table.
// Do not change a value here without first updating SCIENCE.md (CLAUDE.md rule 1).

// ---------------------------------------------------------------------------
// Fundamental air properties — SCIENCE.md §3
// ---------------------------------------------------------------------------

/** Gravitational acceleration, m/s². Standard value (ASHRAE Handbook—Fundamentals). */
export const G = 9.81;

/** Specific gas constant of dry air, J/(kg·K). ASHRAE Handbook—Fundamentals, Psychrometrics. */
export const R_AIR = 287.05;

/** Atmospheric pressure at sea level, Pa. ISO 2533 standard atmosphere. */
export const P_ATM = 101325;

/** Kinematic viscosity of air at ~20 °C, m²/s. SCIENCE.md §3 (standard property tables). */
export const NU_AIR = 1.5e-5;

/** Thermal diffusivity of air at ~20 °C, m²/s. SCIENCE.md §3 (standard property tables). */
export const ALPHA_AIR = 2.1e-5;

/** Offset between Celsius and Kelvin. Exact by definition (SI). */
export const KELVIN_OFFSET = 273.15;

// ---------------------------------------------------------------------------
// Turbulence and drag — SCIENCE.md §6.5
// ---------------------------------------------------------------------------

/** Turbulent Prandtl number. SCIENCE.md §3 (common RANS/LES value). */
export const PR_T = 0.85;

/** Smagorinsky constant (tunable 0.1–0.2). Smagorinsky (1963); SCIENCE.md §6.5. */
export const C_SMAGORINSKY = 0.17;

/** Upper clamp on eddy viscosity for stability, m²/s. SCIENCE.md §6.5. */
export const NU_T_MAX = 0.05;

/**
 * Floor/ceiling friction coefficient for depth-averaged drag. SCIENCE.md §6.5.
 * STARTING VALUE ONLY: must be calibrated against V5 (fan jet decay) in Phase 4,
 * then this comment updated with "calibrated in V5 on <date>".
 */
export const C_F_DRAG = 0.004;

// ---------------------------------------------------------------------------
// Envelope model (Layer A) — SCIENCE.md §5
// ---------------------------------------------------------------------------

/** Discharge coefficient for windows/doors. ASHRAE typical range 0.6–0.7; SCIENCE.md §3. */
export const C_D = 0.65;

/** Wall-averaged Cp on the windward wall at normal incidence. Swami & Chandra (1988); SCIENCE.md §5.3. */
export const CP_0 = 0.6;

/** Meteorological station reference height, m. ASHRAE Fundamentals, Airflow Around Buildings; SCIENCE.md §5.2. */
export const H_MET = 10;

/** Power-law exponent at the met station (open terrain). ASHRAE Fundamentals; SCIENCE.md §5.2. */
export const A_MET = 0.14;

/** Boundary-layer thickness at the met station (open terrain), m. ASHRAE Fundamentals; SCIENCE.md §5.2. */
export const DELTA_MET = 270;

/**
 * Site terrain options: power-law exponent `a` and boundary-layer thickness `delta` (m).
 * ASHRAE Handbook—Fundamentals, "Airflow Around Buildings"; SCIENCE.md §5.2.
 * Cross-checked 2026-09-24 against EnergyPlus terrain defaults (Country/Suburbs/City): identical.
 */
export const TERRAIN = Object.freeze({
  open:     Object.freeze({ a: 0.14, delta: 270 }),
  suburban: Object.freeze({ a: 0.22, delta: 370 }),
  urban:    Object.freeze({ a: 0.33, delta: 460 }),
});

/** Default terrain. SCIENCE.md §5.2. */
export const DEFAULT_TERRAIN = 'suburban';

/** Default building height for the wind profile (single story), m. SCIENCE.md §5.2. */
export const DEFAULT_BUILDING_HEIGHT = 3.0;

/** de Gids & Phaff (1982) single-opening exchange coefficients. SCIENCE.md §5.7. */
export const DGP_C1 = 0.001;  // wind term, dimensionless
export const DGP_C2 = 0.0035; // buoyancy term, dimensionless
export const DGP_C3 = 0.01;   // turbulence term, m²/s²

/** Bisection bracket for zone pressure, Pa. SCIENCE.md §5.5. */
export const ZONE_P_BRACKET = 2000;

/**
 * Safety cap on zone-pressure bisection iterations. SCIENCE.md §5.5.
 * Bisection runs to floating-point precision (~60 iterations); this only guards against an endless loop.
 */
export const ZONE_P_MAX_ITER = 200;

/** How often Layer A is re-solved, s of sim time. SCIENCE.md §5.8. */
export const ENVELOPE_UPDATE_INTERVAL = 0.5;

// ---------------------------------------------------------------------------
// Geometry defaults — SCIENCE.md §4
// ---------------------------------------------------------------------------

/** Default grid cell size, m (≈4 in). SCIENCE.md §4.1. */
export const DEFAULT_CELL_SIZE = 0.1;

/** Maximum grid dimension, cells per side (performance cap). SCIENCE.md §4.1. */
export const MAX_GRID_CELLS = 250;

/** Plan-view slice height above floor, m (1.1 m ≈ 3.6 ft). SCIENCE.md §1. */
export const SLICE_HEIGHT = 1.1;

/** Default ceiling height, m (8 ft). SCIENCE.md §5.8. */
export const DEFAULT_CEILING_HEIGHT = 2.44;

/** Default door geometry, m. SCIENCE.md §4.3. */
export const DOOR_DEFAULTS = Object.freeze({ width: 0.9, zBottom: 0, zTop: 2.03 });

/** Default window geometry, m. SCIENCE.md §4.3. */
export const WINDOW_DEFAULTS = Object.freeze({ width: 0.9, zBottom: 0.9, zTop: 2.1 });

/** Open fraction for double-hung / sliding windows. SCIENCE.md §4.3. */
export const SLIDING_WINDOW_OPEN_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Interior solver (Layer B) — SCIENCE.md §6
// ---------------------------------------------------------------------------

/** Maximum time step, s. SCIENCE.md §6.2. */
export const DT_MAX = 0.05;

/** CFL number used in the time-step rule Δt = CFL · Δ / max|u|. SCIENCE.md §6.2. */
export const CFL = 0.5;

/** Target divergence after projection, 1/s. SCIENCE.md §6.2 and V6. */
export const DIVERGENCE_TOL = 1e-4;

/** Fan actuator relaxation time constant, s. SCIENCE.md §6.6. */
export const FAN_TAU = 0.1;

/** Fan actuator depth, cells. SCIENCE.md §6.6. */
export const FAN_ACTUATOR_DEPTH_CELLS = 2;

/** Two-way exchange relaxation band depth, cells. SCIENCE.md §6.4. */
export const EXCHANGE_BAND_CELLS = 2;

// ---------------------------------------------------------------------------
// Fans — SCIENCE.md §6.6
// Typical values only; real products vary a lot. The UI must say
// "typical; check your fan's rating".
// Flow values are in m³/s (converted from CFM: 1 CFM = 4.71947e-4 m³/s).
// ---------------------------------------------------------------------------

const CFM = 4.71947e-4; // m³/s per CFM, NIST SP 811. Duplicated from units.js on purpose so constants stay dependency-free.

export const FAN_PRESETS = Object.freeze({
  box20:      Object.freeze({ label: '20" box fan',      faceWidth: 0.51, faceHeight: 0.51, flowHigh: 2000 * CFM }),
  // Round 16" pedestal: face area of a 0.41 m circle, stored as width = diameter
  // and an equivalent height so that width × height = π·d²/4.
  pedestal16: Object.freeze({ label: '16" pedestal fan', faceWidth: 0.41, faceHeight: Math.PI * 0.41 / 4, flowHigh: 1500 * CFM }),
  tower:      Object.freeze({ label: 'Tower fan',         faceWidth: 0.10, faceHeight: 0.75, flowHigh: 500 * CFM }),
  twinWindow: Object.freeze({ label: 'Twin window fan',   faceWidth: 0.60, faceHeight: 0.30, flowHigh: 1200 * CFM }),
});

/** Fan speed settings as fractions of high speed (fan affinity laws, approx.). SCIENCE.md §6.6. */
export const FAN_SPEED_FRACTIONS = Object.freeze({ low: 0.5, medium: 0.75, high: 1.0 });

// ---------------------------------------------------------------------------
// Visualization and metrics thresholds — SCIENCE.md §7
// ---------------------------------------------------------------------------

/** Below this speed, arrows are hidden, m/s. SCIENCE.md §7.2. */
export const ARROW_MIN_SPEED = 0.02;

/** Time-averaged speed below which a cell counts as stagnant, m/s. SCIENCE.md §7.3. */
export const STAGNANT_SPEED = 0.05;

/** ASHRAE 55 "still air" threshold, m/s (≈40 fpm). SCIENCE.md §7.3. */
export const STILL_AIR_SPEED = 0.2;

/** ACH label thresholds (upper bounds), 1/h. SCIENCE.md §7.3. */
export const ACH_LABELS = Object.freeze([
  Object.freeze({ max: 1,        label: 'stale' }),
  Object.freeze({ max: 5,        label: 'light' }),
  Object.freeze({ max: 15,       label: 'good airing' }),
  Object.freeze({ max: Infinity, label: 'strong cross-breeze' }),
]);
