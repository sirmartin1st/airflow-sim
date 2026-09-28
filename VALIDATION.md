# Validation Report

Results of the validation suite in SCIENCE.md §8, plus the supporting unit tests. Update this file whenever physics code changes.

**Final v1 run:** 2026-09-27, `node tests/run.js`: **17/17 test files pass** (about 5 minutes; V1 and V5 take about 2.5 minutes each).

## Validation tests (SCIENCE.md §8)

| ID | Test | What it proves | Result | Key numbers |
|---|---|---|---|---|
| V1 | Lid-driven cavity, Re 100 & 400, 64² & 128² | The Navier-Stokes solver is correct | **PASS** | Re 100: max centreline error vs Ghia et al. (1982) 0.0059 (64²), 0.0080 (128²); criterion 0.05·U. Re 400 (for information): 0.0246 (64²), 0.0081 (128²) |
| V2 | Plane Poiseuille channel | Viscous terms and walls | **PASS** | Max error 0.74% of u_max (criterion 2%) |
| V3 | Two-opening network | Layer A equations and solver | **PASS** | 4 cases (areas 0.2–1.5 m², wind 0.5–10 m/s): max relative error 2.8e-16 (criterion 1e-6) |
| V4 | Cp(β) table | Wind pressure correlation typed correctly | **PASS** | 9 angles: max error 0.0005 (criterion 0.002) |
| V5 | Fan jet decay | Realistic fan-jet reach (**calibrates c_f**) | **PASS (calibration)** | c_f = 0.2: centreline speed −21.7% … +12.3% of K·√A₀/x over 2.91–5 m (criterion ±25%) |
| V6 | Closed room conservation | Stability and conservation | **PASS** | max\|∇·u\| 5.0e-5 1/s (criterion 1e-4); kinetic energy fell every step after the fan switched off (0 increases); mean T drift 2e-11 K = 5e-10% of the initial spread (criterion 1%) |
| V7 | Stack sign | Stack-effect sign convention | **PASS** | 80 °F in / 60 °F out: +302 CFM in at the low opening, −314 CFM out at the high one; reverses when colder inside |
| V8 | Well-mixed sanity | Age tracer and ACH consistent | **PASS** | Room-average age 0.76·τ_n (criterion 0.5–1.5) |
| V9 | Cross-check vs NIST CONTAM (manual) | Layer A against an established tool | **Not done** | See "Open items" |

## Supporting tests

| Test | Checks | Result |
|---|---|---|
| Unit conversions (`tests/units_test.js`) | 14 | PASS |
| Constants sanity (`tests/constants_test.js`) | 6 | PASS |
| Layer A building blocks (`tests/envelope_test.js`) | 21 | PASS |
| Layer B building blocks (`tests/fluid_test.js`) | 10 | PASS |
| Layout model and grid (`tests/layout_test.js`) | 18 | PASS |
| Layer A ↔ B coupling (`tests/coupling_test.js`) | 10 | PASS |
| Simulation runner / worker loop (`tests/engine_test.js`) | 5 | PASS |
| Metrics: probes, time to target, comparison (`tests/metrics_test.js`) | 6 | PASS |
| Example layouts load and run (`tests/presets_test.js`) | 5 | PASS |

## What these results do and don't show

- **Validated against independent references:** V1 (published benchmark), V2 and V3 (exact solutions), V4 (published table), V7 (sign convention), V6 (conservation).
- **Calibrated, not independently validated:** V5. The floor/ceiling drag c_f was chosen so the fan jet matches the ASHRAE decay formula. c_f = 0.2 is about 50× a physical wall-friction value: it stands in for the 3D spreading a plan-view jet lacks. The model's jet decays more gradually than 1/x (−22% at 2.9 m, +12% at 5 m).
- **Passes only with an extrapolated input:** V8. It relies on the scalar mixing floor from Cheng et al. (2011), measured at 0.2–5.4 ACH. The V8 room runs at ~100 ACH on the solver's basis.
- **Not tested against measurements in real rooms.** Interior air speeds are meaningful in pattern and rough size; local values can be off by 20–50% (SCIENCE.md §1, §9).

