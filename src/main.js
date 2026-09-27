// Entry point: wires the layout editor, conditions/play controls, the simulation engine
// (a Web Worker, see engine/) and the drawing of its snapshots, plus saving.

import { createLayout } from './layout/layout.js';
import { createEditor, TOOLS } from './ui/editor.js';
import { createPropertiesPanel } from './ui/properties.js';
import { createControls, DEFAULT_CONDITIONS, DEFAULT_VIEW } from './ui/controls.js';
import { loadAutosave, saveAutosave, downloadLayout, readLayoutFile } from './ui/storage.js';
import { createEngine } from './engine/client.js';
import { drawVelocityArrows, drawOpeningFlows } from './render/arrows.js';
import {
  drawCompass, drawWind, createFieldStats, updateFieldStats, updateFieldImage, drawFieldImage,
  stagnantFraction, drawTempLegend, drawFieldLegend, temperaturePalette,
} from './render/overlays.js';
import {
  createParticles, resetParticles, updateParticles, drawTrails, compositeTrails, COLOR_STEPS,
} from './render/particles.js';
import { ACH_LABELS } from './constants.js';
import { ftToM, m2ToFt2, kToF } from './units.js';

const PLAN_WIDTH_FT = 50, PLAN_HEIGHT_FT = 40;   // drawing area
const AUTOSAVE_DELAY_MS = 300;
const PARTICLE_COUNT = 5000;                     // SCIENCE.md §7.1: 3,000–8,000
const FIELD_REFRESH_MS = 250;                    // overlay image refresh interval
const RESULTS_REFRESH_MS = 250;                  // results panel refresh interval

const $ = (id) => document.getElementById(id);
const canvas = $('plan'), statusEl = $('status'), warningsEl = $('warnings'), saveStatus = $('save-status');

const newLayout = () => ({ ...createLayout(ftToM(PLAN_WIDTH_FT), ftToM(PLAN_HEIGHT_FT)), conditions: { ...DEFAULT_CONDITIONS } });
const restored = loadAutosave();
const initial = restored ? { ...restored, conditions: restored.conditions ?? { ...DEFAULT_CONDITIONS } } : newLayout();

let autosaveTimer = null;
let message = null;   // one-off hint shown in the status line until the next change
let props = null;
let controls = null;
let conditions = initial.conditions;
let fps = null;
let speed = 1;
let view = { ...DEFAULT_VIEW };

// The simulation lives in the engine; `sim` is the page's copy of its latest snapshot, shaped like
// physics/coupling.js's simulation so the renderers can use it directly.
let sim = null;
let build = null;               // { id, layout, grid } of the simulation currently requested
let lastLayout = null;
const particles = createParticles(PARTICLE_COUNT);
const fieldStats = createFieldStats();
let trailStepPending = false;   // set when particles moved; the underlay then fades + extends the trails
let stagnantShare = null;
let palette = null, paletteKey = '';

const engine = createEngine({ onSnapshot });

// --- editor ---
const editor = createEditor(canvas, {
  layout: initial,
  onChange: (layout, grid) => {
    message = null;
    renderStatus(grid, layout);
    updateHistoryButtons();
    layoutChanged(layout, grid);
    scheduleAutosave(layout);
  },
  onSelect: () => props?.render(),
  onMessage: (text) => { message = text; renderStatus(editor.getGrid(), editor.getLayout()); },
});
props = createPropertiesPanel($('props'), editor);
props.render();

function scheduleAutosave(layout) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    saveStatus.textContent = saveAutosave({ ...layout, conditions })
      ? 'Saved in this browser.'
      : "This browser won't let the page save; use Save file to keep your layout.";
  }, AUTOSAVE_DELAY_MS);
}

// --- simulation requests ---
// Changes to walls, windows or doors start the simulation again from the starting temperature.
// Fan changes (add, move, rotate, type, speed) are applied to the running simulation instead.
function layoutChanged(layout, grid) {
  if (build && lastLayout && layout.walls === lastLayout.walls && JSON.stringify(layout.openings) === JSON.stringify(lastLayout.openings)) {
    engine.setFans(layout.fans);
  } else {
    startSimulation(layout, grid);
  }
  lastLayout = layout;
}

function startSimulation(layout = editor.getLayout(), grid = editor.getGrid()) {
  lastLayout = layout;
  sim = null;
  renderResults();
  if (!grid.ok) { build = null; return; }
  build = { id: engine.build(layout, conditions), layout, grid };
}

