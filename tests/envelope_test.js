// Unit tests for the Layer A building blocks in src/physics/envelope.js. SCIENCE.md §5.
import { check, near, nearRel, finish } from './lib.js';
import * as E from '../src/physics/envelope.js';
import { TERRAIN, DGP_C3, C_D, WINDOW_DEFAULTS } from '../src/constants.js';

// --- Wind profile (§5.2) ---
check('wind profile: open terrain at 10 m returns met speed exactly', () => {
  near(E.windSpeedAtHeight(5, 10, TERRAIN.open), 5, 1e-12);
});
check('wind profile: suburban, H = 3 m ≈ 0.550 × U_met (hand calc)', () => {
  // (270/10)^0.14 · (3/370)^0.22 = 1.5864 · 0.3467 = 0.5500
  near(E.windSpeedAtHeight(1, 3, TERRAIN.suburban), 0.5500, 5e-4);
});
check('wind profile: rougher terrain → less wind', () => {
  const [o, s, u] = ['open', 'suburban', 'urban'].map((t) => E.windSpeedAtHeight(5, 3, TERRAIN[t]));
  if (!(o > s && s > u)) throw new Error(`${o}, ${s}, ${u}`);
});

// --- Angles (§5.1) ---
check('incidence angle: head-on, oblique, wrap-around, downwind', () => {
  near(E.incidenceAngle(0, 0), 0, 1e-12);
  near(E.incidenceAngle(350, 10), 20, 1e-12);
  near(E.incidenceAngle(10, 350), 20, 1e-12);
  near(E.incidenceAngle(270, 0), 90, 1e-12);
  near(E.incidenceAngle(180, 0), 180, 1e-12);
  near(E.incidenceAngle(90, 270), 180, 1e-12);
});
check('wall normal bearing from grid direction + orientation', () => {
  near(E.wallNormalBearing('up', 0), 0, 0);
  near(E.wallNormalBearing('right', 30), 120, 0);
  near(E.wallNormalBearing('left', 100), 10, 0);
  near(E.wallNormalBearing('down', 270), 90, 0);
});

// --- Cp (§5.3) ---
check('Cp: side ratio has no effect at β = 0 (sin term vanishes)', () => {
  near(E.cpSwamiChandra(0, 2), E.cpSwamiChandra(0, 1), 1e-12);
});
check('Cp: S and 1/S give different results off-normal (cubed term matters)', () => {
  const a = E.cpSwamiChandra(60, 2), b = E.cpSwamiChandra(60, 0.5);
  if (Math.abs(a - b) < 1e-3) throw new Error(`${a} vs ${b}`);
});

// --- Density, stack, orifice (§3, §5.4, §5.5) ---
check('air density at 20 °C ≈ 1.204 kg/m³', () => near(E.airDensity(293.15), 1.204, 0.001));
check('stack: warm inside → negative, growing with height', () => {
  const rhoOut = E.airDensity(283.15), rhoIn = E.airDensity(298.15);
  const s1 = E.stackPressure(rhoOut, rhoIn, 1), s2 = E.stackPressure(rhoOut, rhoIn, 2);
  if (!(s1 < 0 && s2 < s1)) throw new Error(`${s1}, ${s2}`);
  near(s2, 2 * s1, 1e-12);
});
check('orifice: 1 Pa, 1 m², ρ 1.2 → C_d·sqrt(2/1.2)', () => {
  near(E.orificeFlow(1, 1, 1.2, 1.2), C_D * Math.sqrt(2 / 1.2), 1e-12);
});
check('orifice: antisymmetric at equal density, zero at zero ΔP or area', () => {
  near(E.orificeFlow(-3, 0.5, 1.2, 1.2), -E.orificeFlow(3, 0.5, 1.2, 1.2), 1e-12);
  near(E.orificeFlow(0, 0.5, 1.2, 1.2), 0, 0);
  near(E.orificeFlow(5, 0, 1.2, 1.2), 0, 0);
});
check('orifice: uses upstream density', () => {
  near(E.orificeFlow(2, 1, 1.0, 4.0), C_D * Math.sqrt(4 / 1.0), 1e-12); // inflow → ρ_out
  near(E.orificeFlow(-2, 1, 1.0, 4.0), -C_D * Math.sqrt(4 / 4.0), 1e-12); // outflow → ρ_in
});
check('opening area: default window half open = 0.9 × 1.2 × 0.5 = 0.54 m²', () => {
  near(E.openingArea({ ...WINDOW_DEFAULTS, openFraction: 0.5 }), 0.54, 1e-12);
});

