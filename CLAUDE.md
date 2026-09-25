# CLAUDE.md — Air Flow Simulator

## What this is

A static website, hosted on GitHub Pages, where someone draws a floor plan (walls, doors, windows, fans), sets outdoor conditions, and watches an animated simulation of how air moves through the space. The goal is practical: **help the user figure out how to arrange windows, doors and fans to get the airflow they want.**

Scientific accuracy is the top priority. The UI can stay simple. `SCIENCE.md` is the physics spec and source of truth. Read it before touching any solver code.

## About the owner

Marty is new to coding and to fluid dynamics. He's comfortable with tools, data and GitHub basics. When working with him:

- Explain what you're about to build and why in plain English before large changes. Keep it short.
- After each phase, tell him exactly how to test it himself (what to click, what he should see).
- When there's a real tradeoff, give him the options with pros and cons and recommend one.
- Don't assume he knows git commands. Give the exact command when he needs to run one.

## Non-negotiable rules

1. **Physics follows SCIENCE.md.** If an equation, constant or boundary condition needs to change, update SCIENCE.md first (with the reason and a source), then the code. Never change physics silently.
2. **No magic numbers.** Every physical constant lives in `src/constants.js` with a comment naming its source (paper, handbook, or "calibrated in V5 on <date>").
3. **SI units inside, imperial at the edges.** Only `src/units.js` and the UI convert. The solver never sees °F, mph, CFM or feet.
4. **The solver must not touch the DOM.** Everything in `src/physics/` must run in Node for tests. No `window`, `document` or canvas there.
5. **Validation before merge.** Run `node tests/run.js` before every commit that touches `src/physics/`. If a validation test in SCIENCE.md §8 fails, fix it or stop and explain. Never loosen a pass criterion to make a test pass without Marty's explicit OK.
6. **Be honest in the UI.** The About panel shows the limitations from SCIENCE.md §9. Never label output as "accurate" or "engineering-grade."

## Tech stack

- Plain HTML + CSS + JavaScript (ES modules). **No frameworks, no bundler, no npm dependencies at runtime.** GitHub Pages serves the files as-is.
- Rendering: Canvas 2D. Move to WebGL only if Canvas can't hold 30 fps at the target grid size, and ask first.
- Tests: Node 18+ with plain `node` scripts (no test framework required; `node:test` and `node:assert` are fine).
- Solver arrays: `Float32Array` / `Float64Array` (Float64 for the pressure solve).

## Folder structure

```
/
├── index.html
├── style.css
├── CLAUDE.md
├── SCIENCE.md
├── VALIDATION.md          # latest validation results (numbers, pass/fail, date)
├── README.md              # what it is, live link, how to run locally
├── src/
│   ├── main.js            # wires UI, sim loop, renderer
│   ├── constants.js       # every physical constant, with sources
│   ├── units.js           # SI <-> imperial conversions
│   ├── layout/            # grid, walls, openings, fans, flood fill, zones
│   ├── physics/
│   │   ├── envelope.js    # Layer A: Cp, wind profile, stack, orifice, zone balance, de Gids-Phaff
│   │   ├── fluid.js       # Layer B: MAC grid, advection, diffusion, projection
│   │   ├── pcg.js         # preconditioned conjugate gradient pressure solver
│   │   ├── turbulence.js  # Smagorinsky + floor/ceiling drag
│   │   └── fans.js        # actuator regions
│   ├── render/
│   │   ├── particles.js   # wispy trails, RK2, temperature color
│   │   ├── arrows.js
│   │   └── overlays.js    # speed, age of air, stagnant zones
│   └── ui/
│       ├── editor.js      # draw walls, snap openings to walls, place/rotate fans
│       ├── controls.js    # orientation, temps, wind, terrain, fan speeds, play/pause
│       └── metrics.js     # ACH, per-opening CFM, probes, time-to-target
├── presets/               # JSON layouts (bedroom + box fan, cross-breeze apartment, etc.)
└── tests/
    ├── run.js             # runs everything, prints a pass/fail table
    └── v1_cavity.js ... v9_*.js
```

