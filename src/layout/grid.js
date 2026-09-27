// Turns a layout (layout.js) into the solver's cell grid. SCIENCE.md §4.2–4.4.
// Pure, no DOM, SI units. Grid coordinates follow the layout: x right, y DOWN, so
// cell (i, j) covers [x0 + i·h, x0 + (i+1)·h] × [y0 + j·h, y0 + (j+1)·h].
//
// Steps:
//  1. Rasterise walls (1 cell thick) onto a grid covering the walls' bounding box plus a margin.
//     Every opening's cells are walls at this stage, so the envelope stays closed.
//  2. Flood-fill from the grid border through non-wall cells: everything reached is OUTSIDE (§4.2).
//     Everything else that isn't a wall is indoor air (FLUID).
//  3. Classify each opening from the cells on either side of it: exterior (indoor one side,
//     outdoor the other), interior (indoor both sides) or invalid.
//  4. Open interior openings become FLUID (§4.2). Exterior openings stay wall cells here;
//     Layer B turns them into inlets/outlets once Layer A has solved (Phase 6).
//  5. Zones: connected regions of FLUID cells (§4.4).

import { DEFAULT_CELL_SIZE, MAX_GRID_CELLS, SLICE_HEIGHT } from '../constants.js';

export const LCELL = Object.freeze({ OUTSIDE: 0, FLUID: 1, WALL: 2 });
const { OUTSIDE, FLUID, WALL } = LCELL;
const MARGIN = 2; // cells of outdoor air kept around the building

/** Outward normal of each side of a wall, as a grid direction ('up' = −y, i.e. toward the top of the plan). */
const SIDES = { h: ['up', 'down'], v: ['left', 'right'] };

/**
 * @returns {
 *   ok, error,                     ok = false with a plain-English error if there's no closed room
 *   nx, ny, h, x0, y0,             grid size, cell size and world position of cell (0, 0)
 *   cells: Uint8Array,             LCELL per cell
 *   zone: Int32Array,              zone index per FLUID cell, −1 otherwise
 *   zones: [{ id, cells, area }],  area in m²
 *   openings: [{ id, cells: number[], kind: 'exterior'|'interior'|'invalid',
 *                normal (exterior: outward grid direction), zone (exterior), crossesSlice }],
 *   footprint: { width, height },  bounding box of the building (walls + indoor air), m
 *   sideRatio: { up, down, left, right },   S for Swami & Chandra Cp (§5.3)
 *   warnings: string[] }
 */
