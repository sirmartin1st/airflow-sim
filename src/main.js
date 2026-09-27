// Entry point: wires the layout editor, conditions/play controls, the simulation loop and saving.

import { createLayout } from './layout/layout.js';
import { createEditor, TOOLS } from './ui/editor.js';
import { createPropertiesPanel } from './ui/properties.js';
import { createControls, DEFAULT_CONDITIONS } from './ui/controls.js';
import { loadAutosave, saveAutosave, downloadLayout, readLayoutFile } from './ui/storage.js';
import { createSimulation, setConditions, setSimFans, advance } from './physics/coupling.js';
import { drawVelocityArrows, drawOpeningFlows } from './render/arrows.js';
import { drawCompass, drawWind } from './render/overlays.js';
import { ACH_LABELS } from './constants.js';
import { ftToM, m2ToFt2, kToF } from './units.js';

const PLAN_WIDTH_FT = 50, PLAN_HEIGHT_FT = 40;   // drawing area
const AUTOSAVE_DELAY_MS = 300;
const FRAME_BUDGET_MS = 22;                      // time per frame the solver may use (keeps the page responsive)
const MAX_FRAME_S = 0.1;                         // ignore longer gaps (tab in background)

const $ = (id) => document.getElementById(id);
const canvas = $('plan'), statusEl = $('status'), warningsEl = $('warnings'), saveStatus = $('save-status');

const newLayout = () => ({ ...createLayout(ftToM(PLAN_WIDTH_FT), ftToM(PLAN_HEIGHT_FT)), conditions: { ...DEFAULT_CONDITIONS } });
const restored = loadAutosave();
const initial = restored ? { ...restored, conditions: restored.conditions ?? { ...DEFAULT_CONDITIONS } } : newLayout();

let autosaveTimer = null;
let message = null;   // one-off hint shown in the status line until the next change
let props = null;
let controls = null;
let sim = null;
let conditions = initial.conditions;
let speed = 1;
let achieved = null;  // measured sim-seconds per real second

// --- editor ---
const editor = createEditor(canvas, {
  layout: initial,
  onChange: (layout, grid) => {
    message = null;
    renderStatus(grid, layout);
    updateHistoryButtons();
    rebuildSimulation(layout, grid);
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

// --- simulation ---
// Changes to walls, windows or doors start the simulation again from the starting temperature.
// Fan changes (add, move, rotate, type, speed) are applied to the running simulation instead.
let lastLayout = null;
function rebuildSimulation(layout, grid) {
  if (sim && lastLayout && onlyFanSettingsChanged(lastLayout, layout)) {
    setSimFans(sim, layout.fans);
  } else {
    sim = grid.ok ? createSimulation(layout, grid, conditions) : null;
  }
  lastLayout = layout;
  renderResults();
}

function onlyFanSettingsChanged(a, b) {
  return a.walls === b.walls && JSON.stringify(a.openings) === JSON.stringify(b.openings);
}

function mountControls() {
  const wasPlaying = controls?.isPlaying() ?? false;
  controls = createControls($('controls'), {
    conditions,
    onConditions: (c) => {
      const restart = c.TinStart !== conditions.TinStart;
      conditions = c;
      if (sim) { if (restart) rebuildFromScratch(); else setConditions(sim, c); }
      scheduleAutosave(editor.getLayout());
      renderResults();
      editor.redraw();
    },
    onPlay: (p) => { if (p && !sim) { message = 'Draw a closed room first.'; renderStatus(editor.getGrid(), editor.getLayout()); controls.setPlaying(false); } },
    onReset: () => { rebuildFromScratch(); editor.redraw(); },
    onSpeed: (s) => { speed = s; },
  });
  speed = 1;
  if (wasPlaying) controls.setPlaying(true);
}
mountControls();

function rebuildFromScratch() {
  const grid = editor.getGrid();
  sim = grid.ok ? createSimulation(editor.getLayout(), grid, conditions) : null;
  lastLayout = editor.getLayout();
  renderResults();
}

editor.setOverlay((ctx, view, colors, width) => {
  if (sim) {
    drawVelocityArrows(ctx, sim, view, colors.arrow);
    drawOpeningFlows(ctx, sim, view, colors);
  }
  drawWind(ctx, buildingBox(view), conditions, colors);
  drawCompass(ctx, width, conditions, colors);
});

// Screen-pixel bounding box of the walls (or the whole plan if there are none).
function buildingBox(view) {
  const L = editor.getLayout();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of L.walls) { x0 = Math.min(x0, w.x0); y0 = Math.min(y0, w.y0); x1 = Math.max(x1, w.x1); y1 = Math.max(y1, w.y1); }
  if (!L.walls.length) { x0 = 0; y0 = 0; x1 = L.width; y1 = L.height; }
  const [ax, ay] = view.toScreen(x0, y0), [bx, by] = view.toScreen(x1, y1);
  return { x0: ax, y0: ay, x1: bx, y1: by };
}

// Animation loop: advance the solver for up to FRAME_BUDGET_MS per frame, aiming for `speed` × real time.
let lastFrame = performance.now(), lastResults = 0;
function frame(now) {
  const realDt = Math.min((now - lastFrame) / 1000, MAX_FRAME_S);
  lastFrame = now;
  if (sim && controls.isPlaying()) {
    const target = speed * realDt, t0 = performance.now();
    let done = 0;
    while (done < target && performance.now() - t0 < FRAME_BUDGET_MS) done += advance(sim);
    const rate = realDt > 0 ? done / realDt : 0;
    achieved = achieved === null ? rate : 0.9 * achieved + 0.1 * rate;
    editor.redraw();
    if (now - lastResults > 250) { renderResults(); lastResults = now; }
  }
  controls.setClock(sim ? sim.time : 0, speed, controls.isPlaying() ? achieved : null);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function renderResults() {
  const el = controls.resultsElement();
  el.replaceChildren();
  if (!sim) return;
  const p = (cls, text) => Object.assign(document.createElement('p'), { className: cls, textContent: text });
  sim.zones.forEach((z, k) => {
    const r = z.result;
    const ach = r && z.balanced ? r.ach : 0;
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

rebuildSimulation(editor.getLayout(), editor.getGrid());
renderStatus(editor.getGrid(), editor.getLayout());
updateHistoryButtons();
saveStatus.textContent = restored ? 'Restored your last layout from this browser.' : '';