## Commands

```bash
# Run locally (then open http://localhost:8000)
python3 -m http.server 8000

# Run all validation tests
node tests/run.js

# Run one test
node tests/v1_cavity.js
```

## Build phases

Work one phase at a time. Each phase ends with a commit, an update to VALIDATION.md when physics changed, and a short "how to test this" note for Marty.

**Phase 1 — Repo skeleton**
index.html with an empty canvas, folder structure, constants.js, units.js with unit tests, test runner, README.
*Done when:* the page loads locally and on GitHub Pages, and `node tests/run.js` runs the (empty) suite.

**Phase 2 — Layer A: envelope model**
Cp(β), wind profile, stack term, orifice flow, bisection zone balance, window fans, de Gids-Phaff exchange.
*Done when:* V3, V4 and V7 pass. Also add a tiny debug page that prints per-opening flows for a hard-coded two-window room.

**Phase 3 — Layer B: fluid solver**
MAC grid, BFECC/MacCormack advection, implicit diffusion, PCG projection, boundary conditions from SCIENCE.md §6.4.
*Done when:* V1, V2 and V6 pass.

**Phase 4 — Turbulence, drag and fans**
Smagorinsky, floor/ceiling drag, fan actuators. Calibrate c_f with V5 and record the result.
*Done when:* V5 and V8 pass and the calibrated c_f is in constants.js with the date.

**Phase 5 — Layout editor**
Grid drawing of walls (click-drag, snap to grid, erase), doors and windows that snap onto walls with an open/closed toggle and open fraction, fans placed anywhere with rotation, flood fill for inside/outside and zones, save/load layout as JSON (download/upload file plus localStorage autosave wrapped in try/catch).
*Done when:* Marty can draw a room, place openings and fans, reload the page and get his layout back.

**Phase 6 — Controls and coupling**
Orientation compass, outside temp, inside start temp, wind speed (mph) and direction (from), terrain, ceiling height, fan speed per fan, play/pause/reset, sim speed. Couple Layer A ↔ Layer B per SCIENCE.md §5.8.
*Done when:* changing the wind direction visibly changes which windows are inlets.

**Phase 7 — Visualization**
Particle trails colored blue → red by temperature, arrow glyphs, legend in °F, optional overlays (speed, age of air, stagnant zones).
*Done when:* it holds ≥ 30 fps on a 120 × 120 grid with 5,000 particles on a laptop, and the result looks like the inspiration image but animated.

**Phase 8 — Metrics and presets**
ACH with plain-English labels, per-opening CFM, comfort probes, time-to-target, 3–4 presets, About/limitations panel.
*Done when:* Marty can compare two fan placements and see a clear number that says which one works better.

**Phase 9 — Polish and deploy**
Final validation run, VALIDATION.md updated, README with the live link.

**Later (v2 ideas, don't start without asking)**
Side-section view with buoyancy, ceiling fans, heat gains, ASHRAE 55 SET cooling effect, WebGL/WebGPU for finer grids, "optimize my fan placement" search.

## Deploying to GitHub Pages

1. Push to `main`.
2. On GitHub: Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)` → Save. (One-time setup.)
3. The site goes live at `https://<username>.github.io/<repo-name>/` within a minute or two of each push.
4. Use relative paths everywhere (`./src/main.js`, not `/src/main.js`) or the site breaks under the repo subpath.

## Git workflow

- Small, focused commits with clear messages ("Add Cp correlation and V4 test").
- Commit at the end of each working step so Marty can always roll back.
- Never force-push to `main`.
- Only commit or push when Marty asks, or at the end of a phase he's approved.

## Coding style

- Readable over clever. Comment the physics with the SCIENCE.md section number, e.g. `// SCIENCE.md §5.5 orifice equation`.
- Small pure functions in physics code, so they can be tested one at a time.
- Keep performance-critical loops (advection, PCG) flat and allocation-free inside the step.
