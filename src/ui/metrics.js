// Metrics: comfort probes, time to target, headline numbers and A-vs-B comparison. SCIENCE.md §7.3.
// The calculations are DOM-free (tested in tests/metrics_test.js); renderMetrics builds the panel.
// Inputs are the page's simulation snapshot (shaped like physics/coupling.js's simulation), SI units.

import { PROBE_AVERAGING_TIME, TARGET_BAND_K, ACH_LABELS, STILL_AIR_SPEED } from '../constants.js';
import { sampleU, sampleV, CELL } from '../physics/fluid.js';
import { mpsToFpm, m3sToCfm, kToF, deltaKToF } from '../units.js';

// ---------------------------------------------------------------------------
// Comfort probes
// ---------------------------------------------------------------------------

/** Instantaneous reading at a probe (layout coordinates): { speed m/s, T K } or null if not in indoor air. */
export function probeReading(sim, probe) {
  const { grid, fluid } = sim;
  const x = probe.x - grid.x0, y = probe.y - grid.y0;
  const i = Math.floor(x / grid.h), j = Math.floor(y / grid.h);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny || fluid.kind[i + j * grid.nx] !== CELL.FLUID) return null;
  return { speed: Math.hypot(sampleU(fluid, x, y), sampleV(fluid, x, y)), T: fluid.T[i + j * grid.nx] };
}

/**
 * Updates the probes' running averages by dt seconds of sim time (SCIENCE.md §7.3, 60 s EMA).
 * `stats` is a Map id → { speed, T, age }; entries for removed probes are dropped.
 */
export function updateProbes(stats, sim, probes, dt) {
  const r = 1 - Math.exp(-dt / PROBE_AVERAGING_TIME);
  const ids = new Set();
  for (const p of probes) {
    ids.add(p.id);
    const now = probeReading(sim, p);
    if (!now) { stats.delete(p.id); continue; }
    const s = stats.get(p.id);
    if (!s) { stats.set(p.id, { speed: now.speed, T: now.T, age: 0 }); continue; }
    s.speed += (now.speed - s.speed) * r;
    s.T += (now.T - s.T) * r;
    s.age += dt;
  }
  for (const id of stats.keys()) if (!ids.has(id)) stats.delete(id);
}

// ---------------------------------------------------------------------------
// Time to target (SCIENCE.md §7.3)
// ---------------------------------------------------------------------------

/**
 * @param zone      { Tmean, Qin, Qexchange, volume } from the snapshot
 * @param target    target temperature, K
 * @param Tout      outdoor temperature, K
 * @param now       current sim time, s
 * @param reachedAt sim time the zone first came within the band, or null
 * @returns { state: 'reached'|'estimate'|'never', t (s, for reached/estimate) }
 */
export function timeToTarget(zone, target, Tout, now, reachedAt) {
  if (reachedAt !== null && reachedAt !== undefined) return { state: 'reached', t: reachedAt };
  const T = zone.Tmean;
  if (Math.abs(T - target) <= TARGET_BAND_K) return { state: 'reached', t: now };
  const Tb = target + Math.sign(T - target) * TARGET_BAND_K;   // band edge nearest the current temperature
  const q = zone.Qin + zone.Qexchange;
  // Outdoor air only pulls T̄ toward T_out: the band edge must lie between T̄ and T_out.
  const between = (T - Tb) * (Tb - Tout) > 0;
  if (!between || q <= 0) return { state: 'never' };
  const tau = zone.volume / q;
  return { state: 'estimate', t: now + tau * Math.log((T - Tout) / (Tb - Tout)) };
}

/** Records the first sim time each zone comes within the target band. `reached` is an array per zone. */
export function trackTarget(reached, sim, target) {
  sim.zones.forEach((z, k) => {
    if ((reached[k] === null || reached[k] === undefined) && Math.abs(z.Tmean - target) <= TARGET_BAND_K) reached[k] = sim.time;
  });
}

// ---------------------------------------------------------------------------
// All metrics, the headline and comparison
// ---------------------------------------------------------------------------

/**
 * @param sim          page snapshot
 * @param probes       layout probes
 * @param probeStats   Map from updateProbes
 * @param stagnant     stagnant floor fraction (0–1) or null while averaging
 * @param conditions   { Tout, target }
 * @param reached      per-zone reached times (trackTarget)
 * @param changedAt    sim time of the last change to fans, conditions or markers (averages restart then)
 */
