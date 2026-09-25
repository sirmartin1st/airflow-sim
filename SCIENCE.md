# SCIENCE.md — Air Flow Simulator Physics Spec

This file is the source of truth for the physics in this project. Code must match it. If the physics needs to change, update this file first, explain why, then change the code.

## 1. Purpose and honest scope

The tool answers one question: **"How do I arrange windows, doors and fans to move air through my space the way I want?"**

It is a **plan-view (top-down) simulation** of air moving horizontally through a floor at seated/standing height (default slice height 1.1 m / 3.6 ft). It is built to be:

- **Right about the envelope flow:** how much air comes in and goes out through each window and door, from wind, indoor/outdoor temperature difference and fans. This uses established engineering airflow-network equations (ASHRAE, the same approach as NIST CONTAM).
- **Qualitatively right about the interior:** where that air goes once it's inside, where jets form, where it stalls, and which corners never get fresh air. This uses a 2D incompressible Navier-Stokes solver.

It is **not** a replacement for 3D engineering CFD. Expect interior velocities to be accurate in pattern and order of magnitude, with local values possibly off by 20–50%. The site must say this on screen.

What's deliberately out of scope for v1:

- Vertical buoyancy plumes, stratification and ceiling fans (these need a vertical dimension)
- Heat gain through walls, solar gain, people and appliances (walls are adiabatic in v1)
- Humidity, pollutants other than an "age of air" tracer
- Multi-story stack effect

## 2. Architecture: two coupled layers

```
User inputs (layout, orientation, wind, temps, fans)
        │
        ▼
Layer A: ENVELOPE MODEL (airflow network, algebraic, solved every ~0.5 s sim-time)
   → volumetric flow Q through every exterior opening (+ two-way exchange)
        │  opening velocities become boundary conditions
        ▼
Layer B: INTERIOR FLOW (2D incompressible Navier-Stokes on a grid, every time step)
   → velocity field u(x,y), temperature T(x,y), age of air A(x,y)
        │
        ▼
Layer C: VISUALIZATION + METRICS
   → wispy particle trails colored by T, arrows, ACH, stagnant zones, comfort
```

Why split it this way: a 2D plan-view solver on its own gets total ventilation rates wrong, because real flow through a window depends on 3D pressure fields outside the building. The airflow-network equations are empirically validated for exactly that problem. So Layer A decides **how much** air enters and leaves, and Layer B decides **where it goes inside**.

## 3. Units and constants

All physics code uses **SI units**. The UI converts at the edges only.

| Quantity | SI (internal) | UI display | Conversion |
|---|---|---|---|
| Length | m | ft | 1 ft = 0.3048 m |
| Velocity | m/s | mph (wind), ft/min or m/s (indoor) | 1 mph = 0.44704 m/s; 1 fpm = 0.00508 m/s |
| Flow | m³/s | CFM | 1 CFM = 4.71947e-4 m³/s |
| Temperature | K (math), °C | °F | °F = °C × 9/5 + 32 |
| Pressure | Pa | Pa | — |

Physical constants (put all of these in `src/constants.js` with the source noted next to each):

| Symbol | Value | Meaning |
|---|---|---|
| g | 9.81 m/s² | gravity |
| R | 287.05 J/(kg·K) | gas constant, dry air |
| P_atm | 101325 Pa | atmospheric pressure (sea level default) |
| ν | 1.5e-5 m²/s | kinematic viscosity of air (~20 °C) |
| α | 2.1e-5 m²/s | thermal diffusivity of air (~20 °C) |
| Pr_t | 0.85 | turbulent Prandtl number |
| C_s | 0.17 | Smagorinsky constant (tunable 0.1–0.2, see §6.5) |
| C_d | 0.65 | discharge coefficient, windows/doors (ASHRAE typical range 0.6–0.7) |
| Cp(0°) | 0.6 | wall-averaged Cp, windward wall, wind normal to wall (Swami & Chandra) |

Air density from the ideal gas law: `ρ = P_atm / (R · T_K)`. Compute ρ_in and ρ_out separately; the difference drives stack pressure.

## 4. Geometry and grid

### 4.1 The grid

