// Side panel showing the selected wall, window, door or fan, with editable fields.
// Lengths are shown in feet and converted to metres here (CLAUDE.md rule 3: UI converts).

import { findItem, wallAxis } from '../layout/layout.js';
import { FAN_PRESETS, FAN_SPEED_FRACTIONS, SLICE_HEIGHT } from '../constants.js';
import { ftToM, mToFt, m3sToCfm } from '../units.js';

const FREE_FANS = ['box20', 'pedestal16', 'tower'];     // free-standing fan presets
const WINDOW_FANS = ['twinWindow'];                      // fans that sit in a window (SCIENCE.md §5.6)
const SPEED_LABELS = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };

/**
 * @param root    container element
 * @param editor  the editor API (createEditor)
 */
export function createPropertiesPanel(root, editor) {
  function render() {
    const layout = editor.getLayout(), grid = editor.getGrid(), sel = editor.getSelection();
    root.replaceChildren();
    if (!sel) return renderHelp();
    if (sel.type === 'wall') return renderWall(layout.walls[sel.index]);
    const item = findItem(layout, sel.id);
    if (!item) return renderHelp();
    if (sel.type === 'fan') return renderFan(item);
    if (sel.type === 'probe') return renderProbe(item);
    const info = grid.ok ? grid.openings.find((o) => o.id === item.id) : null;
    return renderOpening(item, info);
  }

  function renderHelp() {
    root.append(
      h('h2', {}, 'Getting started'),
      h('ol', { class: 'help' },
        h('li', {}, 'Pick ', h('b', {}, 'Room'), ' and drag to draw walls around a room.'),
        h('li', {}, 'Pick ', h('b', {}, 'Window'), ' or ', h('b', {}, 'Door'), ' and click on a wall.'),
        h('li', {}, 'Pick ', h('b', {}, 'Fan'), ' and click inside a room.'),
        h('li', {}, 'Pick ', h('b', {}, 'Person'), ' and click where someone sits or sleeps to measure the breeze they feel.'),
        h('li', {}, 'Pick ', h('b', {}, 'Select'), ' and click anything to change it here, or drag windows, doors and fans to move them.')),
      h('p', { class: 'muted' }, 'Keys: S select · B room · W wall · N window · D door · F fan · P person · E erase · R rotate fan · Delete · Cmd/Ctrl+Z undo'));
  }

  function renderWall(w) {
    const len = mToFt(Math.max(w.x1 - w.x0, w.y1 - w.y0));
    root.append(
      h('h2', {}, 'Wall'),
      h('p', {}, `${wallAxis(w) === 'h' ? 'Horizontal' : 'Vertical'}, ${len.toFixed(1)} ft long.`),
      deleteButton('Delete wall'));
  }

  function renderOpening(o, info) {
    const title = o.type === 'door' ? 'Door' : 'Window';
    const where = !info ? '' : info.kind === 'exterior' ? 'On an outside wall.'
      : info.kind === 'interior' ? 'On an inside wall (between rooms).' : "Not between indoor and outdoor air, so it's ignored.";
    const pct = Math.round(o.openFraction * 100);

    const openBox = h('input', { type: 'checkbox', checked: o.open });
    openBox.addEventListener('change', () => { editor.updateSelected({ open: openBox.checked }); render(); });

    const slider = h('input', { type: 'range', min: 0, max: 100, step: 5, value: pct, disabled: !o.open });
    const sliderOut = h('output', {}, `${pct}%`);
    slider.addEventListener('input', () => { sliderOut.textContent = `${slider.value}%`; editor.updateSelected({ openFraction: slider.value / 100 }, true); });
    slider.addEventListener('change', () => editor.updateSelected({ openFraction: slider.value / 100 }));

    const parts = [
      h('h2', {}, title),
      h('p', { class: info?.kind === 'invalid' ? 'error' : 'muted' }, where),
      h('label', { class: 'check' }, openBox, ' Open'),
      h('label', {}, 'How far open', h('span', { class: 'row' }, slider, sliderOut)),
      feetField('Width', o.width, 0.5, (m) => editor.updateSelected({ width: m })),
      feetField('Bottom height (above floor)', o.zBottom, 0.25, (m) => {
        if (m < o.zTop) editor.updateSelected({ zBottom: m }); else render();
      }, 0),
      feetField('Top height (above floor)', o.zTop, 0.25, (m) => {
        if (m > o.zBottom) editor.updateSelected({ zTop: m }); else render();
      }),
    ];
    if (info && !info.crossesSlice) {
      parts.push(h('p', { class: 'warn' },
        `⚠ This opening doesn't cross the ${mToFt(SLICE_HEIGHT).toFixed(1)} ft height the simulation looks at, so its effect on the air around people is overstated.`));
    }
    if (o.type === 'window') parts.push(...windowFanFields(o, info));
    parts.push(deleteButton(`Delete ${title.toLowerCase()}`));
    root.append(...parts);
  }

  function windowFanFields(o, info) {
    const mode = h('select', {},
      h('option', { value: 'none' }, 'No window fan'),
      h('option', { value: 'in' }, 'Window fan blowing in'),
      h('option', { value: 'out' }, 'Window fan blowing out'));
    mode.value = o.fan ? o.fan.direction : 'none';
    mode.addEventListener('change', () => {
      const fan = mode.value === 'none' ? null
        : { preset: o.fan?.preset ?? WINDOW_FANS[0], direction: mode.value, speed: o.fan?.speed ?? 'high' };
      editor.updateSelected({ fan });
      render();
    });
    const out = [h('h3', {}, 'Window fan'), h('label', {}, 'Fan', mode)];
    if (o.fan) {
      const speed = speedSelect(o.fan.speed, (v) => editor.updateSelected({ fan: { ...o.fan, speed: v } }));
      out.push(h('label', {}, 'Speed', speed), ratingNote(o.fan.preset));
      if (info && info.kind !== 'exterior') out.push(h('p', { class: 'warn' }, '⚠ Window fans only work in outside walls.'));
    }
    return out;
  }

  function renderFan(f) {
    const type = h('select', {}, ...FREE_FANS.map((k) => h('option', { value: k }, FAN_PRESETS[k].label)));
    type.value = f.preset;
    type.addEventListener('change', () => { editor.updateSelected({ preset: type.value }); render(); });

    const angle = h('input', { type: 'number', min: 0, max: 359, step: 15, value: Math.round(f.angle) });
    angle.addEventListener('change', () => {
      const v = Number(angle.value);
      if (Number.isFinite(v)) editor.updateSelected({ angle: ((v % 360) + 360) % 360 });
      render();
    });
    const rotL = h('button', { type: 'button', title: 'Rotate left 15° (Shift+R)' }, '⟲');
    const rotR = h('button', { type: 'button', title: 'Rotate right 15° (R)' }, '⟳');
    rotL.addEventListener('click', () => { editor.rotateSelected(-15); render(); });
    rotR.addEventListener('click', () => { editor.rotateSelected(15); render(); });

    root.append(
      h('h2', {}, 'Fan'),
      h('label', {}, 'Type', type),
      h('label', {}, 'Speed', speedSelect(f.speed, (v) => editor.updateSelected({ speed: v }))),
      h('label', {}, 'Direction (degrees, 0 = pointing right)', h('span', { class: 'row' }, angle, rotL, rotR)),
      ratingNote(f.preset),
      deleteButton('Delete fan'));
  }

  function renderProbe(pr) {
    root.append(
      h('h2', {}, 'Person marker'),
      h('p', {}, `Measures the air speed and temperature someone here would feel (averaged over the last minute of simulated time). Shown on the plan and in the results.`),
      h('p', { class: 'muted' }, 'Drag it with Select to try another spot.'),
      deleteButton('Delete person marker'));
  }

  // --- small builders ---

  function speedSelect(value, onChange) {
    const sel = h('select', {}, ...Object.entries(SPEED_LABELS).map(([k, label]) => h('option', { value: k }, label)));
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function ratingNote(presetKey) {
    const p = FAN_PRESETS[presetKey];
    const cfm = (frac) => Math.round(m3sToCfm(p.flowHigh * frac)).toLocaleString();
    return h('p', { class: 'muted' },
      `Assumed airflow: ${cfm(FAN_SPEED_FRACTIONS.low)} / ${cfm(FAN_SPEED_FRACTIONS.medium)} / ${cfm(FAN_SPEED_FRACTIONS.high)} CFM (low / medium / high). Typical values; check your fan's rating.`);
  }

  function feetField(label, metres, step, onChange, min = step) {
    const input = h('input', { type: 'number', min, step, value: round2(mToFt(metres)) });
    input.addEventListener('change', () => {
      const ft = Number(input.value);
      if (Number.isFinite(ft) && ft >= min) onChange(ftToM(ft)); else input.value = round2(mToFt(metres));
    });
    return h('label', {}, `${label} (ft)`, input);
  }

  function deleteButton(text) {
    const b = h('button', { type: 'button', class: 'danger' }, text);
    b.addEventListener('click', () => { editor.deleteSelected(); render(); });
    return b;
  }

  return { render };
}

const round2 = (v) => Math.round(v * 100) / 100;

// Tiny DOM helper: h('tag', {attr: value}, ...children)
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'checked' || k === 'disabled') el[k] = Boolean(v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.filter((c) => c !== null && c !== undefined));
  return el;
}