export function computeMetrics(sim, probes, probeStats, stagnant, conditions, reached, changedAt = 0) {
  const probeList = probes.map((p) => ({ id: p.id, ...(probeStats.get(p.id) ?? { speed: null, T: null, age: 0 }) }));
  const measured = probeList.filter((p) => p.speed !== null);
  const breeze = measured.length ? measured.reduce((a, p) => a + p.speed, 0) / measured.length : null;

  let ageSum = 0, n = 0;
  for (let c = 0; c < sim.fluid.A.length; c++) if (sim.fluid.kind[c] === CELL.FLUID) { ageSum += sim.fluid.A[c]; n++; }

  // An unbalanced zone gets no outdoor air in the simulation (SCIENCE.md §6.7), so none here either.
  const cool = sim.zones.map((z, k) => timeToTarget(z.balanced ? z : { ...z, Qin: 0, Qexchange: 0 },
    conditions.target, conditions.Tout, sim.time, reached[k] ?? null));
  // Headline for "cool": the slowest zone ('never' beats any time).
  let coolHeadline = null;
  for (const c of cool) {
    if (!coolHeadline || c.state === 'never' || (coolHeadline.state !== 'never' && c.t > coolHeadline.t)) coolHeadline = c;
  }

  return {
    time: sim.time,
    settling: sim.time - changedAt < PROBE_AVERAGING_TIME,
    breeze,                                   // m/s, mean of probe averages
    probes: probeList,
    cool, coolHeadline,
    stagnant,                                 // fraction
    meanAge: n ? ageSum / n : null,           // s
    zones: sim.zones.map((z) => ({ ach: z.balanced ? z.ach : 0, Tmean: z.Tmean })),
    openings: sim.openings.filter((o) => o.result).map((o) => ({
      id: o.id, type: o.layout.type, role: o.role, Q: o.result.Q, Qexchange: o.result.Qexchange,
    })),
  };
}

export const GOAL_LABELS = Object.freeze({
  breeze: 'Feel a breeze',
  cool: 'Cool the room down',
  fresh: 'Fresh air everywhere',
});

/**
 * The single number for the chosen goal.
 * @returns { title, text, value (comparable number or null), better: 'higher'|'lower', note }
 */
export function headline(m, goal) {
  if (goal === 'breeze') {
    if (m.breeze === null) return { title: 'Breeze at your person markers', text: '—', value: null, better: 'higher', note: 'Add a Person marker (P) where someone sits or sleeps.' };
    const fpm = mpsToFpm(m.breeze);
    const still = Math.round(mpsToFpm(STILL_AIR_SPEED) / 5) * 5;   // 0.2 m/s ≈ 39.4 ft/min, quoted as "about 40" (SCIENCE.md §7.3)
    return {
      title: 'Breeze at your person markers', text: `${Math.round(fpm)} ft/min`, value: fpm, better: 'higher',
      note: m.breeze < STILL_AIR_SPEED ? `Below about ${still} ft/min: feels like still air (ASHRAE 55).` : `Above about ${still} ft/min: a noticeable breeze (ASHRAE 55).`,
    };
  }
  if (goal === 'cool') {
    const c = m.coolHeadline;
    if (!c) return { title: 'Time to reach your target', text: '—', value: null, better: 'lower', note: '' };
    if (c.state === 'never') return { title: 'Time to reach your target', text: "Won't reach it", value: Infinity, better: 'lower', note: 'Outdoor air alone can’t bring the room to that temperature, or no outdoor air is coming in.' };
    return {
      title: 'Time to reach your target', text: fmtDuration(c.t), value: c.t, better: 'lower',
      note: c.state === 'reached' ? 'Reached.' : 'Estimate, assuming today’s airflow continues. Free-standing fans don’t change this; windows, doors and window fans do.',
    };
  }
  if (m.stagnant === null) return { title: 'Stagnant floor area', text: '…', value: null, better: 'lower', note: 'Averaging; let it run a minute.' };
  return {
    title: 'Stagnant floor area', text: `${Math.round(100 * m.stagnant)}%`, value: 100 * m.stagnant, better: 'lower',
    note: m.meanAge === null ? '' : `Average age of the air: ${fmtDuration(m.meanAge)}.`,
  };
}

