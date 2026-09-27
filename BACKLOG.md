# Backlog

Feedback and ideas collected along the way, so nothing gets lost.

- **Small UI / quality-of-life items** get folded into the next phase, or into Phase 9 (polish).
- **Anything that changes physics** is scheduled on purpose: SCIENCE.md is updated first (with sources), then the code (CLAUDE.md rule 1).

## Open

### Faster simulation for whole-house plans (from Phase 7, 2026-09-28)
After Phase 7's tuning plus the background worker, a 48 × 38 ft house runs at about 0.5× real time (apartment ~1.5×, bedroom ~4×). Options not yet taken:
- **Multigrid pressure solver:** tried in Phase 7. It halved PCG iterations but only gave +8% on the house and +2% on the apartment in plain JavaScript, so it was left out. Code kept outside the repo. Worth revisiting only for bigger grids.
- **Coarser cells for big plans** (0.15–0.2 m): 3–8× faster. Fans would be only 2–3 cells wide and V5 (c_f calibration) would need re-validating at that cell size.
- **GPU (WebGL/WebGPU):** 10–50×. Big rewrite; CLAUDE.md lists it as v2, ask Marty first.

## Done

## Deferred to v2

### Ceiling fans (requested by Marty 2026-09-27; deferred to v2 by Marty 2026-09-27)
Place a ceiling fan in a room, as a type in the fan dropdown. A ceiling fan's airflow is mostly vertical (down to the floor, out along it, up the walls), which the plan-view slice can't represent (SCIENCE.md §1, §6.6). Do it with the v2 side-section view. A simplified Phase 8 version (occupant air speed plus extra mixing) was considered and set aside.