// A snapshot from the engine: adopt it if it belongs to the simulation we last asked for.
function onSnapshot(snap) {
  if (!build || snap.buildId !== build.id) return;
  if (!snap.ok) { sim = null; return; }
  const first = !sim;
  if (first) {
    const byId = new Map(build.layout.openings.map((o) => [o.id, o]));
    sim = {
      grid: build.grid,
      fluid: { nx: build.grid.nx, ny: build.grid.ny, h: build.grid.h },
      openings: build.grid.openings.filter((o) => o.kind === 'exterior')
        .map((o) => ({ id: o.id, cells: o.cells, normal: o.normal, zone: o.zone, layout: byId.get(o.id), role: 'closed', result: null })),
      zones: [], time: 0, warnings: [], achieved: null,
    };
  }
  const prevTime = sim.time;
  Object.assign(sim.fluid, { u: snap.u, v: snap.v, T: snap.T, A: snap.A, kind: snap.kind });
  const dyn = new Map(snap.openings.map((o) => [o.id, o]));
  for (const o of sim.openings) { const d = dyn.get(o.id); if (d) { o.role = d.role; o.result = d.result; } }
  sim.zones = snap.zones; sim.time = snap.time; sim.warnings = snap.warnings; sim.achieved = snap.achieved;

  if (first) {
    resetParticles(particles, sim);
    updateFieldStats(fieldStats, sim, 0);
    stagnantShare = null;
    if (view.overlay !== 'none') refreshField();
    renderResults();
  } else if (sim.time > prevTime) {
    const dt = sim.time - prevTime;
    if (view.particles) { updateParticles(particles, dt); trailStepPending = true; }
    updateFieldStats(fieldStats, sim, dt);
  }
}

function refreshField() {
  if (!sim || view.overlay === 'none') return;
  updateFieldImage(fieldStats, sim, view.overlay, editor.getColors());
  stagnantShare = stagnantFraction(fieldStats, sim);
}

function mountControls() {
  const wasPlaying = controls?.isPlaying() ?? false;
  controls = createControls($('controls'), {
    conditions,
    view,
    onConditions: (c) => {
      const restart = c.TinStart !== conditions.TinStart;
      conditions = c;
      if (restart) startSimulation(); else engine.setConditions(c);
      scheduleAutosave(editor.getLayout());
      editor.redraw();
    },
    onPlay: (p) => {
      if (p && !editor.getGrid().ok) {
        message = 'Draw a closed room first.';
        renderStatus(editor.getGrid(), editor.getLayout());
        controls.setPlaying(false);
        return;
      }
      engine.setPlaying(p);
    },
    onReset: () => { startSimulation(); editor.redraw(); },
    onSpeed: (s) => { speed = s; engine.setSpeed(s); },
    onView: (v) => {
      const particlesTurnedOn = v.particles && !view.particles;
      view = v;
      if (sim && particlesTurnedOn) resetParticles(particles, sim);
      if (sim && v.overlay !== 'none') refreshField();
      editor.redraw();
    },
  });
  speed = 1;
  engine.setSpeed(1);
  if (wasPlaying) controls.setPlaying(true);
}
mountControls();

// --- drawing ---
// Under the walls: colour overlay, then particle trails.
editor.setUnderlay((ctx, v, colors, width, height, dpr) => {
  if (!sim) return;
  if (view.overlay !== 'none') drawFieldImage(ctx, fieldStats, sim, v);
  if (view.particles) {
    if (trailStepPending) {
      const key = colors['t-cold'] + colors['t-mid'] + colors['t-hot'];
      if (key !== paletteKey) { palette = temperaturePalette(colors, COLOR_STEPS); paletteKey = key; }
      drawTrails(particles, v, palette, tempBucket, width, height, dpr);
      trailStepPending = false;
    }
    compositeTrails(particles, ctx, width, height);
  }
});

// On top: arrows, in/out flows, wind, compass, legends.
editor.setOverlay((ctx, v, colors, width, height) => {
  if (sim) {
    if (view.arrows) drawVelocityArrows(ctx, sim, v, colors.arrow);
    drawOpeningFlows(ctx, sim, v, colors);
  }
  drawWind(ctx, buildingBox(v), conditions, colors);
  drawCompass(ctx, width, conditions, colors);
  if (!sim) return;
  let ly = height - 22;
  if (view.particles) {
    const [lo, hi] = tempRange();
    drawTempLegend(ctx, 22, ly, kToF(lo), kToF(hi), colors);
    ly -= 60;
  }
  if (view.overlay !== 'none' && fieldStats.mode === view.overlay) {
    drawFieldLegend(ctx, 22, ly, view.overlay, { max: fieldStats.max }, colors, stagnantShare);
  }
});

// Screen-pixel bounding box of the walls (or the whole plan if there are none).
function buildingBox(v) {
  const L = editor.getLayout();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of L.walls) { x0 = Math.min(x0, w.x0); y0 = Math.min(y0, w.y0); x1 = Math.max(x1, w.x1); y1 = Math.max(y1, w.y1); }
  if (!L.walls.length) { x0 = 0; y0 = 0; x1 = L.width; y1 = L.height; }
  const [ax, ay] = v.toScreen(x0, y0), [bx, by] = v.toScreen(x1, y1);
  return { x0: ax, y0: ay, x1: bx, y1: by };
}