export function buildGrid(layout, h = DEFAULT_CELL_SIZE) {
  const warnings = [];
  if (layout.walls.length === 0) return { ok: false, error: 'Draw some walls to make a room.', warnings };

  // --- grid extent ---
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of layout.walls) {
    minX = Math.min(minX, w.x0); minY = Math.min(minY, w.y0);
    maxX = Math.max(maxX, w.x1); maxY = Math.max(maxY, w.y1);
  }
  const x0 = (Math.floor(minX / h) - MARGIN) * h, y0 = (Math.floor(minY / h) - MARGIN) * h;
  const nx = Math.floor((maxX - x0) / h) + 1 + MARGIN, ny = Math.floor((maxY - y0) / h) + 1 + MARGIN;
  if (nx > MAX_GRID_CELLS || ny > MAX_GRID_CELLS) {
    return { ok: false, error: `The building is too big for the simulator (limit ${MAX_GRID_CELLS} × ${MAX_GRID_CELLS} cells of ${h} m).`, warnings };
  }
  const col = (x) => Math.floor((x - x0) / h + 1e-9);
  const row = (y) => Math.floor((y - y0) / h + 1e-9);
  const cells = new Uint8Array(nx * ny); // all OUTSIDE (0) to start

  // --- 1. walls: the cells containing the wall line, endpoints included, so corners close ---
  for (const w of layout.walls) {
    if (Math.abs(w.y1 - w.y0) < 1e-9) {
      const j = row(w.y0);
      for (let i = col(w.x0); i <= col(w.x1); i++) cells[i + j * nx] = WALL;
    } else {
      const i = col(w.x0);
      for (let j = row(w.y0); j <= row(w.y1); j++) cells[i + j * nx] = WALL;
    }
  }

  // Opening cells: wall cells on the opening's line whose centres fall within its width,
  // half-open [start, end) with a small tolerance so exact ties round the same way at both ends.
  const firstCentre = (t) => Math.ceil((t) / h - 0.5 - 1e-7);
  const openingCells = layout.openings.map((o) => {
    const list = [];
    if (o.axis === 'h') {
      const j = row(o.y);
      const a = firstCentre(o.x - o.width / 2 - x0), b = firstCentre(o.x + o.width / 2 - x0) - 1;
      for (let i = a; i <= b; i++) if (i >= 0 && i < nx && cells[i + j * nx] === WALL) list.push(i + j * nx);
    } else {
      const i = col(o.x);
      const a = firstCentre(o.y - o.width / 2 - y0), b = firstCentre(o.y + o.width / 2 - y0) - 1;
      for (let j = a; j <= b; j++) if (j >= 0 && j < ny && cells[i + j * nx] === WALL) list.push(i + j * nx);
    }
    return list;
  });

  // --- 2. outside: flood fill from the border through non-wall cells ---
  const reached = new Uint8Array(nx * ny);
  const queue = new Int32Array(nx * ny);
  let head = 0, tail = 0;
  const seed = (c) => { if (!reached[c] && cells[c] !== WALL) { reached[c] = 1; queue[tail++] = c; } };
  for (let i = 0; i < nx; i++) { seed(i); seed(i + (ny - 1) * nx); }
  for (let j = 0; j < ny; j++) { seed(j * nx); seed(nx - 1 + j * nx); }
  while (head < tail) {
    const c = queue[head++], i = c % nx, j = (c - i) / nx;
    if (i > 0) seed(c - 1);
    if (i < nx - 1) seed(c + 1);
    if (j > 0) seed(c - nx);
    if (j < ny - 1) seed(c + nx);
  }
  let fluidCount = 0;
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] !== WALL && !reached[c]) { cells[c] = FLUID; fluidCount++; }
  }
  if (fluidCount === 0) {
    return { ok: false, error: "The room isn't closed: no indoor space found. Draw walls all the way around.", warnings };
  }

  // --- 3. classify openings from the cells on either side ---
  const openings = layout.openings.map((o, k) => {
    const list = openingCells[k];
    const [sideA, sideB] = SIDES[o.axis];
    const off = o.axis === 'h' ? nx : 1;            // step to the neighbour across the wall
    let aFluid = 0, aOut = 0, bFluid = 0, bOut = 0;
    for (const c of list) {
      const a = c - off, b = c + off;
      if (cells[a] === FLUID) aFluid++; else if (cells[a] === OUTSIDE) aOut++;
      if (cells[b] === FLUID) bFluid++; else if (cells[b] === OUTSIDE) bOut++;
    }
    const aIsFluid = aFluid > aOut, bIsFluid = bFluid > bOut;
    const aIsOut = aOut > aFluid, bIsOut = bOut > bFluid;
    let kind = 'invalid', normal = null;
    if (list.length === 0) kind = 'invalid';
    else if (aIsFluid && bIsFluid) kind = 'interior';
    else if (aIsFluid && bIsOut) { kind = 'exterior'; normal = sideB; }
    else if (aIsOut && bIsFluid) { kind = 'exterior'; normal = sideA; }
    if (kind === 'invalid') warnings.push(`${label(o)} isn't between indoor and outdoor air (or two rooms), so it will be ignored.`);
    const crossesSlice = o.zBottom <= SLICE_HEIGHT && o.zTop >= SLICE_HEIGHT;
    return { id: o.id, cells: list, kind, normal, zone: -1, crossesSlice, open: o.open && o.openFraction > 0 };
  });

  // --- 4. open interior openings join the rooms on either side ---
  for (const op of openings) {
    if (op.kind === 'interior' && op.open) for (const c of op.cells) cells[c] = FLUID;
  }

  // --- 5. zones ---
  const zone = new Int32Array(nx * ny).fill(-1);
  const zones = [];
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== FLUID || zone[start] !== -1) continue;
    const id = zones.length;
    head = 0; tail = 0; queue[tail++] = start; zone[start] = id;
    while (head < tail) {
      const c = queue[head++], i = c % nx, j = (c - i) / nx;
      const visit = (d) => { if (cells[d] === FLUID && zone[d] === -1) { zone[d] = id; queue[tail++] = d; } };
      if (i > 0) visit(c - 1);
      if (i < nx - 1) visit(c + 1);
      if (j > 0) visit(c - nx);
      if (j < ny - 1) visit(c + nx);
    }
    zones.push({ id, cells: tail, area: tail * h * h });
  }

  // Exterior openings belong to the zone on their indoor side.
  for (const op of openings) {
    if (op.kind !== 'exterior') continue;
    const inward = { up: nx, down: -nx, left: 1, right: -1 }[op.normal];
    const counts = new Map();
    for (const c of op.cells) { const z = zone[c + inward]; if (z >= 0) counts.set(z, (counts.get(z) || 0) + 1); }
    op.zone = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
  }

  // Fans must stand in indoor air.
  for (const f of layout.fans) {
    const i = col(f.x), j = row(f.y);
    const inside = i >= 0 && i < nx && j >= 0 && j < ny && cells[i + j * nx] === FLUID;
    if (!inside) warnings.push(`Fan ${f.id} isn't inside a room, so it will be ignored.`);
  }

  // Footprint bounding box (walls + indoor air) for the Cp side ratio S (§5.3).
  let bi0 = nx, bi1 = -1, bj0 = ny, bj1 = -1;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (cells[i + j * nx] === OUTSIDE) continue;
    bi0 = Math.min(bi0, i); bi1 = Math.max(bi1, i); bj0 = Math.min(bj0, j); bj1 = Math.max(bj1, j);
  }
  const width = (bi1 - bi0 + 1) * h, height = (bj1 - bj0 + 1) * h;
  const sideRatio = { up: width / height, down: width / height, left: height / width, right: height / width };

  return {
    ok: true, error: null, nx, ny, h, x0, y0, cells, zone, zones, openings,
    footprint: { width, height }, sideRatio, warnings,
  };
}

function label(o) {
  return `${o.type === 'door' ? 'Door' : 'Window'} ${o.id}`;
}
