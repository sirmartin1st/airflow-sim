// Conditions panel (orientation, wind, temperatures, terrain, ceiling) and play controls.
// Shows imperial units and converts to SI at this edge (CLAUDE.md rule 3).

import { TERRAIN, DEFAULT_TERRAIN, DEFAULT_CEILING_HEIGHT } from '../constants.js';
import { mphToMps, mpsToMph, fToK, kToF, ftToM, mToFt } from '../units.js';

/** Starting conditions for a new plan, SI (see physics/coupling.js). */
export const DEFAULT_CONDITIONS = Object.freeze({
  orientation: 0,
  windSpeed: mphToMps(10),
  windFrom: 0,
  terrain: DEFAULT_TERRAIN,
  Tout: fToK(70),
  TinStart: fToK(80),
  ceilingHeight: DEFAULT_CEILING_HEIGHT,
});

export const SIM_SPEEDS = Object.freeze([1, 5, 20]);
export const DEFAULT_VIEW = Object.freeze({ particles: true, arrows: false, overlay: 'none' });

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassName = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const TERRAIN_LABELS = { open: 'Open (flat, few obstructions)', suburban: 'Suburban', urban: 'City / dense' };

/**
 * @param root      container element
 * @param opts.conditions  initial conditions (SI)
 * @param opts.onConditions(conditions)       any condition changed
 * @param opts.onPlay(playing), opts.onReset(), opts.onSpeed(multiplier)
 * @param opts.view, opts.onView(view)   display options { particles, arrows, overlay }
 */
export function createControls(root, { conditions, onConditions, onPlay, onReset, onSpeed, view = DEFAULT_VIEW, onView }) {
  let cond = { ...conditions };
  let viewState = { ...view };
  let playing = false;

  const emit = (patch) => { cond = { ...cond, ...patch }; onConditions(cond); };

  // --- play controls ---
  const playBtn = h('button', { type: 'button', class: 'primary' }, 'Play');
  const resetBtn = h('button', { type: 'button', title: 'Start again from the starting inside temperature' }, 'Reset');
  const speedSel = h('select', { 'aria-label': 'Simulation speed' }, ...SIM_SPEEDS.map((s) => h('option', { value: s }, `${s}×`)));
  const clock = h('p', { class: 'muted clock' }, 'Not started');
  playBtn.addEventListener('click', () => setPlaying(!playing));
  resetBtn.addEventListener('click', () => onReset());
  speedSel.addEventListener('change', () => onSpeed(Number(speedSel.value)));

  function setPlaying(p) {
    playing = p;
    playBtn.textContent = p ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(p));
    onPlay(p);
  }

  // --- conditions ---
  const orientation = angleField('Top of the plan faces', cond.orientation, (v) => emit({ orientation: v }));
  const windFrom = angleField('Wind comes from', cond.windFrom, (v) => emit({ windFrom: v }));
  const windSpeed = numberField('Wind speed (mph)', round1(mpsToMph(cond.windSpeed)), 0, 60, 1,
    (v) => emit({ windSpeed: mphToMps(v) }));
  const tout = numberField('Outside temperature (°F)', round1(kToF(cond.Tout)), -20, 120, 1, (v) => emit({ Tout: fToK(v) }));
  const tin = numberField('Inside temperature at start (°F)', round1(kToF(cond.TinStart)), 30, 110, 1,
    (v) => emit({ TinStart: fToK(v) }), 'Used when you press Reset or change the plan.');
  const terrain = h('select', {}, ...Object.keys(TERRAIN).map((k) => h('option', { value: k }, TERRAIN_LABELS[k] ?? k)));
  terrain.value = cond.terrain;
  terrain.addEventListener('change', () => emit({ terrain: terrain.value }));
  const ceiling = numberField('Ceiling height (ft)', round1(mToFt(cond.ceilingHeight)), 6, 20, 0.5,
    (v) => emit({ ceilingHeight: ftToM(v) }));

  // --- view options ---
  const setView = (patch) => { viewState = { ...viewState, ...patch }; onView?.(viewState); };
  const particlesBox = h('input', { type: 'checkbox' }); particlesBox.checked = viewState.particles;
  particlesBox.addEventListener('change', () => setView({ particles: particlesBox.checked }));
  const arrowsBox = h('input', { type: 'checkbox' }); arrowsBox.checked = viewState.arrows;
  arrowsBox.addEventListener('change', () => setView({ arrows: arrowsBox.checked }));
  const overlaySel = h('select', {},
    h('option', { value: 'none' }, 'None'),
    h('option', { value: 'speed' }, 'Air speed'),
    h('option', { value: 'age' }, 'Age of air (where fresh air reaches last)'),
    h('option', { value: 'stagnant' }, 'Stagnant areas'));
  overlaySel.value = viewState.overlay;
  overlaySel.addEventListener('change', () => setView({ overlay: overlaySel.value }));

  const results = h('div', { class: 'results' });
  root.replaceChildren(
    h('h2', {}, 'Simulation'),
    h('div', { class: 'row play' }, playBtn, resetBtn, speedSel),
    clock,
    results,
    h('h3', {}, 'Conditions'),
    orientation, windSpeed, windFrom, tout, tin,
    h('label', {}, 'Surroundings', terrain),
    ceiling,
    h('h3', {}, 'View'),
    h('label', { class: 'check' }, particlesBox, ' Particle trails (paths air takes, coloured by temperature)'),
    h('label', { class: 'check' }, arrowsBox, ' Arrows (direction and speed)'),
    h('label', {}, 'Colour overlay', overlaySel),
  );

  return {
    setPlaying,
    isPlaying: () => playing,
    /** Updates the clock line. simTime in s; achieved = actual sim-seconds per real second. */
    setClock(simTime, requested, achieved, fps, where) {
      const m = Math.floor(simTime / 60), s = Math.floor(simTime % 60);
      let text = `Simulated time ${m}:${String(s).padStart(2, '0')}`;
      if (playing && achieved !== null) {
        text += achieved < 0.9 * requested ? ` · running at ${achieved.toFixed(1)}× (limited by this computer)` : ` · ${requested}×`;
      }
      if (fps) text += ` · ${Math.round(fps)} fps`;
      if (fps && where) text += ` · solver: ${where}`;
      clock.textContent = text;
    },
    resultsElement: () => results,
  };
}

function angleField(label, value, onChange) {
  const range = h('input', { type: 'range', min: 0, max: 355, step: 5, value: Math.round(value) });
  const out = h('output', {}, fmtAngle(value));
  range.addEventListener('input', () => { out.textContent = fmtAngle(Number(range.value)); onChange(Number(range.value)); });
  return h('label', {}, label, h('span', { class: 'row' }, range, out));
}
const fmtAngle = (deg) => `${compassName(deg)} (${Math.round(deg)}°)`;

function numberField(label, value, min, max, step, onChange, note) {
  const input = h('input', { type: 'number', min, max, step, value });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v) && v >= min && v <= max) onChange(v); else input.value = value;
    value = Number(input.value);
  });
  return h('label', {}, label, input, note ? h('span', { class: 'muted' }, note) : null);
}

const round1 = (v) => Math.round(v * 10) / 10;

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'value') el.value = v; else el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c !== null && c !== undefined));
  return el;
}
