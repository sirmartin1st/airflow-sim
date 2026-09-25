// Unit conversion tests. SCIENCE.md §3.
import { check, near, nearRel, finish } from './lib.js';
import * as U from '../src/units.js';

check('1 ft = 0.3048 m', () => near(U.ftToM(1), 0.3048, 1e-12));
check('1 mph = 0.44704 m/s', () => near(U.mphToMps(1), 0.44704, 1e-12));
check('1 fpm = 0.00508 m/s', () => near(U.fpmToMps(1), 0.00508, 1e-12));
check('1 CFM = 4.71947e-4 m³/s', () => nearRel(U.cfmToM3s(1), 0.3048 ** 3 / 60, 1e-5));
check('2000 CFM ≈ 0.9439 m³/s', () => near(U.cfmToM3s(2000), 0.9439, 1e-4));
check('40 fpm ≈ 0.2 m/s (ASHRAE 55 still air)', () => near(U.fpmToMps(40), 0.2032, 1e-9));

check('32 °F = 0 °C', () => near(U.fToC(32), 0, 1e-12));
check('212 °F = 100 °C', () => near(U.fToC(212), 100, 1e-12));
check('−40 °F = −40 °C', () => near(U.fToC(-40), -40, 1e-12));
check('0 °C = 273.15 K', () => near(U.cToK(0), 273.15, 1e-12));
check('68 °F = 293.15 K', () => near(U.fToK(68), 293.15, 1e-9));
check('ΔT 9 °F = 5 K', () => near(U.deltaFToK(9), 5, 1e-12));

check('round trips', () => {
  for (const x of [-30, 0, 1, 12.5, 77, 1500]) {
    near(U.mToFt(U.ftToM(x)), x, 1e-9, 'ft');
    near(U.mpsToMph(U.mphToMps(x)), x, 1e-9, 'mph');
    near(U.mpsToFpm(U.fpmToMps(x)), x, 1e-9, 'fpm');
    near(U.m3sToCfm(U.cfmToM3s(x)), x, 1e-9, 'cfm');
    near(U.cToF(U.fToC(x)), x, 1e-9, '°F');
    near(U.kToF(U.fToK(x)), x, 1e-9, '°F↔K');
    near(U.deltaKToF(U.deltaFToK(x)), x, 1e-9, 'ΔT');
  }
});

finish();
