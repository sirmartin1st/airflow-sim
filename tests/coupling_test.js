// Layer A ↔ Layer B coupling tests (src/physics/coupling.js). SCIENCE.md §5.8, §6.7.
import { check, near, nearRel, finish } from './lib.js';
import { createLayout, addRoom, placeOpening, updateItem, addFan } from '../src/layout/layout.js';
import { buildGrid } from '../src/layout/grid.js';
import { createSimulation, setConditions, advance, zoneMeanAge, fluidMean } from '../src/physics/coupling.js';
import { CELL } from '../src/physics/fluid.js';
import { mphToMps, fToK } from '../src/units.js';

// 4 × 5 m room (x 1..5, y 1..6), window centred on the top (north when orientation = 0) and bottom walls.
function twoWindowRoom() {
  let l = addRoom(createLayout(8, 8), 1, 1, 5, 6);
  l = placeOpening(l, 'window', 3, 1, 0.3).layout;    // win1: top wall
  l = placeOpening(l, 'window', 3, 6, 0.3).layout;    // win2: bottom wall
  return l;
}
const baseConditions = {
  orientation: 0, windSpeed: mphToMps(10), windFrom: 0, terrain: 'suburban',
  Tout: fToK(65), TinStart: fToK(78), ceilingHeight: 2.44,
};
const roles = (sim) => Object.fromEntries(sim.openings.map((o) => [o.id, o.role]));
const cellKind = (sim, id) => sim.fluid.kind[sim.openings.find((o) => o.id === id).cells[0]];

check('wind from the north: top window is the inlet, bottom the outlet (Layer B cells follow)', () => {
  const l = twoWindowRoom();
  const sim = createSimulation(l, buildGrid(l), baseConditions);
  const r = roles(sim);
  if (r.win1 !== 'inlet' || r.win2 !== 'outlet') throw new Error(JSON.stringify(r));
  if (cellKind(sim, 'win1') !== CELL.INLET || cellKind(sim, 'win2') !== CELL.OUTLET) throw new Error('cells not set');
  // inflow velocity points into the room (+y, since the top wall's outside is −y)
  const c = sim.openings[0].cells[0];
  if (!(sim.fluid.bv[c] > 0) || sim.fluid.bu[c] !== 0) throw new Error(`bv=${sim.fluid.bv[c]}`);
});

check('changing the wind to "from the south" swaps inlet and outlet (Phase 6 done-criterion)', () => {
  const l = twoWindowRoom();
  const sim = createSimulation(l, buildGrid(l), baseConditions);
  setConditions(sim, { ...baseConditions, windFrom: 180 });
  const r = roles(sim);
  if (r.win1 !== 'outlet' || r.win2 !== 'inlet') throw new Error(JSON.stringify(r));
});

check('orientation: top of plan facing east + wind from the east → top window is the inlet', () => {
  const l = twoWindowRoom();
  const sim = createSimulation(l, buildGrid(l), { ...baseConditions, orientation: 90, windFrom: 90 });
  if (roles(sim).win1 !== 'inlet') throw new Error(JSON.stringify(roles(sim)));
  near(sim.openings[0].result.beta, 0, 1e-9, 'head-on');
});

check('slice factor r = H_room / (window height × open fraction) for a cross-breeze', () => {
  const l = twoWindowRoom();
  const sim = createSimulation(l, buildGrid(l), baseConditions);
  // 9 cells × 0.1 m = 0.9 m = window width, so r = w·H / (w·h·f) = 2.44 / (1.2 · 0.5)
  nearRel(sim.zones[0].sliceFactor, 2.44 / (1.2 * 0.5), 1e-9);
});

check('closed windows: no inlets, zone temperature stays put', () => {
  let l = twoWindowRoom();
  for (const id of ['win1', 'win2']) l = updateItem(l, id, { open: false });
  const sim = createSimulation(l, buildGrid(l), baseConditions);
  if (sim.openings.some((o) => o.role !== 'closed')) throw new Error(JSON.stringify(roles(sim)));
  for (let n = 0; n < 20; n++) advance(sim);
  near(fluidMean(sim.fluid, sim.fluid.T), fToK(78), 1e-9);
});

