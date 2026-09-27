// Floor-plan data model. Pure functions, SI units (metres), no DOM.
//
// Coordinates: x to the right, y DOWN (screen convention), origin at the plan's top-left corner.
// Walls are axis-aligned segments. Openings (windows, doors) sit on a wall. Fans sit anywhere.
// Every function that changes a layout returns a NEW layout object (the input is not modified),
// which keeps undo simple.
//
// Layout JSON (version 1):
// { version: 1, width, height,                            plan area, m
//   walls:    [{ x0, y0, x1, y1 }],                         axis-aligned, x0 ≤ x1, y0 ≤ y1
//   openings: [{ id, type: 'window'|'door', x, y,          centre on the wall line, m
//                axis: 'h'|'v',                             direction of the wall it sits on
//                width, zBottom, zTop,                      m (SCIENCE.md §4.3)
//                open: bool, openFraction: 0–1,
//                fan: null | { preset, direction: 'in'|'out', speed } }],   window fan (§5.6)
//   fans:     [{ id, preset, x, y, angle, speed }],         angle: degrees, 0 = +x, clockwise on screen
//                                                           speed: 'off'|'low'|'medium'|'high'
//   probes:   [{ id, x, y }],                              comfort probes ("person" markers), SCIENCE.md §7.3
//   conditions?: { orientation, windSpeed, windFrom, terrain, Tout, TinStart, ceilingHeight,
//                  target?, goal? } }                       optional, SI; target K, goal 'breeze'|'cool'|'fresh'

import { DOOR_DEFAULTS, WINDOW_DEFAULTS, SLIDING_WINDOW_OPEN_FRACTION, FAN_PRESETS, TERRAIN } from '../constants.js';

export const LAYOUT_VERSION = 1;
export const FAN_SPEEDS = Object.freeze(['off', 'low', 'medium', 'high']);
export const GOALS = Object.freeze(['breeze', 'cool', 'fresh']);
const EPS = 1e-6; // m, tolerance for "same line"

export function createLayout(width, height) {
  return { version: LAYOUT_VERSION, width, height, walls: [], openings: [], fans: [], probes: [] };
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/** Adds an axis-aligned wall. Diagonal input is snapped to its dominant axis; zero length is ignored. */
export function addWall(layout, x0, y0, x1, y1) {
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) y1 = y0; else x1 = x0;
  if (Math.abs(x1 - x0) < EPS && Math.abs(y1 - y0) < EPS) return layout;
  const wall = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  return { ...layout, walls: [...layout.walls, wall] };
}

/** Adds the four walls of a rectangle with opposite corners (xa, ya) and (xb, yb). */
export function addRoom(layout, xa, ya, xb, yb) {
  if (Math.abs(xb - xa) < EPS || Math.abs(yb - ya) < EPS) return layout;
  let l = addWall(layout, xa, ya, xb, ya);
  l = addWall(l, xa, yb, xb, yb);
  l = addWall(l, xa, ya, xa, yb);
  return addWall(l, xb, ya, xb, yb);
}

export function wallAxis(w) {
  return Math.abs(w.y1 - w.y0) < EPS ? 'h' : 'v';
}

/** Removes wall `index` and any openings left without a wall under them. */
export function removeWall(layout, index) {
  const walls = layout.walls.filter((_, k) => k !== index);
  const l = { ...layout, walls };
  return { ...l, openings: l.openings.filter((o) => isOnWall(l, o)) };
}

/**
 * Nearest wall to (x, y) within `tol` metres, measured perpendicular to the wall, with the
 * point's projection falling on the segment. Returns { index, axis, px, py, dist } or null.
 */
