// SI <-> imperial conversions. SCIENCE.md §3.
// Only this file and the UI convert units. The solver works purely in SI.

import { KELVIN_OFFSET } from './constants.js';

// Exact or standard conversion factors (NIST SP 811).
const M_PER_FT = 0.3048;          // exact
const MPS_PER_MPH = 0.44704;      // exact
const MPS_PER_FPM = 0.00508;      // exact (0.3048 / 60)
const M3S_PER_CFM = 4.71947e-4;   // 0.3048³ / 60 = 4.719474e-4

// Length
export const ftToM = (ft) => ft * M_PER_FT;
export const mToFt = (m) => m / M_PER_FT;

// Velocity
export const mphToMps = (mph) => mph * MPS_PER_MPH;
export const mpsToMph = (mps) => mps / MPS_PER_MPH;
export const fpmToMps = (fpm) => fpm * MPS_PER_FPM;
export const mpsToFpm = (mps) => mps / MPS_PER_FPM;

// Volumetric flow
export const cfmToM3s = (cfm) => cfm * M3S_PER_CFM;
export const m3sToCfm = (m3s) => m3s / M3S_PER_CFM;

// Temperature
export const fToC = (f) => (f - 32) * 5 / 9;
export const cToF = (c) => c * 9 / 5 + 32;
export const cToK = (c) => c + KELVIN_OFFSET;
export const kToC = (k) => k - KELVIN_OFFSET;
export const fToK = (f) => cToK(fToC(f));
export const kToF = (k) => cToF(kToC(k));

// Temperature *differences* (no offset): 1 K = 1.8 °F
export const deltaFToK = (dF) => dF * 5 / 9;
export const deltaKToF = (dK) => dK * 9 / 5;