// SCIENCE.md §7.1: trail colours centred on the midpoint between outside and starting inside temperature.
const MIN_HALF_RANGE = 0.5; // K: keep the scale from collapsing when the two temperatures are equal
function tempRange() {
  const mid = (conditions.Tout + conditions.TinStart) / 2;
  const half = Math.max(Math.abs(conditions.TinStart - conditions.Tout) / 2, MIN_HALF_RANGE);
  return [mid - half, mid + half];
}
function tempBucket(T) {
  const [lo, hi] = tempRange();
  const f = Math.min(1, Math.max(0, (T - lo) / (hi - lo)));
  return Math.round(f * (COLOR_STEPS - 1));
}

// Animation loop: draws the latest snapshot. The solver runs in the engine, not here.
let lastFrame = performance.now(), lastResults = 0, lastField = 0;
function frame(now) {
  const rawDt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (rawDt > 0) fps = fps === null ? 1 / rawDt : 0.9 * fps + 0.1 / rawDt;
  const playing = controls.isPlaying();
  if (sim && playing) {
    if (view.overlay !== 'none' && now - lastField > FIELD_REFRESH_MS) { refreshField(); lastField = now; }
    editor.redraw();
    if (now - lastResults > RESULTS_REFRESH_MS) { renderResults(); lastResults = now; }
  }
  controls.setClock(sim ? sim.time : 0, speed, playing ? sim?.achieved ?? null : null, playing ? fps : null,
    engine.mode === 'worker' ? 'background' : 'on page');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function renderResults() {
  const el = controls.resultsElement();
  el.replaceChildren();
  if (!sim) return;
  const p = (cls, text) => Object.assign(document.createElement('p'), { className: cls, textContent: text });
  sim.zones.forEach((z, k) => {
    const ach = z.balanced ? z.ach : 0;
    const label = ACH_LABELS.find((l) => ach < l.max).label;
    const name = sim.zones.length > 1 ? `Room ${k + 1}: ` : '';
    el.append(p('big', `${name}${ach.toFixed(1)} air changes per hour (${label})`));
    el.append(p('muted', `Average inside ${kToF(z.Tmean).toFixed(1)} °F · outside ${kToF(conditions.Tout).toFixed(1)} °F`));
  });
  for (const w of sim.warnings) el.append(p('warn', `⚠ ${w}`));
}

// --- toolbar ---
const toolButtons = [...document.querySelectorAll('[data-tool]')];
function showTool(tool) {
  for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
}
for (const b of toolButtons) b.addEventListener('click', () => { editor.setTool(b.dataset.tool); showTool(b.dataset.tool); });
window.addEventListener('keyup', () => showTool(canvas.dataset.tool));
showTool(canvas.dataset.tool);
console.assert(TOOLS.every((t) => toolButtons.some((b) => b.dataset.tool === t)), 'every tool needs a button');

$('undo').addEventListener('click', () => { editor.undo(); props.render(); });
$('redo').addEventListener('click', () => { editor.redo(); props.render(); });
function updateHistoryButtons() {
  $('undo').disabled = !editor.canUndo();
  $('redo').disabled = !editor.canRedo();
}

$('new').addEventListener('click', () => {
  if (editor.getLayout().walls.length && !confirm('Start a new, empty plan? (You can undo this.)')) return;
  editor.replaceLayout(newLayout());
});
$('save').addEventListener('click', () => downloadLayout({ ...editor.getLayout(), conditions }));
$('open').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const layout = await readLayoutFile(file);
    if (layout.conditions) { conditions = layout.conditions; mountControls(); }
    editor.replaceLayout(layout);
    message = `Opened ${file.name}.`;
  } catch (err) {
    message = err.message;
  }
  renderStatus(editor.getGrid(), editor.getLayout());
});

// --- status line ---
function renderStatus(grid, layout) {
  warningsEl.replaceChildren();
  statusEl.classList.toggle('error', !grid.ok && layout.walls.length > 0);
  if (!grid.ok) {
    statusEl.textContent = message ?? (layout.walls.length ? grid.error : 'Pick Room and drag on the grid to draw your first room.');
    return;
  }
  const count = (kind, type) => grid.openings.filter((o) => o.kind === kind && findType(layout, o.id) === type).length;
  const area = grid.zones.reduce((a, z) => a + z.area, 0);
  const parts = [
    `${grid.zones.length} room${grid.zones.length === 1 ? '' : 's'}`,
    `${Math.round(m2ToFt2(area))} ft² of floor`,
    `windows: ${count('exterior', 'window')} outside, ${count('interior', 'window')} inside`,
    `doors: ${count('exterior', 'door')} outside, ${count('interior', 'door')} inside`,
    `${layout.fans.length} fan${layout.fans.length === 1 ? '' : 's'}`,
  ];
  statusEl.textContent = (message ? `${message} · ` : '') + parts.join(' · ');
  for (const w of grid.warnings) warningsEl.append(Object.assign(document.createElement('li'), { textContent: w }));
}
const findType = (layout, id) => layout.openings.find((o) => o.id === id)?.type;

startSimulation(editor.getLayout(), editor.getGrid());
renderStatus(editor.getGrid(), editor.getLayout());
updateHistoryButtons();
saveStatus.textContent = restored ? 'Restored your last layout from this browser.' : '';
