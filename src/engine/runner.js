// Simulation runner: owns a simulation (physics/coupling.js), advances it toward `speed` × real
// time, and packs snapshots for drawing. No DOM; used inside the Web Worker (engine/worker.js) and,
// as a fallback, on the main thread (engine/client.js).

import { buildGrid } from '../layout/grid.js';
import { createSimulation, setConditions, setSimFans, advance } from '../physics/coupling.js';

const MAX_DEBT_S = 0.25;   // never owe more than this much real time of simulation (slow machines)

/** Per-zone numbers the page needs (SCIENCE.md §5.8, §7.3), flattened from the simulation. */
export function snapshotZones(sim) {
  return sim.zones.map((z) => ({
    Tmean: z.Tmean, balanced: z.balanced, sliceFactor: z.sliceFactor,
    ach: z.result ? z.result.ach : 0, Qin: z.result ? z.result.Qin : 0,
    Qexchange: z.result ? z.result.QexchangeTotal : 0, volume: z.volume,
  }));
}

export function createRunner() {
  let sim = null, buildId = 0;
  let playing = false, speed = 1;
  let debt = 0, achieved = null, lastTick = null;

  return {
    /** New simulation from a layout (restarts from the starting temperature). */
    build(layout, conditions, id) {
      buildId = id;
      const grid = buildGrid(layout);
      sim = grid.ok ? createSimulation(layout, grid, conditions) : null;
      debt = 0;
    },
    setConditions(c) { if (sim) setConditions(sim, c); },
    setFans(fans) { if (sim) setSimFans(sim, fans); },
    setPlaying(p) { playing = p; lastTick = null; debt = 0; if (!p) achieved = null; },
    setSpeed(s) { speed = s; },
    hasWork: () => Boolean(sim && playing && debt > 0),

    /** Runs solver steps for up to sliceMs of wall time, paying off the simulation time owed. */
    tick(sliceMs) {
      const now = performance.now();
      if (!sim || !playing) { lastTick = now; return; }
      const realDt = lastTick === null ? 0 : (now - lastTick) / 1000;
      lastTick = now;
      debt = Math.min(debt + speed * realDt, speed * MAX_DEBT_S);
      let done = 0;
      while (debt > 0 && performance.now() - now < sliceMs) { const dt = advance(sim); debt -= dt; done += dt; }
      if (realDt > 0) {
        const rate = done / realDt;
        achieved = achieved === null ? rate : 0.9 * achieved + 0.1 * rate;
      }
    },

    /**
     * Everything the page needs to draw, as fresh typed arrays (transferable to the main thread).
     * @returns { snapshot, transfer } or null when there is no valid simulation
     */
    snapshot() {
      if (!sim) return { snapshot: { buildId, ok: false }, transfer: [] };
      const f = sim.fluid;
      const u = Float32Array.from(f.u), v = Float32Array.from(f.v);
      const T = Float32Array.from(f.T), A = Float32Array.from(f.A), kind = Uint8Array.from(f.kind);
      const snapshot = {
        buildId, ok: true, time: sim.time, achieved,
        u, v, T, A, kind,
        openings: sim.openings.map((o) => ({ id: o.id, role: o.role, result: o.result })),
        zones: snapshotZones(sim),
        warnings: sim.warnings,
      };
      return { snapshot, transfer: [u.buffer, v.buffer, T.buffer, A.buffer, kind.buffer] };
    },
  };
}