- Uniform square cells, default **Δ = 0.1 m** (≈4 in). Option for 0.05 m on small rooms.
- Typical footprint 10 × 12 m → 100 × 120 = 12,000 cells. Cap the domain at about 250 × 250 cells for performance.
- Use a **MAC staggered grid**: pressure, temperature and age at cell centers; u (x-velocity) on vertical cell faces; v (y-velocity) on horizontal cell faces. This is the standard arrangement that avoids checkerboard pressure errors (Harlow & Welch 1965; Bridson 2015, ch. 2).

### 4.2 Cell types

Each cell is one of: `SOLID` (wall), `FLUID` (indoor air), `OUTSIDE` (not simulated).

- **Indoor vs outdoor:** flood-fill from the grid border through non-wall cells. Everything reached is `OUTSIDE`. Everything else that isn't a wall is `FLUID`. If there's no closed envelope, show a UI error ("close the room with walls").
- **Exterior wall:** any wall cell touching both `FLUID` and `OUTSIDE`. Openings placed on exterior walls are **envelope openings** (Layer A).
- **Interior wall:** a wall touching `FLUID` on both sides. Openings on interior walls are **internal openings**. When open, their cells become `FLUID`; when closed, `SOLID`. No special physics needed.

### 4.3 Openings

Each opening stores: width w (m, along the wall), bottom height z_b and top height z_t (m above floor), open fraction (0–1, scales area), and the wall it sits on (with that wall's outward normal).

Defaults: door w = 0.9 m, z_b = 0, z_t = 2.03 m. Window w = 0.9 m, z_b = 0.9 m, z_t = 2.1 m. Double-hung/sliding windows open 50% of their area.

Effective area: `A = w · (z_t − z_b) · open_fraction`.

### 4.4 Zones

A **zone** is a connected region of `FLUID` cells. Closing an interior door can split the floor into multiple zones. Recompute zones with a flood fill whenever the layout or a door state changes. Layer A treats each zone as a single well-mixed pressure node.

## 5. Layer A — Envelope airflow model

### 5.1 Orientation and wind incidence

- The user sets the room's orientation as the **compass bearing that "up" on the grid faces** (0° = north up).
- Each exterior wall segment has an outward-normal bearing φ_wall (compass degrees), derived from its grid direction plus the room orientation.
- Wind direction θ_wind is given the meteorological way, as the direction the wind comes **from** (what weather apps show).
- **Incidence angle** for a wall: `β = |wrap180(θ_wind − φ_wall)|`, from 0° to 180°. β = 0° means wind hits the wall head-on; β = 180° means the wall is directly downwind.

### 5.2 Wind speed at the building

Weather apps report wind at 10 m in open terrain. Correct it to the building's height H (default 3 m for a single story) with the ASHRAE power-law profile:

```
U_H = U_met · (δ_met / H_met)^a_met · (H / δ)^a
```

with H_met = 10 m, a_met = 0.14, δ_met = 270 m, and site terrain from a UI dropdown:

| Terrain | a | δ (m) |
|---|---|---|
| Open (flat, few obstructions) | 0.14 | 270 |
| Suburban (default) | 0.22 | 370 |
| Urban / dense | 0.33 | 460 |

Source: ASHRAE Handbook—Fundamentals, "Airflow Around Buildings" chapter. Verify these table values against the current edition when implementing.

### 5.3 Wind pressure coefficient Cp(β)

Use the **Swami & Chandra (1988)** wall-averaged correlation for low-rise buildings, the same one used in several building-simulation tools:

```
NCp(β, G) = ln[ 1.248 − 0.703·sin(β/2) − 1.175·sin²(β) + 0.131·sin³(2βG)
               + 0.769·cos(β/2) + 0.07·G²·sin²(β/2) + 0.717·cos²(β/2) ]

Cp = Cp(0°) · NCp = 0.6 · NCp
```

- G = ln(S), where S = (length of this wall) / (length of the adjacent wall), taken from the building's footprint bounding box.
- β is in radians inside the trig functions.
- Note: the AIVC source text is ambiguous on whether the 0.131 term is cubed. It only matters when S ≠ 1. Confirm against the original paper and record the decision in a comment.

Reference values (square footprint, S = 1). Use these as unit-test targets:

| β | 0° | 30° | 45° | 60° | 90° | 120° | 135° | 150° | 180° |
|---|---|---|---|---|---|---|---|---|---|
| Cp | 0.603 | 0.469 | 0.323 | 0.119 | −0.443 | −0.681 | −0.535 | −0.390 | −0.364 |

Wind pressure on the outside of opening j:

```
P_w,j = ½ · ρ_out · Cp(β_j) · U_H²
```

### 5.4 Stack (temperature) pressure

Warm air is lighter. For an opening whose center is at height z_j above the floor, the indoor–outdoor pressure difference from temperature is:

```
ΔP_stack,j = −(ρ_out − ρ_in) · g · z_j
```

(sign convention: added to the outdoor-minus-indoor pressure difference in §5.5; recheck the sign in a unit test where warm-inside air must flow **out** of the higher of two openings).

On one story with windows at similar heights this term is small but real. It matters more for tall openings, clerestories and doors paired with high windows.

### 5.5 Orifice flow and zone pressure balance

For each envelope opening j in a zone with unknown interior pressure P_in:

```
ΔP_j = P_w,j − P_in + ΔP_stack,j                 (outside minus inside, Pa)
Q_j  = C_d · A_j · sign(ΔP_j) · sqrt( 2·|ΔP_j| / ρ_j )   (m³/s, + = inflow)
```

ρ_j = ρ_out for inflow, ρ_in for outflow.

**Mass balance:** find P_in so that

```
Σ_j ρ_j · Q_j  +  Σ_fans ρ · Q_fan,window  =  0
```

The left side is monotonic in P_in, so solve with **bisection** (bracket ±2000 Pa, tolerance 1e-6 Pa). Newton's method is fine too but bisection can't fail.

This is the standard orifice/airflow-network method (ASHRAE Fundamentals, "Ventilation and Infiltration" chapter; NIST CONTAM).

### 5.6 Window fans

A fan placed **inside** a window opening is a fixed-flow element: Q_fan = rated flow × speed setting, inflow or outflow per its direction. It adds to the mass balance in §5.5 and the remaining window area (if any) acts as a normal orifice.

### 5.7 Two-way exchange at a single opening (single-sided ventilation)

When a zone has only one opening (or net flow through an opening is small), the orifice model predicts ~zero flow, but real windows still breathe from turbulence and temperature difference. Use **de Gids & Phaff (1982)**:

```
U_eff = sqrt( C1·U_met² + C2·g·h·|ΔT| + C3 )     C1 = 0.001, C2 = 0.0035, C3 = 0.01
Q_dgp = (A / 2) · U_eff
```

h = opening height (m), ΔT = |T_out − T_in| (K), U_met = met-station wind speed (m/s).

Apply as: `Q_exchange,j = max(0, Q_dgp,j − |Q_j|)`. This is a **zero-net-mass** exchange: in Layer B it swaps indoor air for outdoor-temperature air in the cells just inside the opening, with no net velocity imposed. This is a documented heuristic for combining the two models. Flag it as such in the code.

### 5.8 Outputs of Layer A (every update)

Per opening: Q_j, ΔP_j, direction (in/out), Q_exchange,j. Per zone: P_in, total inflow Q_in = Σ max(Q_j, 0), **air changes per hour** `ACH = 3600 · Q_in / V_zone` with V_zone = floor area × ceiling height (default 2.44 m / 8 ft).

Re-solve Layer A every 0.5 s of sim time, since T_in changes as the room cools or warms. Use the zone's mean temperature from Layer B as T_in.

## 6. Layer B — Interior flow (2D incompressible Navier-Stokes)

### 6.1 Equations

Velocity **u** = (u, v), pressure p, temperature T, age of air A:

```
∂u/∂t + (u·∇)u = −(1/ρ)∇p + ∇·[(ν + ν_t)∇u] + f_fan − f_drag
∇·u = 0
∂T/∂t + (u·∇)T = ∇·[(α + ν_t/Pr_t)∇T]
∂A/∂t + (u·∇)A = ∇·[(α + ν_t/Pr_t)∇A] + 1
```

Temperature is a **passive scalar** in plan view: it's carried by the flow but doesn't push it horizontally. That's physically right for a horizontal slice. Temperature affects flow only through the stack term in Layer A.

### 6.2 Time-stepping (operator splitting, per step)

Based on Stam, "Stable Fluids" (SIGGRAPH 1999), with the upgrades noted:

1. **Apply boundary conditions** (§6.4) and fan forcing (§6.6).
2. **Advect** u, T, A with a semi-Lagrangian scheme. Use **MacCormack / BFECC** with min-max clamping (Selle et al. 2008) instead of plain first-order. Plain semi-Lagrangian smears jets out far too fast (numerical diffusion), which would make fans look weaker than they are.
3. **Diffuse** with ν_eff = ν + ν_t, implicit (a few Jacobi / Gauss-Seidel sweeps or reuse the CG solver).
4. **Floor/ceiling drag** (§6.5).
5. **Project**: solve the pressure Poisson equation `∇²p = (ρ/Δt)∇·u*`, then `u = u* − (Δt/ρ)∇p`. Use **preconditioned conjugate gradient** (incomplete Cholesky or Jacobi preconditioner). Plain Jacobi is too slow to converge on 100+ cell grids. Target residual: max |∇·u| < 1e-4 s⁻¹.
6. **Advect/diffuse scalars** T and A with the projected velocity, then add the age source (+Δt to A in every fluid cell).

Time step: `Δt = min(0.5 · Δ / max|u|, 0.05 s)`. Display simulated time on screen with a speed control (1×, 5×, 20× real time).

### 6.3 Why 2D is allowed here and where it breaks

Room air is turbulent (Re = U·L/ν ≈ 0.5 × 4 / 1.5e-5 ≈ 130,000). Two honest issues:

- Grid cells of 10 cm can't resolve turbulence. That's handled with an eddy-viscosity model (§6.5).
- **2D turbulence behaves differently from 3D.** Energy flows to large scales instead of breaking down, so 2D sims grow big, long-lived swirls that real rooms don't have. The floor/ceiling drag term (§6.5) is the standard correction for depth-averaged (shallow) flows and is calibrated against the fan jet test (§8, V5).

### 6.4 Boundary conditions

| Boundary | Velocity | T and A |
|---|---|---|
| Wall (`SOLID`) | No penetration (normal velocity = 0). Tangential: **free-slip** in v1, because 10 cm cells can't resolve wall boundary layers and no-slip would over-damp. | Zero-gradient (adiabatic wall) |
| Envelope opening, **inflow** (Q_j > 0) | Prescribed normal velocity `u_n = Q_j / A_j` into the room, uniform across the opening width | T = T_out, A = 0 |
| Envelope opening, **outflow** (Q_j < 0) | **Pressure outlet**: p = 0 (Dirichlet) on the opening face, zero-gradient velocity. The 2D solver balances mass itself. | Zero-gradient (carried out) |
| Two-way exchange (Q_exchange > 0) | No net velocity | Relax cells in a 2-cell band inside the opening toward T_out and A = 0 at rate Q_exchange / V_band |
| Open internal door | Just fluid cells | — |

Note: Layer A computes the physically correct **total** flow. The 2D solver decides how outflow splits between multiple outlets, and that split may differ slightly from Layer A. Show Layer A's numbers as the authoritative ACH and per-opening flows.

Assumption: every opening is treated as crossing the 1.1 m slice. For a high window (clerestory) this overstates its effect on the occupied zone. Show a small warning icon on openings where z_b > 1.1 m or z_t < 1.1 m.

### 6.5 Turbulence and drag

**Smagorinsky eddy viscosity** (Smagorinsky 1963):

```
ν_t = (C_s · Δ)² · |S|,    |S| = sqrt(2 S_ij S_ij)
```

with S_ij the strain-rate tensor from central differences. C_s = 0.17 default. Clamp ν_t ≤ 0.05 m²/s for stability.

**Floor/ceiling drag** (depth-averaged friction):

```
f_drag = (c_f / H_room) · |u| · u
```

with H_room the ceiling height and c_f a friction coefficient. Start at c_f = 0.004 and **calibrate** once against V5 (fan jet decay). Record the calibrated value and the test result in `src/constants.js`. Don't tune it by eye.

### 6.6 Fans (free-standing: box, pedestal, tower)

Model each fan as an **actuator region**: a rectangle w_fan wide by 2 cells deep, facing direction n̂.

- Target outlet velocity: `U_fan = Q_fan / A_fan`, where Q_fan = rated flow × speed fraction and A_fan = fan face area (w_fan × h_fan).
- Each step, in the actuator cells, relax the normal velocity toward the target: `u_n ← u_n + (U_fan − u_n) · (1 − e^(−Δt/τ))`, τ = 0.1 s.
- Intake behind the fan and the entrainment around the jet then come out of the incompressibility constraint naturally. Don't add them by hand.

Preset fans (label as **typical; check your fan's rating**, since real products vary a lot):

| Preset | Face size | Flow (high) |
|---|---|---|
| 20" box fan | 0.51 × 0.51 m | ~2,000 CFM |
| 16" pedestal fan | ⌀ 0.41 m | ~1,500 CFM |
| Tower fan | 0.10 × 0.75 m | ~500 CFM |
| Twin window fan | 0.60 × 0.30 m | ~1,200 CFM |

Speed settings map to fractions of high: low 0.5, medium 0.75, high 1.0 (approximately, since fan flow scales with rpm per the fan affinity laws).

Ceiling fans are out of scope for plan view v1: their main effect is vertical.

## 7. Layer C — Visualization and metrics

### 7.1 Wispy lines (particle trails)

- Seed 3,000–8,000 particles uniformly over fluid cells. Each has a lifetime of 3–8 s (randomized), then respawns at a random fluid cell. Particles also spawn at inflow openings proportional to Q_j.
- Move with **RK2 (midpoint)** integration using bilinear interpolation of the staggered velocity.
- Draw each particle's last ~20 positions as a fading polyline, width 1–1.5 px.
- **Color by local temperature**: diverging blue → light gray → red, centered on the midpoint between T_out and T_in at start (or a user setpoint). Blue = cooler, red = warmer. Show a legend with °F values.
- Label these honestly in the UI: they are pathlines (where air parcels actually travel), not instantaneous streamlines.

### 7.2 Arrows

Draw arrow glyphs on a coarse lattice (every ~0.5 m). Direction = local velocity; length ∝ speed, capped. Hide arrows where |u| < 0.02 m/s.

### 7.3 Metrics panel (this is where the tool earns its keep)

- **ACH** per zone (from Layer A) and a plain-English label: < 1 "stale", 1–5 "light", 5–15 "good airing", > 15 "strong cross-breeze".
- **Per-opening flow** in CFM with in/out arrows.
- **Stagnant area %**: fraction of fluid cells with time-averaged |u| < 0.05 m/s. Optional overlay.
- **Age of air map** (optional overlay): local mean age A. Shows which corners never get fresh air. For perfect mixing, room-average age equals the nominal time constant τ_n = V/Q_in.
- **Comfort probes**: the user drops "person" markers. Each shows local speed and temperature over time. Reference points from ASHRAE Standard 55: air speed below about 0.2 m/s (40 fpm) is "still air"; higher speeds give a cooling effect that grows with speed. v2 can compute the actual cooling effect with the SET method used by ASHRAE 55 / the CBE Thermal Comfort Tool. Don't hard-code a degrees-of-cooling number without that model.
- **Time to target**: sim time until zone mean temperature is within 1 °F of a user setpoint.

## 8. Validation suite (must pass before each release)

Every test lives in `tests/` and runs in Node with no browser. Record results in `VALIDATION.md` (numbers, pass/fail, date).

| ID | Test | What it proves | Pass criterion |
|---|---|---|---|
| V1 | **Lid-driven cavity**, Re = 100 and 400, 64×64 and 128×128 (turbulence model and drag off) | Core Navier-Stokes solver is correct | Centerline u and v profiles within 5% of Ghia, Ghia & Shin (1982) tabulated values (normalized by lid speed) at Re 100 |
| V2 | **Plane Poiseuille channel** (ν only, pressure-driven) | Viscous terms and walls correct | Profile within 2% of analytic parabola (note: uses no-slip walls for this test only) |
| V3 | **Two-opening network**, opposite walls, areas A1, A2, Cp1 = 0.6, Cp2 = −0.36, no ΔT | Layer A equations and solver | Q equals `C_d · U_H · sqrt(ΔCp) / sqrt(1/A1² + 1/A2²)` to 1e-6 relative |
| V4 | **Cp(β) table** in §5.3 | Correlation typed correctly | Matches table to ±0.002 |
| V5 | **Fan jet decay**: 20" box fan in a large empty room (10 × 10 m) | Interior jets have realistic reach (calibrates c_f) | Centerline velocity follows `V_x / V_0 = K · sqrt(A_0) / x`, K ≈ 5.7 (compact jet, ASHRAE/AIVC), within ±25% over 1–5 m. Note: this is a calibration, not independent validation. Say so in VALIDATION.md. |
| V6 | **Closed room conservation**: no openings, fan off after 10 s, initial temperature gradient | Stability and conservation | max |∇·u| < 1e-4 after every projection; kinetic energy decays monotonically; mean T conserved within 0.1% |
| V7 | **Stack sign**: warm inside, cool outside, one low and one high opening, no wind | Stack sign convention | Inflow at the low opening, outflow at the high one |
| V8 | **Well-mixed sanity**: one inlet, one outlet, steady | Age tracer and ACH consistent | Room-average age between 0.5·τ_n and 1.5·τ_n |
| V9 | **Cross-check vs NIST CONTAM** (manual, 2–3 layouts) | Layer A against an established tool | Per-opening flows within 10% |

## 9. Known limitations (show a short version in the UI "About" panel)

1. Plan-view slice: vertical motion, plumes and stratification aren't modeled.
2. 2D turbulence is calibrated, not resolved. Local speeds can be off by 20–50%.
3. Outside flow is represented through wall-averaged pressure coefficients. Nearby buildings, trees and fences aren't modeled beyond the terrain setting.
4. Walls are adiabatic. No solar, occupant or appliance heat in v1.
5. Fan ratings vary widely between products. Results are only as good as the fan inputs.
6. Wind is steady. Real wind gusts and shifts direction.

## 10. References

- Stam, J. (1999). "Stable Fluids." *SIGGRAPH '99 Proceedings*, 121–128.
- Bridson, R. (2015). *Fluid Simulation for Computer Graphics*, 2nd ed. CRC Press. (MAC grid, projection, PCG, boundary conditions)
- Harlow, F. H. & Welch, J. E. (1965). "Numerical calculation of time-dependent viscous incompressible flow of fluid with free surface." *Physics of Fluids* 8, 2182.
- Selle, A., Fedkiw, R., Kim, B., Liu, Y., Rossignac, J. (2008). "An Unconditionally Stable MacCormack Method." *J. Scientific Computing* 35, 350–371.
- Smagorinsky, J. (1963). "General circulation experiments with the primitive equations." *Monthly Weather Review* 91, 99–164.
- Ghia, U., Ghia, K. N., Shin, C. T. (1982). "High-Re solutions for incompressible flow using the Navier-Stokes equations and a multigrid method." *J. Computational Physics* 48, 387–411.
- ASHRAE Handbook—Fundamentals: chapters on Airflow Around Buildings, Ventilation and Infiltration, and Space Air Diffusion.
- ANSI/ASHRAE Standard 55, Thermal Environmental Conditions for Human Occupancy (elevated air speed).
- Swami, M. V. & Chandra, S. (1988). "Correlations for pressure distribution on buildings and calculation of natural-ventilation airflow." *ASHRAE Transactions* 94(1). Summary: https://www.aivc.org/sites/default/files/airbase_3283.pdf
- de Gids, W. & Phaff, H. (1982). "Ventilation rates and energy consumption due to open windows." *Air Infiltration Review* 4(1). Summarized in: https://engineering.purdue.edu/~yanchen/paper/2003-11.pdf
- Diffuser jet decay constants: https://www.aivc.org/sites/default/files/airbase_6532.pdf
- NIST CONTAM (multizone airflow network tool): https://www.nist.gov/services-resources/software/contam
- CBE Thermal Comfort Tool (ASHRAE 55 calculations): https://comfort.cbe.berkeley.edu