check('single open window: no net flow, but a two-way exchange band', () => {
  let l = twoWindowRoom();
  l = updateItem(l, 'win2', { open: false });
  const sim = createSimulation(l, buildGrid(l), baseConditions);
  const o = sim.openings[0];
  if (o.role !== 'closed') throw new Error(`role ${o.role}`); // Layer A: Q ≈ 0 (to round-off, may be tiny)
  if (!(o.result.Qexchange > 0) || sim.fluid.exchange.length !== 1) throw new Error('no exchange band');
  if (sim.fluid.exchange[0].cells.length !== 18) throw new Error(`band cells ${sim.fluid.exchange[0].cells.length}`);
});

check('zone-mean temperature follows the Layer A heat balance (SCIENCE.md §6.7)', () => {
  const l = twoWindowRoom();
  const cond = { ...baseConditions, windSpeed: mphToMps(4) };
  const sim = createSimulation(l, buildGrid(l), cond);
  const z = sim.zones[0];
  let t = 0, expected = cond.TinStart;
  while (t < 5) {
    const q = z.result.Qin + z.result.QexchangeTotal;       // Layer A flows in force for this step
    const dt = advance(sim);
    expected = cond.Tout + (expected - cond.Tout) * Math.exp((-dt * q) / z.volume);
    t += dt;
  }
  near(fluidMean(sim.fluid, sim.fluid.T), expected, 1e-6, 'Layer B mean T');
  if (!(expected < cond.TinStart - 0.1)) throw new Error('room should be cooling');
});

check('age clock runs at the slice factor rate', () => {
  let l = twoWindowRoom();
  const sim = createSimulation(l, buildGrid(l), baseConditions);
  const r = sim.zones[0].sliceFactor;
  const dt = advance(sim);
  // After one step from zero age, cells away from the inlet have aged r·Δt (±diffusion, age starts uniform 0).
  near(zoneMeanAge(sim, 0), r * dt, 0.05 * r * dt);
});

check('window fan alone: zone unbalanced → openings closed, warning shown', () => {
  let l = twoWindowRoom();
  l = updateItem(l, 'win2', { open: false });
  l = updateItem(l, 'win1', { fan: { preset: 'twinWindow', direction: 'in', speed: 'high' }, openFraction: 0.25 });
  // Fan face (0.6 × 0.3 = 0.18 m²) covers the whole 0.9 × 1.2 × 0.25 = 0.27 m²? No: 0.09 m² remains as an orifice,
  // so the zone balances through the remaining gap. Close the gap entirely to force "unbalanced":
  l = updateItem(l, 'win1', { width: 0.6, zBottom: 0.9, zTop: 1.2, openFraction: 1 });
  const sim = createSimulation(l, buildGrid(l), baseConditions);
  if (sim.zones[0].balanced) throw new Error('should be unbalanced');
  if (!sim.warnings.length || sim.openings.some((o) => o.role !== 'closed')) throw new Error('should warn and close');
});

check('free-standing fans map into Layer B; "off" means zero flow', () => {
  let l = twoWindowRoom();
  l = addFan(l, 'box20', 3, 3.5, 90, 'high').layout;
  l = addFan(l, 'tower', 2, 2, 0, 'off').layout;
  l = addFan(l, 'box20', 7, 7, 0, 'high').layout;     // outside the room: ignored
  const sim = createSimulation(l, buildGrid(l), baseConditions);
  if (sim.fluid.fans.length !== 2) throw new Error(`fans: ${sim.fluid.fans.length}`);
  if (!(sim.fluid.fans[0].flow > 0.9) || sim.fluid.fans[1].flow !== 0) throw new Error('flows wrong');
  near(sim.fluid.fans[0].angle, Math.PI / 2, 1e-12);
  for (let n = 0; n < 30; n++) advance(sim);
  if (!(sim.fluid.fans[0].speed > 0)) throw new Error('fan should spin up');
});

finish();