## Open items

- **V9, CONTAM cross-check:** not done; left open by Marty's choice on 2026-09-28 (option C). It needs NIST CONTAM (a Windows desktop program, or its command-line solver) run on 2–3 layouts, with per-opening flows compared within 10%. The Layer A equations are the same orifice/airflow-network method CONTAM uses and are checked against exact solutions by V3 and V7, but V9 would confirm the whole chain (wind profile, Cp, stack, zone balance) against an established tool.

## History (decisions and findings, in order)

- **2026-09-24, Phase 2:** the single-opening unit test found that bisecting zone pressure to 1e-6 Pa left ~0.3 CFM of spurious flow in a one-window room (flow ∝ √ΔP). Bisection now runs to floating-point precision (SCIENCE.md §5.5).
- **2026-09-24, Phase 3, V1:** "within 5%" is read as max |model − Ghia| ≤ 0.05 × lid speed at Ghia's tabulated points (confirmed by Marty; SCIENCE.md §8). Ghia data were checked against a published transcription; the known Re 400 typo at x = 0.9063 is skipped.
- **2026-09-24, Phase 3, V2:** the error is uniform across the channel and shrinks with Δt (0.72% → 0.41% → 0.25% as Δt halves): the known O(Δt) splitting error of non-incremental projection at no-slip walls. It is ≈ 0.2% in a real room.
- **2026-09-24, Phase 3, V6:** semi-Lagrangian advection drifted the room-mean temperature by 0.14 K in 60 s (3.5% of the spread). Marty chose a heat-conservation correction (SCIENCE.md §6.2) and a tighter V6 criterion (1% of the initial spread instead of 0.1% of absolute temperature). Side effect: during a sharp cool front at an inlet, cells can briefly undershoot the inlet temperature (~0.3 K in a 10 K flush), which then washes out.
- **2026-09-25, Phase 4, fans:** the original relaxation actuator delivered only 50% of a fan's rated flow. Fans became fixed-flow actuators with a 0.1 s spin-up (approved by Marty; SCIENCE.md §6.6).
- **2026-09-25, Phase 4, V8:** without extra mixing, 2D recirculation eddies stayed sealed and the age kept rising (4.5·τ_n). Added the scalar mixing floor from Cheng et al. (2011) (approved by Marty; SCIENCE.md §6.5).
- **2026-09-25, Phase 4, V5:** comparison range changed from 1–5 m to K·√A₀–5 m (Marty's OK), because the formula is invalid in the jet core. c_f sweep, worst error: 0.004–0.12 → 40–76% (the jet wanders); 0.14 → 15% or 27% depending on averaging window (rejected as not robust); 0.16 → 23%; **0.2 → 22% on both windows (chosen)**; 0.25 → 27%; 0.3 → 32%; 0.4 → 40%.
- **2026-09-27, Phase 6, coupling:** a flat slice passes ~H_room/(opening height × open fraction) more air than really enters (≈ 4× for a half-open window). Marty chose option A (SCIENCE.md §6.7): true inflow speeds, zone-mean temperature from Layer A's heat balance, and the age clock scaled by the slice factor. Opening flows under 1e-6 m³/s count as zero.
- **2026-09-27, Phase 7, speed:** PCG and diffusion tolerances loosened (reasons in constants.js); all tests re-run and pass. Temperature and age share one back-trace per step. A multigrid preconditioner was tried and dropped (+8% on a house-sized grid). The solver runs in a Web Worker. Speed (Node, one full core): bedroom ~4× real time, apartment ~1.5×, 48 × 38 ft house ~0.5×.
- **2026-09-27, Phase 8, metrics:** time to target matches the exponential heat-balance solution exactly. A box fan pointed at a person gives 178 ft/min there vs 110 ft/min pointed away. Time to target is unchanged by a free-standing fan (to 0.1%), as the physics says. The "pointed away" value is inflated because a flat slice overstates intake and return currents (noted in the About panel).
