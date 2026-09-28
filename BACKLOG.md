# Backlog

Feedback and ideas collected along the way, so nothing gets lost.

- **Small UI / quality-of-life items** get folded into the next phase, or into Phase 9 (polish).
- **Anything that changes physics** is scheduled on purpose: SCIENCE.md is updated first (with sources), then the code (CLAUDE.md rule 1).

## Open

### V9: cross-check Layer A against NIST CONTAM (left open 2026-09-28)
Marty chose to leave V9 open for v1. To do it later: (A) run CONTAM on a Windows PC or VM with a step-by-step input sheet for 2–3 simple layouts and compare per-opening flows (target within 10%), or (B) run NIST's command-line solver (ContamX) in Docker with hand-written project files. The Layer A equations are already checked against exact solutions by V3 and V7.

### Fill in outdoor conditions from a ZIP code (requested by Marty, 2026-09-28)
Type a ZIP code; the app looks up the current outdoor temperature, wind speed and wind direction and fills them into the Conditions panel.

- **Good fit with the physics:** weather reports give wind at the standard 10 m met-station height and as the direction it comes *from*, which is exactly what SCIENCE.md §5.1–5.2 expects.
- **Constraint:** the site is static (GitHub Pages, no server), so the lookup must go straight from the browser to free services that allow it (CORS) and ideally need no API key. Candidates to verify when building: the US National Weather Service API (api.weather.gov: free, no key, needs latitude/longitude) with a ZIP-to-location lookup (e.g. zippopotam.us), or Open-Meteo (free, no key, worldwide).
- **Honesty and privacy:** the ZIP code is sent to those third-party services, and the UI should say so. The reading comes from the nearest weather station, not the user's yard. Show the station/time and let the user edit the values afterwards. It needs a fallback message when a service is down.
- **Scope:** UI only (src/ui/ plus units.js conversions); no physics changes.

### Small polish ideas (offered 2026-09-28, not yet requested)
- Remember View settings (trails, overlay) across reloads.
- Friendlier names in results ("Window 1" instead of "win1").
- A one-time tip for first-time visitors.

### Faster simulation for whole-house plans (from Phase 7, 2026-09-27)
After Phase 7's tuning plus the background worker, a 48 × 38 ft house runs at about 0.5× real time (apartment ~1.5×, bedroom ~4×). Options not yet taken:
- **Multigrid pressure solver:** tried in Phase 7. It halved PCG iterations but only gave +8% on the house and +2% on the apartment in plain JavaScript, so it was left out. Code kept outside the repo. Worth revisiting only for bigger grids.
- **Coarser cells for big plans** (0.15–0.2 m): 3–8× faster. Fans would be only 2–3 cells wide and V5 (c_f calibration) would need re-validating at that cell size.
- **GPU (WebGL/WebGPU):** 10–50×. Big rewrite; CLAUDE.md lists it as v2, ask Marty first.

## Done

## Deferred to v2

### Ceiling fans (requested by Marty 2026-09-27; deferred to v2 by Marty 2026-09-27)
Place a ceiling fan in a room, as a type in the fan dropdown. A ceiling fan's airflow is mostly vertical (down to the floor, out along it, up the walls), which the plan-view slice can't represent (SCIENCE.md §1, §6.6). Do it with the v2 side-section view. A simplified Phase 8 version (occupant air speed plus extra mixing) was considered and set aside.
