// Sanity checks on src/constants.js: values match SCIENCE.md §3 and are physically sensible.
import { check, near, finish } from './lib.js';
import * as C from '../src/constants.js';
import { cfmToM3s } from '../src/units.js';

check('SCIENCE.md §3 table values', () => {
  near(C.G, 9.81, 0, 'g');
  near(C.R_AIR, 287.05, 0, 'R');
  near(C.P_ATM, 101325, 0, 'P_atm');
  near(C.NU_AIR, 1.5e-5, 0, 'ν');
  near(C.ALPHA_AIR, 2.1e-5, 0, 'α');
  near(C.PR_T, 0.85, 0, 'Pr_t');
  near(C.C_SMAGORINSKY, 0.17, 0, 'C_s');
  near(C.C_D, 0.65, 0, 'C_d');
  near(C.CP_0, 0.6, 0, 'Cp(0°)');
});

// Ideal gas law ρ = P / (R·T). Dry air at 20 °C, sea level ≈ 1.204 kg/m³ (ASHRAE Fundamentals).
check('air density at 20 °C ≈ 1.204 kg/m³', () => {
  const rho = C.P_ATM / (C.R_AIR * (20 + C.KELVIN_OFFSET));
  near(rho, 1.204, 0.001, 'ρ');
});

check('terrain table (SCIENCE.md §5.2)', () => {
  near(C.TERRAIN.open.a, 0.14, 0);     near(C.TERRAIN.open.delta, 270, 0);
  near(C.TERRAIN.suburban.a, 0.22, 0); near(C.TERRAIN.suburban.delta, 370, 0);
  near(C.TERRAIN.urban.a, 0.33, 0);    near(C.TERRAIN.urban.delta, 460, 0);
  if (!(C.DEFAULT_TERRAIN in C.TERRAIN)) throw new Error('default terrain missing');
});

check('fan preset flows match CFM in SCIENCE.md §6.6', () => {
  near(C.FAN_PRESETS.box20.flowHigh, cfmToM3s(2000), 1e-9, 'box');
  near(C.FAN_PRESETS.pedestal16.flowHigh, cfmToM3s(1500), 1e-9, 'pedestal');
  near(C.FAN_PRESETS.tower.flowHigh, cfmToM3s(500), 1e-9, 'tower');
  near(C.FAN_PRESETS.twinWindow.flowHigh, cfmToM3s(1200), 1e-9, 'window');
});

check('pedestal face area = π·d²/4', () => {
  const p = C.FAN_PRESETS.pedestal16;
  near(p.faceWidth * p.faceHeight, Math.PI * 0.41 ** 2 / 4, 1e-12);
});

check('constants are frozen', () => {
  if (!Object.isFrozen(C.TERRAIN) || !Object.isFrozen(C.FAN_PRESETS.box20)) {
    throw new Error('tables should be frozen');
  }
});

finish();
