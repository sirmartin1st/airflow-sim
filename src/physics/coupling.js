// Couples Layer A (envelope.js) and Layer B (fluid.js) for a layout. SCIENCE.md §5.8 and §6.7.
// Pure, SI units, no DOM.
//
// A simulation is built from a layout, its grid (layout/grid.js) and the conditions:
//   conditions = { orientation   compass bearing the top of the plan faces, degrees
//                  windSpeed     met-station wind speed, m/s
//                  windFrom      direction the wind comes from, degrees
//                  terrain       key of TERRAIN in constants.js
//                  Tout          outdoor temperature, K
//                  TinStart      indoor temperature at the start, K
//                  ceilingHeight m }
// Layer A is re-solved every ENVELOPE_UPDATE_INTERVAL seconds of sim time, using each zone's
// mean temperature. Its flows set Layer B's inlets, outlets and exchange bands.

import {
  TERRAIN, DEFAULT_BUILDING_HEIGHT, ENVELOPE_UPDATE_INTERVAL, EXCHANGE_BAND_CELLS, FLOW_ZERO_TOL,
  FAN_PRESETS, FAN_SPEED_FRACTIONS,
} from '../constants.js';
import { LCELL } from '../layout/grid.js';
import { solveZone, prepareOpening, windSpeedAtHeight, wallNormalBearing, openingArea } from './envelope.js';
import {
  createFluid, setCells, setFans, setExchangeBands, step, computeDt, componentOf, fluidMean, CELL,
} from './fluid.js';
import { fanFromPreset } from './fans.js';

const INWARD = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }; // (di, dj) from outside to inside
const speedFraction = (speed) => (speed === 'off' ? 0 : FAN_SPEED_FRACTIONS[speed]);

/**
 * Builds a simulation. `grid` must be buildGrid(layout) with ok = true.
 * @returns sim { layout, grid, conditions, fluid, zones, openings, time, warnings }
 */
export function createSimulation(layout, grid, conditions) {
  const { nx, ny, h } = grid;
  const fluid = createFluid({ nx, ny, h, ceilingHeight: conditions.ceilingHeight, T0: conditions.TinStart });
  for (let c = 0; c < grid.cells.length; c++) fluid.kind[c] = grid.cells[c] === LCELL.FLUID ? CELL.FLUID : CELL.SOLID;

  const byId = new Map(layout.openings.map((o) => [o.id, o]));
  const openings = grid.openings
    .filter((g) => g.kind === 'exterior')
    .map((g) => ({ ...g, layout: byId.get(g.id), result: null, role: 'closed' }));

  // Zones: volume, representative cell (to find the Layer B zone index), and mean temperature.
  const firstCell = new Int32Array(grid.zones.length).fill(-1);
  for (let c = 0; c < grid.zone.length; c++) {
    const z = grid.zone[c];
    if (z >= 0 && firstCell[z] < 0) firstCell[z] = c;
  }
  const zones = grid.zones.map((z) => ({
    id: z.id, area: z.area, volume: z.area * conditions.ceilingHeight, cell: firstCell[z.id],
    Tmean: conditions.TinStart, result: null, sliceFactor: 1, balanced: true,
  }));

  const sim = { layout, grid, conditions, fluid, zones, openings, time: 0, nextEnvelope: 0, warnings: [] };
  setSimFans(sim, layout.fans);
  updateEnvelope(sim);
  return sim;
}

/** Free-standing fans → Layer B actuators (layout coordinates → grid coordinates). */
export function setSimFans(sim, layoutFans) {
  const { grid, fluid } = sim;
  const fans = [];
  for (const f of layoutFans) {
    const i = Math.floor((f.x - grid.x0) / grid.h), j = Math.floor((f.y - grid.y0) / grid.h);
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny || grid.cells[i + j * grid.nx] !== LCELL.FLUID) continue;
    const fan = fanFromPreset(FAN_PRESETS[f.preset], speedFraction(f.speed), f.x - grid.x0, f.y - grid.y0, (f.angle * Math.PI) / 180);
    const old = fluid.fans.find((o) => o.layoutId === f.id);
    fan.speed = old ? old.speed : 0; // keep the current spin state when only settings change
    fan.layoutId = f.id;
    fans.push(fan);
  }
  setFans(fluid, fans);
  reapplyZoneInputs(sim);
}

/** Changes the conditions (wind, temperatures, orientation…) and re-solves Layer A now. */
export function setConditions(sim, conditions) {
  sim.conditions = conditions;
  sim.fluid.ceilingHeight = conditions.ceilingHeight;
  for (const z of sim.zones) z.volume = z.area * conditions.ceilingHeight;
  updateEnvelope(sim);
}

/**
 * SCIENCE.md §5.8 / §6.7: solve Layer A for every zone and set Layer B's boundary conditions.
 */
