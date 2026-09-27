// Metrics tests (src/ui/metrics.js calculations). SCIENCE.md §7.3.
import { check, near, nearRel, finish } from './lib.js';
import { timeToTarget, updateProbes, headline, verdict, computeMetrics, trackTarget } from '../src/ui/metrics.js';
import { createLayout, addRoom, placeOpening, addFan, addProbe } from '../src/layout/layout.js';
import { buildGrid } from '../src/layout/grid.js';
import { createSimulation, advance } from '../src/physics/coupling.js';
import { snapshotZones } from '../src/engine/runner.js';
import { fToK, mphToMps } from '../src/units.js';
import { TARGET_BAND_K } from '../src/constants.js';

const zone = (Tmean, Qin, volume = 50, Qexchange = 0) => ({ Tmean, Qin, Qexchange, volume });

check('time to target: exact exponential estimate to the near edge of the ±1 °F band', () => {
  const Tout = fToK(70), T = fToK(80), target = fToK(75), q = 0.5, V = 50;
  const r = timeToTarget(zone(T, q, V), target, Tout, 10, null);
  const Tb = target + TARGET_BAND_K;
  if (r.state !== 'estimate') throw new Error(r.state);
  nearRel(r.t, 10 + (V / q) * Math.log((T - Tout) / (Tb - Tout)), 1e-12);
});
check('time to target: warming works the same way (cold room, warm outside)', () => {
  const r = timeToTarget(zone(fToK(60), 0.5), fToK(68), fToK(75), 0, null);
  if (r.state !== 'estimate' || !(r.t > 0)) throw new Error(JSON.stringify(r));
});
check('time to target: unreachable targets and no airflow say "never"', () => {
  if (timeToTarget(zone(fToK(80), 0.5), fToK(68), fToK(70), 0, null).state !== 'never') throw new Error('below outdoor');
  if (timeToTarget(zone(fToK(80), 0), fToK(75), fToK(70), 0, null).state !== 'never') throw new Error('no airflow');
});
check('time to target: already inside the band → reached now; recorded time is kept', () => {
  const r = timeToTarget(zone(fToK(75.5), 0.5), fToK(75), fToK(70), 42, null);
  if (r.state !== 'reached' || r.t !== 42) throw new Error(JSON.stringify(r));
  if (timeToTarget(zone(fToK(80), 0.5), fToK(75), fToK(70), 99, 30).t !== 30) throw new Error('recorded time');
});

check('verdict: higher-is-better and lower-is-better, with a "same" band; never colour-only', () => {
  const a = { value: 50, better: 'higher' }, b = { value: 80, better: 'higher' };
  if (verdict(a, b).word !== 'better' || verdict(b, a).word !== 'worse') throw new Error('higher');
  if (verdict({ value: 100, better: 'lower' }, { value: 60, better: 'lower' }).word !== 'better') throw new Error('lower');
  if (verdict(a, { value: 51, better: 'higher' }).word !== 'about the same') throw new Error('same');
  if (verdict({ value: Infinity, better: 'lower' }, { value: 600, better: 'lower' }).word !== 'better') throw new Error('never → reachable');
});

// End-to-end on a real simulation: box fan blowing at a person vs away from them.
function roomWithFan(angle) {
  let l = addRoom(createLayout(8, 8), 1, 1, 5, 5);
  l = placeOpening(l, 'window', 3, 1, 0.3).layout;
  l = addFan(l, 'box20', 2, 3, angle, 'high').layout;     // fan at (2, 3)
  return addProbe(l, 3.5, 3).layout;                      // person 1.5 m to the east
}
function runBreeze(angle, seconds) {
  const l = roomWithFan(angle);
  const sim = createSimulation(l, buildGrid(l), { orientation: 0, windSpeed: mphToMps(3), windFrom: 0, terrain: 'suburban', Tout: fToK(70), TinStart: fToK(80), ceilingHeight: 2.44 });
  const stats = new Map(), reached = [];
  while (sim.time < seconds) {
    const dt = advance(sim);
    updateProbes(stats, sim, l.probes, dt);
    trackTarget(reached, { ...sim, zones: snapshotZones(sim) }, fToK(75));
  }
  const view = { ...sim, zones: snapshotZones(sim) };   // the shape the page receives from the engine
  return computeMetrics(view, l.probes, stats, null, { Tout: fToK(70), target: fToK(75) }, reached);
}
check('fan pointed at the person gives a clearly higher breeze than pointed away (the Phase 8 comparison)', () => {
  const toward = runBreeze(0, 20), away = runBreeze(180, 20);
  const a = headline(away, 'breeze'), b = headline(toward, 'breeze');
  console.log(`    fan away: ${a.text}, fan toward: ${b.text}`);
  if (verdict(a, b).word !== 'better') throw new Error(`${a.text} vs ${b.text}`);
  // Free-standing fans don't change the zone heat balance, so time-to-target matches. Only to ~0.1%:
  // the fan changes the CFL time steps, so Layer A is re-solved at slightly different moments.
  near(toward.coolHeadline.t, away.coolHeadline.t, 1e-3 * toward.coolHeadline.t, 'time to target');
});

finish();
