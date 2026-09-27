# Air Flow Simulator

Draw a floor plan (walls, doors, windows, fans), set the outdoor conditions, and watch an animated simulation of how air moves through the space. The goal is to help you work out how to arrange windows, doors and fans to get the airflow you want.

**Status:** Phase 8 (metrics and presets). Draw a plan or load an example, press Play, and compare arrangements with a headline number.

**Live site:** _coming once GitHub Pages is enabled_ (`https://sirmartin1st.github.io/airflow-sim/`)

## Using the editor

- **Room** (B): drag a rectangle of walls. **Wall** (W): drag a single wall. Walls snap to a 6-inch grid.
- **Window** (N) / **Door** (D): click on a wall. **Fan** (F): click inside a room.
- **Select** (S): click anything to edit it in the side panel; drag windows, doors and fans to move them. **R** rotates a selected fan.
- **Erase** (E): click something to delete it. **Cmd/Ctrl+Z** undoes.
- Your layout autosaves in the browser. **Save file** / **Open file** keep layouts as `.json` files.
- **Person** (P): click where someone sits or sleeps; it shows the breeze (ft/min) and temperature they'd feel.
- **Examples** menu: four ready-made layouts to start from.
- **What do you want?** picks the headline number: *Feel a breeze* (average air speed at your person markers), *Cool the room down* (time to reach your target temperature), or *Fresh air everywhere* (stagnant floor area). **Save these results as A**, change something, let it run a minute, and the panel says whether the new arrangement is better or worse.
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
