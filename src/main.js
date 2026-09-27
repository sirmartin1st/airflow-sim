// Entry point: wires the layout editor, properties panel, status line and saving.
// Phase 5: editing only. The simulation is connected in Phase 6.

import { createLayout } from './layout/layout.js';
import { createEditor, TOOLS } from './ui/editor.js';
import { createPropertiesPanel } from './ui/properties.js';
import { loadAutosave, saveAutosave, downloadLayout, readLayoutFile } from './ui/storage.js';
import { ftToM, m2ToFt2 } from './units.js';

const PLAN_WIDTH_FT = 50, PLAN_HEIGHT_FT = 40;   // drawing area
const AUTOSAVE_DELAY_MS = 300;

const $ = (id) => document.getElementById(id);
const canvas = $('plan'), statusEl = $('status'), warningsEl = $('warnings'), saveStatus = $('save-status');

const newLayout = () => createLayout(ftToM(PLAN_WIDTH_FT), ftToM(PLAN_HEIGHT_FT));
const restored = loadAutosave();

let autosaveTimer = null;
let message = null;   // one-off hint shown in the status line until the next change
let props = null;

const editor = createEditor(canvas, {
  layout: restored ?? newLayout(),
  onChange: (layout, grid) => {
    message = null;
    renderStatus(grid, layout);
    updateHistoryButtons();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      saveStatus.textContent = saveAutosave(layout)
        ? 'Saved in this browser.'
        : "This browser won't let the page save; use Save file to keep your layout.";
    }, AUTOSAVE_DELAY_MS);
  },
  onSelect: () => props?.render(),
  onMessage: (text) => { message = text; renderStatus(editor.getGrid(), editor.getLayout()); },
});
props = createPropertiesPanel($('props'), editor);
props.render();

// --- toolbar ---
const toolButtons = [...document.querySelectorAll('[data-tool]')];
function showTool(tool) {
  for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
}
for (const b of toolButtons) b.addEventListener('click', () => { editor.setTool(b.dataset.tool); showTool(b.dataset.tool); });
// Keyboard shortcuts change the tool inside the editor; keep the buttons in sync.
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
$('save').addEventListener('click', () => downloadLayout(editor.getLayout()));
$('open').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    editor.replaceLayout(await readLayoutFile(file));
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

renderStatus(editor.getGrid(), editor.getLayout());
updateHistoryButtons();
saveStatus.textContent = restored ? 'Restored your last layout from this browser.' : '';