export function updateEnvelope(sim) {
  const { conditions: cond, fluid, grid, zones, openings } = sim;
  const UH = windSpeedAtHeight(cond.windSpeed, DEFAULT_BUILDING_HEIGHT, TERRAIN[cond.terrain]);
  const warnings = [];
  let kindsChanged = false;
  const bands = [];

  for (const zone of zones) {
    const zoneOps = openings.filter((o) => o.zone === zone.id);
    const active = [], prepared = [];
    for (const o of zoneOps) {
      const L = o.layout;
      if (!L.open || L.openFraction <= 0) { o.result = null; continue; }
      let fan;
      if (L.fan && L.fan.speed !== 'off') {
        const p = FAN_PRESETS[L.fan.preset];
        const q = p.flowHigh * speedFraction(L.fan.speed);
        fan = { flow: L.fan.direction === 'in' ? q : -q, faceArea: p.faceWidth * p.faceHeight };
      }
      active.push(o);
      prepared.push(prepareOpening({
        id: o.id, width: L.width, zBottom: L.zBottom, zTop: L.zTop, openFraction: L.openFraction,
        wallNormalDeg: wallNormalBearing(o.normal, cond.orientation), sideRatio: grid.sideRatio[o.normal], fan,
      }, cond.windFrom));
    }
    const res = solveZone(prepared, { Tout: cond.Tout, Tin: zone.Tmean, UH, Umet: cond.windSpeed }, zone.volume);
    zone.result = res;
    zone.balanced = res.balanced;
    if (!res.balanced) warnings.push('A window fan has no way for air to get in or out of its room, so it is ignored. Open another window or door.');

    let sliceInflow = 0;
    active.forEach((o, k) => {
      const r = res.openings[k];
      o.result = { ...r, beta: prepared[k].beta, cp: prepared[k].cp };
      const area = openingArea(o.layout);
      const role = !res.balanced ? 'closed' : r.Q > FLOW_ZERO_TOL ? 'inlet' : r.Q < -FLOW_ZERO_TOL ? 'outlet' : 'closed';
      if (role !== o.role) kindsChanged = true;
      o.role = role;
      const [di, dj] = INWARD[o.normal];
      const un = role === 'inlet' ? r.Q / area : 0;
      for (const c of o.cells) {
        fluid.kind[c] = role === 'inlet' ? CELL.INLET : role === 'outlet' ? CELL.OUTLET : CELL.SOLID;
        fluid.bu[c] = di * un; fluid.bv[c] = dj * un;
        fluid.TBC[c] = cond.Tout;
        fluid.pBC[c] = 0;
      }
      if (role === 'inlet') sliceInflow += un * o.cells.length * grid.h * cond.ceilingHeight;
      if (r.Qexchange > 0) bands.push({ cells: bandCells(grid, o, di, dj), Qexchange: r.Qexchange, T: cond.Tout });
    });
    for (const o of zoneOps) if (!active.includes(o) && o.role !== 'closed') {
      kindsChanged = true;
      o.role = 'closed';
      for (const c of o.cells) { fluid.kind[c] = CELL.SOLID; fluid.bu[c] = 0; fluid.bv[c] = 0; }
    }
    // SCIENCE.md §6.7 slice factor r_z
    zone.sliceFactor = res.balanced && res.Qin > 0 ? sliceInflow / res.Qin : 1;
  }

  if (kindsChanged) setCells(fluid);
  setExchangeBands(fluid, bands);
  reapplyZoneInputs(sim);
  sim.warnings = warnings;
  sim.nextEnvelope = sim.time + ENVELOPE_UPDATE_INTERVAL;
}

// Fluid cells 1..EXCHANGE_BAND_CELLS inside each opening cell (SCIENCE.md §6.4).
function bandCells(grid, o, di, dj) {
  const out = [];
  for (const c of o.cells) {
    const i = c % grid.nx, j = (c - i) / grid.nx;
    for (let k = 1; k <= EXCHANGE_BAND_CELLS; k++) {
      const d = (i + di * k) + (j + dj * k) * grid.nx;
      if (grid.cells[d] === LCELL.FLUID) out.push(d);
    }
  }
  return Int32Array.from(out);
}

// setCells resets Layer B's per-zone inputs; write the zone-mean temperatures and age rates back.
function reapplyZoneInputs(sim) {
  const { fluid, zones } = sim;
  for (const z of zones) {
    const comp = componentOf(fluid, z.cell);
    if (comp < 0) continue;
    fluid.zoneTargetT[comp] = z.Tmean;
    fluid.ageRate[comp] = z.sliceFactor;
  }
}

/**
 * Advances the simulation by one Layer B step (Δt from the CFL rule, §6.2). Returns Δt.
 * Order: zone heat balance (§6.7) → Layer B step → Layer A update when due (§5.8).
 */
export function advance(sim) {
  const { fluid, zones, conditions: cond } = sim;
  const dt = computeDt(fluid);
  for (const z of zones) {
    const r = z.result;
    const q = r && z.balanced ? r.Qin + r.QexchangeTotal : 0;
    z.Tmean = cond.Tout + (z.Tmean - cond.Tout) * Math.exp((-dt * q) / z.volume);
  }
  reapplyZoneInputs(sim);
  step(fluid, dt);
  sim.time += dt;
  if (sim.time >= sim.nextEnvelope) updateEnvelope(sim);
  return dt;
}

/** Room-average age of air per zone, s (§7.3). */
export function zoneMeanAge(sim, zoneId) {
  const { fluid, zones } = sim;
  const comp = componentOf(fluid, zones[zoneId].cell);
  let sum = 0, n = 0;
  for (let c = 0; c < fluid.A.length; c++) if (fluid.kind[c] === CELL.FLUID && componentOf(fluid, c) === comp) { sum += fluid.A[c]; n++; }
  return n ? sum / n : 0;
}

export { fluidMean };