// --- de Gids & Phaff (§5.7) ---
check('de Gids-Phaff: hand calc', () => {
  // A=0.5, h=1.2, U=3, ΔT=10: U_eff = sqrt(0.001·9 + 0.0035·9.81·1.2·10 + 0.01) = sqrt(0.43102) = 0.65652
  near(E.deGidsPhaffFlow(0.5, 1.2, 3, 10), 0.25 * Math.sqrt(0.001 * 9 + 0.0035 * 9.81 * 1.2 * 10 + 0.01), 1e-12);
  near(E.deGidsPhaffFlow(0.5, 1.2, 3, 10), 0.16413, 1e-5);
});

// --- Zone solve (§5.5–5.8) ---
const cond = { Tout: 290, Tin: 296, UH: 2.5, Umet: 4.5 };
check('zone: four openings mass-balance, P_in within the range of outside pressures', () => {
  const ops = [
    { id: 'a', area: 0.5, zCenter: 1.5, height: 1.2, cp: 0.55 },
    { id: 'b', area: 0.3, zCenter: 1.0, height: 2.0, cp: -0.2 },
    { id: 'c', area: 0.8, zCenter: 1.5, height: 1.2, cp: -0.44 },
    { id: 'd', area: 0.2, zCenter: 2.2, height: 0.4, cp: -0.36 },
  ];
  const r = E.solveZone(ops, cond, 50);
  if (!r.balanced) throw new Error('unbalanced');
  near(r.massResidual, 0, 1e-9, 'residual');
  const rhoOut = E.airDensity(cond.Tout), rhoIn = E.airDensity(cond.Tin);
  const mIn = r.openings.filter((o) => o.Q > 0).reduce((s, o) => s + o.Q * rhoOut, 0);
  const mOut = r.openings.filter((o) => o.Q < 0).reduce((s, o) => s - o.Q * rhoIn, 0);
  nearRel(mIn, mOut, 1e-8, 'mass in vs out');
  near(r.ach, (3600 * r.Qin) / 50, 1e-12, 'ACH');
});
check('zone: single opening, no wind, no ΔT → zero net flow, exchange = A/2·sqrt(C3)', () => {
  const r = E.solveZone([{ id: 'w', area: 0.54, zCenter: 1.5, height: 1.2, cp: 0.6 }],
    { Tout: 293, Tin: 293, UH: 0, Umet: 0 });
  near(r.openings[0].Q, 0, 1e-9);
  near(r.openings[0].Qexchange, 0.27 * Math.sqrt(DGP_C3), 1e-9);
});
check('zone: single opening with wind still has ~zero net flow (P_in = P_w)', () => {
  const r = E.solveZone([{ id: 'w', area: 0.54, zCenter: 1.5, height: 1.2, cp: 0.6 }], { ...cond, Tin: 290 });
  near(r.openings[0].Q, 0, 1e-6);
  if (!(r.openings[0].Qexchange > 0)) throw new Error('expected exchange flow');
});
check('zone: intake window fan filling its window pushes the same mass out the other window', () => {
  const r = E.solveZone([
    { id: 'fan', area: 0.18, zCenter: 1.5, height: 0.3, cp: 0, fanFlow: 0.5, fanArea: 0.18 },
    { id: 'win', area: 0.54, zCenter: 1.5, height: 1.2, cp: 0 },
  ], { Tout: 290, Tin: 296, UH: 0, Umet: 0 });
  const [fan, win] = r.openings;
  near(fan.Q, 0.5, 1e-12, 'fan');
  nearRel(-win.Q * E.airDensity(296), 0.5 * E.airDensity(290), 1e-8, 'mass');
  near(fan.Qexchange, 0, 0, 'no exchange through a fully blocked window');
});
check('zone: window fan with no other opening → reported unbalanced', () => {
  const r = E.solveZone([{ id: 'fan', area: 0.18, zCenter: 1.5, height: 0.3, cp: 0, fanFlow: 0.5, fanArea: 0.18 }], cond);
  if (r.balanced) throw new Error('expected unbalanced');
});
check('zone: no openings → zero flow, balanced', () => {
  const r = E.solveZone([], cond, 30);
  if (!r.balanced || r.Qin !== 0 || r.ach !== 0) throw new Error(JSON.stringify(r));
});
check('prepareOpening: north window, wind from north → β = 0, Cp ≈ 0.603', () => {
  const p = E.prepareOpening({ id: 'n', ...WINDOW_DEFAULTS, openFraction: 0.5, wallNormalDeg: 0, sideRatio: 1 }, 0);
  near(p.beta, 0, 0); near(p.cp, 0.603, 0.001); near(p.area, 0.54, 1e-12); near(p.zCenter, 1.5, 1e-12);
});

finish();