export function findWall(layout, x, y, tol) {
  let best = null;
  layout.walls.forEach((w, index) => {
    const axis = wallAxis(w);
    let px, py, dist;
    if (axis === 'h') {
      if (x < w.x0 - tol || x > w.x1 + tol) return;
      px = Math.min(Math.max(x, w.x0), w.x1); py = w.y0; dist = Math.hypot(x - px, y - py);
    } else {
      if (y < w.y0 - tol || y > w.y1 + tol) return;
      px = w.x0; py = Math.min(Math.max(y, w.y0), w.y1); dist = Math.hypot(x - px, y - py);
    }
    if (dist <= tol && (!best || dist < best.dist)) best = { index, axis, px, py, dist };
  });
  return best;
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

/** Is the opening's centre on some wall of the same direction? */
export function isOnWall(layout, o) {
  return layout.walls.some((w) => {
    if (wallAxis(w) !== o.axis) return false;
    if (o.axis === 'h') return Math.abs(w.y0 - o.y) < EPS && o.x >= w.x0 - EPS && o.x <= w.x1 + EPS;
    return Math.abs(w.x0 - o.x) < EPS && o.y >= w.y0 - EPS && o.y <= w.y1 + EPS;
  });
}

function nextId(layout, prefix) {
  const used = new Set([...layout.openings, ...layout.fans, ...(layout.probes ?? [])].map((it) => it.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

// Centre position on wall w for an opening of this width near point (px, py): the opening is kept
// inside the wall segment when it fits, otherwise centred on the wall.
function positionOnWall(w, axis, px, py, width) {
  if (axis === 'h') {
    const lo = w.x0 + width / 2, hi = w.x1 - width / 2;
    return { x: lo <= hi ? Math.min(Math.max(px, lo), hi) : (w.x0 + w.x1) / 2, y: w.y0 };
  }
  const lo = w.y0 + width / 2, hi = w.y1 - width / 2;
  return { x: w.x0, y: lo <= hi ? Math.min(Math.max(py, lo), hi) : (w.y0 + w.y1) / 2 };
}

/**
 * Places a window or door on the wall nearest (x, y), within `tol` metres.
 * Uses the SCIENCE.md §4.3 defaults. Returns { layout, id } or null if there's no wall nearby.
 */
export function placeOpening(layout, type, x, y, tol) {
  const hit = findWall(layout, x, y, tol);
  if (!hit) return null;
  const d = type === 'door' ? DOOR_DEFAULTS : WINDOW_DEFAULTS;
  const pos = positionOnWall(layout.walls[hit.index], hit.axis, hit.px, hit.py, d.width);
  const id = nextId(layout, type === 'door' ? 'door' : 'win');
  const opening = {
    id, type, ...pos, axis: hit.axis,
    width: d.width, zBottom: d.zBottom, zTop: d.zTop,
    open: true,
    openFraction: type === 'door' ? 1 : SLIDING_WINDOW_OPEN_FRACTION,
    fan: null,
  };
  return { layout: { ...layout, openings: [...layout.openings, opening] }, id };
}

/** Moves an opening to the wall nearest (x, y). Returns the layout unchanged if there's no wall nearby. */
export function moveOpening(layout, id, x, y, tol) {
  const hit = findWall(layout, x, y, tol);
  if (!hit) return layout;
  return {
    ...layout,
    openings: layout.openings.map((o) => (o.id !== id ? o : {
      ...o, ...positionOnWall(layout.walls[hit.index], hit.axis, hit.px, hit.py, o.width), axis: hit.axis,
    })),
  };
}

// ---------------------------------------------------------------------------
// Fans
// ---------------------------------------------------------------------------

export function addFan(layout, preset, x, y, angle = 0, speed = 'high') {
  const id = nextId(layout, 'fan');
  return { layout: { ...layout, fans: [...layout.fans, { id, preset, x, y, angle, speed }] }, id };
}

// ---------------------------------------------------------------------------
// Comfort probes ("person" markers)
// ---------------------------------------------------------------------------

export function addProbe(layout, x, y) {
  const id = nextId(layout, 'person');
  return { layout: { ...layout, probes: [...(layout.probes ?? []), { id, x, y }] }, id };
}

// ---------------------------------------------------------------------------
// Generic item edits (openings, fans and probes, by id)
// ---------------------------------------------------------------------------

export function findItem(layout, id) {
  return layout.openings.find((o) => o.id === id) || layout.fans.find((f) => f.id === id)
    || (layout.probes ?? []).find((p) => p.id === id) || null;
}

/** Shallow-merges `patch` into the opening, fan or probe with this id. */
export function updateItem(layout, id, patch) {
  return {
    ...layout,
    openings: layout.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    fans: layout.fans.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    probes: (layout.probes ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
  };
}

export function removeItem(layout, id) {
  return {
    ...layout,
    openings: layout.openings.filter((o) => o.id !== id),
    fans: layout.fans.filter((f) => f.id !== id),
    probes: (layout.probes ?? []).filter((p) => p.id !== id),
  };
}

// ---------------------------------------------------------------------------
// Serialisation and validation
// ---------------------------------------------------------------------------

export function serializeLayout(layout) {
  return JSON.stringify(layout, null, 2);
}

/**
 * Checks an object read from JSON and returns a clean layout, or throws an Error whose message
 * says what's wrong in plain English. Unknown extra fields are dropped.
 */
export function parseLayout(obj) {
  const fail = (msg) => { throw new Error(`This isn't a valid layout file: ${msg}`); };
  const num = (v, what) => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} must be a number.`); return v; };
  const pos = (v, what) => { if (num(v, what) <= 0) fail(`${what} must be greater than zero.`); return v; };

  if (!obj || typeof obj !== 'object') fail('it is empty or not JSON.');
  if (obj.version !== LAYOUT_VERSION) fail(`unsupported version ${JSON.stringify(obj.version)} (expected ${LAYOUT_VERSION}).`);
  for (const key of ['walls', 'openings', 'fans']) if (!Array.isArray(obj[key])) fail(`"${key}" must be a list.`);

  const layout = createLayout(pos(obj.width, 'width'), pos(obj.height, 'height'));
  layout.walls = obj.walls.map((w, k) => {
    const x0 = num(w.x0, `wall ${k + 1} x0`), y0 = num(w.y0, `wall ${k + 1} y0`);
    const x1 = num(w.x1, `wall ${k + 1} x1`), y1 = num(w.y1, `wall ${k + 1} y1`);
    if (Math.abs(x1 - x0) > EPS && Math.abs(y1 - y0) > EPS) fail(`wall ${k + 1} is diagonal; walls must be horizontal or vertical.`);
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  });
  const ids = new Set();
  const uniqueId = (id, what) => {
    if (typeof id !== 'string' || !id) fail(`${what} needs an id.`);
    if (ids.has(id)) fail(`id "${id}" is used twice.`);
    ids.add(id);
    return id;
  };
  layout.openings = obj.openings.map((o, k) => {
    const what = `opening ${k + 1}`;
    if (o.type !== 'window' && o.type !== 'door') fail(`${what} must be a window or a door.`);
    if (o.axis !== 'h' && o.axis !== 'v') fail(`${what} axis must be "h" or "v".`);
    const zBottom = num(o.zBottom, `${what} bottom height`), zTop = num(o.zTop, `${what} top height`);
    if (zBottom < 0 || zTop <= zBottom) fail(`${what} needs 0 ≤ bottom height < top height.`);
    const openFraction = num(o.openFraction, `${what} open amount`);
    if (openFraction < 0 || openFraction > 1) fail(`${what} open amount must be between 0 and 1.`);
    let fan = null;
    if (o.fan) {
      if (!FAN_PRESETS[o.fan.preset]) fail(`${what} has an unknown window fan type.`);
      if (o.fan.direction !== 'in' && o.fan.direction !== 'out') fail(`${what} window fan direction must be "in" or "out".`);
      if (!FAN_SPEEDS.includes(o.fan.speed)) fail(`${what} window fan speed is not recognised.`);
      fan = { preset: o.fan.preset, direction: o.fan.direction, speed: o.fan.speed };
    }
    return {
      id: uniqueId(o.id, what), type: o.type,
      x: num(o.x, `${what} x`), y: num(o.y, `${what} y`), axis: o.axis,
      width: pos(o.width, `${what} width`), zBottom, zTop,
      open: Boolean(o.open), openFraction, fan,
    };
  });
  layout.fans = obj.fans.map((f, k) => {
    const what = `fan ${k + 1}`;
    if (!FAN_PRESETS[f.preset]) fail(`${what} has an unknown fan type.`);
    if (!FAN_SPEEDS.includes(f.speed)) fail(`${what} speed is not recognised.`);
    return {
      id: uniqueId(f.id, what), preset: f.preset,
      x: num(f.x, `${what} x`), y: num(f.y, `${what} y`), angle: num(f.angle, `${what} angle`), speed: f.speed,
    };
  });
  if (obj.probes !== undefined) {
    if (!Array.isArray(obj.probes)) fail('"probes" must be a list.');
    layout.probes = obj.probes.map((p, k) => ({
      id: uniqueId(p.id, `person marker ${k + 1}`), x: num(p.x, `person marker ${k + 1} x`), y: num(p.y, `person marker ${k + 1} y`),
    }));
  }
  if (obj.conditions !== undefined) {
    const c = obj.conditions;
    if (!c || typeof c !== 'object') fail('"conditions" must be an object.');
    if (!TERRAIN[c.terrain]) fail('conditions terrain is not recognised.');
    if (num(c.windSpeed, 'wind speed') < 0) fail('wind speed must not be negative.');
    layout.conditions = {
      orientation: num(c.orientation, 'orientation'), windSpeed: c.windSpeed, windFrom: num(c.windFrom, 'wind direction'),
      terrain: c.terrain, Tout: pos(c.Tout, 'outside temperature'), TinStart: pos(c.TinStart, 'inside temperature'),
      ceilingHeight: pos(c.ceilingHeight, 'ceiling height'),
    };
    if (c.target !== undefined) layout.conditions.target = pos(c.target, 'target temperature');
    if (c.goal !== undefined) {
      if (!GOALS.includes(c.goal)) fail('conditions goal is not recognised.');
      layout.conditions.goal = c.goal;
    }
  }
  return layout;
}
