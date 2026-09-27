// Simulation runner tests (src/engine/runner.js), the loop the Web Worker runs.
import { check, near, finish } from './lib.js';
import { createRunner } from '../src/engine/runner.js';
import { createLayout, addRoom, placeOpening, addFan } from '../src/layout/layout.js';
import { mphToMps, fToK } from '../src/units.js';

let layout = addRoom(createLayout(8, 8), 1, 1, 5, 6);
layout = placeOpening(layout, 'window', 3, 1, 0.3).layout;
layout = placeOpening(layout, 'window', 3, 6, 0.3).layout;
const cond = { orientation: 0, windSpeed: mphToMps(10), windFrom: 0, terrain: 'suburban', Tout: fToK(65), TinStart: fToK(78), ceilingHeight: 2.44 };
const busyWait = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };

check('build → snapshot has fields, flows and transferable arrays', () => {
  const r = createRunner();
  r.build(layout, cond, 7);
  const { snapshot: s, transfer } = r.snapshot();
  if (!s.ok || s.buildId !== 7 || s.time !== 0) throw new Error(JSON.stringify({ ok: s.ok, id: s.buildId, t: s.time }));
  if (!(s.u instanceof Float32Array) || transfer.length !== 5) throw new Error('arrays');
  const roles = Object.fromEntries(s.openings.map((o) => [o.id, o.role]));
  if (roles.win1 !== 'inlet' || roles.win2 !== 'outlet') throw new Error(JSON.stringify(roles));
  if (!(s.zones[0].ach > 1)) throw new Error('ACH missing');
});

check('invalid layout → snapshot says not ok', () => {
  const r = createRunner();
  r.build(createLayout(8, 8), cond, 1);
  if (r.snapshot().snapshot.ok) throw new Error('should not be ok');
});

check('paused: time does not advance; playing: advances toward speed × real time', () => {
  const r = createRunner();
  r.build(layout, cond, 1);
  r.tick(20); busyWait(50); r.tick(20);
  near(r.snapshot().snapshot.time, 0, 0, 'paused');
  r.setPlaying(true); r.setSpeed(1);
  r.tick(20);                     // first tick only starts the clock
  busyWait(100); r.tick(200);     // owes ~0.1 s of sim time
  const t = r.snapshot().snapshot.time;
  if (!(t > 0.05 && t < 0.2)) throw new Error(`sim time ${t}`);
});

check('wind change flips inlets in the running simulation', () => {
  const r = createRunner();
  r.build(layout, cond, 1);
  r.setConditions({ ...cond, windFrom: 180 });
  const roles = Object.fromEntries(r.snapshot().snapshot.openings.map((o) => [o.id, o.role]));
  if (roles.win1 !== 'outlet' || roles.win2 !== 'inlet') throw new Error(JSON.stringify(roles));
});

check('fans can be changed without restarting', () => {
  const r = createRunner();
  r.build(layout, cond, 1);
  r.setPlaying(true); r.tick(5); busyWait(30); r.tick(50);
  const t0 = r.snapshot().snapshot.time;
  r.setFans(addFan(layout, 'box20', 3, 3.5, 90, 'high').layout.fans);
  if (r.snapshot().snapshot.time !== t0) throw new Error('fan change restarted the simulation');
});

finish();
