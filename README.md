# Air Flow Simulator

Draw a floor plan (walls, doors, windows, fans), set the outdoor conditions, and watch an animated simulation of how air moves through the space. The goal is to help you work out how to arrange windows, doors and fans to get the airflow you want.

**Status:** Phase 1 (repo skeleton). No simulation yet.

**Live site:** _coming once GitHub Pages is enabled_ (`https://sirmartin1st.github.io/airflow-sim/`)

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
