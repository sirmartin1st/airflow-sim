// Layout model and grid builder tests (src/layout). SCIENCE.md §4.
import { check, near, finish } from './lib.js';
import {
  createLayout, addWall, addRoom, removeWall, findWall, placeOpening, moveOpening, addFan,
  updateItem, removeItem, parseLayout, serializeLayout, isOnWall,
} from '../src/layout/layout.js';
import { buildGrid, LCELL } from '../src/layout/grid.js';
import { WINDOW_DEFAULTS, DOOR_DEFAULTS } from '../src/constants.js';

const h = 0.1;
// A 4 m × 3 m room with its corner at (1, 1).
const room = () => addRoom(createLayout(10, 8), 1, 1, 5, 4);

// --- model ---
check('addWall snaps a nearly-horizontal drag to horizontal and orders endpoints', () => {
  const l = addWall(createLayout(10, 8), 3, 2, 1, 2.2);
  const w = l.walls[0];
  near(w.x0, 1, 0); near(w.x1, 3, 0); near(w.y0, 2, 0); near(w.y1, 2, 0);
});
check('zero-length walls are ignored; addRoom adds four walls', () => {
  if (addWall(createLayout(10, 8), 1, 1, 1, 1).walls.length !== 0) throw new Error('zero-length wall added');
  if (room().walls.length !== 4) throw new Error('room should have 4 walls');
});
check('findWall: nearest wall within tolerance, projected onto it', () => {
  const hit = findWall(room(), 2.5, 1.2, 0.3);
  if (!hit || hit.axis !== 'h') throw new Error(JSON.stringify(hit));
  near(hit.px, 2.5, 1e-12); near(hit.py, 1, 1e-12);
  if (findWall(room(), 2.5, 2.5, 0.3) !== null) throw new Error('should miss in the middle of the room');
});
check('placeOpening: snaps to the wall, uses SCIENCE.md defaults, stays inside the segment', () => {
  const r = placeOpening(room(), 'window', 1.1, 1.05, 0.3); // near the top-left corner
  const o = r.layout.openings[0];
  near(o.y, 1, 1e-12, 'on the wall line');
  near(o.x, 1 + WINDOW_DEFAULTS.width / 2, 1e-12, 'clamped inside the wall');
  near(o.zBottom, WINDOW_DEFAULTS.zBottom, 0); near(o.openFraction, 0.5, 0);
  const d = placeOpening(room(), 'door', 5.05, 2.5, 0.3).layout.openings[0];
  if (d.axis !== 'v') throw new Error('door should be on the vertical wall');
  near(d.zTop, DOOR_DEFAULTS.zTop, 0); near(d.openFraction, 1, 0);
  if (placeOpening(room(), 'window', 3, 2.5, 0.3) !== null) throw new Error('no wall there');
});
check('moveOpening slides along or jumps to another wall; removeWall drops orphaned openings', () => {
  let { layout, id } = placeOpening(room(), 'window', 3, 1, 0.3);
  layout = moveOpening(layout, id, 1.0, 2.5, 0.3);          // onto the west wall
  const o = layout.openings[0];
  if (o.axis !== 'v') throw new Error('should be on the vertical wall');
  near(o.x, 1, 1e-12);
  const westIndex = layout.walls.findIndex((w) => w.x0 === 1 && w.x1 === 1);
  layout = removeWall(layout, westIndex);
  if (layout.openings.length !== 0) throw new Error('orphaned opening kept');
});
check('fans: add, update, remove; ids are unique', () => {
  let { layout, id } = addFan(room(), 'box20', 3, 2.5);
  const second = addFan(layout, 'tower', 2, 2);
  if (second.id === id) throw new Error('duplicate id');
  layout = updateItem(second.layout, id, { angle: 90, speed: 'low' });
  if (layout.fans[0].angle !== 90 || layout.fans[0].speed !== 'low') throw new Error('update failed');
  layout = removeItem(layout, id);
  if (layout.fans.length !== 1) throw new Error('remove failed');
});
check('parse(serialize(layout)) round-trips', () => {
  let l = placeOpening(room(), 'window', 3, 1, 0.3).layout;
  l = updateItem(l, l.openings[0].id, { fan: { preset: 'twinWindow', direction: 'in', speed: 'medium' } });
  l = addFan(l, 'pedestal16', 2, 2, 45, 'medium').layout;
  const back = parseLayout(JSON.parse(serializeLayout(l)));
  if (JSON.stringify(back) !== JSON.stringify(l)) throw new Error('round trip changed the layout');
});
check('conditions round-trip and are validated', () => {
  const l = { ...room(), conditions: { orientation: 90, windSpeed: 4, windFrom: 180, terrain: 'urban', Tout: 290, TinStart: 300, ceilingHeight: 2.44 } };
  if (JSON.stringify(parseLayout(JSON.parse(serializeLayout(l)))) !== JSON.stringify(l)) throw new Error('round trip');
  let msg = null;
  try { parseLayout({ ...JSON.parse(serializeLayout(l)), conditions: { ...l.conditions, terrain: 'moon' } }); } catch (e) { msg = e.message; }
  if (!msg) throw new Error('bad terrain accepted');
});

