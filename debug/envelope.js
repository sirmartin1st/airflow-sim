// Debug page for Layer A: prints per-opening flows for a hard-coded two-window room.

import { solveZone, prepareOpening, windSpeedAtHeight, wallNormalBearing } from '../src/physics/envelope.js';
import {
  TERRAIN, WINDOW_DEFAULTS, SLIDING_WINDOW_OPEN_FRACTION,
  DEFAULT_BUILDING_HEIGHT, DEFAULT_CEILING_HEIGHT, ACH_LABELS,
} from '../src/constants.js';
import { mphToMps, fToK, m3sToCfm } from '../src/units.js';

// Room: 4 m wide (east–west) × 5 m deep (north–south), grid "up" = north.
const ROOM_W = 4, ROOM_D = 5;
const ORIENTATION = 0;
const VOLUME = ROOM_W * ROOM_D * DEFAULT_CEILING_HEIGHT;

// Side ratio S = this wall's length / adjacent wall's length (SCIENCE.md §5.3).
const WINDOWS = [
  { id: 'North window', gridDir: 'up',   sideRatio: ROOM_W / ROOM_D },
  { id: 'South window', gridDir: 'down', sideRatio: ROOM_W / ROOM_D },
].map((w) => ({
  ...WINDOW_DEFAULTS,
  openFraction: SLIDING_WINDOW_OPEN_FRACTION,
  wallNormalDeg: wallNormalBearing(w.gridDir, ORIENTATION),
  ...w,
}));

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round(deg / 45) % 8];

const form = document.getElementById('inputs');
const rows = document.getElementById('rows');
const zone = document.getElementById('zone');

function update() {
  const f = new FormData(form);
  const Umet = mphToMps(Number(f.get('windMph')));
  const windFrom = Number(f.get('windFrom'));
  const cond = {
    Tout: fToK(Number(f.get('outF'))),
    Tin: fToK(Number(f.get('inF'))),
    Umet,
    UH: windSpeedAtHeight(Umet, DEFAULT_BUILDING_HEIGHT, TERRAIN[f.get('terrain')]),
  };

  const prepared = WINDOWS.map((w) => prepareOpening(w, windFrom));
  const r = solveZone(prepared, cond, VOLUME);

  rows.innerHTML = r.openings.map((o, j) => {
    const p = prepared[j];
    const arrow = o.direction === 'in' ? '↓ in' : o.direction === 'out' ? '↑ out' : '—';
    return `<tr>
      <td>${o.id}</td>
      <td>${compass(WINDOWS[j].wallNormalDeg)}</td>
      <td>${p.beta.toFixed(0)}°</td>
      <td>${p.cp.toFixed(3)}</td>
      <td>${o.dP.toFixed(3)}</td>
      <td>${m3sToCfm(o.Q).toFixed(0)}</td>
      <td>${arrow}</td>
      <td>${m3sToCfm(o.Qexchange).toFixed(0)}</td>
    </tr>`;
  }).join('');

  const label = ACH_LABELS.find((l) => r.ach < l.max).label;
  zone.textContent =
    `Indoor pressure: ${r.Pin.toFixed(3)} Pa · Total inflow: ${m3sToCfm(r.Qin).toFixed(0)} CFM · ` +
    `Air changes per hour: ${r.ach.toFixed(1)} (${label}) · Wind at roof height: ${(cond.UH / Umet || 0).toFixed(2)} × reported` +
    (r.balanced ? '' : ' · ⚠ No balance possible: air has no way out');
}

form.addEventListener('input', update);
update();
