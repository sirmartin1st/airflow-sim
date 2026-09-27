// Every preset in presets/ loads, forms closed rooms and runs. SCIENCE.md §7 / Phase 8.
import { readFileSync } from 'node:fs';
import { check, finish } from './lib.js';
import { parseLayout } from '../src/layout/layout.js';
import { buildGrid } from '../src/layout/grid.js';
import { createSimulation, advance } from '../src/physics/coupling.js';

const dir = new URL('../presets/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir)));

check('index lists four presets with labels and descriptions', () => {
  if (index.length !== 4 || index.some((p) => !p.file || !p.label || !p.description)) throw new Error(JSON.stringify(index));
});

for (const p of index) {
  check(`${p.label}: parses, closed rooms, no warnings, runs 50 steps`, () => {
    const layout = parseLayout(JSON.parse(readFileSync(new URL(p.file, dir))));
    if (!layout.conditions) throw new Error('missing conditions');
    const grid = buildGrid(layout);
    if (!grid.ok || grid.warnings.length) throw new Error(grid.error ?? grid.warnings.join('; '));
    const sim = createSimulation(layout, grid, layout.conditions);
    if (sim.warnings.length) throw new Error(sim.warnings.join('; '));
    for (let k = 0; k < 50; k++) advance(sim);
    if (!(sim.time > 0) || sim.zones.some((z) => !Number.isFinite(z.Tmean))) throw new Error('did not run');
  });
}

finish();