check('parseLayout rejects bad files with a readable message', () => {
  const good = JSON.parse(serializeLayout(room()));
  const bad = [
    null,
    { ...good, version: 99 },
    { ...good, walls: 'nope' },
    { ...good, walls: [{ x0: 0, y0: 0, x1: 1, y1: 1 }] },         // diagonal
    { ...good, width: -1 },
    { ...good, fans: [{ id: 'f', preset: 'jet engine', x: 1, y: 1, angle: 0, speed: 'high' }] },
    { ...good, fans: [{ id: 'f', preset: 'box20', x: NaN, y: 1, angle: 0, speed: 'high' }] },
  ];
  for (const b of bad) {
    let msg = null;
    try { parseLayout(b); } catch (e) { msg = e.message; }
    if (!msg || !msg.startsWith("This isn't a valid layout file")) throw new Error(`accepted: ${JSON.stringify(b)?.slice(0, 80)}`);
  }
});

// --- grid ---
check('grid: empty layout and open (unclosed) walls give plain-English errors', () => {
  if (buildGrid(createLayout(10, 8), h).ok) throw new Error('empty layout accepted');
  let l = addWall(createLayout(10, 8), 1, 1, 5, 1);
  l = addWall(l, 1, 1, 1, 4); l = addWall(l, 5, 1, 5, 4); l = addWall(l, 1, 4, 4.5, 4); // 0.5 m gap
  const g = buildGrid(l, h);
  if (g.ok || !/isn't closed/.test(g.error)) throw new Error(g.error);
});
check('grid: 4 × 3 m room → one zone with ~12 m² of indoor air', () => {
  const g = buildGrid(room(), h);
  if (!g.ok || g.zones.length !== 1) throw new Error(JSON.stringify(g.error ?? g.zones));
  // Walls are one cell thick along the drawn lines, so the indoor area is within a perimeter strip of 12 m².
  near(g.zones[0].area, 12, 14 * h);
  const i = Math.floor((3 - g.x0) / h), j = Math.floor((2.5 - g.y0) / h);
  if (g.cells[i + j * g.nx] !== LCELL.FLUID) throw new Error('room centre should be indoor air');
  if (g.cells[0] !== LCELL.OUTSIDE) throw new Error('corner should be outside');
});
check('grid: interior wall splits into two zones; an open door joins them; a closed door keeps them apart', () => {
  let l = addWall(room(), 3, 1, 3, 4);
  if (buildGrid(l, h).zones.length !== 2) throw new Error('expected 2 zones');
  const r = placeOpening(l, 'door', 3, 2.5, 0.3);
  l = r.layout;
  const g = buildGrid(l, h);
  const op = g.openings.find((o) => o.id === r.id);
  if (op.kind !== 'interior') throw new Error(`door kind ${op.kind}`);
  if (g.zones.length !== 1) throw new Error(`open door: ${g.zones.length} zones`);
  if (buildGrid(updateItem(l, r.id, { open: false }), h).zones.length !== 2) throw new Error('closed door should split');
});
check('grid: exterior windows get the right outward normal and zone; openings are 9 cells for 0.9 m', () => {
  let l = room();
  const cases = [[3, 1, 'up'], [3, 4, 'down'], [1, 2.5, 'left'], [5, 2.5, 'right']];
  for (const [x, y] of cases) l = placeOpening(l, 'window', x, y, 0.3).layout;
  const g = buildGrid(l, h);
  g.openings.forEach((op, k) => {
    if (op.kind !== 'exterior' || op.normal !== cases[k][2]) throw new Error(`window ${k}: ${op.kind} ${op.normal}`);
    if (op.zone !== 0) throw new Error(`window ${k} zone ${op.zone}`);
    if (op.cells.length !== 9) throw new Error(`window ${k} has ${op.cells.length} cells`);
    if (!op.crossesSlice) throw new Error('default window crosses the 1.1 m slice');
  });
  // The envelope stays closed: open windows don't let the outside flood in.
  if (g.zones.length !== 1 || g.zones[0].area < 10) throw new Error('outside leaked into the room');
});
check('grid: high window flagged as not crossing the 1.1 m slice (SCIENCE.md §6.4)', () => {
  let l = placeOpening(room(), 'window', 3, 1, 0.3).layout;
  l = updateItem(l, l.openings[0].id, { zBottom: 1.8, zTop: 2.2 });
  if (buildGrid(l, h).openings[0].crossesSlice) throw new Error('should be flagged');
});
check('grid: fan outside the room produces a warning; side ratio from footprint', () => {
  const l = addFan(room(), 'box20', 8, 6).layout;
  const g = buildGrid(l, h);
  if (!g.warnings.some((w) => /isn't inside a room/.test(w))) throw new Error('no warning');
  near(g.sideRatio.up, g.footprint.width / g.footprint.height, 1e-12);
  near(g.footprint.width, 4.1, 0.1 + 1e-9); near(g.footprint.height, 3.1, 0.1 + 1e-9);
});
check('grid: layouts larger than the cell cap are refused', () => {
  const g = buildGrid(addRoom(createLayout(40, 40), 0, 0, 30, 30), h);
  if (g.ok || !/too big/.test(g.error)) throw new Error('should refuse');
});
check('isOnWall is true for placed openings', () => {
  const l = placeOpening(room(), 'window', 3, 1, 0.3).layout;
  if (!isOnWall(l, l.openings[0])) throw new Error('not on wall');
});

finish();
