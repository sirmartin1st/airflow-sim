# Air Flow Simulator

Draw a floor plan (walls, doors, windows, fans), set the outdoor conditions, and watch an animated simulation of how air moves through the space. The goal is to help you work out how to arrange windows, doors and fans to get the airflow you want.

**Status:** Phase 6 (controls and coupling). Draw a plan, set the wind and temperatures, press Play. Particle trails and full metrics arrive in Phases 7–8.

**Live site:** _coming once GitHub Pages is enabled_ (`https://sirmartin1st.github.io/airflow-sim/`)

## Using the editor

- **Room** (B): drag a rectangle of walls. **Wall** (W): drag a single wall. Walls snap to a 6-inch grid.
- **Window** (N) / **Door** (D): click on a wall. **Fan** (F): click inside a room.
- **Select** (S): click anything to edit it in the side panel; drag windows, doors and fans to move them. **R** rotates a selected fan.
- **Erase** (E): click something to delete it. **Cmd/Ctrl+Z** undoes.
- Your layout autosaves in the browser. **Save file** / **Open file** keep layouts as `.json` files.
- **Simulation panel:** set which way the top of the plan faces, the wind (speed and the direction it comes *from*), outside and starting inside temperatures, surroundings and ceiling height, then press **Play**. Windows and doors show whether air flows **in** or **out** and how much (CFM); arrows show where it goes inside.

## How it works

- **Layer A (envelope model):** standard airflow-network equations (ASHRAE / NIST CONTAM approach) decide how much air comes in and goes out through each opening.
- **Layer B (interior flow):** a 2D Navier-Stokes solver decides where that air goes inside.
- The physics is specified in [SCIENCE.md](SCIENCE.md). Validation results are in [VALIDATION.md](VALIDATION.md).

This is a plan-view (top-down) approximation, not engineering CFD. See SCIENCE.md §9 for its limitations.

## Run locally

You need Python 3 (to serve the files) and Node 18+ (to run the tests).

```bash
# Serve the site, then open http://localhost:8000
python3 -m http.server 8000

# Run all tests
node tests/run.js
```

There's no build step and there are no dependencies. The browser loads the files as they are.

## Debug pages

- `debug/envelope.html`: per-window flows for a hard-coded two-window room (Layer A only).