/** Compares a saved headline A with the current B. Returns { word, arrow } (never colour alone). */
export function verdict(a, b) {
  if (!a || !b || a.value === null || b.value === null || a.better !== b.better) return null;
  const tol = a.value === Infinity || b.value === Infinity ? 0 : 0.03 * Math.max(Math.abs(a.value), Math.abs(b.value), 1e-9);
  const diff = b.value - a.value;
  if (a.value === b.value || Math.abs(diff) <= tol) return { word: 'about the same', arrow: '=' };
  const bBetter = a.better === 'higher' ? diff > 0 : diff < 0;
  return bBetter ? { word: 'better', arrow: '▲' } : { word: 'worse', arrow: '▼' };
}

export function fmtDuration(s) {
  if (!Number.isFinite(s)) return '—';
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

// ---------------------------------------------------------------------------
// Panel (DOM)
// ---------------------------------------------------------------------------

/**
 * Renders the results panel.
 * @param saved  { headline, label } for A, or null
 * @param onSaveA callback for the "Save as A" button, onClearA to forget A
 */
export function renderMetrics(el, m, goal, conditions, saved, { onSaveA, onClearA }) {
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  el.replaceChildren();
  if (!m) return;
  const now = headline(m, goal);

  // Headline card
  const card = h('div', 'headline');
  card.append(h('p', 'muted', now.title), h('p', 'big-number', now.text));
  if (now.note) card.append(h('p', 'muted', now.note));
  if (m.settling) card.append(h('p', 'warn', 'Still settling: let it run at least a minute before comparing.'));
  el.append(card);

  // A vs B
  if (saved) {
    const v = verdict(saved.headline, now);
    const row = h('div', 'compare');
    row.append(h('p', '', `A: ${saved.headline.text}  →  now: ${now.text}`));
    if (v) row.append(h('p', 'verdict', `${v.arrow} Now is ${v.word} than A`));
    const clear = h('button', 'link', 'Forget A'); clear.type = 'button'; clear.addEventListener('click', onClearA);
    row.append(clear);
    el.append(row);
  }
  const save = h('button', '', saved ? 'Replace A with these results' : 'Save these results as A'); save.type = 'button';
  save.addEventListener('click', onSaveA);
  el.append(save);

  // Details
  el.append(h('h3', '', 'Details'));
  m.zones.forEach((z, k) => {
    const label = ACH_LABELS.find((l) => z.ach < l.max).label;
    const name = m.zones.length > 1 ? `Room ${k + 1}: ` : '';
    el.append(h('p', '', `${name}${z.ach.toFixed(1)} air changes per hour (${label}) · average ${kToF(z.Tmean).toFixed(1)} °F`));
  });
  const c = m.coolHeadline;
  if (c) {
    const text = c.state === 'never' ? "won't reach it" : c.state === 'reached' ? `reached at ${fmtDuration(c.t)}` : `about ${fmtDuration(c.t)}`;
    el.append(h('p', '', `Target ${kToF(conditions.target).toFixed(0)} °F (±${deltaKToF(TARGET_BAND_K).toFixed(0)} °F): ${text}`));
  }
  el.append(h('p', '', `Stagnant floor: ${m.stagnant === null ? 'averaging…' : `${Math.round(100 * m.stagnant)}%`} · average age of air: ${m.meanAge === null ? '—' : fmtDuration(m.meanAge)}`));
  for (const p of m.probes) {
    el.append(h('p', '', p.speed === null ? `${p.id}: not in a room` : `${p.id}: ${Math.round(mpsToFpm(p.speed))} ft/min · ${kToF(p.T).toFixed(1)} °F`));
  }
  if (m.openings.length) {
    el.append(h('h3', '', 'Windows and doors'));
    for (const o of m.openings) {
      const kind = o.type === 'door' ? 'Door' : 'Window';
      const flow = o.role === 'inlet' ? `in ${Math.round(m3sToCfm(o.Q))} CFM`
        : o.role === 'outlet' ? `out ${Math.round(m3sToCfm(-o.Q))} CFM` : 'no through-flow';
      const ex = o.Qexchange > 0 ? ` · two-way ${Math.round(m3sToCfm(o.Qexchange))} CFM` : '';
      el.append(h('p', '', `${kind} ${o.id}: ${flow}${ex}`));
    }
  }
}
