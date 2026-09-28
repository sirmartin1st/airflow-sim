# Air Flow Simulator

Draw a floor plan (walls, windows, doors, fans), set the weather, and watch an animated simulation of how air moves through the space. The point is practical: **try window, door and fan arrangements and see which one gives you the airflow you want**, before moving furniture.

**▶ Live site: https://sirmartin1st.github.io/airflow-sim/**

It runs entirely in your browser. There's nothing to install, no account, and your plans stay on your computer.

## What you can do

- **Draw your space:** rooms, walls, windows and doors (open, closed or partly open), with snapping and undo.
- **Add fans:** box, pedestal and tower fans pointing any way, plus window fans blowing in or out.
- **Set the conditions:** which way your plan faces, wind speed and direction, outside and inside temperatures, surroundings (open, suburban, city), and ceiling height.
- **Watch the air:** particle trails coloured blue (cool) to red (warm), arrows, and overlays for air speed, age of air (where fresh air reaches last) and stagnant spots. Each window and door shows how much air flows in or out, in CFM.
- **Measure what matters:** drop **Person** markers where people sit or sleep to see the breeze they'd feel. Pick a goal (*feel a breeze*, *cool the room down* or *fresh air everywhere*) to get one headline number.
- **Compare arrangements:** **Save these results as A**, move a fan or open a window, let it run a minute, and the panel tells you whether the new arrangement is better or worse.
- **Start from an example:** a bedroom with a box fan, a cross-breeze apartment, a single-window room, or a small house with a window fan.
- **Save your work:** layouts autosave in your browser. **Save file** / **Open file** keep them as `.json` files.

## Using the editor

| Tool | Key | What it does |
|---|---|---|
| Select | S | Click something to edit it in the side panel; drag windows, doors, fans and people to move them. **R** rotates a selected fan. |
| Room | B | Drag a rectangle of four walls. |
| Wall | W | Drag a single wall (walls snap to a 6-inch grid). |
| Window / Door | N / D | Click on a wall. |
| Fan | F | Click inside a room. |
| Person | P | Click where someone sits or sleeps. |
| Erase | E | Click something to delete it. |

**Cmd/Ctrl+Z** undoes, **Delete** removes the selected item, and **Esc** cancels.

## How it works (in short)

Two layers work together. They are described in full, with sources, in [SCIENCE.md](SCIENCE.md):

1. **How much air comes in and out:** standard engineering airflow-network equations (the ASHRAE / NIST CONTAM approach). Wind pressure on each wall, the "stack effect" from warm air rising, and the flow through each opening combine to set the flow for every window and door.
2. **Where it goes inside:** a 2D fluid simulation of a slice at seated height (3.6 ft), with a turbulence model, floor/ceiling friction and fans. It runs in a background Web Worker so the page stays smooth.

Every physics routine is checked by automated tests against published benchmarks and exact solutions. Results are in [VALIDATION.md](VALIDATION.md).

## Honest limits

This is an approximation for **comparing arrangements**, not engineering CFD. Rising warm air and other vertical motion aren't simulated. Local air speeds can be off by 20–50%. Nearby buildings and trees aren't modelled, and fan ratings vary a lot between products. The **About & limitations** button on the site has the full list.

## Run it locally

You need Python 3 (to serve the files) and Node 18 or newer (to run the tests). There's no build step and no dependencies.

```bash
# Serve the site, then open http://localhost:8000
python3 -m http.server 8000

# Run all tests (about 5 minutes; V1 and V5 are the slow ones)
node tests/run.js

# Run one test
node tests/v3_network.js
```

`debug/envelope.html` is a small debug page showing per-window flows for a hard-coded two-window room (the envelope model only).

## Project layout

```
index.html, style.css     the page
src/main.js               wires everything together
src/constants.js          every physical constant, with its source
src/units.js              SI ↔ imperial conversions (the physics is SI inside)
src/physics/              envelope model, fluid solver, turbulence, fans, coupling (no browser code)
src/engine/               runs the simulation in a background Web Worker
src/layout/               floor-plan model and grid builder
src/render/               particle trails, arrows, overlays
src/ui/                   editor, panels, metrics, saving
presets/                  example layouts
tests/                    validation (V1–V8) and unit tests
SCIENCE.md                the physics spec (source of truth)
VALIDATION.md             latest test results
BACKLOG.md                ideas and deferred work
```
